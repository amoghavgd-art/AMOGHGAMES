import { GoogleGenAI, ThinkingLevel, type GenerateContentConfig } from "@google/genai";
import {
  ManagedAgents,
  BASE_AGENT,
  VERTEX_BASE_AGENT,
  CANDIDATE_BASE_AGENTS,
  CANDIDATE_MODELS,
  DEFAULT_MODEL,
  ManagedAgentsError,
  Result,
  inline,
  network,
  type InlineSource,
  type InteractionCreateBody,
  type ManagedAgentEvent,
} from "./vendor/managed-agents.js";
import { CONFIG } from "./config";

function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Aborted"));
  }
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, abortPromise]).finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}

function getProxyBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.href) {
    return new URL("api/gemini", window.location.href).toString().replace(/\/$/, "");
  }
  const port = typeof process !== "undefined" ? process.env.PORT || process.env.API_PORT || "8787" : "8787";
  return `http://127.0.0.1:${port}/api/gemini`;
}

function getInitialAdminToken(): string | undefined {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get("admin");
    if (tok) return tok;
  }
  return undefined;
}

let currentAdminToken: string | undefined = getInitialAdminToken();
let useDirectBrowserFallback = false;

export const ma = new ManagedAgents({
  baseUrl: "api/gemini",
  headers: currentAdminToken ? { "x-admin-token": currentAdminToken } : {},
});

export const ai = new GoogleGenAI({
  apiKey: "unused",
  httpOptions: {
    baseUrl: getProxyBaseUrl(),
    headers: currentAdminToken ? { "x-admin-token": currentAdminToken } : {},
  },
});

const directBrowserAi = new GoogleGenAI({
  apiKey: "AI_STUDIO_PROXY",
});

function isMissingServerKeyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return msg.includes("MISSING_SERVER_GEMINI_KEY") || msg.includes("Server missing GEMINI_API_KEY");
}

export function setAdminToken(token: string | undefined): void {
  currentAdminToken = token;
  if (token) {
    ma._headers["x-admin-token"] = token;
  } else {
    delete ma._headers["x-admin-token"];
  }
}

export function getAdminToken(): string | undefined {
  return currentAdminToken;
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra || {}) };
  if (currentAdminToken) {
    h["x-admin-token"] = currentAdminToken;
  }
  return h;
}

export interface FlashJsonOptions {
  systemInstruction?: string;
  responseJsonSchema?: unknown;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  useInteractions?: boolean;
}

let preferredFlashModel: string | null = null;
let preferredImageModel: string | null = null;

/**
 * Call Gemini (`gemini-4-argon` with automatic fallback to `gemini-3.8-flash`)
 * through `/api/gemini` via `generateContent` or the standard `/v1beta/interactions` API.
 */
export async function flash<T = unknown>(
  prompt: string,
  opts: FlashJsonOptions = {}
): Promise<{ data: T; rawText: string; latencyMs: number; model: string }> {
  const requestedModel = opts.model || preferredFlashModel || CONFIG.FLASH_MODEL;
  const ctl = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => ctl.abort(), opts.timeoutMs) : null;
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => ctl.abort(), { once: true });
  }

  const candidateModels = opts.model
    ? [opts.model]
    : Array.from(
        new Set([
          requestedModel,
          CONFIG.FLASH_MODEL,
          ...CANDIDATE_MODELS,
        ])
      );

  try {
    if (opts.useInteractions) {
      let lastInterErr: unknown = null;
      for (const candidateModel of candidateModels) {
        if (ctl.signal.aborted) break;
        const attemptStart = performance.now();
        try {
          const body: InteractionCreateBody = {
            model: candidateModel,
            input: prompt,
          };
          if (opts.systemInstruction) {
            body.system_instruction = opts.systemInstruction;
          }
          if (opts.responseJsonSchema) {
            body.response_mime_type = "application/json";
            body.response_format = opts.responseJsonSchema;
          }
          const raw = await raceWithSignal(ma.interactions.create(body), ctl.signal);
          const rawText = new Result(raw).text;
          const latencyMs = Math.round(performance.now() - attemptStart);
          const data = (opts.responseJsonSchema ? JSON.parse(rawText) : rawText) as T;
          if (!opts.model) preferredFlashModel = candidateModel;
          return { data, rawText, latencyMs, model: candidateModel };
        } catch (err) {
          lastInterErr = err;
          if (ctl.signal.aborted) throw err;
        }
      }
      throw lastInterErr || new Error(`Failed interaction with ${requestedModel}`);
    }

    const makeConfig = (targetModel: string, direct: boolean): GenerateContentConfig => {
      const isArgon = targetModel.toLowerCase().includes("argon");
      const cfg: GenerateContentConfig = {
        thinkingConfig: isArgon ? { thinkingLevel: ThinkingLevel.LOW } : { thinkingBudget: 0 },
        httpOptions: direct
          ? { timeout: opts.timeoutMs }
          : {
              baseUrl: getProxyBaseUrl(),
              headers: buildHeaders(),
              timeout: opts.timeoutMs,
            },
      };
      if (opts.systemInstruction) {
        cfg.systemInstruction = opts.systemInstruction;
      }
      if (opts.responseJsonSchema) {
        cfg.responseMimeType = "application/json";
        cfg.responseJsonSchema = opts.responseJsonSchema;
      }
      if (opts.signal || timer) {
        cfg.abortSignal = ctl.signal;
      }
      return cfg;
    };

    let res: any = null;
    let activeModel = requestedModel;
    let winningStart = performance.now();
    let lastErr: unknown = null;

    for (const candidateModel of candidateModels) {
      if (ctl.signal.aborted) break;
      activeModel = candidateModel;
      winningStart = performance.now();
      try {
        const client = useDirectBrowserFallback ? directBrowserAi : ai;
        res = await raceWithSignal(
          client.models.generateContent({
            model: candidateModel,
            contents: prompt,
            config: makeConfig(candidateModel, useDirectBrowserFallback),
          }),
          ctl.signal
        );
        lastErr = null;
        if (!opts.model) preferredFlashModel = candidateModel;
        break;
      } catch (err) {
        if (!useDirectBrowserFallback && typeof window !== "undefined" && isMissingServerKeyError(err)) {
          useDirectBrowserFallback = true;
          winningStart = performance.now();
          try {
            res = await raceWithSignal(
              directBrowserAi.models.generateContent({
                model: candidateModel,
                contents: prompt,
                config: makeConfig(candidateModel, true),
              }),
              ctl.signal
            );
            lastErr = null;
            if (!opts.model) preferredFlashModel = candidateModel;
            break;
          } catch (directErr) {
            lastErr = directErr;
          }
        } else {
          lastErr = err;
        }
        if (ctl.signal.aborted) {
          throw lastErr;
        }
      }
    }

    if (lastErr || !res) {
      throw lastErr || new Error(`Failed to generate content with ${activeModel}`);
    }

    const rawText =
      res.text ??
      res.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") ??
      "";
    const latencyMs = Math.round(performance.now() - winningStart);
    const data = (opts.responseJsonSchema ? JSON.parse(rawText) : rawText) as T;
    return { data, rawText, latencyMs, model: activeModel };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ImageGenOptions {
  aspectRatio?: "21:9" | "9:16" | "16:9" | "1:1" | "4:3" | "3:4";
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Call Nano Banana (Gemini image generation) through `/api/gemini`.
 * Automatically falls back across internal/free-tier Nano Banana models
 * (`gemini-2.5-flash-image`)
 * if `gemini-3.1-flash-image` returns a Paid-Pro quota/permission error in AI Studio.
 */
export async function image(
  prompt: string,
  opts: ImageGenOptions = {}
): Promise<{ base64: string; mimeType: string; latencyMs: number; model: string }> {
  const requestedModel = opts.model || preferredImageModel || CONFIG.NANO_BANANA_MODEL;
  const timeoutMs = opts.timeoutMs ?? CONFIG.IMAGE_TIMEOUT_MS;
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => ctl.abort(), { once: true });
  }

  try {
    const candidateModels = opts.model
      ? [opts.model]
      : Array.from(
          new Set([
            requestedModel,
            CONFIG.NANO_BANANA_MODEL,
            "gemini-2.5-flash-image",
          ])
        );

    const makeConfig = (direct: boolean): GenerateContentConfig => ({
      responseModalities: ["IMAGE"],
      imageConfig: opts.aspectRatio ? { aspectRatio: opts.aspectRatio } : undefined,
      abortSignal: ctl.signal,
      httpOptions: direct
        ? { timeout: timeoutMs }
        : {
            baseUrl: getProxyBaseUrl(),
            headers: buildHeaders(),
            timeout: timeoutMs,
          },
    });

    let activeModel = requestedModel;
    let imgPart: any = null;
    let winningImgStart = t0;
    let lastErr: unknown = null;

    for (const candidateModel of candidateModels) {
      if (ctl.signal.aborted) break;
      activeModel = candidateModel;
      winningImgStart = performance.now();
      try {
        let res;
        try {
          const client = useDirectBrowserFallback ? directBrowserAi : ai;
          res = await raceWithSignal(
            client.models.generateContent({
              model: candidateModel,
              contents: prompt,
              config: makeConfig(useDirectBrowserFallback),
            }),
            ctl.signal
          );
        } catch (err) {
          if (!useDirectBrowserFallback && typeof window !== "undefined" && isMissingServerKeyError(err)) {
            useDirectBrowserFallback = true;
            winningImgStart = performance.now();
            res = await raceWithSignal(
              directBrowserAi.models.generateContent({
                model: candidateModel,
                contents: prompt,
                config: makeConfig(true),
              }),
              ctl.signal
            );
          } else {
            throw err;
          }
        }

        const parts = res.candidates?.[0]?.content?.parts || [];
        const found = parts.find((p: any) => p.inlineData?.data);
        if (!found?.inlineData?.data) {
          throw new Error(`No inlineData image returned from ${candidateModel}`);
        }
        imgPart = found;
        lastErr = null;
        if (!opts.model) preferredImageModel = candidateModel;
        break;
      } catch (err) {
        lastErr = err;
        if (ctl.signal.aborted) {
          throw err;
        }
      }
    }

    if (!imgPart?.inlineData?.data) {
      throw lastErr || new Error(`No inlineData image returned from ${activeModel}`);
    }

    const latencyMs = Math.round(performance.now() - winningImgStart);
    return {
      base64: imgPart.inlineData.data,
      mimeType: imgPart.inlineData.mimeType || "image/png",
      latencyMs,
      model: activeModel,
    };
  } finally {
    clearTimeout(timer);
  }
}

export {
  BASE_AGENT,
  VERTEX_BASE_AGENT,
  CANDIDATE_BASE_AGENTS,
  CANDIDATE_MODELS,
  DEFAULT_MODEL,
  ManagedAgentsError,
  Result,
  inline,
  network,
  type InlineSource,
  type InteractionCreateBody,
  type ManagedAgentEvent,
};
