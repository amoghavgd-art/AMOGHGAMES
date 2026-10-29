import {
  ma,
  BASE_AGENT,
  CANDIDATE_BASE_AGENTS,
  CANDIDATE_MODELS,
  ManagedAgentsError,
  inline,
  type InlineSource,
  type ManagedAgentEvent,
} from "../gemini";
import { CONFIG } from "../config";
import type { GameDesignCard } from "../card/schema";
import type { GenreName } from "../card/presets";
import { CartHost } from "../cart/CartHost";
import { runSkinSession, type SkinResult } from "./skinSession";
import gamesmithSystemRaw from "../../agents/gamesmith/SYSTEM.md?raw";
import agentsMdRaw from "../../agent/.agents/AGENTS.md?raw";
import skillPixelGameRaw from "../../agent/.agents/skills/pixel-game-from-card/SKILL.md?raw";
import skillPlaytestRaw from "../../agent/.agents/skills/playtest/SKILL.md?raw";
import skillSpritesRaw from "../../agent/.agents/skills/pixel-art-sprites/SKILL.md?raw";
import cartDtsRaw from "../../engine/cart.d.ts?raw";
import runtimeJsRaw from "../../engine/runtime.js?raw";
import headlessMjsRaw from "../../engine/headless.mjs?raw";
import dodgerRaw from "../../engine/games/dodger.js?raw";
import runnerRaw from "../../engine/games/runner.js?raw";
import shooterRaw from "../../engine/games/shooter.js?raw";
import mazeRaw from "../../engine/games/maze.js?raw";
import breakoutRaw from "../../engine/games/breakout.js?raw";
import platformerRaw from "../../engine/games/platformer.js?raw";

export type BuildState =
  | "BOOTING"
  | "STREAMING"
  | "FETCHING_CART"
  | "VERIFYING"
  | "RETRYING"
  | "READY"
  | "FALLBACK"
  | "CANCELLED";

export type StageStatus = "pending" | "active" | "done";

export interface BuildStageItem {
  id:
    | "card"
    | "paint"
    | "engine"
    | "coding"
    | "playtest"
    | "cartridge";
  label: string;
  status: StageStatus;
}

export type WorkLogKind = "thought" | "code" | "output" | "status";

export interface WorkLogEntry {
  id: string;
  timestamp: number;
  kind: WorkLogKind;
  text: string;
  stepId?: string;
}

export interface BuildSnapshot {
  state: BuildState;
  card: GameDesignCard;
  stages: BuildStageItem[];
  workLog: WorkLogEntry[];
  startedAt: number;
  elapsedSeconds: number;
  interactionId: string | null;
  environmentId: string | null;
  cartSource: string | null;
  houseCartSource: string | null;
  skin: SkinResult | null;
  fallbackReason: string | null;
  isFallback: boolean;
  tweakUsed: boolean;
  isTweaking: boolean;
  error: string | null;
}

export interface BuildSessionCallbacks {
  onUpdate?: (snapshot: BuildSnapshot) => void;
  onSkinReady?: (skin: SkinResult) => void;
  onHouseCartReady?: (source: string) => void;
  onReady?: (cartSource: string, snapshot: BuildSnapshot) => void;
  onFallback?: (cartSource: string, reason: string, snapshot: BuildSnapshot) => void;
}

export const INITIAL_STAGE_LABELS: ReadonlyArray<{
  id: BuildStageItem["id"];
  label: string;
}> = [
  { id: "card", label: "sketching your game card" },
  { id: "paint", label: "painting the cabinet & marquee" },
  { id: "engine", label: "setting up the game engine" },
  { id: "coding", label: "coding the hero, enemies & controls" },
  { id: "playtest", label: "play-testing in the sandbox" },
  { id: "cartridge", label: "plugging the cartridge into the cabinet" },
];

const CLIENT_BUILD_TIMEOUT_MS = CONFIG.AGENT_TIMEOUT_MS || 240_000;
const STREAM_RECONNECT_MAX = 3;
const STREAM_RECONNECT_BACKOFF_MS = 2_000;
const TWEAK_MAX_TOKENS = 200_000;

const BUILTIN_HOUSE_GAMES: Record<GenreName, string> = {
  dodger: dodgerRaw,
  runner: runnerRaw,
  shooter: shooterRaw,
  maze: mazeRaw,
  breakout: breakoutRaw,
  platformer: platformerRaw,
};

function buildFallbackSources(
  genre: GenreName,
  refGame: string,
  card?: GameDesignCard
): InlineSource[] {
  const sources: InlineSource[] = [
    inline(".agents/AGENTS.md", agentsMdRaw),
    inline(".agents/skills/pixel-game-from-card/SKILL.md", skillPixelGameRaw),
    inline(".agents/skills/playtest/SKILL.md", skillPlaytestRaw),
    inline(".agents/skills/pixel-art-sprites/SKILL.md", skillSpritesRaw),
    inline("workspace/engine/cart.d.ts", cartDtsRaw),
    inline("workspace/engine/runtime.js", runtimeJsRaw),
    inline("workspace/engine/headless.mjs", headlessMjsRaw),
    inline(`workspace/engine/games/${genre}.js`, refGame),
  ];
  if (card) {
    sources.push(inline("workspace/card.json", JSON.stringify(card, null, 2)));
  }
  return sources;
}

/**
 * Loads the house classic game source for a genre (`public/house-games/${genre}.js`),
 * falling back to the built-in genre implementation if fetch fails.
 */
export async function loadHouseGameSource(genre: GenreName): Promise<string> {
  if (typeof fetch !== "undefined") {
    try {
      const res = await fetch(`house-games/${genre}.js`);
      if (res.ok) {
        const text = await res.text();
        if (text && !text.trim().startsWith("<") && text.includes("create")) {
          return text;
        }
      }
    } catch {
      // ignore and fall back
    }
  }
  return BUILTIN_HOUSE_GAMES[genre] || BUILTIN_HOUSE_GAMES.dodger;
}

/**
 * Verifies a cartridge source string inside a hidden CartHost:
 * - Must load within 2s without forbidden-token or syntax errors
 * - Runs 60 ticks with no runtime errors
 * - Must render >= 2 distinct pixel colors in the 320x200 RGBA buffer
 */
export async function verifyCartridgeInHiddenHost(
  source: string,
  card: GameDesignCard
): Promise<{ ok: boolean; error?: string; distinctColors: number }> {
  if (typeof document === "undefined") {
    return { ok: true, distinctColors: 4 };
  }

  let cart: CartHost | null = null;
  let runtimeError: string | null = null;
  let lastFrame: Uint8Array | null = null;

  try {
    cart = new CartHost(document.body, {
      onFrame: (rgba) => {
        if (!lastFrame) {
          lastFrame = new Uint8Array(rgba.length);
        }
        lastFrame.set(rgba);
      },
      onError: (err) => {
        if (!runtimeError) {
          runtimeError = `${err.phase}: ${err.message}`;
        }
      },
    });

    await cart.load(source, card, { timeoutMs: 2500 });

    for (let tick = 0; tick < 60; tick++) {
      if (runtimeError) break;
      cart.tick(1000 / 60, {
        left: tick >= 20 && tick < 35,
        right: tick >= 5 && tick < 20,
        up: tick % 15 === 0,
        down: false,
        a: tick % 12 === 0,
        b: false,
        start: tick === 0,
      });
      if (tick % 20 === 19) {
        await new Promise((r) => setTimeout(r, 8));
      }
    }

    await new Promise((r) => setTimeout(r, 20));

    if (runtimeError) {
      return { ok: false, error: runtimeError, distinctColors: 0 };
    }

    if (!lastFrame) {
      return {
        ok: false,
        error: "No frame rendered after 60 ticks",
        distinctColors: 0,
      };
    }

    const colorSet = new Set<number>();
    const buf = lastFrame as Uint8Array;
    for (let i = 0; i < buf.length; i += 4) {
      const rgb = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
      colorSet.add(rgb);
      if (colorSet.size >= 8) break;
    }

    if (colorSet.size < 2) {
      return {
        ok: false,
        error: `Frame rendered only ${colorSet.size} distinct pixel color(s); expected >= 2`,
        distinctColors: colorSet.size,
      };
    }

    return { ok: true, distinctColors: colorSet.size };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
      distinctColors: 0,
    };
  } finally {
    cart?.destroy();
  }
}

let preferredBuildAgent: string | null = null;
let preferredBuildModel: string | null = null;

export class BuildSession {
  public state: BuildState = "BOOTING";
  public readonly card: GameDesignCard;
  public stages: BuildStageItem[];
  public workLog: WorkLogEntry[] = [];
  public readonly startedAt: number = Date.now();
  public interactionId: string | null = null;
  public environmentId: string | null = null;
  public cartSource: string | null = null;
  public houseCartSource: string | null = null;
  public skin: SkinResult | null = null;
  public fallbackReason: string | null = null;
  public isFallback = false;
  public tweakUsed = false;
  public isTweaking = false;
  public error: string | null = null;

  private callbacks: BuildSessionCallbacks;
  private listeners = new Set<(snapshot: BuildSnapshot) => void>();
  private abortController = new AbortController();
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private cleanedUp = false;
  private pageHideHandler: () => void;
  private activeAgentId: string = preferredBuildAgent || CONFIG.GAMESMITH_AGENT;
  private activeModel: string = preferredBuildModel || CONFIG.AGENT_MODEL;
  private logCounter = 0;
  private sseCandidateCartSource: string | null = null;
  private sseVerifiedCartSource: string | null = null;
  private sseStreamBuffer = "";

  constructor(card: GameDesignCard, callbacks: BuildSessionCallbacks = {}) {
    this.card = card;
    this.callbacks = callbacks;
    this.stages = INITIAL_STAGE_LABELS.map((s, idx) => ({
      id: s.id,
      label: s.label,
      // Stage 1 ("sketching your game card") is done as soon as GameDesignCard is ready
      status: idx === 0 ? "done" : idx === 1 ? "active" : "pending",
    }));

    this.pageHideHandler = () => {
      this.cleanup();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.pageHideHandler);
    }
  }

  public subscribe(listener: (snapshot: BuildSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): BuildSnapshot {
    return {
      state: this.state,
      card: this.card,
      stages: this.stages.map((s) => ({ ...s })),
      workLog: [...this.workLog],
      startedAt: this.startedAt,
      elapsedSeconds: Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000)),
      interactionId: this.interactionId,
      environmentId: this.environmentId,
      cartSource: this.cartSource,
      houseCartSource: this.houseCartSource,
      skin: this.skin,
      fallbackReason: this.fallbackReason,
      isFallback: this.isFallback,
      tweakUsed: this.tweakUsed,
      isTweaking: this.isTweaking,
      error: this.error,
    };
  }

  private notify(): void {
    const snap = this.getSnapshot();
    this.callbacks.onUpdate?.(snap);
    for (const listener of this.listeners) {
      listener(snap);
    }
  }

  private setStageStatus(id: BuildStageItem["id"], status: StageStatus): void {
    const item = this.stages.find((s) => s.id === id);
    if (item && item.status !== status) {
      // Never regress a "done" stage back to "pending" or "active"
      if (item.status === "done" && status !== "done") return;
      item.status = status;
      this.notify();
    }
  }

  public addWorkLog(kind: WorkLogKind, text: string, stepId?: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Coalesce streaming deltas for the same stepId and kind
    if (stepId && this.workLog.length > 0) {
      const last = this.workLog[this.workLog.length - 1];
      if (last.stepId === stepId && last.kind === kind) {
        last.text = (last.text + text).slice(-1200);
        this.notify();
        return;
      }
    }

    this.logCounter++;
    this.workLog.push({
      id: `log_${this.logCounter}_${Date.now()}`,
      timestamp: Date.now(),
      kind,
      text: trimmed.slice(0, 1200),
      stepId,
    });
    if (this.workLog.length > 80) {
      this.workLog.shift();
    }
    this.notify();
  }

  private resetSseCartCapture(): void {
    this.sseCandidateCartSource = null;
    this.sseVerifiedCartSource = null;
    this.sseStreamBuffer = "";
  }

  private inspectTextForCartridge(text: string): void {
    if (!text || typeof text !== "string") return;

    if (/\bFAIL:/.test(text) && !/\bPASS:\s+\d+\s+ticks\b/.test(text)) {
      this.sseCandidateCartSource = null;
      this.sseVerifiedCartSource = null;
      this.sseStreamBuffer = "";
      return;
    }

    this.sseStreamBuffer += text;
    if (this.sseStreamBuffer.length > 200_000) {
      this.sseStreamBuffer = this.sseStreamBuffer.slice(-200_000);
    }

    // Check 2: Heredoc in code_execution_call arguments
    const heredocRe =
      /cat\s+<<\s*['"]?([A-Za-z0-9_]+)['"]?\s*>\s*\/workspace\/out\/game\.js\r?\n([\s\S]*?)\r?\n\1(?:\r?\n|$)/g;
    let hm: RegExpExecArray | null;
    while ((hm = heredocRe.exec(this.sseStreamBuffer)) !== null) {
      const body = hm[2].trim();
      if (body.includes("export function create")) {
        this.sseCandidateCartSource = body;
      }
    }

    const heredocAltRe =
      /cat\s+>\s*\/workspace\/out\/game\.js\s+<<\s*['"]?([A-Za-z0-9_]+)['"]?\r?\n([\s\S]*?)\r?\n\1(?:\r?\n|$)/g;
    while ((hm = heredocAltRe.exec(this.sseStreamBuffer)) !== null) {
      const body = hm[2].trim();
      if (body.includes("export function create")) {
        this.sseCandidateCartSource = body;
      }
    }

    // Check 1: Explicit verified marker
    const markerRe =
      /===BEGIN_VERIFIED_GAME_JS===\r?\n([\s\S]*?)\r?\n===END_VERIFIED_GAME_JS===/g;
    let m: RegExpExecArray | null;
    while ((m = markerRe.exec(this.sseStreamBuffer)) !== null) {
      const body = m[1].trim();
      if (
        body.includes("export function create") &&
        !body.includes('echo "===BEGIN_VERIFIED_GAME_JS==="')
      ) {
        this.sseCandidateCartSource = body;
        if (/\bPASS:\s+\d+\s+ticks\b/.test(this.sseStreamBuffer)) {
          this.sseVerifiedCartSource = body;
        }
      }
    }

    if (
      /\bPASS:\s+\d+\s+ticks\b/.test(text) &&
      !/\bFAIL:/.test(text) &&
      this.sseCandidateCartSource
    ) {
      this.sseVerifiedCartSource = this.sseCandidateCartSource;
    }
  }

  /**
   * Starts the parallel build orchestration:
   * 1. Preloads the matching house game so the user can play immediately during BUILDING
   * 2. Starts Nano Banana 2 cabinet skin generation (`skinSession`)
   * 3. Starts the Managed Agent session (`gamesmith-v1` with 404 fallback to `BASE_AGENT`)
   */
  public async start(opts: { runSkin?: boolean; timeoutMs?: number } = {}): Promise<BuildSnapshot> {
    const runSkin = opts.runSkin ?? true;
    const timeoutMs = opts.timeoutMs ?? Math.min(CLIENT_BUILD_TIMEOUT_MS, CONFIG.AGENT_TIMEOUT_MS || CLIENT_BUILD_TIMEOUT_MS);

    this.tickTimer = setInterval(() => {
      if (
        this.state === "READY" ||
        this.state === "FALLBACK" ||
        this.state === "CANCELLED"
      ) {
        return;
      }
      this.notify();
    }, 1000);

    // Load the house game immediately for "passing the time"
    loadHouseGameSource(this.card.genre).then((src) => {
      this.houseCartSource = src;
      this.callbacks.onHouseCartReady?.(src);
      this.notify();
    });

    // Fire parallel Nano Banana 2 skin generation
    if (runSkin) {
      this.setStageStatus("paint", "active");
      runSkinSession(this.card, {
        signal: this.abortController.signal,
      })
        .then((skinRes) => {
          this.skin = skinRes;
          this.setStageStatus("paint", "done");
          this.addWorkLog("status", "cabinet marquee & side art ready");
          this.callbacks.onSkinReady?.(skinRes);
          this.notify();
        })
        .catch(() => {
          this.setStageStatus("paint", "done");
        });
    } else {
      this.setStageStatus("paint", "done");
    }

    if (!CONFIG.LIVE) {
      await this.transitionToFallback("the arcade is in demo mode — here's the house classic!");
      return this.getSnapshot();
    }

    // Enforce 180s client-side timeout
    this.timeoutTimer = setTimeout(() => {
      if (
        this.state !== "READY" &&
        this.state !== "FALLBACK" &&
        this.state !== "CANCELLED"
      ) {
        this.abortController.abort();
        this.transitionToFallback(
          `the crew needed a breather, so we loaded the classic ${this.card.genre} cartridge!`
        );
      }
    }, timeoutMs);

    try {
      await this.runAgentBuildFlow();
    } catch (err: any) {
      if ((this.state as BuildState) === "CANCELLED") {
        return this.getSnapshot();
      }
      const isRateLimit =
        (err instanceof ManagedAgentsError && err.status === 429) ||
        String(err?.message || "").includes("429");
      const reason = isRateLimit
        ? "the arcade's packed right now — here's a house classic skinned for you!"
        : `that build hit a snag, so we plugged in the classic ${this.card.genre} cartridge!`;
      await this.transitionToFallback(reason);
    } finally {
      if (this.timeoutTimer) {
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = null;
      }
    }

    return this.getSnapshot();
  }

  public markSkinComplete(skin?: SkinResult): void {
    if (skin) this.skin = skin;
    this.setStageStatus("paint", "done");
    this.notify();
  }

  private async runAgentBuildFlow(): Promise<void> {
    this.state = "BOOTING";
    this.setStageStatus("engine", "active");
    this.addWorkLog("status", `booting sandbox for ${this.card.title}…`);
    this.notify();

    const refGame =
      this.houseCartSource ||
      BUILTIN_HOUSE_GAMES[this.card.genre] ||
      (await loadHouseGameSource(this.card.genre));

    const promptText = [
      `Make the game for this GameDesignCard JSON (<= 300 lines in /workspace/out/game.js):`,
      JSON.stringify(this.card, null, 2),
      `Reference template (/workspace/engine/games/${this.card.genre}.js — already provided below so DO NOT run cat or ls first):`,
      "```js",
      refGame.trim(),
      "```",
      `Execute in a SINGLE code_execution tool call (Step 1):`,
      `1. mkdir -p /workspace/out and write /workspace/card.json.`,
      `2. Write /workspace/out/game.js (<= 300 lines) with a bespoke 5–6 color dark-outlined 2-frame hero sprite (hero1, hero2 using single-char keys {o:16,k:16,w:7,b:P.accent1,f:P.fg,a:P.accent2}) for "${this.card.hero.description}", 2 distinct enemy sprites for ${JSON.stringify(this.card.enemies.map((e) => e.description))}, a 3-layer procedural backdrop for "${this.card.art.scene}", and an active Button B ability for ${JSON.stringify(this.card.mechanics)} using engine.burst() and engine.popup().`,
      `3. In the SAME bash command, verify and emit the verified file:`,
      `node /workspace/engine/headless.mjs /workspace/out/game.js /workspace/card.json && echo "===BEGIN_VERIFIED_GAME_JS===" && cat /workspace/out/game.js && echo "===END_VERIFIED_GAME_JS==="`,
      `If it prints PASS, stop calling tools immediately and reply in two sentences.`,
    ].join("\n\n");

    let completedInteraction: any;
    const isRecoverableAgentOrModelErr = (e: unknown): boolean => {
      if (this.interactionId) return false;
      const msg = String((e as any)?.message || "");
      return (
        (e instanceof ManagedAgentsError &&
          (e.status === 404 || e.status === 403 || e.status === 400)) ||
        msg.includes("404") ||
        msg.includes("403") ||
        /not found|does not exist|permission|invalid|unsupported|cannot be overridden/i.test(msg)
      );
    };

    try {
      if (preferredBuildAgent && preferredBuildAgent !== CONFIG.GAMESMITH_AGENT) {
        throw new ManagedAgentsError(
          404,
          { error: { message: `Using memoized fallback agent ${preferredBuildAgent}` } },
          "POST",
          "/interactions"
        );
      }
      this.activeAgentId = CONFIG.GAMESMITH_AGENT;
      this.activeModel = preferredBuildModel || CONFIG.AGENT_MODEL;
      completedInteraction = await this.streamInteractionWithReconnect(promptText, {
        agent: CONFIG.GAMESMITH_AGENT,
        model: this.activeModel,
        maxTokens: CONFIG.MAX_AGENT_TOKENS,
      });
      preferredBuildAgent = CONFIG.GAMESMITH_AGENT;
    } catch (err: any) {
      const errMsg = String(err?.message || "");
      if (
        typeof window !== "undefined" &&
        /UNIMPLEMENTED|501|API key not valid|API_KEY_INVALID/i.test(errMsg)
      ) {
        try {
          (window as any).aistudio?.openSelectKey?.();
        } catch {
          // ignore
        }
      }

      if (!isRecoverableAgentOrModelErr(err) || this.abortController.signal.aborted) {
        throw err;
      }

      const fallbackSources = buildFallbackSources(this.card.genre, refGame, this.card);
      const candidateAgents = Array.from(
        new Set([
          ...(preferredBuildAgent && preferredBuildAgent !== CONFIG.GAMESMITH_AGENT
            ? [preferredBuildAgent]
            : []),
          CONFIG.AGENT_ID || BASE_AGENT,
          ...CANDIDATE_BASE_AGENTS,
        ])
      );
      const candidateModels = Array.from(
        new Set([
          ...(preferredBuildModel ? [preferredBuildModel] : []),
          CONFIG.AGENT_MODEL,
          ...CANDIDATE_MODELS,
        ])
      );

      let lastCandidateErr: unknown = err;
      let fallbackSucceeded = false;

      for (const fallbackAgent of candidateAgents) {
        if (this.abortController.signal.aborted || fallbackSucceeded) {
          break;
        }
        for (const fallbackModel of candidateModels) {
          if (this.abortController.signal.aborted) {
            throw lastCandidateErr;
          }
          try {
            this.activeAgentId = fallbackAgent;
            this.activeModel = fallbackModel;
            this.addWorkLog(
              "status",
              `attaching engine kit on ${fallbackAgent} (${fallbackModel})…`
            );
            completedInteraction = await this.streamInteractionWithReconnect(promptText, {
              agent: fallbackAgent,
              model: fallbackModel,
              maxTokens: CONFIG.MAX_AGENT_TOKENS,
              systemInstruction: gamesmithSystemRaw,
              sources: fallbackSources,
            });
            preferredBuildAgent = fallbackAgent;
            preferredBuildModel = fallbackModel;
            lastCandidateErr = null;
            fallbackSucceeded = true;
            break;
          } catch (candErr) {
            lastCandidateErr = candErr;
            if (!isRecoverableAgentOrModelErr(candErr)) {
              throw candErr;
            }
            const candMsg = String((candErr as any)?.message || "");
            if (/\bagent\b/i.test(candMsg) && !/\bmodel\b/i.test(candMsg)) {
              break;
            }
          }
        }
      }

      if (lastCandidateErr || !fallbackSucceeded) {
        throw lastCandidateErr || err;
      }
    }

    this.extractIdsFromInteraction(completedInteraction);
    if (
      !this.environmentId &&
      !this.sseVerifiedCartSource &&
      !this.sseCandidateCartSource
    ) {
      throw new Error("Agent interaction completed without an environmentId");
    }

    // Attempt 1: Fetch & verify /workspace/out/game.js
    const firstCheck = await this.fetchAndVerifyCart();
    if (firstCheck.ok && firstCheck.source) {
      this.completeReady(firstCheck.source);
      return;
    }

    // Retry once in the same sandbox environment if verification failed
    if (this.abortController.signal.aborted) return;
    if (!this.environmentId) {
      throw new Error(firstCheck.error || "Missing sandbox environmentId for retry");
    }
    this.state = "RETRYING";
    const errReason = firstCheck.error || "Unknown cartridge verification error";
    this.addWorkLog("status", `playtest check tripped (${errReason}) — asking agent for 1 quick fix…`);
    this.setStageStatus("coding", "active");
    this.notify();

    const retryPrompt = `Verification of /workspace/out/game.js failed with error: ${errReason}. Fix /workspace/out/game.js (<= 300 lines) so it exports create(engine, card), uses single-character sprite keys with palette indices 0..31, has no forbidden globals, and renders >= 4 distinct colors. Then re-run node /workspace/engine/headless.mjs /workspace/out/game.js /workspace/card.json && echo "===BEGIN_VERIFIED_GAME_JS===" && cat /workspace/out/game.js && echo "===END_VERIFIED_GAME_JS===" and ensure it prints PASS.`;

    const retryInteraction = await Promise.race([
      this.streamInteractionWithReconnect(retryPrompt, {
        agent: this.activeAgentId,
        model: this.activeModel,
        previous: this.interactionId || undefined,
        environment: this.environmentId,
        maxTokens: CONFIG.MAX_AGENT_TOKENS,
        systemInstruction: !this.isCustomGamesmithAgent()
          ? gamesmithSystemRaw
          : undefined,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Retry turn timed out after 45s")), 45_000)
      ),
    ]);
    this.extractIdsFromInteraction(retryInteraction);

    const secondCheck = await this.fetchAndVerifyCart();
    if (secondCheck.ok && secondCheck.source) {
      this.completeReady(secondCheck.source);
      return;
    }

    throw new Error(secondCheck.error || "Second cartridge verification failed");
  }

  private isCustomGamesmithAgent(): boolean {
    return (
      this.activeAgentId === CONFIG.GAMESMITH_AGENT ||
      this.activeAgentId.startsWith("gamesmith-") ||
      this.activeAgentId.startsWith("agents/gamesmith-")
    );
  }

  private extractIdsFromInteraction(raw: Record<string, any> | null | undefined): void {
    if (!raw) return;
    const iid = raw.id || raw.interaction?.id;
    if (iid) this.interactionId = String(iid);
    const envId =
      raw.environment_id ||
      (typeof raw.environment === "string" && raw.environment !== "remote"
        ? raw.environment
        : raw.interaction?.environment_id);
    if (envId) this.environmentId = String(envId);
  }

  private async streamInteractionWithReconnect(
    input: string,
    opts: {
      agent: string;
      model?: string;
      previous?: string;
      environment?: string;
      maxTokens: number;
      systemInstruction?: string;
      sources?: InlineSource[];
    }
  ): Promise<Record<string, unknown>> {
    this.resetSseCartCapture();

    const body = {
      ...ma.buildRequest(input, {
        agent: opts.agent,
        model: opts.model || CONFIG.AGENT_MODEL,
        previous: opts.previous,
        environment: opts.environment ?? "remote",
        maxTokens: opts.maxTokens,
        systemInstruction: opts.systemInstruction,
        sources: opts.sources,
      }),
      stream: true,
    };
    delete body.background;

    let iid: string | undefined = this.interactionId || undefined;
    let lastEventId: string | undefined;
    const seenEventIds = new Set<string>();

    let stream: AsyncGenerator<ManagedAgentEvent> = ma.sse("POST", "/interactions", {
      json: body,
      signal: this.abortController.signal,
    });

    for (let reconnectAttempt = 0; ; ) {
      try {
        for await (const ev of stream) {
          if (ev.event_id) {
            if (seenEventIds.has(ev.event_id)) continue;
            seenEventIds.add(ev.event_id);
            lastEventId = ev.event_id;
          }

          this.handleSseEvent(ev);
          if (ev.event_type === "interaction.created") {
            iid = ev.interaction?.id || iid;
          }
          if (this.sseVerifiedCartSource) {
            this.setStageStatus("coding", "done");
            this.setStageStatus("playtest", "done");
            this.setStageStatus("cartridge", "active");
            return {
              id: iid || this.interactionId,
              environment_id: this.environmentId,
              earlyVerifiedSource: this.sseVerifiedCartSource,
            };
          }
          if (
            ev.event_type === "interaction.completed" ||
            ev.event_type === "interaction.complete"
          ) {
            this.extractIdsFromInteraction(ev.interaction || ev);
            if (
              this.environmentId ||
              this.sseVerifiedCartSource ||
              this.sseCandidateCartSource
            ) {
              return ev.interaction || ev;
            }
            const finalId = iid || ev.interaction?.id || this.interactionId;
            if (finalId) {
              return await ma.interactions.get(finalId);
            }
            return ev.interaction || ev;
          }
          if (ev.event_type === "error") {
            throw new ManagedAgentsError(500, ev.error, "STREAM", "/interactions");
          }
        }

        if (this.sseVerifiedCartSource || this.sseCandidateCartSource) {
          return {
            id: iid || this.interactionId,
            environment_id: this.environmentId,
            earlyVerifiedSource: this.sseVerifiedCartSource || this.sseCandidateCartSource,
          };
        }
        if (iid) {
          return await ma.interactions.wait(iid, {
            signal: this.abortController.signal,
          });
        }
        throw new Error("SSE stream ended before interaction was created");
      } catch (err: unknown) {
        if (this.abortController.signal.aborted) {
          if (iid) {
            ma.interactions.cancel(iid).catch(() => {});
          }
          throw err;
        }
        if (
          err instanceof ManagedAgentsError ||
          !iid ||
          reconnectAttempt >= STREAM_RECONNECT_MAX
        ) {
          throw err;
        }
        if ((ma as unknown as { _base?: string })._base?.startsWith("https://generativelanguage.googleapis.com")) {
          return await ma.interactions.wait(iid, {
            signal: this.abortController.signal,
          });
        }
        reconnectAttempt++;
        this.addWorkLog(
          "status",
          `stream hiccup — reconnecting (${reconnectAttempt}/${STREAM_RECONNECT_MAX})…`
        );
        await new Promise((r) => setTimeout(r, STREAM_RECONNECT_BACKOFF_MS));
        stream = ma.interactions.stream(iid, {
          lastEventId,
          signal: this.abortController.signal,
        });
      }
    }
  }

  private inspectStepFields(step: Record<string, any> | null | undefined): void {
    if (!step || typeof step !== "object") return;
    const fields = [
      typeof step.arguments === "string" ? step.arguments : step.arguments?.code,
      typeof step.result === "string"
        ? step.result
        : step.result?.output || step.result?.stdout,
      step.output,
      step.stdout,
      ...(Array.isArray(step.content)
        ? step.content.flatMap((c: any) => [
            c?.text,
            c?.code,
            c?.output,
            c?.stdout,
            typeof c?.arguments === "string" ? c.arguments : c?.arguments?.code,
            typeof c?.result === "string" ? c.result : c?.result?.output || c?.result?.stdout,
          ])
        : []),
    ];
    for (const f of fields) {
      if (typeof f === "string" && f) {
        this.inspectTextForCartridge(`\n${f}\n`);
      }
    }
  }

  private handleSseEvent(ev: ManagedAgentEvent): void {
    if (!ev || typeof ev.event_type !== "string") return;

    if (ev.event_type === "interaction.created") {
      this.extractIdsFromInteraction(ev.interaction || ev);
      this.state = "STREAMING";
      this.setStageStatus("engine", "active");
      this.addWorkLog("status", "sandbox connected — setting up game engine");
      this.notify();
      return;
    }

    if (ev.event_type === "step.start") {
      if (this.state === "BOOTING") this.state = "STREAMING";
      this.setStageStatus("engine", "done");
      const codingStage = this.stages.find((s) => s.id === "coding");
      if (codingStage && codingStage.status === "pending") {
        this.setStageStatus("coding", "active");
      }

      const step = ev.step || {};
      this.inspectStepFields(step);
      const stepStr = JSON.stringify(step);
      if (stepStr.includes("game.js") || stepStr.includes("write_to_file")) {
        this.setStageStatus("coding", "active");
      }
      if (stepStr.includes("headless.mjs")) {
        this.setStageStatus("coding", "done");
        this.setStageStatus("playtest", "active");
      }
      return;
    }

    if (ev.event_type === "step.delta") {
      this.setStageStatus("engine", "done");
      const delta = ev.delta || {};
      const stepId = ev.step_id || ev.step?.id || "delta";
      const deltaArgs = delta.arguments as unknown;
      const rawText =
        delta.text ||
        delta.thought ||
        (typeof deltaArgs === "string"
          ? deltaArgs
          : (deltaArgs as { code?: string } | undefined)?.code) ||
        delta.arguments_delta ||
        delta.code ||
        delta.output ||
        delta.stdout ||
        "";

      if (typeof rawText === "string" && rawText) {
        this.inspectTextForCartridge(rawText);

        if (rawText.includes("game.js")) {
          const playtestStage = this.stages.find((s) => s.id === "playtest");
          if (playtestStage?.status !== "active" && playtestStage?.status !== "done") {
            this.setStageStatus("coding", "active");
          }
        }
        if (rawText.includes("headless.mjs")) {
          this.setStageStatus("coding", "done");
          this.setStageStatus("playtest", "active");
        }

        const kind: WorkLogKind =
          delta.type === "arguments_delta" || delta.type === "code"
            ? "code"
            : delta.type === "output" || delta.type === "code_execution_result"
            ? "output"
            : "thought";

        this.addWorkLog(kind, rawText, stepId);
      }
      return;
    }

    if (ev.event_type === "step.stop") {
      const step = ev.step || {};
      this.inspectStepFields(step);
      const stepStr = JSON.stringify(step);
      if (stepStr.includes("headless.mjs")) {
        this.setStageStatus("coding", "done");
        this.setStageStatus("playtest", "active");
      }
    }
  }

  private async fetchAndVerifyCart(): Promise<{
    ok: boolean;
    source?: string;
    error?: string;
  }> {
    const inlineSource = this.sseVerifiedCartSource || this.sseCandidateCartSource;
    if (inlineSource) {
      this.state = "VERIFYING";
      this.setStageStatus("engine", "done");
      this.setStageStatus("coding", "done");
      this.setStageStatus("playtest", "done");
      this.setStageStatus("cartridge", "active");
      this.addWorkLog("status", "verifying cartridge in hidden 60-tick playtest host…");
      this.notify();

      const inlineVerification = await verifyCartridgeInHiddenHost(inlineSource, this.card);
      if (inlineVerification.ok) {
        return { ok: true, source: inlineSource };
      }
    }

    if (!this.environmentId && this.interactionId) {
      try {
        const info = await ma.interactions.get(this.interactionId);
        this.extractIdsFromInteraction(info);
      } catch {
        // ignore
      }
    }

    if (!this.environmentId) {
      return { ok: false, error: "Missing sandbox environmentId" };
    }

    this.state = "FETCHING_CART";
    this.setStageStatus("engine", "done");
    this.setStageStatus("coding", "done");
    this.setStageStatus("playtest", "done");
    this.setStageStatus("cartridge", "active");
    this.addWorkLog("status", "fetching /workspace/out/game.js from sandbox…");
    this.notify();

    let source: string;
    try {
      source = await ma.files.readText(this.environmentId, "workspace/out/game.js");
    } catch (err: any) {
      return {
        ok: false,
        error: `Could not read /workspace/out/game.js: ${err?.message || String(err)}`,
      };
    }

    this.state = "VERIFYING";
    this.addWorkLog("status", "verifying cartridge in hidden 60-tick playtest host…");
    this.notify();

    const verification = await verifyCartridgeInHiddenHost(source, this.card);
    if (!verification.ok) {
      return { ok: false, error: verification.error };
    }

    return { ok: true, source };
  }

  private completeReady(verifiedSource: string): void {
    this.cartSource = verifiedSource;
    this.isFallback = false;
    this.state = "READY";
    for (const st of this.stages) {
      st.status = "done";
    }
    this.addWorkLog("status", "cartridge verified & ready to play!");
    this.notify();
    this.callbacks.onReady?.(verifiedSource, this.getSnapshot());

    if (!this.environmentId && this.interactionId) {
      ma.interactions
        .get(this.interactionId)
        .then((info) => this.extractIdsFromInteraction(info))
        .catch(() => {});
    }
  }

  /**
   * Immediately switches to the house classic game for the card's genre, verifies it,
   * and transitions to `"FALLBACK"`. Used on timeout, double failure, 429 rate limit,
   * or when the user clicks `"play the classic instead →"`.
   */
  public async useClassicFallback(
    customReason = "playing the house classic with your custom cabinet!"
  ): Promise<BuildSnapshot> {
    this.abortController.abort();
    await this.transitionToFallback(customReason);
    return this.getSnapshot();
  }

  private async transitionToFallback(reason: string): Promise<void> {
    if (this.state === "FALLBACK" || this.state === "CANCELLED") return;
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    const houseSource =
      this.houseCartSource || (await loadHouseGameSource(this.card.genre));
    this.houseCartSource = houseSource;

    const check = await verifyCartridgeInHiddenHost(houseSource, this.card);
    const verifiedSource = check.ok
      ? houseSource
      : BUILTIN_HOUSE_GAMES[this.card.genre] || BUILTIN_HOUSE_GAMES.dodger;

    this.cartSource = verifiedSource;
    this.fallbackReason = reason;
    this.isFallback = true;
    this.state = "FALLBACK";
    for (const st of this.stages) {
      st.status = "done";
    }
    this.addWorkLog("status", reason);
    this.notify();
    this.callbacks.onFallback?.(verifiedSource, reason, this.getSnapshot());

    // Clean up sandbox environment since fallback does not support sandbox tweaking
    await this.cleanup();
  }

  /**
   * Single-turn tweak during Play mode (§1.3):
   * Sends 1 follow-up turn (`previous: lastInteractionId`, `environment: environmentId`, `maxTokens: 200_000`),
   * fetches & verifies the updated `/workspace/out/game.js`, swaps it in, and then deletes the sandbox environment.
   */
  public async tweak(instruction: string): Promise<{
    ok: boolean;
    cartSource: string;
    error?: string;
  }> {
    if (this.tweakUsed) {
      return {
        ok: false,
        cartSource: this.cartSource || "",
        error: "Tweak already used for this game",
      };
    }
    if (!this.environmentId || this.isFallback) {
      return {
        ok: false,
        cartSource: this.cartSource || "",
        error: "No live sandbox available for tweaking",
      };
    }

    this.isTweaking = true;
    this.error = null;
    this.notify();

    const cleanInstruction = instruction.trim().slice(0, 80);
    const prompt = `Update /workspace/out/game.js to apply this tweak: ${cleanInstruction}. Re-run node /workspace/engine/headless.mjs /workspace/out/game.js /workspace/card.json && echo "===BEGIN_VERIFIED_GAME_JS===" && cat /workspace/out/game.js && echo "===END_VERIFIED_GAME_JS===" and ensure it prints PASS.`;

    try {
      this.resetSseCartCapture();
      const res = await ma.run(prompt, {
        agent: this.activeAgentId,
        model: this.activeModel,
        previous: this.interactionId || undefined,
        environment: this.environmentId,
        maxTokens: TWEAK_MAX_TOKENS,
        systemInstruction: !this.isCustomGamesmithAgent()
          ? gamesmithSystemRaw
          : undefined,
        onEvent: (ev) => {
          this.handleSseEvent(ev);
          if (ev.event_type === "interaction.created" && ev.interaction?.id) {
            this.interactionId = ev.interaction.id;
          }
        },
      });

      if (res.id) this.interactionId = res.id;
      const updatedSource =
        this.sseVerifiedCartSource ||
        (await ma.files.readText(this.environmentId, "workspace/out/game.js"));
      const verification = await verifyCartridgeInHiddenHost(
        updatedSource,
        this.card
      );
      if (!verification.ok) {
        throw new Error(verification.error || "Tweaked cartridge failed verification");
      }

      this.cartSource = updatedSource;
      this.tweakUsed = true;
      this.isTweaking = false;
      this.notify();
      this.callbacks.onReady?.(updatedSource, this.getSnapshot());
      return { ok: true, cartSource: updatedSource };
    } catch (err: any) {
      const msg = err?.message || String(err);
      this.error = msg;
      this.tweakUsed = true;
      this.isTweaking = false;
      this.notify();
      return {
        ok: false,
        cartSource: this.cartSource || "",
        error: msg,
      };
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Cancels the build and returns to Step 04 with answers intact.
   */
  public async cancel(): Promise<void> {
    if (this.state === "CANCELLED") return;
    this.state = "CANCELLED";
    this.abortController.abort();
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.notify();
    await this.cleanup();
  }

  /**
   * Deletes the sandbox environment (`ma.environments.delete(environmentId)`) and cancels
   * any active interaction so no sandbox environment is ever leaked (§1.4).
   */
  public async cleanup(): Promise<void> {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.pageHideHandler);
    }
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    const iid = this.interactionId;
    const envId = this.environmentId;
    this.environmentId = null;

    if (iid && (this.state === "BOOTING" || this.state === "STREAMING" || this.state === "RETRYING")) {
      ma.interactions.cancel(iid).catch(() => {});
    }
    if (envId) {
      try {
        await ma.environments.delete(envId);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export default BuildSession;
