#!/usr/bin/env node
// scripts/bake-agent.mjs — Bake the pre-configured "gamesmith-v1" managed agent
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ManagedAgents,
  BASE_AGENT,
  DEFAULT_MODEL,
  agentsMd,
  codeExecution,
  inline,
} from "../src/vendor/managed-agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const AGENT_ID = process.env.GAMESMITH_AGENT || "gamesmith-v1";
const BASE_AGENT_ID = process.env.AGENT_ID || BASE_AGENT;
const MODEL = process.env.GAMESMITH_MODEL || DEFAULT_MODEL;
const MAX_TOKENS = 400_000;
const isDryRun = process.argv.includes("--dry-run");
const isIfMissing = process.argv.includes("--if-missing");

function readRepoFile(relPath) {
  const full = path.join(rootDir, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing required file for agent bundle: ${relPath}`);
  }
  return fs.readFileSync(full, "utf8");
}

async function main() {
  const systemInstruction = readRepoFile("agents/gamesmith/SYSTEM.md");
  const agentsMdContent = readRepoFile("agent/.agents/AGENTS.md");

  const engineFiles = [
    "engine/cart.d.ts",
    "engine/runtime.js",
    "engine/headless.mjs",
    "engine/games/dodger.js",
    "engine/games/runner.js",
    "engine/games/shooter.js",
    "engine/games/maze.js",
    "engine/games/breakout.js",
    "engine/games/platformer.js",
  ];

  const agentKitFiles = [
    {
      repo: "agent/.agents/skills/pixel-game-from-card/SKILL.md",
      target: ".agents/skills/pixel-game-from-card/SKILL.md",
    },
    {
      repo: "agent/.agents/skills/playtest/SKILL.md",
      target: ".agents/skills/playtest/SKILL.md",
    },
    {
      repo: "agent/.agents/skills/pixel-art-sprites/SKILL.md",
      target: ".agents/skills/pixel-art-sprites/SKILL.md",
    },
  ];

  const sources = [
    agentsMd(agentsMdContent),
    ...agentKitFiles.map((f) => inline(f.target, readRepoFile(f.repo))),
    ...engineFiles.map((rel) => inline(`workspace/${rel}`, readRepoFile(rel))),
  ];

  const bundleHash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        baseAgent: BASE_AGENT_ID,
        model: MODEL,
        maxTokens: MAX_TOKENS,
        systemInstruction,
        sources,
      })
    )
    .digest("hex")
    .slice(0, 12);

  const description = `playglow PICO-8 arcade cartridge generator (gamesmith) [hash:${bundleHash}]`;

  const totalBytes = sources.reduce(
    (sum, s) => sum + Buffer.byteLength(s.content || "", "utf8"),
    0
  );

  console.log(
    `[bake-agent] Prepared bundle for '${AGENT_ID}' (${sources.length} sources, ${totalBytes} bytes, model=${MODEL}, maxTokens=${MAX_TOKENS}, hash=${bundleHash})`
  );

  if (isDryRun) {
    console.log("[bake-agent] --dry-run specified; skipping network call.");
    return;
  }

  const rawKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
  const apiKey = rawKey.trim();
  if (
    !apiKey ||
    apiKey === "MY_GEMINI_API_KEY" ||
    apiKey === "PLACEHOLDER_API_KEY" ||
    apiKey === "YOUR_GEMINI_API_KEY" ||
    apiKey === "YOUR_API_KEY" ||
    apiKey === "unused"
  ) {
    console.error("[bake-agent] Missing valid GEMINI_API_KEY");
    process.exit(1);
  }

  const ma = new ManagedAgents({
    apiKey,
    baseUrl: process.env.GEMINI_UPSTREAM || undefined,
  });

  if (isIfMissing) {
    try {
      const existing = await ma.agents.get(AGENT_ID);
      if (
        existing &&
        (existing.id || existing.name) &&
        String(existing.description || "").includes(`[hash:${bundleHash}]`) &&
        String(existing.base_agent || "").includes(BASE_AGENT_ID)
      ) {
        console.log(
          `[bake-agent] Agent '${AGENT_ID}' already up-to-date on active project key [hash:${bundleHash}].`
        );
        return;
      }
      console.log(
        `[bake-agent] Re-baking '${AGENT_ID}' (bundle hash or base_agent updated -> ${bundleHash})...`
      );
    } catch (err) {
      if (err?.status !== 404) {
        console.warn(`[bake-agent] Warning checking existing '${AGENT_ID}':`, err?.message || err);
      }
    }
  }

  const candidateBaseAgents = Array.from(
    new Set([
      BASE_AGENT_ID,
      "antigravity-preview-09-2026",
    ])
  );
  const candidateModels = Array.from(
    new Set([MODEL, "gemini-4-argon", "gemini-3.8-flash"])
  );

  let created = null;
  let lastErr = null;
  for (const candidateBase of candidateBaseAgents) {
    if (created) break;
    for (const candidateModel of candidateModels) {
      try {
        console.log(
          `[bake-agent] Calling ma.agents.replace("${AGENT_ID}", { baseAgent: "${candidateBase}", model: "${candidateModel}" })...`
        );
        created = await ma.agents.replace(AGENT_ID, {
          baseAgent: candidateBase,
          description,
          model: candidateModel,
          maxTokens: MAX_TOKENS,
          tools: [codeExecution()],
          network: "disabled",
          systemInstruction,
          sources,
        });
        break;
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || err);
        console.warn(
          `[bake-agent] Attempt with baseAgent="${candidateBase}", model="${candidateModel}" failed: ${msg}`
        );
        if (/\bagent\b/i.test(msg) && !/\bmodel\b/i.test(msg)) {
          break;
        }
      }
    }
  }

  if (!created) {
    throw lastErr || new Error(`Failed to bake agent ${AGENT_ID}`);
  }

  const verified = await ma.agents.get(AGENT_ID);
  console.log(`[bake-agent] Verified baked agent:`, {
    id: verified.id || created.id || AGENT_ID,
    base_agent: verified.base_agent,
    description: verified.description,
    model: verified.agent_config?.model || MODEL,
    max_total_tokens: verified.agent_config?.max_total_tokens || MAX_TOKENS,
    network: verified.base_environment?.network || "disabled",
    sourcesCount: verified.base_environment?.sources?.length ?? sources.length,
  });
}

main().catch((err) => {
  console.error("[bake-agent] Fatal error:", err);
  process.exit(1);
});
