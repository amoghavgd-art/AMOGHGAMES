import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  createGeminiProxyRouter,
  resetAllCaps,
  resetProbeCaps,
  isSelftestContext,
  getEffectiveAdminToken,
  getServerApiKey,
  ensureGamesmithBaked,
} from "./gemini-proxy";

const rootDir = process.cwd();

function parseCliArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1] && !args[i + 1].startsWith("-")) {
      return args[i + 1];
    }
    if (args[i].startsWith(`${flag}=`)) {
      return args[i].slice(flag.length + 1);
    }
  }
  return undefined;
}

function ensureCartHostBuilt(): void {
  const hostHtmlPath = path.join(rootDir, "public", "cart", "host.html");
  const buildCartScript = path.join(rootDir, "scripts", "build-cart.mjs");
  if (!fs.existsSync(hostHtmlPath) && fs.existsSync(buildCartScript)) {
    try {
      execFileSync(process.execPath, [buildCartScript], { cwd: rootDir, stdio: "inherit" });
    } catch (err: any) {
      console.warn("[playglow-server] build-cart warning:", err?.message || err);
    }
  }
}

async function startServer(): Promise<void> {
  ensureCartHostBuilt();

  const app = express();
  app.use(cors());

  app.get("/api/healthz", (_req, res) => {
    res.json({
      ok: true,
      hasServerApiKey: Boolean(getServerApiKey()),
    });
  });

  // Admin endpoint to reset rate-limit counters (used by ?selftest Check 9)
  app.post("/api/admin/reset-caps", (req, res) => {
    const adminToken = getEffectiveAdminToken();
    const provided = req.headers["x-admin-token"];
    const validAdmin = Boolean(adminToken && provided === adminToken);
    const isAiStudioDev =
      process.env.NODE_ENV !== "production" ||
      process.env.DISABLE_HMR === "true" ||
      Boolean(process.env.K_SERVICE);

    if (validAdmin || isAiStudioDev) {
      resetAllCaps();
      res.json({ ok: true });
      return;
    }

    if (isSelftestContext(req)) {
      resetProbeCaps();
      res.json({ ok: true, probeOnly: true });
      return;
    }

    res.status(401).json({ error: { message: "Unauthorized: invalid or missing x-admin-token" } });
  });

  // Selftest helper endpoint: provides ADMIN_TOKEN only when running on local loopback, in AI Studio dev container during ?selftest, or when ALLOW_REMOTE_SELFTEST=true
  app.get("/api/admin/selftest-token", (req, res) => {
    const host = req.headers.host || "";
    const hasForwardedFor = Boolean(req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"]);
    const isLocalHostHeader =
      host === "localhost" ||
      host.startsWith("localhost:") ||
      host === "127.0.0.1" ||
      host.startsWith("127.0.0.1:");
    const isStrictLocalDev =
      !hasForwardedFor &&
      isLocalHostHeader &&
      process.env.NODE_ENV !== "production" &&
      (req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1");

    const isAiStudioSelftest =
      (process.env.NODE_ENV !== "production" ||
        process.env.DISABLE_HMR === "true" ||
        Boolean(process.env.K_SERVICE)) &&
      isSelftestContext(req);

    const allowRemoteSelftest = process.env.ALLOW_REMOTE_SELFTEST === "true";

    const adminToken = getEffectiveAdminToken();
    const validHeader = Boolean(adminToken) && req.headers["x-admin-token"] === adminToken;

    if (!isStrictLocalDev && !isAiStudioSelftest && !allowRemoteSelftest && !validHeader) {
      res.status(403).json({ error: { message: "Forbidden" } });
      return;
    }
    res.json({ adminToken });
  });

  // Mount Gemini proxy at /api/gemini BEFORE static / Vite middleware
  app.use("/api/gemini", createGeminiProxyRouter());

  const distDir = path.join(rootDir, "dist");
  const distIndexHtml = path.join(distDir, "index.html");
  const isBundledServer = Boolean(process.argv[1]?.endsWith("server.cjs"));
  const hasViteSource = fs.existsSync(path.join(rootDir, "src", "main.tsx"));
  const useStaticDist =
    (process.env.NODE_ENV === "production" ||
      process.env.USE_DIST === "1" ||
      isBundledServer ||
      !hasViteSource) &&
    fs.existsSync(distIndexHtml);

  if (useStaticDist) {
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(distIndexHtml);
    });
  } else {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        root: rootDir,
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (err: any) {
      if (fs.existsSync(distIndexHtml)) {
        app.use(express.static(distDir));
        app.use((_req, res) => {
          res.sendFile(distIndexHtml);
        });
      } else {
        console.error("[playglow-server] Failed to initialize Vite middleware:", err?.message || err);
      }
    }
  }

  const cliPort = parseCliArg("--port");
  const cliHost = parseCliArg("--host");
  const port = Number(cliPort || process.env.PORT || process.env.API_PORT || 8787);
  const listenHost = cliHost || process.env.HOST || "0.0.0.0";

  app.listen(port, listenHost, () => {
    console.log(`[playglow-server] listening on http://${listenHost}:${port}`);
    void ensureGamesmithBaked();
  });
}

startServer().catch((err) => {
  console.error("[playglow-server] Fatal startup error:", err);
  process.exit(1);
});
