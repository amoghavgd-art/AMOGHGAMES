import * as THREE from "three";
import type { GameDesignCard } from "../card/schema";
import { VIBES, PALETTE_32, type VibeName } from "../card/vibes";
import type { GenreName } from "../card/presets";
import { truncateStr, stripTrailingStopwords } from "../card/designCard";

export type VibeId = VibeName;
export type GenreId = GenreName;

// 4x4 Bayer matrix (0..15) matching mocks/playglow/index.html
const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

const PALETTE_RGB: Array<[number, number, number]> = PALETTE_32.map(hexToRgb);

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  if (typeof document === "undefined") {
    return { width: w, height: h } as unknown as HTMLCanvasElement;
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Ordered-dither vertical gradient through hex stops (ported from mocks/playglow/index.html).
 */
export function ditherVerticalGradient(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  hexStops: string[]
): void {
  const id = ctx.createImageData(w, h);
  const d = id.data;
  const rgb = hexStops.map(hexToRgb);
  const maxIdx = Math.max(0, rgb.length - 1);
  for (let j = 0; j < h; j++) {
    const f = (j / Math.max(1, h - 1)) * maxIdx;
    const i0 = Math.min(maxIdx, Math.floor(f));
    const fr = f - i0;
    for (let i = 0; i < w; i++) {
      const th = (BAYER_4X4[((y0 + j) & 3) * 4 + ((x0 + i) & 3)] + 0.5) / 16;
      const c = rgb[Math.min(maxIdx, fr > th ? i0 + 1 : i0)];
      const k = (j * w + i) * 4;
      d[k] = c[0];
      d[k + 1] = c[1];
      d[k + 2] = c[2];
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(id, x0, y0);
}

/**
 * Ordered-dither sun/disc with optional horizontal scan stripes (from mocks/playglow/index.html).
 */
export function ditherDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  colTop: string,
  colBot: string,
  stripes = 0
): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r) continue;
      const f = (y + r) / (2 * r);
      const th = (BAYER_4X4[((cy + y) & 3) * 4 + ((cx + x) & 3)] + 0.5) / 16;
      if (stripes && y > 0 && (y + 1) % stripes < Math.max(1, Math.floor((y / r) * 3))) continue;
      ctx.fillStyle = f > th ? colBot : colTop;
      ctx.fillRect(cx + x, cy + y, 1, 1);
    }
  }
}

/**
 * Snap every pixel in a canvas to the nearest of the 32 PICO-8 + secret palette colours
 * using redmean distance and 4x4 Bayer ordered dither (amplitude = 0.06 per 03-design-card-and-art.md).
 */
export function snapCanvasToPalette32(canvas: HTMLCanvasElement, ditherAmp = 0.06): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const amp255 = ditherAmp * 255;

  for (let y = 0; y < h; y++) {
    const rowBayer = (y & 3) * 4;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const bayer = (BAYER_4X4[rowBayer + (x & 3)] / 16 - 0.5) * amp255;
      const sr = Math.max(0, Math.min(255, d[idx] + bayer));
      const sg = Math.max(0, Math.min(255, d[idx + 1] + bayer));
      const sb = Math.max(0, Math.min(255, d[idx + 2] + bayer));

      let bestDist = 1e18;
      let bestColor = PALETTE_RGB[0];
      for (let i = 0; i < PALETTE_RGB.length; i++) {
        const p = PALETTE_RGB[i];
        const er = sr - p[0];
        const eg = sg - p[1];
        const eb = sb - p[2];
        const rm = (sr + p[0]) * 0.5 / 255;
        const dist = (2 + rm) * er * er + 4 * eg * eg + (3 - rm) * eb * eb;
        if (dist < bestDist) {
          bestDist = dist;
          bestColor = p;
        }
      }
      d[idx] = bestColor[0];
      d[idx + 1] = bestColor[1];
      d[idx + 2] = bestColor[2];
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Alpha-thresholded pixel-crisp "Press Start 2P" text renderer (ported from mocks/playglow/index.html).
 */
export function drawPixelText(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  opts: {
    size?: number;
    font?: string;
    align?: "left" | "center" | "right";
    color?: string;
    grad?: [string, string];
    outline?: string;
    shadow?: string;
    shadowD?: number;
  } = {}
): number {
  if (typeof document === "undefined") return str.length * 8;
  const size = opts.size || 8;
  const font = opts.font || "Press Start 2P";
  const cw = Math.max(640, Math.ceil(str.length * size * 1.25) + 32);
  const ch = Math.max(96, size * 2 + 16);
  const scratch = makeCanvas(cw, ch);
  const tx = scratch.getContext("2d", { willReadFrequently: true })!;
  tx.clearRect(0, 0, cw, ch);
  tx.font = `${size}px "${font}", monospace`;
  tx.textBaseline = "top";
  tx.fillStyle = "#ffffff";
  const w = Math.max(4, Math.min(cw - 4, Math.ceil(tx.measureText(str).width) + 4));
  const h = Math.min(ch - 4, size + 6);
  tx.fillText(str, 1, 1);

  const id = tx.getImageData(0, 0, w, h);
  for (let i = 3; i < id.data.length; i += 4) {
    id.data[i] = id.data[i] > 100 ? 255 : 0;
  }
  const mask = makeCanvas(w, h);
  mask.getContext("2d")!.putImageData(id, 0, 0);

  const tint = (col: string) => {
    const t = makeCanvas(w, h);
    const tctx = t.getContext("2d")!;
    tctx.drawImage(mask, 0, 0);
    tctx.globalCompositeOperation = "source-in";
    tctx.fillStyle = col;
    tctx.fillRect(0, 0, w, h);
    return t;
  };

  const x0 =
    Math.round(opts.align === "center" ? x - w / 2 : opts.align === "right" ? x - w : x) - 1;
  const y0 = Math.round(y) - 1;

  if (opts.shadow) {
    const sh = tint(opts.shadow);
    const sd = opts.shadowD || 1;
    for (let k = 1; k <= sd; k++) {
      ctx.drawImage(sh, x0 + k, y0 + k);
    }
  }
  if (opts.outline) {
    const out = tint(opts.outline);
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
    ]) {
      ctx.drawImage(out, x0 + dx, y0 + dy);
    }
  }
  if (opts.grad) {
    const t = tint(opts.grad[1]);
    const tctx = t.getContext("2d")!;
    tctx.globalCompositeOperation = "source-atop";
    tctx.fillStyle = opts.grad[0];
    tctx.fillRect(0, 0, w, 1 + Math.floor(size / 2));
    ctx.drawImage(t, x0, y0);
  } else {
    ctx.drawImage(tint(opts.color || "#FFF1E8"), x0, y0);
  }
  return w - 2;
}

// 16x12 genre hero sprites (ported from mocks/playglow/index.html)
const GENRE_SPRITE_ROWS: Record<GenreName, { rows: string[]; map: Record<string, string> }> = {
  runner: {
    rows: [
      "..........o..o..",
      ".........oro.oro",
      ".........orrrrro",
      "........orrkrrwo",
      "........orrrrwwk",
      ".oo.....owwwwwo.",
      "orro...ossssso..",
      "orrro.orrsrrrro.",
      ".owrrrorrrrrrro.",
      "..owrrrrrrrrrro.",
      "...oorrrrrrrroo.",
      "....orro..orro..",
      "....ooo...ooo...",
    ],
    map: { o: "#291814", r: "#FF6C24", w: "#FFF1E8", k: "#000000", s: "#29ADFF" },
  },
  shooter: {
    rows: [
      ".....o.....",
      "....oco....",
      "....oco....",
      "...owcwo...",
      "..owwwwwo..",
      ".orwwwwwro.",
      "orrwwwwwrro",
      "oo.oyyyo.oo",
      "....oyo....",
    ],
    map: { o: "#111D35", c: "#29ADFF", w: "#C2C3C7", r: "#FF004D", y: "#FFA300" },
  },
  maze: {
    rows: [
      ".oo.....oo.",
      "owwo.k.owwo",
      "owwwokowwwo",
      "owpwokowpwo",
      ".owwokowwo.",
      "..oo.o.oo..",
    ],
    map: { o: "#111D35", w: "#FFF1E8", p: "#FF77A8", k: "#83769C" },
  },
  breakout: {
    rows: [
      ".....rr.....",
      ".....oo.....",
      "...oppppo...",
      "..oppwpppo..",
      ".opppppppwo.",
      ".oppppppppo.",
      "oooooooooooo",
      "obtbtbtbtbto",
      ".obtbtbtbto.",
      ".obtbtbtbto.",
      "..obtbtbto..",
      "..oooooooo..",
    ],
    map: { o: "#422136", p: "#FF77A8", w: "#FFF1E8", b: "#AB5236", t: "#FFCCAA", r: "#FF004D" },
  },
  platformer: {
    rows: [
      "....oooo....",
      "..oohgggoo..",
      ".ohhggggggo.",
      ".ogggggggggo",
      "ogkggggkgggo",
      "ogkggggkgggo",
      "oggggggggggo",
      "oggggmmggggo",
      ".oggggggggo.",
      "..oooooooo..",
    ],
    map: { o: "#1D2B53", g: "#A8E72E", h: "#F3EF7D", k: "#111D35", m: "#008751" },
  },
  dodger: {
    rows: [
      "......oooo......",
      "....oorrrroo....",
      "...orryyyyrro...",
      "..oryYYyyyyyro..",
      "..orYYyyyyyyro..",
      ".oryYyyyyyyyyro.",
      ".oryywkyyywkyro.",
      ".oryykkyyykkyro.",
      ".oryykkyyykkyro.",
      ".orpyyyyyyyypro.",
      ".oryyyykkyyyyro.",
      "..oryyyyyyyyro..",
      "..orryyyyyyrro..",
      "...oorrrrrroo...",
      ".....oooooo.....",
      "....oRo..oRo....",
      "....ooo..ooo....",
    ],
    map: {
      o: "#422136",
      r: "#FFA300",
      R: "#FF6C24",
      y: "#FFEC27",
      Y: "#F3EF7D",
      k: "#291814",
      w: "#FFF1E8",
      p: "#FF77A8",
    },
  },
};

export function makeGenreSpriteCanvas(genre: GenreName = "runner"): HTMLCanvasElement {
  const def = GENRE_SPRITE_ROWS[genre] || GENRE_SPRITE_ROWS.runner;
  const h = def.rows.length;
  const w = Math.max(...def.rows.map((r) => r.length));
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d")!;
  def.rows.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      const col = def.map[ch];
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(i, j, 1, 1);
      }
    });
  });
  return c;
}

let cachedBaseImage: HTMLImageElement | HTMLCanvasElement | null = null;

/**
 * Create a procedural 1024x1024 baked ambient-occlusion + woodgrain texture if /assets/ArcadeMachine.png
 * hasn't loaded yet or fails to load.
 */
export function createFallbackBaseCabinetCanvas(): HTMLCanvasElement {
  const c = makeCanvas(1024, 1024);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ece6eb";
  ctx.fillRect(0, 0, 1024, 1024);

  // Subtle woodgrain lines
  ctx.fillStyle = "rgba(66, 33, 54, 0.06)";
  for (let y = 0; y < 1024; y += 4) {
    ctx.fillRect(0, y, 1024, 2);
  }

  // Soft ambient occlusion borders around UV islands
  const drawAoRect = (x: number, y: number, w: number, h: number) => {
    ctx.strokeStyle = "rgba(41, 24, 20, 0.22)";
    ctx.lineWidth = 8;
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
  };
  drawAoRect(120, 20, 784, 140); // marquee band
  drawAoRect(0, 180, 420, 800); // left side panel
  drawAoRect(604, 180, 420, 800); // right side panel

  return c;
}

/**
 * Load /assets/ArcadeMachine.png (with caching and procedural fallback).
 */
export async function loadBaseCabinetImage(
  url = "assets/ArcadeMachine.png"
): Promise<HTMLImageElement | HTMLCanvasElement> {
  if (cachedBaseImage) return cachedBaseImage;
  try {
    const img = await loadImageSource(url);
    if (img) {
      cachedBaseImage = img;
      return img;
    }
  } catch {
    // fall back
  }
  cachedBaseImage = createFallbackBaseCabinetCanvas();
  return cachedBaseImage;
}

export function loadImageSource(
  src?: string | HTMLImageElement | HTMLCanvasElement | null
): Promise<HTMLImageElement | HTMLCanvasElement | null> {
  if (!src) return Promise.resolve(null);
  if (src instanceof HTMLImageElement || src instanceof HTMLCanvasElement) {
    return Promise.resolve(src);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    if (
      src.startsWith("data:") ||
      src.startsWith("http") ||
      src.startsWith("/") ||
      src.startsWith("./") ||
      src.startsWith("assets/") ||
      /\.(png|jpg|jpeg|webp|svg)(\?.*)?$/i.test(src)
    ) {
      img.src = src;
    } else {
      img.src = `data:image/png;base64,${src}`;
    }
  });
}

function drawCenterCropped(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const sw = img.width || (img as HTMLImageElement).naturalWidth || dw;
  const sh = img.height || (img as HTMLImageElement).naturalHeight || dh;
  const targetAspect = dw / dh;
  const srcAspect = sw / sh;

  let sx = 0;
  let sy = 0;
  let sWidth = sw;
  let sHeight = sh;

  if (srcAspect > targetAspect) {
    sWidth = Math.round(sh * targetAspect);
    sx = Math.round((sw - sWidth) / 2);
  } else {
    sHeight = Math.round(sw / targetAspect);
    sy = Math.round((sh - sHeight) / 2);
  }

  ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
}

function upscaleNearest(src: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const dst = makeCanvas(src.width * factor, src.height * factor);
  const ctx = dst.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, dst.width, dst.height);
  return dst;
}

export interface ComposeSkinInput {
  baseImage?: HTMLImageElement | HTMLCanvasElement | null;
  card: GameDesignCard;
  bannerImage?: HTMLImageElement | HTMLCanvasElement | null;
  sideImage?: HTMLImageElement | HTMLCanvasElement | null;
  attractImage?: HTMLImageElement | HTMLCanvasElement | null;
}

export interface ComposedRegions {
  marquee: HTMLCanvasElement;
  side: HTMLCanvasElement;
  attract: HTMLCanvasElement;
  marqueeLow: HTMLCanvasElement;
  sideLow: HTMLCanvasElement;
  trim: string;
  body: string;
  buttons: string[];
}

/**
 * Compose the 3 pixel-snapped region canvases (marquee 288x40 -> 2016x280, side 100x202 -> 1000x2020,
 * attract 160x100 -> 320x200) per brief/03-design-card-and-art.md & mocks/playglow/index.html.
 */
export function splitSideTitleLines(title: string, maxLineChars = 11): [string, string] {
  const words = title.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["AMOGH", "GAMES"];
  if (words.length === 1) {
    const w = words[0];
    return w.length <= maxLineChars
      ? [w, ""]
      : [w.slice(0, maxLineChars), w.slice(maxLineChars, maxLineChars * 2)];
  }
  let bestSplit = Math.ceil(words.length / 2);
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(" ");
    const l2 = words.slice(i).join(" ");
    const overflow =
      Math.max(0, l1.length - maxLineChars) * 10 +
      Math.max(0, l2.length - maxLineChars) * 10;
    const diff = Math.abs(l1.length - l2.length);
    const score = overflow + diff;
    if (score < bestScore) {
      bestScore = score;
      bestSplit = i;
    }
  }
  const rawL1 = words.slice(0, bestSplit).join(" ");
  const rawL2 = words.slice(bestSplit).join(" ");
  const fitLine = (line: string) => {
    if (line.length <= maxLineChars) return line;
    return line.includes(" ")
      ? stripTrailingStopwords(truncateStr(line, maxLineChars)) || line.slice(0, maxLineChars)
      : line.slice(0, maxLineChars);
  };
  return [fitLine(rawL1), fitLine(rawL2)];
}

export function composeRegionCanvases(input: ComposeSkinInput): ComposedRegions {
  const { card, bannerImage, sideImage, attractImage } = input;
  const vibeDef = VIBES[card.vibe] || VIBES.sunset;
  const pal = card.palette || vibeDef.palette;
  const heroSprite = makeGenreSpriteCanvas(card.genre || "runner");
  const title = (card.title || "AMOGH GAMES").toUpperCase();

  // 1. Marquee (288x40 art -> palette snap -> Press Start 2P title -> x7 upscale to 2016x280)
  const mqLow = makeCanvas(288, 40);
  const mqCtx = mqLow.getContext("2d")!;
  const isPrecomposedMarquee =
    Boolean(bannerImage) &&
    bannerImage!.width === 288 &&
    bannerImage!.height === 40;

  if (isPrecomposedMarquee && bannerImage) {
    mqCtx.imageSmoothingEnabled = false;
    mqCtx.drawImage(bannerImage, 0, 0, 288, 40);
  } else {
    if (bannerImage) {
      mqCtx.imageSmoothingEnabled = true;
      mqCtx.imageSmoothingQuality = "high";
      drawCenterCropped(mqCtx, bannerImage, 0, 0, 288, 40);
      snapCanvasToPalette32(mqLow, 0.06);
    } else {
      ditherVerticalGradient(mqCtx, 0, 0, 288, 40, ["#111D35", pal.bg, pal.fg, pal.accent1]);
      mqCtx.fillStyle = pal.ui || "#FFF1E8";
      for (let i = 0; i < 30; i++) {
        mqCtx.fillRect((i * 97) % 288, (i * 23) % 22, 1, 1);
      }
      mqCtx.imageSmoothingEnabled = false;
      const sc = 2;
      const sw = heroSprite.width * sc;
      const sh = heroSprite.height * sc;
      mqCtx.drawImage(heroSprite, 10, Math.max(2, 36 - sh), sw, sh);
      mqCtx.save();
      mqCtx.translate(278, 0);
      mqCtx.scale(-1, 1);
      mqCtx.drawImage(heroSprite, 0, Math.max(2, 36 - sh), sw, sh);
      mqCtx.restore();
    }

    // Frame borders & title on marquee
    mqCtx.fillStyle = "#291814";
    mqCtx.fillRect(0, 0, 288, 2);
    mqCtx.fillRect(0, 38, 288, 2);
    mqCtx.fillStyle = pal.fg;
    mqCtx.fillRect(0, 34, 288, 2);

    // Press Start 2P auto-fitted on a single centered line (up to 18 chars fits cleanly in 288px width)
    const fSize =
      title.length > 16 ? 9 : title.length > 13 ? 10 : title.length > 10 ? 13 : 15;
    const fY = Math.round((40 - fSize) / 2) + 1;
    drawPixelText(mqCtx, title, 144, fY, {
      size: fSize,
      align: "center",
      grad: [pal.accent2, pal.accent1],
      outline: "#291814",
      shadow: pal.accent1,
      shadowD: 2,
    });
  }

  // 2. Side panel (100x202 art -> palette snap -> 80s diagonal stripes + top title -> x10 upscale to 1000x2020)
  const sdLow = makeCanvas(100, 202);
  const sdCtx = sdLow.getContext("2d")!;
  const isPrecomposedSide =
    Boolean(sideImage) &&
    sideImage!.width === 100 &&
    sideImage!.height === 202;

  if (isPrecomposedSide && sideImage) {
    sdCtx.imageSmoothingEnabled = false;
    sdCtx.drawImage(sideImage, 0, 0, 100, 202);
  } else {
    if (sideImage) {
      sdCtx.imageSmoothingEnabled = true;
      sdCtx.imageSmoothingQuality = "high";
      drawCenterCropped(sdCtx, sideImage, 0, 0, 100, 202);
      snapCanvasToPalette32(sdLow, 0.06);
    } else {
      sdCtx.imageSmoothingEnabled = false;
      ditherVerticalGradient(sdCtx, 0, 0, 100, 202, ["#111D35", pal.bg, pal.fg, pal.accent1]);
      sdCtx.fillStyle = pal.ui || "#FFF1E8";
      for (let i = 0; i < 40; i++) {
        sdCtx.fillRect((i * 37) % 100, (i * 53) % 110, 1, 1);
      }
      ditherDisc(sdCtx, 50, 95, 26, pal.accent2, pal.fg, 4);
      // Silhouette hills
      for (let i = 0; i < 100; i++) {
        const y1 = Math.round(132 + Math.sin((i / 100) * 9.42 + 1) * 7);
        sdCtx.fillStyle = pal.bg;
        sdCtx.fillRect(i, y1, 1, 202 - y1);
        sdCtx.fillStyle = pal.fg;
        sdCtx.fillRect(i, y1, 1, 1);
        const y2 = Math.round(150 + Math.sin((i / 100) * 9.42 + 2.5) * 6);
        sdCtx.fillStyle = "#422136";
        sdCtx.fillRect(i, y2, 1, 202 - y2);
      }
      // Center hero sprite
      const hScale = 4;
      const hw = heroSprite.width * hScale;
      const hh = heroSprite.height * hScale;
      sdCtx.drawImage(heroSprite, Math.round((100 - hw) / 2), 96 - Math.round(hh / 2), hw, hh);
    }

    // Classic 80s diagonal stripes across bottom 18%
    const stripeColors = [pal.accent2, pal.accent1, pal.fg];
    stripeColors.forEach((col, k) => {
      sdCtx.fillStyle = col;
      for (let i = 0; i < 100; i++) {
        sdCtx.fillRect(i, Math.round(176 - k * 7 - i * 0.35), 1, 4);
      }
    });

    // Small title at the top of side panel
    const [topLine1, topLine2] = splitSideTitleLines(title, 11);
    drawPixelText(sdCtx, topLine1, 50, 12, {
      size: 8,
      align: "center",
      color: pal.accent2,
      outline: "#291814",
      shadow: "#291814",
      shadowD: 2,
    });
    if (topLine2) {
      drawPixelText(sdCtx, topLine2, 50, 24, {
        size: 8,
        align: "center",
        color: pal.accent2,
        outline: "#291814",
        shadow: "#291814",
        shadowD: 2,
      });
    }
  }

  // 3. Attract screen (160x100 -> palette snap -> x2 upscale to 320x200)
  const atLow = makeCanvas(160, 100);
  const atCtx = atLow.getContext("2d")!;
  const isPrecomposedAttract =
    Boolean(attractImage) &&
    attractImage!.width === 160 &&
    attractImage!.height === 100;

  if (isPrecomposedAttract && attractImage) {
    atCtx.imageSmoothingEnabled = false;
    atCtx.drawImage(attractImage, 0, 0, 160, 100);
  } else if (attractImage) {
    atCtx.imageSmoothingEnabled = true;
    atCtx.imageSmoothingQuality = "high";
    drawCenterCropped(atCtx, attractImage, 0, 0, 160, 100);
    snapCanvasToPalette32(atLow, 0.06);
  } else {
    ditherVerticalGradient(atCtx, 0, 0, 160, 100, ["#111D35", pal.bg, pal.fg]);
    ditherDisc(atCtx, 80, 50, 24, pal.accent2, pal.accent1, 3);
    atCtx.imageSmoothingEnabled = false;
    atCtx.drawImage(
      heroSprite,
      Math.round(80 - heroSprite.width * 1.5),
      Math.round(50 - heroSprite.height * 1.5),
      heroSprite.width * 3,
      heroSprite.height * 3
    );
  }

  const marquee = upscaleNearest(mqLow, 7); // 2016x280
  const side = upscaleNearest(sdLow, 10); // 1000x2020
  const attract = upscaleNearest(atLow, 2); // 320x200

  const buttons = [
    pal.accent1,
    pal.accent2,
    pal.fg,
    vibeDef.trim,
    "#29ADFF",
    "#FF77A8",
  ];

  return {
    marquee,
    side,
    attract,
    marqueeLow: mqLow,
    sideLow: sdLow,
    trim: vibeDef.trim,
    body: vibeDef.body,
    buttons,
  };
}

/**
 * 1024x1024 offscreen canvas compositor:
 * - Starts with a fresh 1024x1024 canvas and draws `baseImage` (`ArcadeMachine.png`) first.
 * - Uses `ctx.globalCompositeOperation = 'multiply'` so baked ambient-occlusion and woodgrain detail stay visible.
 * - Composites:
 *   - `sideImage` (9:16) into the left & right side-panel UV islands (`x: 0..420, y: 180..980` and `x: 604..1024, y: 180..980`)
 *   - `bannerImage` (21:9) into the top marquee band (`x: 120..904, y: 20..160`)
 * - Draws `card.title` centered over the marquee band in `"Press Start 2P"` with dark stroke + vibe accent fill + subtle glow.
 * - Returns a `THREE.CanvasTexture` (`colorSpace = THREE.SRGBColorSpace`, `needsUpdate = true`),
 *   with `userData.regions` holding the dedicated marquee/side/attract canvases for the 3D cabinet groups.
 */
export function composeCabinetSkin(input: ComposeSkinInput): THREE.CanvasTexture {
  const { card, bannerImage, sideImage } = input;
  const baseImage = input.baseImage || cachedBaseImage || createFallbackBaseCabinetCanvas();
  const vibeDef = VIBES[card.vibe] || VIBES.sunset;
  const pal = card.palette || vibeDef.palette;

  const regions = composeRegionCanvases(input);

  const canvas = makeCanvas(1024, 1024);
  const ctx = canvas.getContext("2d")!;

  // 1. Draw base AO / woodgrain diffuse map first
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(baseImage, 0, 0, 1024, 1024);

  // 2. Multiply vibe shell tint + side & banner art over baseImage so AO shadows remain visible
  ctx.save();
  ctx.globalCompositeOperation = "multiply";

  // Subtle shell tint outside art islands
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, 1024, 1024);

  // Left & right side-panel UV islands (x: 0..420, y: 180..980 and x: 604..1024, y: 180..980)
  const sideSrc = sideImage || regions.side;
  drawCenterCropped(ctx, sideSrc, 0, 180, 420, 800);
  drawCenterCropped(ctx, sideSrc, 604, 180, 420, 800);

  // Top marquee band (x: 120..904, y: 20..160)
  const bannerSrc = bannerImage || regions.marqueeLow;
  drawCenterCropped(ctx, bannerSrc, 120, 20, 784, 140);
  ctx.restore();

  // Also blend crisp pixel details at 75% source-over on the marquee/side islands so dark vibes stay vivid
  ctx.save();
  ctx.globalAlpha = 0.78;
  ctx.imageSmoothingEnabled = false;
  drawCenterCropped(ctx, regions.sideLow, 0, 180, 420, 800);
  drawCenterCropped(ctx, regions.sideLow, 604, 180, 420, 800);
  drawCenterCropped(ctx, regions.marqueeLow, 120, 20, 784, 140);
  ctx.restore();

  // 3. Draw card.title centered over the marquee band (x: 120..904, y: 20..160) in "Press Start 2P"
  const title = (card.title || "PLAYGLOW").toUpperCase();
  ctx.save();
  ctx.font = '36px "Press Start 2P", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = pal.accent1;
  ctx.shadowBlur = 12;
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#291814";
  ctx.strokeText(title, 512, 90);
  ctx.fillStyle = pal.accent2 || pal.accent1;
  ctx.fillText(title, 512, 90);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.userData = {
    regions,
    marquee: regions.marquee,
    side: regions.side,
    attract: regions.attract,
    trim: regions.trim,
    body: regions.body,
    buttons: regions.buttons,
  };
  return tex;
}

/**
 * Procedural preview skin during Wizard Steps 1-4 before AI art arrives.
 */
export function composeProceduralSkin(opts: {
  name?: string;
  title?: string;
  vibe?: VibeName;
  genre?: GenreName;
  hero?: string;
  step?: number;
  baseImage?: HTMLImageElement | HTMLCanvasElement | null;
}): THREE.CanvasTexture {
  const vibe: VibeName = opts.vibe || "sunset";
  const genre: GenreName = opts.genre || "runner";
  const vibeDef = VIBES[vibe] || VIBES.sunset;
  const cleanName = (opts.name || "").trim().toUpperCase();
  const marqueeTitle =
    opts.title?.trim().toUpperCase() ||
    (cleanName ? `${cleanName}'S GAME` : "AMOGH GAMES");

  // Pending marquee (matches mocks/playglow/index.html pendingMarquee / blankMarquee)
  const mqLow = makeCanvas(288, 40);
  const mqCtx = mqLow.getContext("2d")!;
  const isStep4 = (opts.step ?? 1) >= 4;
  ditherVerticalGradient(
    mqCtx,
    0,
    0,
    288,
    40,
    isStep4
      ? ["#111D35", vibeDef.palette.bg, vibeDef.palette.fg]
      : ["#111D35", "#422136", "#111D35"]
  );
  mqCtx.fillStyle = "#291814";
  mqCtx.fillRect(0, 0, 288, 2);
  mqCtx.fillRect(0, 38, 288, 2);
  const mText = marqueeTitle.slice(0, 19);
  const mSize = mText.length > 16 ? 9 : mText.length > 13 ? 11 : mText.length > 10 ? 13 : 15;
  const mY = Math.round((40 - mSize) / 2) + 1;
  drawPixelText(mqCtx, mText, 144, mY, {
    size: mSize,
    align: "center",
    color: "#FFCCAA",
    outline: "#291814",
    shadow: isStep4 ? vibeDef.palette.accent1 : "#7E2553",
    shadowD: 2,
  });

  // Blank / preview side panel (matches mocks/playglow/index.html blankSide)
  const sdLow = makeCanvas(100, 202);
  const sdCtx = sdLow.getContext("2d")!;
  sdCtx.fillStyle = isStep4 ? vibeDef.body : "#422136";
  sdCtx.fillRect(0, 0, 100, 202);
  sdCtx.fillStyle = isStep4 ? vibeDef.palette.bg : "#49333B";
  for (let j = 0; j < 202; j += 2) {
    for (let i = (j / 2) % 2; i < 100; i += 4) {
      sdCtx.fillRect(i, j, 1, 1);
    }
  }
  const stripeCols = isStep4
    ? [vibeDef.palette.accent1, vibeDef.palette.fg]
    : ["#754665", "#49333B"];
  stripeCols.forEach((col, k) => {
    sdCtx.fillStyle = col;
    for (let i = 0; i < 100; i++) {
      sdCtx.fillRect(i, Math.round(176 - k * 7 - i * 0.35), 1, 4);
    }
  });
  drawPixelText(sdCtx, "?", 50, 80, {
    size: 32,
    align: "center",
    color: isStep4 ? vibeDef.palette.accent2 : "#754665",
    shadow: "#291814",
    shadowD: 3,
  });

  const marquee = upscaleNearest(mqLow, 7);
  const side = upscaleNearest(sdLow, 10);

  // Also build the 1024x1024 combined texture
  const baseImage = opts.baseImage || cachedBaseImage || createFallbackBaseCabinetCanvas();
  const canvas = makeCanvas(1024, 1024);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(baseImage, 0, 0, 1024, 1024);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = isStep4 ? vibeDef.palette.bg : "#422136";
  ctx.fillRect(0, 0, 1024, 1024);
  drawCenterCropped(ctx, sdLow, 0, 180, 420, 800);
  drawCenterCropped(ctx, sdLow, 604, 180, 420, 800);
  drawCenterCropped(ctx, mqLow, 120, 20, 784, 140);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.userData = {
    regions: {
      marquee,
      side,
      attract: makeCanvas(320, 200),
      marqueeLow: mqLow,
      sideLow: sdLow,
      trim: isStep4 ? vibeDef.trim : "#754665",
      body: isStep4 ? vibeDef.body : "#422136",
      buttons: isStep4
        ? [vibeDef.palette.accent1, vibeDef.palette.accent2, vibeDef.palette.fg, vibeDef.trim, "#29ADFF", "#FF77A8"]
        : ["#C2C3C7", "#C2C3C7", "#C2C3C7", "#C2C3C7", "#C2C3C7", "#C2C3C7"],
    },
    marquee,
    side,
    trim: isStep4 ? vibeDef.trim : "#754665",
    body: isStep4 ? vibeDef.body : "#422136",
    genre,
  };
  return tex;
}

/**
 * UV test card for M1 verification (a): arrow + "TOP-LEFT" corner marker on screen, marquee, and side panels.
 */
export function composeUvTestCard(): {
  marquee: HTMLCanvasElement;
  side: HTMLCanvasElement;
  screen: HTMLCanvasElement;
} {
  const drawTestPattern = (w: number, h: number, label: string) => {
    const c = makeCanvas(w, h);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#1D2B53";
    ctx.fillRect(0, 0, w, h);
    // Border
    ctx.strokeStyle = "#FFEC27";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    // Top-left marker (inset slightly on SIDE so the cabinet bezel curve doesn't clip the left letters)
    const tx = label === "SIDE" ? 18 : 6;
    const ty = label === "SIDE" ? 18 : 6;
    ctx.fillStyle = "#FF004D";
    ctx.fillRect(tx - 2, ty - 2, Math.min(68, w - tx - 4), 16);
    drawPixelText(ctx, "TOP-LEFT", tx, ty + 2, {
      size: label === "SIDE" ? 6 : 8,
      color: "#FFF1E8",
      outline: "#000000",
    });
    // Upright arrow in center
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    ctx.fillStyle = "#00E436";
    ctx.fillRect(cx - 3, cy - 10, 6, 20);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 16);
    ctx.lineTo(cx - 10, cy - 4);
    ctx.lineTo(cx + 10, cy - 4);
    ctx.closePath();
    ctx.fill();
    drawPixelText(ctx, label, cx, cy + 12, {
      size: 8,
      align: "center",
      color: "#FFEC27",
      outline: "#000000",
    });
    return c;
  };

  return {
    marquee: upscaleNearest(drawTestPattern(288, 40, "MARQUEE"), 7),
    side: upscaleNearest(drawTestPattern(100, 202, "SIDE"), 10),
    screen: drawTestPattern(320, 200, "SCREEN"),
  };
}

/**
 * Named 32-color PICO-8 + secret palette from mocks/playglow/index.html.
 */
export const C = {
  black: "#000000",
  navy: "#1D2B53",
  plum: "#7E2553",
  green: "#008751",
  brown: "#AB5236",
  dgray: "#5F574F",
  lgray: "#C2C3C7",
  cream: "#FFF1E8",
  red: "#FF004D",
  orange: "#FFA300",
  yellow: "#FFEC27",
  lime: "#00E436",
  blue: "#29ADFF",
  lav: "#83769C",
  pink: "#FF77A8",
  peach: "#FFCCAA",
  dbrown: "#291814",
  dnavy: "#111D35",
  dplum: "#422136",
  teal: "#125359",
  rust: "#742F29",
  mauve: "#49333B",
  tan: "#A28879",
  lyellow: "#F3EF7D",
  crimson: "#BE1250",
  dorange: "#FF6C24",
  ylime: "#A8E72E",
  mgreen: "#00B543",
  dblue: "#065AB5",
  dmauve: "#754665",
  salmon: "#FF6E59",
  lpeach: "#FF9D81",
} as const;

export interface MockMarqueeOpts {
  title: string;
  bg: string[];
  color?: string;
  grad?: [string, string];
  outline?: string;
  shadow?: string;
  hero?: HTMLCanvasElement | null;
  deco?: string;
}

export interface MockSideOpts {
  bg: string[];
  sun?: [number, number, number, number?];
  sunCols?: [string, string];
  hills?: Array<[number, number, string, string | null, number]>;
  hero?: HTMLCanvasElement | null;
  heroScale?: number;
  title?: [string, string?];
  sub?: string;
  stripes?: string[];
  deco?: string;
}

/**
 * Exact 288x40 marquee art generator ported from mocks/playglow/index.html lines 455–471.
 */
export function marqueeArt(opts: MockMarqueeOpts): HTMLCanvasElement {
  const { title, bg, color, grad, outline, shadow, hero, deco } = opts;
  const c = makeCanvas(288, 40);
  const x = c.getContext("2d")!;
  ditherVerticalGradient(x, 0, 0, 288, 40, bg);
  x.fillStyle = deco || C.cream;
  for (let i = 0; i < 30; i++) {
    x.fillRect((i * 97) % 288, (i * 23) % 22, 1, 1);
  }
  x.fillStyle = C.dbrown;
  x.fillRect(0, 0, 288, 2);
  x.fillRect(0, 38, 288, 2);
  if (shadow) {
    x.fillStyle = shadow;
    x.fillRect(0, 34, 288, 2);
  }
  const size = title.length > 13 ? 11 : title.length > 10 ? 13 : 15;
  const ty = Math.round((40 - size) / 2) + 1;
  drawPixelText(x, title, 144, ty, {
    size,
    align: "center",
    grad,
    color,
    outline,
    shadow: outline,
    shadowD: 2,
  });
  if (hero) {
    const s = hero;
    const sc = 2;
    const w = s.width * sc;
    const h = s.height * sc;
    x.imageSmoothingEnabled = false;
    x.drawImage(s, 10, 38 - h - 2, w, h);
    x.save();
    x.translate(278, 0);
    x.scale(-1, 1);
    x.drawImage(s, 0, 38 - h - 2, w, h);
    x.restore();
  }
  return c;
}

/**
 * Exact 100x202 side panel art generator ported from mocks/playglow/index.html lines 472–498.
 */
export function sideArt(opts: MockSideOpts): HTMLCanvasElement {
  const { bg, sun, sunCols, hills, hero, heroScale = 4, title, sub, stripes, deco } = opts;
  const W = 100;
  const H = 202;
  const c = makeCanvas(W, H);
  const x = c.getContext("2d")!;
  x.imageSmoothingEnabled = false;
  ditherVerticalGradient(x, 0, 0, W, H, bg);
  x.fillStyle = deco || C.cream;
  for (let i = 0; i < 40; i++) {
    x.fillRect((i * 37) % W, (i * 53) % 110, 1, 1);
  }
  if (sun && sunCols) {
    ditherDisc(x, sun[0], sun[1], sun[2], sunCols[0], sunCols[1], sun[3] || 0);
  }
  if (hills) {
    hills.forEach(([base, amp, col, top, seed]) => {
      for (let i = 0; i < W; i++) {
        const y = Math.round(
          base +
            Math.sin((i / W) * 6.28 * 1.5 + seed) * amp +
            Math.sin((i / W) * 6.28 * 4 + seed) * amp * 0.3
        );
        x.fillStyle = col;
        x.fillRect(i, y, 1, H - y);
        if (top) {
          x.fillStyle = top;
          x.fillRect(i, y, 1, 1);
        }
      }
    });
  }
  if (stripes) {
    stripes.forEach((col, k) => {
      x.fillStyle = col;
      for (let i = 0; i < W; i++) {
        x.fillRect(i, Math.round(176 - k * 7 - i * 0.35), 1, 4);
      }
    });
  }
  if (hero) {
    const w = hero.width * heroScale;
    const h = hero.height * heroScale;
    x.drawImage(hero, Math.round((W - w) / 2) + 4, 100 - Math.round(h / 2), w, h);
  }
  if (title) {
    drawPixelText(x, title[0], W / 2, 12, {
      size: 8,
      align: "center",
      color: C.yellow,
      outline: C.dbrown,
      shadow: C.dbrown,
      shadowD: 2,
    });
    if (title[1]) {
      drawPixelText(x, title[1], W / 2, 24, {
        size: 8,
        align: "center",
        color: C.yellow,
        outline: C.dbrown,
        shadow: C.dbrown,
        shadowD: 2,
      });
    }
  }
  if (sub) {
    // tiny 3x5 credit line at bottom of side panel
    const upper = sub.toUpperCase();
    const tw = upper.length * 4 - 1;
    const sx = Math.round(W / 2 - tw / 2);
    x.fillStyle = C.dbrown;
    x.fillRect(sx, 193, tw, 5);
    x.fillStyle = C.cream;
    for (let idx = 0; idx < upper.length; idx++) {
      if (upper[idx] !== " ") {
        x.fillRect(sx + idx * 4, 192, 3, 5);
      }
    }
  }
  return c;
}

export function pendingMarquee(playerName = ""): HTMLCanvasElement {
  const c = makeCanvas(288, 40);
  const x = c.getContext("2d")!;
  ditherVerticalGradient(x, 0, 0, 288, 40, [C.dnavy, C.dplum, C.dnavy]);
  x.fillStyle = C.dbrown;
  x.fillRect(0, 0, 288, 2);
  x.fillRect(0, 38, 288, 2);
  const clean = playerName.trim().toUpperCase();
  const rawLabel = clean
    ? clean === "AMOGH GAMES" || clean === "PLAYGLOW" || clean.endsWith("'S GAME")
      ? clean === "PLAYGLOW" ? "AMOGH GAMES" : clean
      : `${clean}'S GAME`
    : "AMOGH GAMES";
  const label = rawLabel.slice(0, 19);
  const size = label.length > 16 ? 9 : label.length > 13 ? 11 : label.length > 10 ? 13 : 15;
  const ty = Math.round((40 - size) / 2) + 1;
  drawPixelText(x, label, 144, ty, {
    size,
    align: "center",
    color: C.peach,
    outline: C.dbrown,
    shadow: C.plum,
    shadowD: 2,
  });
  return c;
}

export function blankSide(): HTMLCanvasElement {
  const c = makeCanvas(100, 202);
  const x = c.getContext("2d")!;
  x.fillStyle = C.dplum;
  x.fillRect(0, 0, 100, 202);
  x.fillStyle = C.mauve;
  for (let j = 0; j < 202; j += 2) {
    for (let i = (j / 2) % 2; i < 100; i += 4) {
      x.fillRect(i, j, 1, 1);
    }
  }
  [C.dmauve, C.mauve].forEach((col, k) => {
    x.fillStyle = col;
    for (let i = 0; i < 100; i++) {
      x.fillRect(i, Math.round(176 - k * 7 - i * 0.35), 1, 4);
    }
  });
  drawPixelText(x, "?", 50, 80, {
    size: 32,
    align: "center",
    color: C.dmauve,
    shadow: C.dbrown,
    shadowD: 3,
  });
  return c;
}

/**
 * Left -> right marquee wipe with a 2px #FFF1E8 cream leading column
 * (ported from mocks/playglow/index.html line 1041).
 */
export function wipeMarqueeStep(
  dst: HTMLCanvasElement,
  from: HTMLCanvasElement,
  to: HTMLCanvasElement,
  f: number
): void {
  const mx = dst.getContext("2d")!;
  const W = dst.width;
  const H = dst.height;
  const scale = Math.max(1, Math.round(W / 288));
  mx.imageSmoothingEnabled = false;
  mx.drawImage(from, 0, 0, W, H);
  const clamped = Math.max(0, Math.min(1, f));
  if (clamped > 0) {
    const wLow = Math.round(288 * clamped);
    const wPx = wLow * scale;
    const srcW = Math.round((wLow / 288) * to.width);
    if (wPx > 0 && srcW > 0) {
      mx.drawImage(to, 0, 0, srcW, to.height, 0, 0, wPx, H);
    }
    if (clamped < 1) {
      mx.fillStyle = C.cream;
      mx.fillRect(wPx, 0, 2 * scale, H);
    }
  }
}

/**
 * Bottom -> up side panel wipe with orange & yellow wet-paint drips
 * (ported from mocks/playglow/index.html lines 1046–1052).
 */
export function wipeSideStep(
  dst: HTMLCanvasElement,
  from: HTMLCanvasElement,
  to: HTMLCanvasElement,
  f: number
): void {
  const sx = dst.getContext("2d")!;
  const W = dst.width;
  const H = dst.height;
  const scaleX = Math.max(1, Math.round(W / 100));
  const scaleY = Math.max(1, Math.round(H / 202));
  sx.imageSmoothingEnabled = false;
  sx.drawImage(from, 0, 0, W, H);
  const clamped = Math.max(0, Math.min(1, f));
  if (clamped > 0) {
    const hgtLow = Math.round(202 * clamped);
    const y0Low = 202 - hgtLow;
    const hgtPx = hgtLow * scaleY;
    const y0Px = y0Low * scaleY;
    const srcY = Math.round((y0Low / 202) * to.height);
    const srcH = to.height - srcY;
    if (hgtPx > 0 && srcH > 0) {
      sx.drawImage(to, 0, srcY, to.width, srcH, 0, y0Px, W, hgtPx);
    }
    if (clamped < 1) {
      for (let i = 0; i < 100; i++) {
        const dr = (i * 7) % 5 === 0 ? 3 + (i % 4) : 1;
        sx.fillStyle = i % 3 ? C.dorange : C.yellow;
        sx.fillRect(i * scaleX, (y0Low - dr) * scaleY, scaleX, dr * scaleY);
      }
    }
  }
}

/**
 * Diagonal 4x4 Bayer pixel-dissolve between two skin canvases with #FFF1E8 cream and #FFEC27 yellow leading edge
 * (ported from mocks/playglow/index.html lines 942–953).
 */
export function dissolve(
  dst: HTMLCanvasElement,
  from: HTMLCanvasElement,
  to: HTMLCanvasElement,
  f: number,
  blk = 4
): void {
  const x = dst.getContext("2d")!;
  const w = dst.width;
  const h = dst.height;
  const nw = Math.ceil(w / blk);
  const nh = Math.ceil(h / blk);
  x.imageSmoothingEnabled = false;
  x.drawImage(from, 0, 0, w, h);
  for (let bj = 0; bj < nh; bj++) {
    for (let bi = 0; bi < nw; bi++) {
      const pos = (bi / nw) * 0.75 + (1 - bj / nh) * 0.25;
      const th = pos + (BAYER_4X4[(bj & 3) * 4 + (bi & 3)] / 16 - 0.5) * 0.16;
      const i = bi * blk;
      const j = bj * blk;
      if (th < f) {
        const sx = (i / w) * to.width;
        const sy = (j / h) * to.height;
        const sw = (blk / w) * to.width;
        const sh = (blk / h) * to.height;
        x.drawImage(to, sx, sy, sw, sh, i, j, blk, blk);
      } else if (th < f + 0.025) {
        x.fillStyle = C.cream;
        x.fillRect(i, j, blk, blk);
      } else if (th < f + 0.05) {
        x.fillStyle = C.yellow;
        x.fillRect(i, j, blk, blk);
      }
    }
  }
}
