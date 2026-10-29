import { image } from "../gemini";
import { CONFIG } from "../config";
import type { GameDesignCard } from "../card/schema";
import { VIBES } from "../card/vibes";
import { getHouseSkinForCard } from "../skin/houseSkins";

const PROMPT_SUFFIX =
  "pixel art, limited palette, flat colours, hard edges, no anti-aliasing, no text, no letters, no numbers, no logos, no watermark, no border, no frame";

export type SkinImageKind = "marquee" | "side" | "attract";

export function getVibeColoursList(card: GameDesignCard): string {
  const p = card.palette || VIBES[card.vibe]?.palette || VIBES.sunset.palette;
  return `${p.bg}, ${p.fg}, ${p.accent1}, ${p.accent2}, ${p.ui}`;
}

export function getVibeDescription(card: GameDesignCard): string {
  return VIBES[card.vibe]?.vibeDesc || "warm golden-hour dusk";
}

export function buildMarqueePrompt(card: GameDesignCard): string {
  const vibeDesc = getVibeDescription(card);
  const vibeColours = getVibeColoursList(card);
  const hero = card.hero?.description || "a tiny arcade hero";
  const heroPose = card.art?.hero_pose || "in an action pose";
  return `Wide pixel-art arcade marquee banner background. ${vibeDesc} dithered gradient sky in ${vibeColours}. Small ${hero} sprites at the far left and far right edges, ${heroPose}. The centre 60% is an empty dark band (for a title added later). Retro 1980s arcade style. ${PROMPT_SUFFIX}`;
}

export function buildSidePrompt(card: GameDesignCard): string {
  const vibeDesc = getVibeDescription(card);
  const vibeColours = getVibeColoursList(card);
  const hero = card.hero?.description || "a tiny arcade hero";
  const heroPose = card.art?.hero_pose || "in an action pose";
  const scene = card.art?.scene || "retro arcade landscape";
  return `Tall pixel-art arcade cabinet side art. ${hero} large in the middle, ${heroPose}. Background: ${scene} at ${vibeDesc}, a big striped sun, layered silhouette hills, ordered dithering in ${vibeColours}. Empty space at the top 15% and the bottom 20%. Retro 1980s arcade side panel style. ${PROMPT_SUFFIX}`;
}

export function buildAttractPrompt(card: GameDesignCard): string {
  const vibeDesc = getVibeDescription(card);
  const vibeColours = getVibeColoursList(card);
  const hero = card.hero?.description || "a tiny arcade hero";
  const scene = card.art?.scene || "retro arcade landscape";
  return `Pixel-art title-screen illustration for a ${card.genre} video game: ${hero} centred in a heroic pose, ${scene} behind, ${vibeDesc} palette in ${vibeColours}. Bold, readable, simple shapes. Retro 8-bit console style. ${PROMPT_SUFFIX}`;
}

/**
 * Generates procedural house pixel-art marquee, side, or attract image as a fallback
 * when Nano Banana times out, fails, or when running in offline/demo mode.
 */
export function createProceduralArt(
  kind: SkinImageKind,
  card: GameDesignCard
): { base64: string; mimeType: string; dataUrl: string } {
  const house = getHouseSkinForCard(card);
  const dataUrl =
    kind === "marquee"
      ? house.marqueeDataUrl
      : kind === "side"
      ? house.sideDataUrl
      : house.attractDataUrl;
  const base64 = dataUrl.split(",")[1] || "";
  return { base64, mimeType: "image/png", dataUrl };
}

export interface SkinImageArtifact {
  base64: string;
  mimeType: string;
  dataUrl: string;
  latencyMs: number;
  fallback: boolean;
}

export interface SkinResult {
  marquee: SkinImageArtifact;
  side: SkinImageArtifact;
  attract: SkinImageArtifact;
  marqueeUrl: string;
  sideUrl: string;
  attractUrl: string;
  imagesMs: [number, number, number];
  trimColor: string;
  bodyColor: string;
  fallbackUsed: boolean;
  latencyMs: number;
}

export interface SkinSessionOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  onImageReady?: (
    kind: SkinImageKind,
    dataUrl: string,
    art: SkinImageArtifact
  ) => void;
}

async function generateSingleArt(
  kind: SkinImageKind,
  prompt: string,
  aspectRatio: "21:9" | "9:16" | "16:9",
  card: GameDesignCard,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<SkinImageArtifact> {
  const t0 = performance.now();
  const isOnline =
    typeof navigator === "undefined" ? true : navigator.onLine !== false;

  if (!CONFIG.LIVE || !isOnline) {
    // Stagger simulated progressive arrival slightly in demo/offline mode so the two-track paint choreography shows
    const delayMs = kind === "marquee" ? 450 : kind === "side" ? 950 : 700;
    await new Promise((r) => setTimeout(r, delayMs));
    const proc = createProceduralArt(kind, card);
    return {
      ...proc,
      latencyMs: Math.round(performance.now() - t0),
      fallback: true,
    };
  }

  // Up to 2 attempts (1 initial + 1 retry on timeout/error per 03-design-card-and-art.md)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) break;
    try {
      const res = await image(prompt, {
        aspectRatio,
        timeoutMs,
        signal,
      });
      const dataUrl = `data:${res.mimeType};base64,${res.base64}`;
      return {
        base64: res.base64,
        mimeType: res.mimeType,
        dataUrl,
        latencyMs: Math.round(performance.now() - t0),
        fallback: false,
      };
    } catch {
      if (attempt === 1 || signal?.aborted) break;
    }
  }

  const proc = createProceduralArt(kind, card);
  return {
    ...proc,
    latencyMs: Math.round(performance.now() - t0),
    fallback: true,
  };
}

/**
 * Fires all 3 parallel Nano Banana (`image()`) calls:
 * - `marquee` at `21:9`
 * - `side` at `9:16`
 * - `attract` at `16:9`
 * with a 25s timeout per image (`CONFIG.IMAGE_TIMEOUT_MS`) and 1 retry.
 * Calls `onImageReady(kind, dataUrl, art)` as each image lands so the cabinet paints progressively.
 */
export async function runSkinSession(
  card: GameDesignCard,
  opts: SkinSessionOptions = {}
): Promise<SkinResult> {
  const timeoutMs = opts.timeoutMs ?? CONFIG.IMAGE_TIMEOUT_MS ?? 25_000;
  const t0 = performance.now();

  const runArtTask = (
    kind: SkinImageKind,
    prompt: string,
    aspectRatio: "21:9" | "9:16" | "16:9"
  ): Promise<SkinImageArtifact> =>
    generateSingleArt(kind, prompt, aspectRatio, card, timeoutMs, opts.signal).then(
      (art) => {
        opts.onImageReady?.(kind, art.dataUrl, art);
        return art;
      }
    );

  const [marquee, side, attract] = await Promise.all([
    runArtTask("marquee", buildMarqueePrompt(card), "21:9"),
    runArtTask("side", buildSidePrompt(card), "9:16"),
    runArtTask("attract", buildAttractPrompt(card), "16:9"),
  ]);
  const vibeDef = VIBES[card.vibe] || VIBES.sunset;

  return {
    marquee,
    side,
    attract,
    marqueeUrl: marquee.dataUrl,
    sideUrl: side.dataUrl,
    attractUrl: attract.dataUrl,
    imagesMs: [marquee.latencyMs, side.latencyMs, attract.latencyMs],
    trimColor: vibeDef.trim,
    bodyColor: vibeDef.body,
    fallbackUsed: marquee.fallback || side.fallback || attract.fallback,
    latencyMs: Math.round(performance.now() - t0),
  };
}

export default runSkinSession;
