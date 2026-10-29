import type { Request, Response, Router } from "express";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { CONFIG } from "../src/config";
import { BASE_AGENT } from "../src/vendor/managed-agents.js";

const rootDir = process.cwd();

const UPSTREAM = (process.env.GEMINI_UPSTREAM || "https://generativelanguage.googleapis.com").replace(/\/$/, "");

const PLACEHOLDER_KEYS = new Set([
  "",
  "MY_GEMINI_API_KEY",
  "PLACEHOLDER_API_KEY",
  "YOUR_GEMINI_API_KEY",
  "YOUR_API_KEY",
  "unused",
]);

const EPHEMERAL_DEV_ADMIN_TOKEN = crypto.randomBytes(24).toString("hex");

export function getEffectiveAdminToken(): string {
  if (process.env.ADMIN_TOKEN) {
    return process.env.ADMIN_TOKEN;
  }
  if (process.env.NODE_ENV === "production") {
    return "";
  }
  return EPHEMERAL_DEV_ADMIN_TOKEN;
}

export function getServerApiKey(): string | undefined {
  // Check AI Studio container .dev.env.json first so runtime secret rotation takes effect without restart
  const jsonEnvFiles = [
    path.join(rootDir, ".dev.env.json"),
    "/tmp/.dev.env.json",
    "/app/.dev.env.json",
  ];
  for (const file of jsonEnvFiles) {
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        const val = parsed?.GEMINI_API_KEY || parsed?.API_KEY;
        if (typeof val === "string" && !PLACEHOLDER_KEYS.has(val.trim())) {
          return val.trim();
        }
      }
    } catch {
      // ignore
    }
  }

  const envCandidates = [process.env.GEMINI_API_KEY, process.env.API_KEY];
  for (const candidate of envCandidates) {
    if (typeof candidate === "string" && !PLACEHOLDER_KEYS.has(candidate.trim())) {
      return candidate.trim();
    }
  }

  return undefined;
}

let bakedForApiKey: string | null = null;
let inFlightBakeKey: string | null = null;
let activeBakePromise: Promise<void> | null = null;

export function invalidateGamesmithBakeCache(): void {
  bakedForApiKey = null;
  inFlightBakeKey = null;
  activeBakePromise = null;
}

export function ensureGamesmithBaked(apiKey?: string): Promise<void> {
  const key = apiKey || getServerApiKey();
  if (!key) return Promise.resolve();
  if ((bakedForApiKey === key || inFlightBakeKey === key) && activeBakePromise) {
    return activeBakePromise;
  }
  const bakeScript = path.join(rootDir, "scripts", "bake-agent.mjs");
  if (!fs.existsSync(bakeScript)) {
    return Promise.resolve();
  }
  inFlightBakeKey = key;
  activeBakePromise = new Promise<void>((resolve) => {
    execFile(
      process.execPath,
      [bakeScript, "--if-missing"],
      { cwd: rootDir, env: { ...process.env, GEMINI_API_KEY: key } },
      (err, stdout) => {
        inFlightBakeKey = null;
        if (err) {
          console.warn("[playglow-server] background bake-agent check warning:", err.message);
          bakedForApiKey = null;
          activeBakePromise = null;
        } else {
          bakedForApiKey = key;
          if (stdout) {
            console.log("[playglow-server] gamesmith-v1 ready on active project key");
          }
        }
        resolve();
      }
    );
  });
  return activeBakePromise;
}

const HOP_REQ_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "accept-encoding",
  "x-goog-api-key",
  "authorization",
  "x-admin-token",
  "x-guardrail-probe",
  "x-selftest",
  "origin",
  "referer",
  "cookie",
]);

const HOP_RES_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
]);

interface WindowCounter {
  timestamps: number[];
}

const ipBuildCounters = new Map<string, WindowCounter>();
const ipImageCounters = new Map<string, WindowCounter>();
const probeBuildCounters = new Map<string, WindowCounter>();
const globalBuildCounter: WindowCounter = { timestamps: [] };

const ONE_HOUR_MS = 3600_000;
const STREAM_HUB_TTL_MS = 15 * 60_000;

interface NormalizedFrame {
  eventId: string;
  sseText: string;
}

interface StreamHubEntry {
  interactionId: string;
  createdAt: number;
  frames: NormalizedFrame[];
  done: boolean;
  abortController: AbortController;
  subscribers: Set<(frame: NormalizedFrame | null) => void>;
}

const streamHub = new Map<string, StreamHubEntry>();
const cancelledInteractions = new Map<string, number>();

function pruneCounterMap(map: Map<string, WindowCounter>, now: number): void {
  for (const [k, counter] of map.entries()) {
    counter.timestamps = counter.timestamps.filter((t) => now - t < ONE_HOUR_MS);
    if (counter.timestamps.length === 0) {
      map.delete(k);
    }
  }
}

function pruneHub(now: number): void {
  for (const [id, entry] of streamHub.entries()) {
    if (now - entry.createdAt > STREAM_HUB_TTL_MS) {
      if (!entry.done) {
        try {
          entry.abortController.abort();
        } catch {
          // ignore
        }
      }
      streamHub.delete(id);
    }
  }
  for (const [id, ts] of cancelledInteractions.entries()) {
    if (now - ts > STREAM_HUB_TTL_MS) {
      cancelledInteractions.delete(id);
    }
  }
  pruneCounterMap(ipBuildCounters, now);
  pruneCounterMap(ipImageCounters, now);
  pruneCounterMap(probeBuildCounters, now);
}

class SseNormalizer {
  private seenCreated = false;
  private deltaSeqByStep = new Map<number, number>();
  private genericSeq = 0;
  private pendingStepStart: { eventName: string; obj: any } | null = null;

  processRawBlock(rawBlock: string): NormalizedFrame[] {
    const out: NormalizedFrame[] = [];
    const lines = rawBlock.split(/\r?\n/);
    let eventName = "";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) return out;
    const payload = dataLines.join("\n").trim();

    if (payload === "[DONE]") {
      if (this.pendingStepStart) {
        out.push(this.finalizeObject(this.pendingStepStart.eventName, this.pendingStepStart.obj));
        this.pendingStepStart = null;
      }
      out.push({
        eventId: "__DONE__",
        sseText: `event: done\ndata: [DONE]\n\n`,
      });
      return out;
    }

    let obj: any;
    try {
      obj = JSON.parse(payload);
    } catch {
      return out;
    }

    // Rule A: Deduplicate repeated interaction.created frames emitted by GET ?stream=true
    if (obj.event_type === "interaction.created") {
      if (this.seenCreated) {
        return out;
      }
      this.seenCreated = true;
    }

    // Rule B: Merge split step.start + step.delta for code_execution_call / code_execution_result
    if (this.pendingStepStart) {
      const pendingObj = this.pendingStepStart.obj;
      if (
        obj.event_type === "step.delta" &&
        obj.index === pendingObj.index &&
        (obj.delta?.type === "code_execution_call" || obj.delta?.type === "code_execution_result")
      ) {
        if (obj.delta.arguments !== undefined) pendingObj.step.arguments = obj.delta.arguments;
        if (obj.delta.result !== undefined) pendingObj.step.result = obj.delta.result;
        if (obj.delta.is_error !== undefined) pendingObj.step.is_error = obj.delta.is_error;
        if (obj.delta.exit_code !== undefined) pendingObj.step.exit_code = obj.delta.exit_code;
        out.push(this.finalizeObject(this.pendingStepStart.eventName, pendingObj));
        this.pendingStepStart = null;
        return out;
      } else {
        out.push(this.finalizeObject(this.pendingStepStart.eventName, pendingObj));
        this.pendingStepStart = null;
      }
    }

    if (
      obj.event_type === "step.start" &&
      ((obj.step?.type === "code_execution_call" && obj.step.arguments === undefined) ||
        (obj.step?.type === "code_execution_result" && obj.step.result === undefined))
    ) {
      this.pendingStepStart = { eventName: eventName || "step.start", obj };
      return out;
    }

    out.push(this.finalizeObject(eventName || obj.event_type || "message", obj));
    return out;
  }

  flush(): NormalizedFrame[] {
    if (!this.pendingStepStart) return [];
    const frame = this.finalizeObject(this.pendingStepStart.eventName, this.pendingStepStart.obj);
    this.pendingStepStart = null;
    return [frame];
  }

  private finalizeObject(eventName: string, obj: any): NormalizedFrame {
    if (!obj.event_id) {
      const t = obj.event_type || eventName;
      if (t === "interaction.created") {
        obj.event_id = "evt_created";
      } else if (t === "interaction.status_update") {
        obj.event_id = `evt_status_${obj.status || "update"}`;
      } else if (t === "step.start") {
        obj.event_id = `evt_step_${obj.index ?? 0}_start`;
      } else if (t === "step.delta") {
        const idx = obj.index ?? 0;
        const seq = (this.deltaSeqByStep.get(idx) || 0) + 1;
        this.deltaSeqByStep.set(idx, seq);
        obj.event_id = `evt_step_${idx}_delta_${seq}`;
      } else if (t === "step.stop") {
        obj.event_id = `evt_step_${obj.index ?? 0}_stop`;
      } else if (typeof t === "string" && t.startsWith("interaction.")) {
        obj.event_id = `evt_terminal_${t}`;
      } else {
        this.genericSeq += 1;
        obj.event_id = `evt_${this.genericSeq}`;
      }
    }
    const eventId = String(obj.event_id);
    const sseText = `${eventName ? `event: ${eventName}\n` : ""}id: ${eventId}\ndata: ${JSON.stringify(obj)}\n\n`;
    return { eventId, sseText };
  }
}

function pruneAndCount(counter: WindowCounter, now: number): number {
  counter.timestamps = counter.timestamps.filter((t) => now - t < ONE_HOUR_MS);
  return counter.timestamps.length;
}

function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "127.0.0.1";
}

function isAdmin(req: Request): boolean {
  const adminToken = getEffectiveAdminToken();
  if (!adminToken) return false;
  const headerToken = req.headers["x-admin-token"];
  return typeof headerToken === "string" && headerToken === adminToken;
}

export function isSelftestContext(req: Request): boolean {
  if (isAdmin(req)) return true;
  if (req.headers["x-selftest"] === "1" || req.query.selftest !== undefined) return true;
  const ref = req.headers.referer || "";
  return ref.includes("selftest");
}

const ALLOWED_PATTERNS: Array<{ method: string; regex: RegExp; selftestOnly?: boolean }> = [
  { method: "POST", regex: /^\/v1beta\/interactions$/ },
  { method: "GET", regex: /^\/v1beta\/interactions\/[^/]+$/ },
  { method: "POST", regex: /^\/v1beta\/interactions\/[^/]+\/cancel$/ },
  { method: "DELETE", regex: /^\/v1beta\/interactions\/[^/]+$/ },
  { method: "GET", regex: /^\/v1beta\/environments\/[^/]+\/files(\/.*)?$/ },
  { method: "DELETE", regex: /^\/v1beta\/environments\/[^/]+$/ },
  { method: "GET", regex: /^\/v1beta\/agents\/[^/]+$/ },
  { method: "POST", regex: /^\/v1beta\/models\/[^/:]+:generateContent$/ },
  { method: "GET", regex: /^\/v1beta\/environments$/, selftestOnly: true },
];

const ALLOWED_BASE_AGENTS = new Set([
  BASE_AGENT,
  "antigravity-preview-09-2026",
]);

function checkAllowedPath(req: Request, v1Path: string): { ok: boolean; status?: number; message?: string } {
  for (const rule of ALLOWED_PATTERNS) {
    if (rule.method === req.method && rule.regex.test(v1Path)) {
      if (rule.selftestOnly && !isSelftestContext(req)) {
        return { ok: false, status: 403, message: "GET /v1beta/environments is only allowed during ?selftest" };
      }
      return { ok: true };
    }
  }
  return { ok: false, status: 403, message: `${req.method} ${v1Path} is not allowlisted on /api/gemini` };
}

export function resetProbeCaps(): void {
  probeBuildCounters.clear();
}

export function resetAllCaps(): void {
  ipBuildCounters.clear();
  ipImageCounters.clear();
  probeBuildCounters.clear();
  globalBuildCounter.timestamps = [];
}

function writeSseHeaders(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

function flushRes(res: Response, chunk: string | Buffer): void {
  if (res.writableEnded) return;
  res.write(chunk);
  const flushable = res as Response & { flush?: () => void };
  if (typeof flushable.flush === "function") {
    flushable.flush();
  }
}

function attachClientToHubEntry(entry: StreamHubEntry, res: Response, lastEventId?: string | null): void {
  writeSseHeaders(res);

  let startIndex = 0;
  if (lastEventId) {
    const idx = entry.frames.findIndex((f) => f.eventId === lastEventId);
    if (idx !== -1) {
      startIndex = idx + 1;
    }
  }

  for (let i = startIndex; i < entry.frames.length; i++) {
    flushRes(res, entry.frames[i].sseText);
  }

  if (entry.done) {
    res.end();
    return;
  }

  const onFrame = (frame: NormalizedFrame | null) => {
    if (res.writableEnded) {
      entry.subscribers.delete(onFrame);
      return;
    }
    if (frame === null) {
      entry.subscribers.delete(onFrame);
      res.end();
      return;
    }
    flushRes(res, frame.sseText);
  };

  entry.subscribers.add(onFrame);
  res.on("close", () => {
    entry.subscribers.delete(onFrame);
  });
}

export function createGeminiProxyRouter(): Router {
  const router = express.Router();

  router.use(express.raw({ type: "*/*", limit: "15mb" }));

  router.use(async (req: Request, res: Response) => {
    const now = Date.now();
    pruneHub(now);

    const subPath = req.path.startsWith("/") ? req.path : `/${req.path}`;
    const v1Match = subPath.match(/\/v1beta\/.*$/);
    const v1Path = v1Match ? v1Match[0] : subPath;

    const allowCheck = checkAllowedPath(req, v1Path);
    if (!allowCheck.ok) {
      res.status(allowCheck.status || 403).json({ error: { message: allowCheck.message } });
      return;
    }

    const admin = isAdmin(req);
    const ip = getClientIp(req);
    const isProbe = req.headers["x-guardrail-probe"] === "1";
    const isAiStudioDev =
      (process.env.NODE_ENV !== "production" ||
        process.env.DISABLE_HMR === "true" ||
        Boolean(process.env.K_SERVICE)) &&
      !isProbe;

    const capBuildsPerIp = isAiStudioDev
      ? Number(process.env.CAP_BUILDS_PER_IP_HOUR || 60)
      : Number(process.env.CAP_BUILDS_PER_IP_HOUR || 3);
    const capBuildsGlobal = Number(process.env.CAP_BUILDS_GLOBAL_HOUR || 60);
    const capImagesPerIp = isAiStudioDev
      ? Number(process.env.CAP_IMAGES_PER_IP_HOUR || 180)
      : Number(process.env.CAP_IMAGES_PER_IP_HOUR || 36);

    // 1. Handle POST /v1beta/interactions/{id}/cancel
    const cancelMatch = req.method === "POST" ? v1Path.match(/^\/v1beta\/interactions\/([^/]+)\/cancel$/) : null;
    if (cancelMatch) {
      const interactionId = cancelMatch[1];
      cancelledInteractions.set(interactionId, now);

      const hubEntry = streamHub.get(interactionId);
      if (hubEntry && !hubEntry.done) {
        hubEntry.abortController.abort();
        hubEntry.done = true;
        for (const sub of hubEntry.subscribers) sub(null);
        hubEntry.subscribers.clear();
      }

      const apiKey = getServerApiKey();
      if (!apiKey) {
        res.status(503).json({
          error: {
            code: "MISSING_SERVER_GEMINI_KEY",
            message: "Server missing GEMINI_API_KEY",
          },
        });
        return;
      }

      try {
        const cancelRes = await fetch(`${UPSTREAM}/v1beta/interactions/${interactionId}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: "{}",
        });
        if (cancelRes.ok) {
          const data = await cancelRes.json().catch(() => ({}));
          res.status(200).json({ id: interactionId, status: "cancelled", object: "interaction", ...data });
          return;
        }
        // Fallback: preview API terminates in-progress interactions via DELETE /v1beta/interactions/{id}
        await fetch(`${UPSTREAM}/v1beta/interactions/${interactionId}`, {
          method: "DELETE",
          headers: { "x-goog-api-key": apiKey },
        }).catch(() => {});
        res.status(200).json({ id: interactionId, status: "cancelled", object: "interaction" });
        return;
      } catch {
        res.status(200).json({ id: interactionId, status: "cancelled", object: "interaction" });
        return;
      }
    }

    // 2. Handle GET /v1beta/interactions/{id} when cancelled or when reconnecting to an active hub stream
    const getInteractionMatch = req.method === "GET" ? v1Path.match(/^\/v1beta\/interactions\/([^/]+)$/) : null;
    if (getInteractionMatch) {
      const interactionId = getInteractionMatch[1];
      const isStreamReq = req.query.stream === "true" || (req.headers.accept || "").includes("text/event-stream");
      const lastEventId = typeof req.query.last_event_id === "string" ? req.query.last_event_id : null;

      if (!isStreamReq && cancelledInteractions.has(interactionId)) {
        res.status(200).json({ id: interactionId, status: "cancelled", object: "interaction" });
        return;
      }

      if (isStreamReq) {
        const hubEntry = streamHub.get(interactionId);
        if (hubEntry) {
          attachClientToHubEntry(hubEntry, res, lastEventId);
          return;
        }
      }
    }

    // 3. Guardrails for POST /v1beta/interactions
    let isStreamingCreate = false;
    let isGamesmithRequest = false;
    if (req.method === "POST" && v1Path === "/v1beta/interactions") {
      let bodyJson: Record<string, any> | null = null;
      try {
        const text = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : "";
        bodyJson = text ? JSON.parse(text) : {};
      } catch {
        res.status(400).json({ error: { message: "Invalid JSON body in POST /v1beta/interactions" } });
        return;
      }

      isStreamingCreate = Boolean(bodyJson?.stream);

      const requestedModel = typeof bodyJson?.model === "string" ? bodyJson.model.replace(/^models\//, "") : "";
      const requestedAgent = bodyJson?.agent;
      const isDirectModelInteraction =
        !requestedAgent &&
        (["gemini-4-argon", "gemini-3.8-flash"].includes(
          requestedModel
        ) || requestedModel.startsWith("gemini-"));

      if (!isDirectModelInteraction) {
        const maxTokens = bodyJson?.agent_config?.max_total_tokens;
        if (
          typeof maxTokens !== "number" ||
          !Number.isFinite(maxTokens) ||
          maxTokens <= 0 ||
          maxTokens > CONFIG.MAX_AGENT_TOKENS
        ) {
          res.status(400).json({
            error: {
              message: `POST /interactions requires agent_config.max_total_tokens between 1 and ${CONFIG.MAX_AGENT_TOKENS}`,
            },
          });
          return;
        }

        const isAllowedAgent =
          requestedAgent === CONFIG.GAMESMITH_AGENT ||
          ALLOWED_BASE_AGENTS.has(requestedAgent);
        if (!isAllowedAgent) {
          res.status(403).json({
            error: {
              message: `Agent "${requestedAgent}" is not allowed. Only "${CONFIG.GAMESMITH_AGENT}" or "${BASE_AGENT}" is permitted.`,
            },
          });
          return;
        }

        isGamesmithRequest = requestedAgent === CONFIG.GAMESMITH_AGENT;

        if (isProbe) {
          if (!admin) {
            let probeCounter = probeBuildCounters.get(ip);
            if (!probeCounter) {
              probeCounter = { timestamps: [] };
              probeBuildCounters.set(ip, probeCounter);
            }
            const probeCount = pruneAndCount(probeCounter, now);
            if (probeCount >= capBuildsPerIp) {
              res.status(429).json({
                error: {
                  message: `Rate limit exceeded: max ${capBuildsPerIp} builds per IP per hour`,
                },
              });
              return;
            }
            probeCounter.timestamps.push(now);
          }
          res.status(200).json({ ok: true, probe: true });
          return;
        }

        if (!admin) {
          let ipCounter = ipBuildCounters.get(ip);
          if (!ipCounter) {
            ipCounter = { timestamps: [] };
            ipBuildCounters.set(ip, ipCounter);
          }
          const ipCount = pruneAndCount(ipCounter, now);
          const globalCount = pruneAndCount(globalBuildCounter, now);

          if (ipCount >= capBuildsPerIp) {
            res.status(429).json({
              error: {
                message: `Rate limit exceeded: max ${capBuildsPerIp} builds per IP per hour`,
              },
            });
            return;
          }
          if (globalCount >= capBuildsGlobal) {
            res.status(429).json({
              error: {
                message: `Global rate limit exceeded: max ${capBuildsGlobal} builds per hour`,
              },
            });
            return;
          }

          ipCounter.timestamps.push(now);
          globalBuildCounter.timestamps.push(now);
        }

        if (ALLOWED_BASE_AGENTS.has(requestedAgent) && bodyJson) {
          bodyJson.agent_config = {
            ...bodyJson.agent_config,
            type: "antigravity",
            model: bodyJson.agent_config?.model || CONFIG.AGENT_MODEL,
          };
          req.body = Buffer.from(JSON.stringify(bodyJson), "utf8");
        } else if (bodyJson?.agent_config) {
          // Custom agents (e.g. gamesmith-v1) already have base_agent & model
          // baked in and upstream returns 400 "AntigravityConfig cannot be overridden for custom agents" if agent_config is sent on POST /interactions.
          delete bodyJson.agent_config;
          req.body = Buffer.from(JSON.stringify(bodyJson), "utf8");
        }
      }
    }

    // 4. Guardrails for POST /v1beta/models/{model}:generateContent (image rate limit)
    if (req.method === "POST" && /^\/v1beta\/models\/[^/:]+:generateContent$/.test(v1Path)) {
      let isImageCall = /image|banana|imagen/i.test(v1Path);
      if (!isImageCall && Buffer.isBuffer(req.body)) {
        try {
          const parsed = JSON.parse(req.body.toString("utf8"));
          const modalities =
            parsed?.generationConfig?.responseModalities ||
            parsed?.config?.responseModalities ||
            [];
          if (Array.isArray(modalities) && modalities.includes("IMAGE")) {
            isImageCall = true;
          }
        } catch {
          // ignore parse error
        }
      }

      if (isImageCall && !admin) {
        let imgCounter = ipImageCounters.get(ip);
        if (!imgCounter) {
          imgCounter = { timestamps: [] };
          ipImageCounters.set(ip, imgCounter);
        }
        const count = pruneAndCount(imgCounter, now);
        if (count >= capImagesPerIp) {
          res.status(429).json({
            error: {
              message: `Image rate limit exceeded: max ${capImagesPerIp} images per IP per hour`,
            },
          });
          return;
        }
        imgCounter.timestamps.push(now);
      }
    }

    const apiKey = getServerApiKey();
    if (!apiKey) {
      res.status(503).json({
        error: {
          code: "MISSING_SERVER_GEMINI_KEY",
          message: "Server missing GEMINI_API_KEY",
        },
      });
      return;
    }

    // Ensure gamesmith-v1 is baked on the active project key (and await if this request targets gamesmith-v1)
    const bakeTask = ensureGamesmithBaked(apiKey);
    if (isGamesmithRequest || v1Path === `/v1beta/agents/${CONFIG.GAMESMITH_AGENT}`) {
      await Promise.race([
        bakeTask,
        new Promise<void>((r) => setTimeout(r, 25_000)),
      ]);
    }

    // Forward to upstream
    const queryStr = req.originalUrl.includes("?")
      ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
      : "";
    const upstreamParams = new URLSearchParams(queryStr);
    upstreamParams.delete("selftest");
    const requestedLastEventId = upstreamParams.get("last_event_id");
    const qs = upstreamParams.toString();
    const targetUrl = `${UPSTREAM}${subPath}${qs ? `?${qs}` : ""}`;

    const outHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (HOP_REQ_HEADERS.has(k.toLowerCase())) continue;
      if (typeof v === "string") outHeaders[k] = v;
      else if (Array.isArray(v)) outHeaders[k] = v.join(", ");
    }
    outHeaders["x-goog-api-key"] = apiKey;

    // For streaming POST /v1beta/interactions, do NOT abort upstream when client socket drops so reconnects succeed
    const upstreamAbort = new AbortController();
    if (!isStreamingCreate) {
      res.on("close", () => {
        if (!res.writableEnded) {
          upstreamAbort.abort();
        }
      });
    }

    try {
      const hasBody = !["GET", "HEAD"].includes(req.method) && Buffer.isBuffer(req.body) && req.body.length > 0;
      const upstreamRes = await fetch(targetUrl, {
        method: req.method,
        headers: outHeaders,
        body: hasBody ? req.body : undefined,
        signal: upstreamAbort.signal,
      });

      if (
        (upstreamRes.status === 404 || upstreamRes.status === 400) &&
        (isGamesmithRequest || v1Path === `/v1beta/agents/${CONFIG.GAMESMITH_AGENT}`)
      ) {
        invalidateGamesmithBakeCache();
        void ensureGamesmithBaked(apiKey);
      }

      const contentType = upstreamRes.headers.get("content-type") || "";
      const isInteractionSse =
        upstreamRes.ok &&
        contentType.includes("text/event-stream") &&
        v1Path.startsWith("/v1beta/interactions") &&
        upstreamRes.body;

      if (isInteractionSse && upstreamRes.body) {
        // Normalize SSE frames, populate event_id, support StreamHub + last_event_id resume
        writeSseHeaders(res);

        let hubEntry = null as StreamHubEntry | null;
        const normalizer = new SseNormalizer();
        const reader = upstreamRes.body.getReader();
        const dec = new TextDecoder();
        let buf = "";

        let skippingUntil = !isStreamingCreate ? requestedLastEventId : null;
        let foundLast = !skippingUntil;

        const handleFrames = (frames: NormalizedFrame[]) => {
          for (const frame of frames) {
            if (!hubEntry && isStreamingCreate && frame.eventId === "evt_created") {
              const m = frame.sseText.match(/"id"\s*:\s*"(v1_[^"]+)"/);
              if (m) {
                const iid = m[1];
                hubEntry = {
                  interactionId: iid,
                  createdAt: Date.now(),
                  frames: [],
                  done: false,
                  abortController: upstreamAbort,
                  subscribers: new Set(),
                };
                streamHub.set(iid, hubEntry);
              }
            }

            if (hubEntry) {
              hubEntry.frames.push(frame);
              for (const sub of hubEntry.subscribers) {
                sub(frame);
              }
            }

            if (!foundLast) {
              if (frame.eventId === skippingUntil) {
                foundLast = true;
              }
              continue;
            }

            flushRes(res, frame.sseText);
          }
        };

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let sepIdx: number;
            while ((sepIdx = buf.indexOf("\n\n")) !== -1) {
              const rawBlock = buf.slice(0, sepIdx);
              buf = buf.slice(sepIdx + 2);
              handleFrames(normalizer.processRawBlock(rawBlock));
            }
          }
          if (buf.trim()) {
            handleFrames(normalizer.processRawBlock(buf));
          }
          handleFrames(normalizer.flush());
        } catch {
          // Upstream closed or aborted
        } finally {
          if (hubEntry) {
            hubEntry.done = true;
            for (const sub of hubEntry.subscribers) {
              sub(null);
            }
            hubEntry.subscribers.clear();
          }
          if (!res.writableEnded) {
            res.end();
          }
        }
        return;
      }

      res.status(upstreamRes.status);

      upstreamRes.headers.forEach((val, key) => {
        const lower = key.toLowerCase();
        if (HOP_RES_HEADERS.has(lower)) return;
        if (lower === "location") {
          const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
          const host = req.headers.host || "localhost:8787";
          const base = `${proto}://${host}/api/gemini`;
          res.setHeader("Location", val.replace(UPSTREAM, base));
          return;
        }
        res.setHeader(key, val);
      });

      if (contentType.includes("text/event-stream")) {
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();
      }

      if (!upstreamRes.body) {
        res.end();
        return;
      }

      const reader = upstreamRes.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            flushRes(res, Buffer.from(value));
          }
        }
        res.end();
      } catch {
        if (!res.writableEnded) {
          res.end();
        }
      }
    } catch (err: any) {
      if (upstreamAbort.signal.aborted) {
        if (!res.writableEnded) res.end();
        return;
      }
      if (!res.headersSent) {
        res.status(502).json({ error: { message: `Upstream error: ${err?.message || String(err)}` } });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  return router;
}
