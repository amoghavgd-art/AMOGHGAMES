#!/usr/bin/env node
// scripts/sync-games.mjs — Sync engine runtime, headless verifier, and 6 house games
// into agent/workspace/engine/, agent/.agents/skills/pixel-game-from-card/reference/, and public/house-games/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const engineDir = path.join(rootDir, "engine");
const gamesDir = path.join(engineDir, "games");

const agentEngineDir = path.join(rootDir, "agent", "workspace", "engine");
const agentEngineGamesDir = path.join(agentEngineDir, "games");
const skillRefDir = path.join(
  rootDir,
  "agent",
  ".agents",
  "skills",
  "pixel-game-from-card",
  "reference"
);
const publicHouseGamesDir = path.join(rootDir, "public", "house-games");

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  fs.mkdirSync(agentEngineGamesDir, { recursive: true });
  fs.mkdirSync(skillRefDir, { recursive: true });
  fs.mkdirSync(publicHouseGamesDir, { recursive: true });

  // 1. Copy core engine files to agent/workspace/engine/
  for (const file of ["cart.d.ts", "runtime.js", "headless.mjs"]) {
    const src = path.join(engineDir, file);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing engine file: ${src}`);
    }
    copyFile(src, path.join(agentEngineDir, file));
  }

  // 2. Copy cart.d.ts to skill reference dir
  copyFile(path.join(engineDir, "cart.d.ts"), path.join(skillRefDir, "cart.d.ts"));

  // 3. Copy all 6 house games to agent/workspace/engine/games/, skillRefDir, and public/house-games/
  const gameFiles = fs
    .readdirSync(gamesDir)
    .filter((f) => f.endsWith(".js"))
    .sort();

  for (const gf of gameFiles) {
    const src = path.join(gamesDir, gf);
    copyFile(src, path.join(agentEngineGamesDir, gf));
    copyFile(src, path.join(skillRefDir, gf));
    copyFile(src, path.join(publicHouseGamesDir, gf));
  }

  console.log(
    `[sync-games] Synced 3 engine files and ${gameFiles.length} house games (${gameFiles.join(", ")}) to agent/workspace/engine/, agent/.agents/skills/pixel-game-from-card/reference/, and public/house-games/.`
  );
}

main();
