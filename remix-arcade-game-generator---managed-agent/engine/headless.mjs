#!/usr/bin/env node
// engine/headless.mjs — Standalone zero-dependency Node 22 headless cart verifier
// Usage:
//   node engine/headless.mjs <cart-path> [card-json-path] [--require-score]
//   node engine/headless.mjs <cart-path> --card <card.json> --policy random|idle|hold-right [--seconds 60] [--seed 7] [--out <dir>]

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { performance } from "node:perf_hooks";

// BEGIN INLINED RUNTIME
// engine/runtime.js — Pure indexed-framebuffer (320x200) cart runtime
// Runs identically inside the sandboxed browser iframe and in Node 22 headless runner.

export const W = 320;
export const H = 200;

export const PALETTE = [
  // 0-15: Base PICO-8
  "#000000", "#1D2B53", "#7E2553", "#008751",
  "#AB5236", "#5F574F", "#C2C3C7", "#FFF1E8",
  "#FF004D", "#FFA300", "#FFEC27", "#00E436",
  "#29ADFF", "#83769C", "#FF77A8", "#FFCCAA",
  // 16-31: Secret PICO-8
  "#291814", "#111D35", "#422136", "#125359",
  "#742F29", "#49333B", "#A28879", "#F3EF7D",
  "#BE1250", "#FF6C24", "#A8E72E", "#00B543",
  "#065AB5", "#754665", "#FF6E59", "#FF9D81",
];

// Precomputed RGBA bytes per palette index
export const PALETTE_RGBA = new Uint8Array(32 * 4);
for (let i = 0; i < 32; i++) {
  const hex = PALETTE[i];
  PALETTE_RGBA[i * 4 + 0] = parseInt(hex.slice(1, 3), 16);
  PALETTE_RGBA[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
  PALETTE_RGBA[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
  PALETTE_RGBA[i * 4 + 3] = 255;
}

// 3x5 bitmap font (each entry is 15 chars of '0'|'1', row-major 3 wide x 5 high)
export const FONT_3X5 = {
  "0": "111101101101111",
  "1": "010110010010111",
  "2": "111001111100111",
  "3": "111001111001111",
  "4": "101101111001001",
  "5": "111100111001111",
  "6": "111100111101111",
  "7": "111001001001001",
  "8": "111101111101111",
  "9": "111101111001111",
  "A": "010101111101101",
  "B": "110101110101110",
  "C": "011100100100011",
  "D": "110101101101110",
  "E": "111100110100111",
  "F": "111100110100100",
  "G": "011100101101011",
  "H": "101101111101101",
  "I": "111010010010111",
  "J": "001001001101010",
  "K": "101101110101101",
  "L": "100100100100111",
  "M": "101111111101101",
  "N": "110101101101101",
  "O": "010101101101010",
  "P": "110101110100100",
  "Q": "010101101110011",
  "R": "110101110101101",
  "S": "011100010001110",
  "T": "111010010010010",
  "U": "101101101101111",
  "V": "101101101101010",
  "W": "101101111111101",
  "X": "101101010101101",
  "Y": "101101010010010",
  "Z": "111001010100111",
  " ": "000000000000000",
  ".": "000000000000010",
  ",": "000000000010100",
  "!": "010010010000010",
  "?": "111001011000010",
  ":": "000010000010000",
  ";": "000010000010100",
  "-": "000000111000000",
  "+": "000010111010000",
  "=": "000111000111000",
  "x": "000101010101000",
  "/": "001001010100100",
  "\\": "100001010001001",
  "|": "010010010010010",
  "*": "000101111111010",
  ">": "100010001010100",
  "<": "001010100010001",
  "(": "010100100100010",
  ")": "010001001001010",
  "[": "110100100100110",
  "]": "011001001001011",
  "{": "011010110010011",
  "}": "110010011010110",
  "#": "101111101111101",
  "$": "011110010011110",
  "&": "110100111101011",
  "@": "111101111100111",
  "_": "000000000000111",
  "%": "101001010100101",
  "'": "010010000000000",
  "\"": "101101000000000",
  "^": "010101000000000",
  "~": "000011110000000",
  "♥": "101111111010010",
};

// 4x4 Bayer matrix (0..15)
const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

// 5x5 HUD heart bitmap (1 = filled)
const HEART_5X5 = [
  0, 1, 0, 1, 0,
  1, 1, 1, 1, 1,
  1, 1, 1, 1, 1,
  0, 1, 1, 1, 0,
  0, 0, 1, 0, 0,
];

// Default char -> palette index map ('0'-'9' -> 0-9, 'a'-'v' -> 10-31)
const DEFAULT_SPRITE_MAP = {};
for (let i = 0; i < 10; i++) DEFAULT_SPRITE_MAP[String(i)] = i;
for (let i = 0; i < 22; i++) DEFAULT_SPRITE_MAP[String.fromCharCode(97 + i)] = 10 + i;

export const FORBIDDEN_TOKENS = [
  /\bwindow\b/,
  /\bdocument\b/,
  /\bglobalThis\b/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bimport\s*\(/,
  /\simport\s+/,
  /^import\s+/m,
  /\beval\b/,
  /\bFunction\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bDate\b/,
  /\bMath\.random\b/,
];

/**
 * Scan game source code for forbidden tokens or oversize files (<= 60 KB).
 */
export function scanSource(source) {
  const issues = [];
  if (typeof source !== "string") {
    return { ok: false, issues: ["Source is not a string"] };
  }
  const byteLen = new TextEncoder().encode(source).length;
  if (byteLen > 60 * 1024) {
    issues.push(`File size ${byteLen} bytes exceeds 60 KB limit`);
  }
  // Strip single-line and block comments before scanning for forbidden tokens
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  for (const rx of FORBIDDEN_TOKENS) {
    if (rx.test(stripped)) {
      issues.push(`Forbidden token matched: ${rx.source}`);
    }
  }
  return { ok: issues.length === 0, issues, byteLen };
}

export function createMulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BTN_KEY_MAP = {
  0: "left",
  1: "right",
  2: "up",
  3: "down",
  4: "a",
  5: "b",
  6: "start",
  left: "left",
  right: "right",
  up: "up",
  down: "down",
  a: "a",
  b: "b",
  start: "start",
  action: "a",
  jump: "a",
  fire: "a",
  shoot: "a",
  dash: "b",
  special: "b",
};

/**
 * Create a self-contained CartRunner instance.
 */
export function createCartRunner({
  card,
  seed = 7,
  initialSave = {},
  onSfx = () => {},
  onFx = () => {},
  onScore = () => {},
  onSave = () => {},
  onGameOver = () => {},
  onError = () => {},
} = {}) {
  const fb = new Uint8Array(W * H);
  const saveStore = { ...initialSave };
  let currentSeed = (seed ?? card?.seed ?? 7) >>> 0;
  let rngFn = createMulberry32(currentSeed);
  let fxRngFn = createMulberry32((currentSeed ^ 0xA5A5A5A5) >>> 0);

  let frameCount = 0;
  let scoreVal = 0;
  let livesVal = 3;
  let bestScore = Number(saveStore.best || 0);
  let shakeFrames = 0;
  let shakePx = 0;
  let flashFrames = 0;
  let flashMaxFrames = 1;
  let flashCol = 7;
  let hitstopFrames = 0;
  let hudPulseFrames = 0;
  let camX = 0;
  let camY = 0;
  let clipX0 = 0;
  let clipY0 = 0;
  let clipX1 = W;
  let clipY1 = H;
  let palMap = null;

  let particles = [];
  let popups = [];
  let fxDrawnThisFrame = false;

  let mode = "title"; // "title" | "playing" | "gameover"
  let paused = false;
  let gameOverReason = "";
  let createFn = null;
  let gameInstance = null;

  // Violations & telemetry tracked for headless runner verification
  const violations = {
    invalidPaletteIndex: false,
    textTooLong: false,
    exceptions: [],
  };
  const stats = {
    sprCalls: 0,
    drawCalls: 0,
  };

  const prevInput = {
    left: false, right: false, up: false, down: false,
    a: false, b: false, start: false,
  };
  const curInput = {
    left: false, right: false, up: false, down: false,
    a: false, b: false, start: false,
  };
  const curPressed = {
    left: false, right: false, up: false, down: false,
    a: false, b: false, start: false,
  };

  function checkColor(c) {
    if (typeof c !== "number" || !Number.isFinite(c)) {
      violations.invalidPaletteIndex = true;
      return 0;
    }
    const idx = c | 0;
    if (idx < 0 || idx > 31) {
      violations.invalidPaletteIndex = true;
      return ((idx % 32) + 32) % 32;
    }
    return palMap ? palMap[idx] : idx;
  }

  function rawPset(x, y, c) {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < clipX0 || ix >= clipX1 || iy < clipY0 || iy >= clipY1) return;
    fb[iy * W + ix] = c;
  }

  function parseRawSpriteGrid(s) {
    const rawLines = (Array.isArray(s) ? s : String(s).split(/\r?\n/))
      .map((l) => String(l ?? "").trim())
      .filter((l) => l.length > 0);
    const sh = rawLines.length;
    if (sh === 0) return null;
    let sw = 0;
    for (let i = 0; i < sh; i++) {
      if (rawLines[i].length > sw) sw = rawLines[i].length;
    }
    if (sw === 0) return null;
    const pixels = new Int16Array(sw * sh);
    pixels.fill(-1);
    for (let sy = 0; sy < sh; sy++) {
      const row = rawLines[sy];
      for (let sx = 0; sx < row.length; sx++) {
        const ch = row[sx];
        if (!ch || ch === "." || ch === " ") continue;
        const col = Object.prototype.hasOwnProperty.call(DEFAULT_SPRITE_MAP, ch)
          ? DEFAULT_SPRITE_MAP[ch]
          : parseInt(ch, 16);
        if (!Number.isNaN(col)) {
          pixels[sy * sw + sx] = col & 31;
        }
      }
    }
    return { w: sw, h: sh, _pixels: pixels, _raw: true };
  }

  function drawEngineFx() {
    if (fxDrawnThisFrame) return;
    fxDrawnThisFrame = true;

    const prevClipX0 = clipX0, prevClipY0 = clipY0, prevClipX1 = clipX1, prevClipY1 = clipY1;
    const prevPalMap = palMap;
    clipX0 = 0; clipY0 = 0; clipX1 = W; clipY1 = H;
    palMap = null;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const sz = p.life < p.maxLife * 0.35 ? 1 : p.size;
      if (sz <= 1) {
        gfx.pset(p.x, p.y, p.c);
      } else {
        gfx.rect(p.x - (sz >> 1), p.y - (sz >> 1), sz, sz, p.c);
      }
    }

    for (let i = 0; i < popups.length; i++) {
      const pop = popups[i];
      if (pop.life < pop.maxLife * 0.25 && (frameCount & 1) === 1) continue;
      if (pop.screenSpace) {
        const prevCamX = camX, prevCamY = camY;
        camX = 0; camY = 0;
        gfx.text(pop.str, pop.x, pop.y, pop.c, { align: "center", shadow: 16 });
        camX = prevCamX; camY = prevCamY;
      } else {
        gfx.text(pop.str, pop.x, pop.y, pop.c, { align: "center", shadow: 16 });
      }
    }

    if (flashFrames > 0) {
      const threshold = flashFrames >= flashMaxFrames * 0.6 ? 8 : 4;
      const col = flashCol & 31;
      for (let py = 0; py < H; py++) {
        const row = py * W;
        const by = (py & 3) * 4;
        for (let px = 0; px < W; px++) {
          if (BAYER_4X4[by + (px & 3)] < threshold) {
            fb[row + px] = col;
          }
        }
      }
    }

    clipX0 = prevClipX0; clipY0 = prevClipY0; clipX1 = prevClipX1; clipY1 = prevClipY1;
    palMap = prevPalMap;
  }

  const gfx = {
    W,
    H,
    cls(c = 0) {
      const col = checkColor(c);
      fb.fill(col);
    },
    pset(x, y, c) {
      const col = checkColor(c);
      rawPset((x | 0) - camX, (y | 0) - camY, col);
    },
    pix(x, y, c) {
      this.pset(x, y, c);
    },
    pget(x, y) {
      const ix = (x | 0) - camX;
      const iy = (y | 0) - camY;
      if (ix < 0 || ix >= W || iy < 0 || iy >= H) return 0;
      return fb[iy * W + ix];
    },
    clip(x, y, w, h) {
      if (x === undefined || w === undefined) {
        clipX0 = 0;
        clipY0 = 0;
        clipX1 = W;
        clipY1 = H;
        return;
      }
      clipX0 = Math.max(0, Math.min(W, x | 0));
      clipY0 = Math.max(0, Math.min(H, y | 0));
      clipX1 = Math.max(clipX0, Math.min(W, (x | 0) + (w | 0)));
      clipY1 = Math.max(clipY0, Math.min(H, (y | 0) + (h | 0)));
    },
    rect(x, y, w, h, c) {
      stats.drawCalls++;
      const col = checkColor(c);
      const x0 = Math.max(clipX0, (x | 0) - camX);
      const y0 = Math.max(clipY0, (y | 0) - camY);
      const x1 = Math.min(clipX1, (x | 0) - camX + (w | 0));
      const y1 = Math.min(clipY1, (y | 0) - camY + (h | 0));
      for (let py = y0; py < y1; py++) {
        const row = py * W;
        for (let px = x0; px < x1; px++) {
          fb[row + px] = col;
        }
      }
    },
    rectfill(x, y, w, h, c) {
      this.rect(x, y, w, h, c);
    },
    rectb(x, y, w, h, c) {
      stats.drawCalls++;
      const col = checkColor(c);
      const rx = (x | 0) - camX;
      const ry = (y | 0) - camY;
      const rw = w | 0;
      const rh = h | 0;
      if (rw <= 0 || rh <= 0) return;
      for (let i = 0; i < rw; i++) {
        rawPset(rx + i, ry, col);
        rawPset(rx + i, ry + rh - 1, col);
      }
      for (let j = 0; j < rh; j++) {
        rawPset(rx, ry + j, col);
        rawPset(rx + rw - 1, ry + j, col);
      }
    },
    rrect(x, y, w, h, r = 2, c = 7) {
      stats.drawCalls++;
      const rw = w | 0;
      const rh = h | 0;
      if (rw <= 0 || rh <= 0) return;
      const ir = Math.max(0, Math.min(r | 0, (rw / 2) | 0, (rh / 2) | 0));
      if (ir <= 0) {
        this.rect(x, y, rw, rh, c);
        return;
      }
      const col = checkColor(c);
      const rx = (x | 0) - camX;
      const ry = (y | 0) - camY;
      const r2 = ir * ir;
      for (let dy = 0; dy < rh; dy++) {
        const cy = dy < ir ? ir - dy : (dy >= rh - ir ? dy - (rh - 1 - ir) : 0);
        for (let dx = 0; dx < rw; dx++) {
          const cx = dx < ir ? ir - dx : (dx >= rw - ir ? dx - (rw - 1 - ir) : 0);
          if (cx > 0 && cy > 0 && cx * cx + cy * cy > r2) continue;
          rawPset(rx + dx, ry + dy, col);
        }
      }
    },
    rrectb(x, y, w, h, r = 2, c = 7) {
      stats.drawCalls++;
      const rw = w | 0;
      const rh = h | 0;
      if (rw <= 0 || rh <= 0) return;
      const ir = Math.max(0, Math.min(r | 0, (rw / 2) | 0, (rh / 2) | 0));
      if (ir <= 0) {
        this.rectb(x, y, rw, rh, c);
        return;
      }
      const col = checkColor(c);
      const rx = (x | 0) - camX;
      const ry = (y | 0) - camY;
      const r2 = ir * ir;
      const inside = (dx, dy) => {
        if (dx < 0 || dx >= rw || dy < 0 || dy >= rh) return false;
        const cx = dx < ir ? ir - dx : (dx >= rw - ir ? dx - (rw - 1 - ir) : 0);
        const cy = dy < ir ? ir - dy : (dy >= rh - ir ? dy - (rh - 1 - ir) : 0);
        return !(cx > 0 && cy > 0 && cx * cx + cy * cy > r2);
      };
      for (let dy = 0; dy < rh; dy++) {
        for (let dx = 0; dx < rw; dx++) {
          if (!inside(dx, dy)) continue;
          if (!inside(dx - 1, dy) || !inside(dx + 1, dy) || !inside(dx, dy - 1) || !inside(dx, dy + 1)) {
            rawPset(rx + dx, ry + dy, col);
          }
        }
      }
    },
    circ(x, y, r, c) {
      stats.drawCalls++;
      const col = checkColor(c);
      const cx = (x | 0) - camX;
      const cy = (y | 0) - camY;
      const ir = r | 0;
      if (ir < 0) return;
      const r2 = ir * ir;
      for (let dy = -ir; dy <= ir; dy++) {
        for (let dx = -ir; dx <= ir; dx++) {
          if (dx * dx + dy * dy <= r2) {
            rawPset(cx + dx, cy + dy, col);
          }
        }
      }
    },
    circfill(x, y, r, c) {
      this.circ(x, y, r, c);
    },
    circb(x, y, r, c) {
      stats.drawCalls++;
      const col = checkColor(c);
      const cx = (x | 0) - camX;
      const cy = (y | 0) - camY;
      const ir = r | 0;
      if (ir < 0) return;
      let dx = ir;
      let dy = 0;
      let err = 1 - dx;
      while (dx >= dy) {
        rawPset(cx + dx, cy + dy, col);
        rawPset(cx + dy, cy + dx, col);
        rawPset(cx - dy, cy + dx, col);
        rawPset(cx - dx, cy + dy, col);
        rawPset(cx - dx, cy - dy, col);
        rawPset(cx - dy, cy - dx, col);
        rawPset(cx + dy, cy - dx, col);
        rawPset(cx + dx, cy - dy, col);
        dy++;
        if (err < 0) {
          err += 2 * dy + 1;
        } else {
          dx--;
          err += 2 * (dy - dx + 1);
        }
      }
    },
    oval(x, y, rx, ry, c) {
      stats.drawCalls++;
      const col = checkColor(c);
      const cx = (x | 0) - camX;
      const cy = (y | 0) - camY;
      const irx = rx | 0;
      const iry = ry | 0;
      if (irx < 0 || iry < 0) return;
      if (irx === 0 || iry === 0) {
        rawPset(cx, cy, col);
        return;
      }
      const rx2 = irx * irx;
      const ry2 = iry * iry;
      const limit = rx2 * ry2;
      for (let dy = -iry; dy <= iry; dy++) {
        const dyTerm = dy * dy * rx2;
        for (let dx = -irx; dx <= irx; dx++) {
          if (dx * dx * ry2 + dyTerm <= limit) {
            rawPset(cx + dx, cy + dy, col);
          }
        }
      }
    },
    ovalb(x, y, rx, ry, c) {
      stats.drawCalls++;
      const col = checkColor(c);
      const cx = (x | 0) - camX;
      const cy = (y | 0) - camY;
      const irx = rx | 0;
      const iry = ry | 0;
      if (irx < 0 || iry < 0) return;
      if (irx === 0 || iry === 0) {
        rawPset(cx, cy, col);
        return;
      }
      const rx2 = irx * irx;
      const ry2 = iry * iry;
      const limit = rx2 * ry2;
      const inside = (dx, dy) => dx * dx * ry2 + dy * dy * rx2 <= limit;
      for (let dy = -iry; dy <= iry; dy++) {
        for (let dx = -irx; dx <= irx; dx++) {
          if (!inside(dx, dy)) continue;
          if (!inside(dx - 1, dy) || !inside(dx + 1, dy) || !inside(dx, dy - 1) || !inside(dx, dy + 1)) {
            rawPset(cx + dx, cy + dy, col);
          }
        }
      }
    },
    tri(x0, y0, x1, y1, x2, y2, c) {
      stats.drawCalls++;
      const col = checkColor(c);
      let ax = (x0 | 0) - camX;
      let ay = (y0 | 0) - camY;
      let bx = (x1 | 0) - camX;
      let by = (y1 | 0) - camY;
      let cx = (x2 | 0) - camX;
      let cy = (y2 | 0) - camY;

      let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (area === 0) {
        this.line(x0, y0, x1, y1, c);
        this.line(x1, y1, x2, y2, c);
        return;
      }
      if (area < 0) {
        const tx = bx, ty = by;
        bx = cx; by = cy;
        cx = tx; cy = ty;
        area = -area;
      }

      const minX = Math.max(clipX0, Math.min(ax, bx, cx));
      const maxX = Math.min(clipX1 - 1, Math.max(ax, bx, cx));
      const minY = Math.max(clipY0, Math.min(ay, by, cy));
      const maxY = Math.min(clipY1 - 1, Math.max(ay, by, cy));

      for (let py = minY; py <= maxY; py++) {
        const row = py * W;
        for (let px = minX; px <= maxX; px++) {
          const w0 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
          const w1 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
          const w2 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
          if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
            fb[row + px] = col;
          }
        }
      }
    },
    trifill(x0, y0, x1, y1, x2, y2, c) {
      this.tri(x0, y0, x1, y1, x2, y2, c);
    },
    trib(x0, y0, x1, y1, x2, y2, c) {
      this.line(x0, y0, x1, y1, c);
      this.line(x1, y1, x2, y2, c);
      this.line(x2, y2, x0, y0, c);
    },
    line(x0, y0, x1, y1, c) {
      stats.drawCalls++;
      const col = checkColor(c);
      let ix0 = (x0 | 0) - camX;
      let iy0 = (y0 | 0) - camY;
      const ix1 = (x1 | 0) - camX;
      const iy1 = (y1 | 0) - camY;
      const dx = Math.abs(ix1 - ix0);
      const sx = ix0 < ix1 ? 1 : -1;
      const dy = -Math.abs(iy1 - iy0);
      const sy = iy0 < iy1 ? 1 : -1;
      let err = dx + dy;
      for (let steps = 0; steps < 1024; steps++) {
        rawPset(ix0, iy0, col);
        if (ix0 === ix1 && iy0 === iy1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; ix0 += sx; }
        if (e2 <= dx) { err += dx; iy0 += sy; }
      }
    },
    spr(s, x, y, opts) {
      if (!s) return;
      const spriteObj = s._pixels ? s : (typeof s === "string" || Array.isArray(s) ? parseRawSpriteGrid(s) : null);
      if (!spriteObj || !spriteObj._pixels) return;
      stats.sprCalls++;
      stats.drawCalls++;

      const isBoolOpts = typeof opts === "boolean";
      const flipX = isBoolOpts ? opts : Boolean(opts && opts.flipX);
      const flipY = !isBoolOpts && Boolean(opts && opts.flipY);
      const rawScale = (!isBoolOpts && opts && opts.scale) ? (opts.scale | 0) : 1;
      const scale = (rawScale >= 1 && rawScale <= 4) ? rawScale : 1;
      const hasFlash = !isBoolOpts && opts && opts.flash !== undefined && opts.flash !== false && opts.flash !== null;
      const flashColor = hasFlash ? checkColor(opts.flash === true ? 7 : opts.flash) : -1;
      const hasOutline = !isBoolOpts && opts && opts.outline !== undefined && opts.outline !== false && opts.outline !== null;
      const outlineColor = hasOutline ? checkColor(opts.outline === true ? 16 : opts.outline) : -1;

      const ox = (x | 0) - camX;
      const oy = (y | 0) - camY;
      const sw = spriteObj.w;
      const sh = spriteObj.h;
      const data = spriteObj._pixels;
      const isRaw = Boolean(spriteObj._raw);

      if (outlineColor >= 0) {
        for (let sy = 0; sy < sh; sy++) {
          const srcY = flipY ? (sh - 1 - sy) : sy;
          for (let sx = 0; sx < sw; sx++) {
            const srcX = flipX ? (sw - 1 - sx) : sx;
            const rawCol = data[srcY * sw + srcX];
            if (isRaw ? rawCol < 0 : rawCol === 0) continue;
            const px0 = ox + sx * scale;
            const py0 = oy + sy * scale;
            for (let d = 0; d < scale; d++) {
              rawPset(px0 + d, py0 - 1, outlineColor);
              rawPset(px0 + d, py0 + scale, outlineColor);
              rawPset(px0 - 1, py0 + d, outlineColor);
              rawPset(px0 + scale, py0 + d, outlineColor);
            }
          }
        }
      }

      for (let sy = 0; sy < sh; sy++) {
        const srcY = flipY ? (sh - 1 - sy) : sy;
        for (let sx = 0; sx < sw; sx++) {
          const srcX = flipX ? (sw - 1 - sx) : sx;
          const rawCol = data[srcY * sw + srcX];
          if (isRaw ? rawCol < 0 : rawCol === 0) continue;
          const col = flashColor >= 0 ? flashColor : (palMap ? palMap[rawCol & 31] : (rawCol & 31));
          if (scale === 1) {
            rawPset(ox + sx, oy + sy, col);
          } else {
            for (let dy = 0; dy < scale; dy++) {
              for (let dx = 0; dx < scale; dx++) {
                rawPset(ox + sx * scale + dx, oy + sy * scale + dy, col);
              }
            }
          }
        }
      }
    },
    text(str, x, y, c = 7, opts) {
      const col = checkColor(c);
      const s = String(str ?? "");
      if (s.length > 40) {
        violations.textTooLong = true;
      }
      const clipped = s.slice(0, 80).toUpperCase();
      const rawScale = (opts && opts.scale) ? (opts.scale | 0) : 1;
      const scale = (rawScale >= 1 && rawScale <= 3) ? rawScale : 1;
      const align = (opts && opts.align) || "left";
      const charAdvance = 4 * scale;
      const totalW = clipped.length > 0 ? clipped.length * charAdvance - scale : 0;
      let ox = (x | 0) - camX;
      const oy = (y | 0) - camY;
      if (align === "center") ox -= (totalW / 2) | 0;
      else if (align === "right") ox -= totalW;

      const drawSpan = (offX, offY, drawCol) => {
        for (let n = 0; n < clipped.length; n++) {
          const ch = clipped[n];
          const glyph = FONT_3X5[ch] || FONT_3X5[ch.toLowerCase()] || FONT_3X5[" "];
          const cx = ox + n * charAdvance + offX;
          const cy = oy + offY;
          for (let i = 0; i < 15; i++) {
            if (glyph[i] === "1") {
              const gx = i % 3;
              const gy = (i / 3) | 0;
              if (scale === 1) {
                rawPset(cx + gx, cy + gy, drawCol);
              } else {
                for (let dy = 0; dy < scale; dy++) {
                  for (let dx = 0; dx < scale; dx++) {
                    rawPset(cx + gx * scale + dx, cy + gy * scale + dy, drawCol);
                  }
                }
              }
            }
          }
        }
      };

      if (opts && opts.outline !== undefined && opts.outline !== false && opts.outline !== null) {
        const outCol = checkColor(opts.outline === true ? 16 : opts.outline);
        drawSpan(-1, 0, outCol);
        drawSpan(1, 0, outCol);
        drawSpan(0, -1, outCol);
        drawSpan(0, 1, outCol);
      }
      if (opts && opts.shadow !== undefined && opts.shadow !== false && opts.shadow !== null) {
        const shCol = checkColor(opts.shadow === true ? 16 : opts.shadow);
        drawSpan(1, 1, shCol);
      }
      drawSpan(0, 0, col);
    },
    print(str, x, y, c = 7, opts) {
      this.text(str, x, y, c, opts);
    },
    dither(x, y, w, h, c1, yCol2, level) {
      const col1 = checkColor(c1);
      const col2 = checkColor(yCol2);
      const lvl = Math.max(0, Math.min(4, level | 0));
      const threshold = lvl * 4; // 0 -> 0, 1 -> 4, 2 -> 8, 3 -> 12, 4 -> 16
      const x0 = Math.max(clipX0, (x | 0) - camX);
      const y0 = Math.max(clipY0, (y | 0) - camY);
      const x1 = Math.min(clipX1, (x | 0) - camX + (w | 0));
      const y1 = Math.min(clipY1, (y | 0) - camY + (h | 0));
      for (let py = y0; py < y1; py++) {
        const row = py * W;
        const by = (py & 3) * 4;
        for (let px = x0; px < x1; px++) {
          const bval = BAYER_4X4[by + (px & 3)];
          fb[row + px] = bval < threshold ? col2 : col1;
        }
      }
    },
    starfield(scrollX = 0, scrollY = 0, count = 28, c1 = 6, c2 = 7) {
      const col1 = checkColor(c1);
      const col2 = checkColor(c2);
      const n = Math.max(0, Math.min(160, count | 0));
      const sx = Number(scrollX) || 0;
      const sy = Number(scrollY) || 0;
      for (let i = 0; i < n; i++) {
        const h1 = Math.imul(i + 1, 2654435761) >>> 0;
        const h2 = Math.imul(i + 1, 2246822519) >>> 0;
        const layer = (i % 3) + 1;
        const speed = layer * 0.45;
        const px = (((h1 % W) - ((sx * speed) | 0)) % W + W) % W;
        const py = ((((h2 >>> 8) % (H - 22)) - ((sy * speed) | 0)) % (H - 22) + (H - 22)) % (H - 22) + 20;
        rawPset(px, py, layer === 1 ? col1 : col2);
      }
    },
    bar(x, y, w, h, pct, fgCol = 11, bgCol = 16, borderCol) {
      const rw = Math.max(1, w | 0);
      const rh = Math.max(1, h | 0);
      const p = Math.max(0, Math.min(1, Number(pct) || 0));
      this.rect(x, y, rw, rh, bgCol);
      if (borderCol !== undefined && borderCol !== null && borderCol !== false) {
        this.rectb(x, y, rw, rh, borderCol === true ? 7 : borderCol);
        const innerW = Math.max(0, rw - 2);
        const fillW = Math.round(innerW * p);
        if (fillW > 0 && rh > 2) {
          this.rect(x + 1, y + 1, fillW, rh - 2, fgCol);
        }
      } else {
        const fillW = Math.round(rw * p);
        if (fillW > 0) {
          this.rect(x, y, fillW, rh, fgCol);
        }
      }
    },
    camera(x = 0, y = 0) {
      camX = x | 0;
      camY = y | 0;
    },
    cam(x = 0, y = 0) {
      this.camera(x, y);
    },
    pal(c0, c1) {
      if (c0 === undefined) {
        palMap = null;
        return;
      }
      if (!palMap) {
        palMap = new Uint8Array(32);
        for (let i = 0; i < 32; i++) palMap[i] = i;
      }
      palMap[c0 & 31] = c1 & 31;
    },
    resetPal() {
      palMap = null;
    },
    vibePalette() {
      const ep = card?.engine_palette || { bg: 2, fg: 25, accent1: 9, accent2: 10, ui: 7 };
      return {
        bg: ep.bg,
        fg: ep.fg,
        primary: ep.accent1,
        secondary: ep.accent2,
        accent: ep.accent1,
        accent1: ep.accent1,
        accent2: ep.accent2,
        ui: ep.ui,
        hazard: 8,
      };
    },
    fx() {
      drawEngineFx();
    },
  };

  const engine = {
    W,
    H,
    get time() {
      return frameCount / 60;
    },
    get frame() {
      return frameCount;
    },
    rng() {
      return rngFn();
    },
    rngInt(min, maxIncl) {
      const lo = Math.ceil(min);
      const hi = Math.floor(maxIncl);
      if (hi <= lo) return lo;
      return lo + Math.floor(rngFn() * (hi - lo + 1));
    },
    rngFloat(min = 0, max = 1) {
      return min + rngFn() * (max - min);
    },
    rngChoice(arr) {
      if (!Array.isArray(arr) || arr.length === 0) return undefined;
      return arr[this.rngInt(0, arr.length - 1)];
    },
    pick(arr) {
      return this.rngChoice(arr);
    },
    chance(p = 0.5) {
      return rngFn() < p;
    },
    clamp(v, lo = 0, hi = 1) {
      return Math.max(lo, Math.min(hi, v));
    },
    lerp(a, b, t) {
      return a + (b - a) * t;
    },
    dist(x1, y1, x2, y2) {
      return Math.hypot(x2 - x1, y2 - y1);
    },
    angle(x1, y1, x2, y2) {
      return Math.atan2(y2 - y1, x2 - x1);
    },
    aabb(ax, ay, aw, ah, bx, by, bw, bh) {
      if (typeof ax === "object" && ax !== null && typeof ay === "object" && ay !== null) {
        const a = ax;
        const b = ay;
        return (
          a.x < b.x + (b.w ?? 8) &&
          a.x + (a.w ?? 8) > b.x &&
          a.y < b.y + (b.h ?? 8) &&
          a.y + (a.h ?? 8) > b.y
        );
      }
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    },
    circleHit(ax, ay, ar, bx, by, br) {
      if (typeof ax === "object" && ax !== null && typeof ay === "object" && ay !== null) {
        const a = ax;
        const b = ay;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const r = (a.r ?? 4) + (b.r ?? 4);
        return dx * dx + dy * dy <= r * r;
      }
      const dx = ax - bx;
      const dy = ay - by;
      const r = ar + br;
      return dx * dx + dy * dy <= r * r;
    },
    btn(k) {
      const key = BTN_KEY_MAP[typeof k === "string" ? k.toLowerCase() : k];
      return key ? Boolean(curInput[key]) : false;
    },
    btnp(k) {
      const key = BTN_KEY_MAP[typeof k === "string" ? k.toLowerCase() : k];
      return key ? Boolean(curPressed[key]) : false;
    },
    score(add) {
      const delta = Number(add) || 0;
      if (delta !== 0) {
        scoreVal = Math.max(0, Math.floor(scoreVal + delta));
        if (scoreVal > bestScore) {
          bestScore = scoreVal;
          saveStore.best = bestScore;
          onSave({ key: "best", value: bestScore });
        }
        onScore({ score: scoreVal, lives: livesVal });
        if (delta >= 25) {
          hudPulseFrames = 10;
          this.popup(`+${Math.floor(delta)}`, 36, 22, card?.engine_palette?.accent2 ?? 10, 0.55, true);
          onFx({ kind: "score", intensity: 0.6 });
        }
      }
    },
    get scoreValue() {
      return scoreVal;
    },
    lives(n) {
      if (n === undefined) return livesVal;
      const next = Math.max(0, n | 0);
      const lost = next < livesVal;
      if (next !== livesVal) {
        livesVal = next;
        onScore({ score: scoreVal, lives: livesVal });
        if (lost) {
          onFx({ kind: "hit", intensity: 0.8 });
        }
      }
      return livesVal;
    },
    loseLife(n = 1) {
      const dec = Math.max(1, n | 0);
      const prev = livesVal;
      this.lives(livesVal - dec);
      if (prev === 0) {
        onFx({ kind: "hit", intensity: 0.8 });
      }
      return livesVal;
    },
    get livesValue() {
      return livesVal;
    },
    gameOver(reason = "") {
      if (mode === "gameover") return;
      mode = "gameover";
      gameOverReason = String(reason || "").slice(0, 32);
      if (scoreVal > bestScore) {
        bestScore = scoreVal;
        saveStore.best = bestScore;
        onSave({ key: "best", value: bestScore });
      }
      onFx({ kind: "gameover", intensity: 1 });
      onGameOver({ score: scoreVal, best: bestScore, reason: gameOverReason });
    },
    sfx(name, noteOrOpts = 0) {
      const note =
        typeof noteOrOpts === "number"
          ? noteOrOpts
          : noteOrOpts && typeof noteOrOpts.note === "number"
            ? noteOrOpts.note
            : 0;
      onSfx({ name: String(name), note });
    },
    shake(frames = 4, px) {
      const f = Math.max(0, frames | 0);
      shakeFrames = f;
      const defaultPx = f >= 10 ? 3 : f >= 5 ? 2 : 1;
      shakePx = Math.max(1, (px !== undefined ? px : defaultPx) | 0);
      if (f > 0) {
        onFx({ kind: "shake", intensity: Math.min(1, f / 10) });
      }
    },
    burst(x, y, opts = {}) {
      const count = Math.max(1, Math.min(48, (opts.count ?? 8) | 0));
      const speed = Number(opts.speed ?? 75);
      const life = Math.max(0.08, Number(opts.life ?? 0.35));
      const gravity = Number(opts.gravity ?? 110);
      const size = Math.max(1, Math.min(4, (opts.size ?? 2) | 0));
      const colorList = Array.isArray(opts.colors)
        ? opts.colors
        : Array.isArray(opts.color)
          ? opts.color
          : null;
      const baseCol = colorList ? 10 : checkColor(opts.color ?? 10);

      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + (fxRngFn() - 0.5) * 0.85;
        const spd = speed * (0.45 + fxRngFn() * 0.75);
        const col = colorList && colorList.length > 0
          ? checkColor(colorList[i % colorList.length])
          : baseCol;
        const maxLife = life * (0.75 + fxRngFn() * 0.4);
        particles.push({
          x: Number(x) || 0,
          y: Number(y) || 0,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - (gravity > 0 ? speed * 0.18 : 0),
          gravity,
          life: maxLife,
          maxLife,
          size,
          c: col,
        });
      }
      while (particles.length > 192) {
        particles.shift();
      }
    },
    particles(x, y, opts) {
      this.burst(x, y, opts);
    },
    popup(str, x, y, c = 10, life = 0.65, screenSpace = false) {
      const dur = Math.max(0.15, Number(life) || 0.65);
      popups.push({
        str: String(str ?? "").slice(0, 24),
        x: Number(x) || 0,
        y: Number(y) || 0,
        vy: -22,
        c: checkColor(c),
        life: dur,
        maxLife: dur,
        screenSpace: Boolean(screenSpace),
      });
      while (popups.length > 32) {
        popups.shift();
      }
    },
    floatText(str, x, y, c = 10, life = 0.65) {
      this.popup(str, x, y, c, life);
    },
    flash(frames = 4, c = 7) {
      flashFrames = Math.max(0, frames | 0);
      flashMaxFrames = Math.max(1, flashFrames);
      flashCol = checkColor(c);
    },
    hitstop(frames = 3) {
      hitstopFrames = Math.max(hitstopFrames, Math.min(15, Math.max(0, frames | 0)));
    },
    freeze(frames = 3) {
      this.hitstop(frames);
    },
    hud(g = gfx) {
      const targetGfx = g || gfx;
      const prevCamX = camX;
      const prevCamY = camY;
      const prevClipX0 = clipX0, prevClipY0 = clipY0, prevClipX1 = clipX1, prevClipY1 = clipY1;
      const prevPalMap = palMap;
      camX = 0;
      camY = 0;
      clipX0 = 0; clipY0 = 0; clipX1 = W; clipY1 = H;
      palMap = null;

      const uiCol = checkColor(card?.engine_palette?.ui ?? 7);
      const accentCol = checkColor(card?.engine_palette?.accent1 ?? 9);
      const scoreCol = hudPulseFrames > 0 ? accentCol : uiCol;

      targetGfx.rect(8, 9, W - 16, 9, 16);
      targetGfx.line(8, 18, W - 9, 18, uiCol);

      const scoreStr = "SCORE " + String(scoreVal).padStart(5, "0");
      targetGfx.text(scoreStr, 13, 12, 0, { scale: 1, align: "left" });
      targetGfx.text(scoreStr, 12, 11, scoreCol, { scale: 1, align: "left" });

      if (card?.collectible) {
        const colName = String(card.collectible).slice(0, 10).toUpperCase();
        targetGfx.text(colName, 161, 12, 0, { scale: 1, align: "center" });
        targetGfx.text(colName, 160, 11, accentCol, { scale: 1, align: "center" });
      }

      if (livesVal > 0) {
        if (livesVal <= 5) {
          for (let i = 0; i < livesVal; i++) {
            const hx = W - 12 - (i + 1) * 6 + 1;
            const hy = 11;
            for (let py = 0; py < 5; py++) {
              for (let px = 0; px < 5; px++) {
                if (HEART_5X5[py * 5 + px]) {
                  rawPset(hx + px + 1, hy + py + 1, 0);
                }
              }
            }
            for (let py = 0; py < 5; py++) {
              for (let px = 0; px < 5; px++) {
                if (HEART_5X5[py * 5 + px]) {
                  rawPset(hx + px, hy + py, accentCol);
                }
              }
            }
          }
        } else {
          const hearts = `♥x${livesVal}`;
          targetGfx.text(hearts, W - 11, 12, 0, { scale: 1, align: "right" });
          targetGfx.text(hearts, W - 12, 11, accentCol, { scale: 1, align: "right" });
        }
      }

      camX = prevCamX;
      camY = prevCamY;
      clipX0 = prevClipX0; clipY0 = prevClipY0; clipX1 = prevClipX1; clipY1 = prevClipY1;
      palMap = prevPalMap;
    },
    sprite(art, paletteMap = {}) {
      if (typeof art !== "string" && !Array.isArray(art)) {
        throw new Error("engine.sprite(art): art must be a string or string[]");
      }
      const rawLines = (Array.isArray(art) ? art : art.split(/\r?\n/))
        .map((l) => String(l ?? "").trim())
        .filter((l) => l.length > 0);
      if (rawLines.length === 0) {
        throw new Error("engine.sprite(art): sprite has no non-empty rows");
      }
      const h = rawLines.length;
      let w = 0;
      for (let i = 0; i < h; i++) {
        if (rawLines[i].length > w) w = rawLines[i].length;
      }
      if (w > 64 || h > 64) {
        throw new Error(`engine.sprite(art): sprite ${w}x${h} exceeds max 64x64`);
      }
      const pixels = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        const row = rawLines[y].padEnd(w, ".");
        for (let x = 0; x < w; x++) {
          const ch = row[x];
          if (ch === "." || ch === " ") {
            pixels[y * w + x] = 0;
          } else if (Object.prototype.hasOwnProperty.call(paletteMap, ch)) {
            pixels[y * w + x] = checkColor(paletteMap[ch]);
          } else if (Object.prototype.hasOwnProperty.call(DEFAULT_SPRITE_MAP, ch)) {
            pixels[y * w + x] = DEFAULT_SPRITE_MAP[ch];
          } else {
            pixels[y * w + x] = 0;
          }
        }
      }
      return Object.freeze({ w, h, _pixels: pixels });
    },
    save: {
      get(key) {
        const v = saveStore[key];
        return typeof v === "number" ? v : undefined;
      },
      set(key, v) {
        if (typeof v === "number" && Number.isFinite(v)) {
          saveStore[key] = v;
          onSave({ key: String(key), value: v });
        }
      },
    },
  };

  // Cross-bridge engine <-> gfx methods so LLM calls to either object never fail
  for (const k of [
    "cls", "pset", "pix", "pget", "clip", "rect", "rectfill", "rectb",
    "rrect", "rrectb", "circ", "circfill", "circb", "oval", "ovalb",
    "tri", "trifill", "trib", "line", "spr", "text", "print", "dither",
    "starfield", "bar", "camera", "cam", "pal", "resetPal", "vibePalette", "fx",
  ]) {
    if (!(k in engine)) {
      engine[k] = (...args) => gfx[k](...args);
    }
  }
  for (const k of [
    "hud", "shake", "sfx", "burst", "particles", "popup", "floatText",
    "flash", "hitstop", "freeze", "rng", "rngInt", "rngFloat", "rngChoice",
    "pick", "chance", "clamp", "lerp", "dist", "angle", "aabb", "circleHit",
    "btn", "btnp", "score", "lives", "loseLife", "gameOver", "sprite",
  ]) {
    if (!(k in gfx)) {
      gfx[k] = (...args) => engine[k](...args);
    }
  }

  function startNewRound() {
    frameCount = 0;
    scoreVal = 0;
    livesVal = 3;
    shakeFrames = 0;
    shakePx = 0;
    flashFrames = 0;
    hitstopFrames = 0;
    hudPulseFrames = 0;
    particles = [];
    popups = [];
    camX = 0;
    camY = 0;
    clipX0 = 0; clipY0 = 0; clipX1 = W; clipY1 = H;
    palMap = null;
    gameOverReason = "";
    rngFn = createMulberry32(currentSeed);
    fxRngFn = createMulberry32((currentSeed ^ 0xA5A5A5A5) >>> 0);
    mode = "playing";
    try {
      gameInstance = createFn(engine, card, gfx);
      if (!gameInstance || typeof gameInstance.update !== "function") {
        throw new Error("create(engine, card) must return { update(dt, input), draw(g) }");
      }
      onScore({ score: scoreVal, lives: livesVal });
    } catch (err) {
      violations.exceptions.push({ phase: "load", message: err?.message || String(err), stack: err?.stack });
      onError({ phase: "load", message: err?.message || String(err), stack: err?.stack });
    }
  }

  function drawTitleScreen() {
    const P = card?.engine_palette || { bg: 2, fg: 25, accent1: 9, accent2: 10, ui: 7 };
    camX = 0;
    camY = 0;
    clipX0 = 0; clipY0 = 0; clipX1 = W; clipY1 = H;
    palMap = null;
    gfx.dither(0, 0, W, H, P.bg, 17, 1);
    gfx.rectb(12, 12, W - 24, H - 24, P.accent1);
    gfx.rectb(14, 14, W - 28, H - 28, P.fg);
    const title = String(card?.title || "PLAYGLOW").slice(0, 24);
    gfx.text(title, W / 2 + 1, 57, 16, { scale: 2, align: "center" });
    gfx.text(title, W / 2, 56, P.accent2, { scale: 2, align: "center" });
    const tagline = String(card?.tagline || "").slice(0, 36);
    if (tagline) {
      gfx.text(tagline, W / 2, 86, P.ui, { scale: 1, align: "center" });
    }
    if (((frameCount / 25) | 0) % 2 === 0) {
      gfx.text("PRESS START", W / 2, 134, P.accent1, { scale: 2, align: "center" });
    }
    if (bestScore > 0) {
      gfx.text(`BEST ${bestScore}`, W / 2, 166, P.ui, { scale: 1, align: "center" });
    }
  }

  function drawGameOverOverlay() {
    const P = card?.engine_palette || { bg: 2, fg: 25, accent1: 9, accent2: 10, ui: 7 };
    camX = 0;
    camY = 0;
    clipX0 = 0; clipY0 = 0; clipX1 = W; clipY1 = H;
    palMap = null;
    gfx.rect(60, 44, 200, 112, 16);
    gfx.rectb(60, 44, 200, 112, P.accent1);
    gfx.rectb(62, 46, 196, 108, P.fg);
    gfx.text("GAME OVER", W / 2, 60, P.accent2, { scale: 2, align: "center" });
    if (gameOverReason) {
      gfx.text(gameOverReason.slice(0, 28), W / 2, 80, P.fg, { scale: 1, align: "center" });
    }
    gfx.text(`SCORE ${scoreVal}`, W / 2, 98, P.ui, { scale: 1, align: "center" });
    gfx.text(`BEST  ${bestScore}`, W / 2, 110, P.accent1, { scale: 1, align: "center" });
    if (((frameCount / 25) | 0) % 2 === 0) {
      gfx.text("PRESS START", W / 2, 132, P.accent2, { scale: 1, align: "center" });
    }
  }

  function drawPauseOverlay() {
    const P = card?.engine_palette || { bg: 2, fg: 25, accent1: 9, accent2: 10, ui: 7 };
    camX = 0;
    camY = 0;
    clipX0 = 0; clipY0 = 0; clipX1 = W; clipY1 = H;
    palMap = null;
    gfx.rect(110, 82, 100, 36, 16);
    gfx.rectb(110, 82, 100, 36, P.accent2);
    gfx.text("PAUSED", W / 2, 95, P.ui, { scale: 2, align: "center" });
  }

  function stepFx(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
      }
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const pop = popups[i];
      pop.y += pop.vy * dt;
      pop.vy *= 0.95;
      pop.life -= dt;
      if (pop.life <= 0) {
        popups.splice(i, 1);
      }
    }
  }

  function stepOneTick(rawInput = {}) {
    const cur = {
      left: Boolean(rawInput.left),
      right: Boolean(rawInput.right),
      up: Boolean(rawInput.up),
      down: Boolean(rawInput.down),
      a: Boolean(rawInput.a),
      b: Boolean(rawInput.b),
      start: Boolean(rawInput.start),
    };
    const pressed = {
      left: cur.left && !prevInput.left,
      right: cur.right && !prevInput.right,
      up: cur.up && !prevInput.up,
      down: cur.down && !prevInput.down,
      a: cur.a && !prevInput.a,
      b: cur.b && !prevInput.b,
      start: cur.start && !prevInput.start,
    };
    Object.assign(prevInput, cur);
    Object.assign(curInput, cur);
    Object.assign(curPressed, pressed);

    if (paused) {
      return;
    }

    frameCount++;
    if (shakeFrames > 0) shakeFrames--;
    if (flashFrames > 0) flashFrames--;
    if (hudPulseFrames > 0) hudPulseFrames--;

    if (mode === "title" || mode === "gameover") {
      if (pressed.start) {
        startNewRound();
      }
      return;
    }

    stepFx(1 / 60);

    if (hitstopFrames > 0) {
      hitstopFrames--;
      return;
    }

    if (mode === "playing" && gameInstance) {
      try {
        gameInstance.update(1 / 60, { ...cur, pressed });
        if (typeof gameInstance.score === "function") {
          const extScore = Number(gameInstance.score());
          if (Number.isFinite(extScore) && extScore > scoreVal) {
            engine.score(extScore - scoreVal);
          }
        }
      } catch (err) {
        violations.exceptions.push({ phase: "update", message: err?.message || String(err), stack: err?.stack });
        onError({ phase: "update", message: err?.message || String(err), stack: err?.stack });
      }
    }
  }

  function renderFrame() {
    camX = 0;
    camY = 0;
    clipX0 = 0;
    clipY0 = 0;
    clipX1 = W;
    clipY1 = H;
    palMap = null;
    fxDrawnThisFrame = false;

    if (mode === "title") {
      drawTitleScreen();
    } else if (gameInstance) {
      try {
        if (typeof gameInstance.draw === "function") {
          gameInstance.draw(gfx);
        }
        drawEngineFx();
      } catch (err) {
        violations.exceptions.push({ phase: "draw", message: err?.message || String(err), stack: err?.stack });
        onError({ phase: "draw", message: err?.message || String(err), stack: err?.stack });
      }
      if (mode === "gameover") {
        drawGameOverOverlay();
      }
    }
    if (paused) {
      drawPauseOverlay();
    }
  }

  function writeRgba(targetUint8Array) {
    let sx = 0;
    let sy = 0;
    if (shakeFrames > 0 && shakePx > 0) {
      sx = ((frameCount * 7) % (shakePx * 2 + 1)) - shakePx;
      sy = ((frameCount * 13) % (shakePx * 2 + 1)) - shakePx;
    }
    const bgIdx = checkColor(card?.engine_palette?.bg ?? 0);
    const bgR = PALETTE_RGBA[bgIdx * 4 + 0];
    const bgG = PALETTE_RGBA[bgIdx * 4 + 1];
    const bgB = PALETTE_RGBA[bgIdx * 4 + 2];

    for (let y = 0; y < H; y++) {
      const srcY = y - sy;
      const outRow = y * W * 4;
      if (srcY < 0 || srcY >= H) {
        for (let x = 0; x < W; x++) {
          const o = outRow + x * 4;
          targetUint8Array[o] = bgR;
          targetUint8Array[o + 1] = bgG;
          targetUint8Array[o + 2] = bgB;
          targetUint8Array[o + 3] = 255;
        }
        continue;
      }
      const srcRow = srcY * W;
      for (let x = 0; x < W; x++) {
        const srcX = x - sx;
        const o = outRow + x * 4;
        if (srcX < 0 || srcX >= W) {
          targetUint8Array[o] = bgR;
          targetUint8Array[o + 1] = bgG;
          targetUint8Array[o + 2] = bgB;
          targetUint8Array[o + 3] = 255;
        } else {
          const c = (fb[srcRow + srcX] & 31) * 4;
          targetUint8Array[o] = PALETTE_RGBA[c];
          targetUint8Array[o + 1] = PALETTE_RGBA[c + 1];
          targetUint8Array[o + 2] = PALETTE_RGBA[c + 2];
          targetUint8Array[o + 3] = 255;
        }
      }
    }
  }

  return {
    setCreateFn(fn) {
      if (typeof fn !== "function") {
        throw new Error("Game module does not export create(engine, card) function");
      }
      createFn = fn;
      mode = "title";
      frameCount = 0;
      renderFrame();
    },
    startRound() {
      startNewRound();
    },
    stepTick(input) {
      stepOneTick(input);
    },
    render() {
      renderFrame();
    },
    writeRgba,
    getFramebuffer() {
      return fb;
    },
    getState() {
      return {
        mode,
        paused,
        frame: frameCount,
        time: frameCount / 60,
        score: scoreVal,
        best: bestScore,
        lives: livesVal,
        gameOverReason,
        violations,
        stats,
      };
    },
    setPaused(p) {
      paused = Boolean(p);
    },
    reset() {
      mode = "title";
      paused = false;
      frameCount = 0;
      scoreVal = 0;
      livesVal = 3;
      gameOverReason = "";
      shakeFrames = 0;
      shakePx = 0;
      flashFrames = 0;
      hitstopFrames = 0;
      hudPulseFrames = 0;
      particles = [];
      popups = [];
      palMap = null;
      renderFrame();
    },
  };
}
// END INLINED RUNTIME

// Minimal pure-JS PNG encoder using node:zlib
function encodePng(width, height, rgbaData) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < width * 4; x++) {
      raw[rowStart + 1 + x] = rgbaData[y * width * 4 + x];
    }
  }
  const compressed = zlib.deflateSync(raw);

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function fbToRgba(fb) {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const c = (fb[i] & 31) * 4;
    rgba[i * 4 + 0] = PALETTE_RGBA[c + 0];
    rgba[i * 4 + 1] = PALETTE_RGBA[c + 1];
    rgba[i * 4 + 2] = PALETTE_RGBA[c + 2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function countDistinctColors(fb) {
  let mask = 0;
  for (let i = 0; i < fb.length; i++) {
    mask |= 1 << (fb[i] & 31);
  }
  let count = 0;
  while (mask) {
    mask &= mask - 1;
    count++;
  }
  return count;
}

function formatStackLocation(stack, defaultFile = "game.js") {
  if (!stack || typeof stack !== "string") return "";
  const lines = stack.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/([A-Za-z0-9_.-]+\.m?js|evalmachine\.<anonymous>):(\d+)(?::(\d+))?/);
    if (m) {
      const file = m[1] === "evalmachine.<anonymous>" ? defaultFile : m[1];
      if (file === "headless.mjs" || file === "prelude.js") continue;
      const col = m[3] ? `:${m[3]}` : "";
      return ` (${file}:${m[2]}${col})`;
    }
  }
  return "";
}

function loadModuleInVm(source, filename) {
  let transformed = source
    .replace(/export\s+default\s+function\s+(\w+)/g, "function $1")
    .replace(/export\s+default\s+function\s*\(/g, "function __default(")
    .replace(/export\s+function\s+(\w+)/g, "function $1")
    .replace(/export\s+const\s+/g, "const ")
    .replace(/export\s+let\s+/g, "let ")
    .replace(/export\s+var\s+/g, "var ")
    .replace(/export\s*\{[^}]*\}\s*;?/g, "");

  transformed += `\n;globalThis.__exports = { create: typeof create !== "undefined" ? create : typeof __default !== "undefined" ? __default : undefined, boot: typeof boot !== "undefined" ? boot : undefined };`;

  const logs = [];
  const sandbox = {
    Math: Object.create(Math),
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    WeakMap,
    WeakSet,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    Promise,
    Symbol,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    Uint8ClampedArray,
    ArrayBuffer,
    DataView,
    console: {
      log: (...a) => logs.push(a.map(String).join(" ")),
      warn: (...a) => logs.push(a.map(String).join(" ")),
      error: (...a) => logs.push(a.map(String).join(" ")),
    },
  };
  try {
    delete sandbox.Math.random;
  } catch {}

  const context = vm.createContext(sandbox);
  const prelude = `
    delete Math.random;
    for (const k of ["Date", "eval", "Function", "setTimeout", "setInterval", "fetch", "WebSocket", "XMLHttpRequest", "window", "document"]) {
      try { Object.defineProperty(globalThis, k, { value: undefined, writable: false, configurable: true }); } catch {}
    }
  `;
  vm.runInContext(prelude, context, { filename: "prelude.js", timeout: 500 });
  vm.runInContext(transformed, context, { filename, timeout: 1000 });
  return { exports: sandbox.__exports || {}, logs };
}

function makeBootAdapter(bootFn) {
  return function createFromBoot(engine, card, gfx) {
    const rng = {
      next: () => engine.rng(),
      int: (lo, hi) => engine.rngInt(lo, hi),
      float: (lo = 0, hi = 1) => lo + engine.rng() * (hi - lo),
      pick: (arr) => arr[engine.rngInt(0, arr.length - 1)],
      chance: (p = 0.5) => engine.rng() < p,
    };
    const sfx = {
      blip: () => engine.sfx("select"),
      jump: () => engine.sfx("jump"),
      hit: () => engine.sfx("hit"),
      coin: () => engine.sfx("coin"),
      boom: () => engine.sfx("explode"),
      win: () => engine.sfx("win"),
      lose: () => engine.sfx("lose"),
      shoot: () => engine.sfx("shoot"),
      powerup: () => engine.sfx("powerup"),
    };
    const clock = {
      get tick() { return engine.frame; },
      get ms() { return engine.time * 1000; },
      get dt() { return 16.6667; },
    };
    const inst = bootFn({ gfx, sfx, rng, clock, card });
    return {
      update(dt, input) {
        inst.tick(input, dt * 1000);
      },
      draw() {},
      score: () => (typeof inst.score === "function" ? inst.score() : 0),
    };
  };
}

function defaultCardForFile(filePath) {
  const base = path.basename(filePath, ".js").toLowerCase();
  const genres = ["runner", "shooter", "maze", "breakout", "platformer", "dodger"];
  const genre = genres.includes(base) ? base : "runner";
  return {
    title: "PLAYGLOW TEST",
    tagline: "arcade test cart",
    player_name: "player 1",
    genre,
    vibe: "sunset",
    hero: { description: "a small orange fox in a blue scarf", short: "fox" },
    enemies: [{ description: "rolling boulders", behaviour: "roll fast" }],
    collectible: "stars",
    mechanics: ["double jump", "B: scarf dash"],
    win_lose: "survive and collect stars",
    art: { scene: "sunset hills", hero_pose: "leaping" },
    safety: { ok: true },
    palette: { bg: "#7E2553", fg: "#FF6C24", accent1: "#FFA300", accent2: "#FFEC27", ui: "#FFF1E8" },
    engine_palette: { bg: 2, fg: 25, accent1: 9, accent2: 10, ui: 7 },
    id: "c_test",
    seed: 7,
  };
}

function parseCli(argv) {
  const positional = [];
  let cardPath = null;
  let policy = null;
  let seconds = 60;
  let seed = 7;
  let outDir = null;
  let requireScore = true;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--card" && argv[i + 1]) {
      cardPath = argv[++i];
    } else if (a === "--policy" && argv[i + 1]) {
      policy = argv[++i];
    } else if (a === "--seconds" && argv[i + 1]) {
      seconds = Number(argv[++i]) || 60;
    } else if (a === "--seed" && argv[i + 1]) {
      seed = Number(argv[++i]) || 7;
    } else if (a === "--out" && argv[i + 1]) {
      outDir = argv[++i];
    } else if (a === "--require-score") {
      requireScore = true;
    } else if (!a.startsWith("--")) {
      positional.push(a);
    }
  }

  const cartPath = positional[0];
  if (!cardPath && positional[1]) {
    cardPath = positional[1];
  }

  return { cartPath, cardPath, policy, seconds, seed, outDir, requireScore };
}

function runQuickVerification(cartPath, card, seed, source, lineCount, createFn) {
  const t0 = performance.now();
  const baseName = path.basename(cartPath);
  const runner = createCartRunner({ card, seed });
  runner.setCreateFn(createFn);

  // Step 2 ticks: first { start: true } to transition from title -> playing,
  // then {} so at least one playing update+draw runs before measuring initColors
  runner.stepTick({ start: true });
  runner.stepTick({});
  runner.render();

  const initSt = runner.getState();
  if (initSt.violations.exceptions.length > 0) {
    const ex = initSt.violations.exceptions[0];
    const loc = formatStackLocation(ex.stack, baseName);
    return { ok: false, reason: `Runtime exception in ${ex.phase}${loc}: ${ex.message}` };
  }

  const initFb = new Uint8Array(runner.getFramebuffer());
  const initColors = countDistinctColors(initFb);
  if (initColors < 2) {
    return {
      ok: false,
      reason: `Initial framebuffer after start is blank (${initColors} distinct colour(s), expected >= 2)`,
    };
  }

  let peakColors = initColors;
  let playfieldChanged = false;
  let maxScore = initSt.score;

  // 60 ticks gentle/idle + 300 ticks active scripted play = 360 ticks
  for (let tick = 0; tick < 360; tick++) {
    let input;
    if (tick < 60) {
      // Gentle start: tap right/a/b so breakout launches and maze/runner begin moving
      input = {
        left: false,
        right: tick >= 10 && tick < 45,
        up: tick === 15 || tick === 35,
        down: false,
        a: tick === 5 || tick === 25,
        b: tick === 12 || tick === 32,
        start: false,
      };
    } else {
      const phase = tick - 60;
      const cycle = phase % 80;
      input = {
        left: cycle >= 50 && cycle < 75,
        right: cycle < 45,
        up: phase % 18 < 6,
        down: phase % 40 >= 30 && phase % 40 < 36,
        a: phase % 10 < 3,
        b: phase % 20 >= 10 && phase % 20 < 13,
        start: false,
      };
    }

    runner.stepTick(input);
    runner.render();
    const st = runner.getState();
    if (st.score > maxScore) maxScore = st.score;

    const curFb = runner.getFramebuffer();
    if ((tick & 7) === 0 || tick === 359) {
      const cCount = countDistinctColors(curFb);
      if (cCount > peakColors) peakColors = cCount;
    }
    if (!playfieldChanged && ((tick & 3) === 0 || tick === 359)) {
      for (let i = 20 * W; i < W * H; i++) {
        if (curFb[i] !== initFb[i]) {
          playfieldChanged = true;
          break;
        }
      }
    }

    if (st.violations.exceptions.length > 0) {
      const ex = st.violations.exceptions[0];
      const loc = formatStackLocation(ex.stack, baseName);
      return { ok: false, reason: `Runtime exception in ${ex.phase}${loc}: ${ex.message}` };
    }
    if (performance.now() - t0 > 2000) {
      return { ok: false, reason: "Exceeded 2000ms wall-clock budget during 360-tick verification" };
    }
  }

  const finalState = runner.getState();
  const finalScore = Math.max(maxScore, finalState.score);
  const finalColors = Math.max(peakColors, countDistinctColors(runner.getFramebuffer()));

  if (finalState.violations.invalidPaletteIndex) {
    return { ok: false, reason: "Invalid palette index used (must be 0..31)" };
  }
  if (finalColors < 4) {
    return {
      ok: false,
      reason: `Insufficient visual palette depth (${finalColors} distinct colour(s), expected >= 4)`,
    };
  }
  if (finalState.stats && finalState.stats.sprCalls < 1 && finalState.stats.drawCalls < 6) {
    return {
      ok: false,
      reason: "Playfield has neither sprite draws (g.spr) nor entity geometry draws",
    };
  }
  if (!playfieldChanged) {
    return {
      ok: false,
      reason: "No playfield pixel motion detected outside the HUD (y >= 20)",
    };
  }
  if (finalState.mode === "gameover") {
    return {
      ok: false,
      reason: "Game entered gameover within the first 360 frames (6s) of play",
    };
  }
  if (typeof finalScore !== "number" || Number.isNaN(finalScore) || finalScore <= 0) {
    return {
      ok: false,
      reason: `Expected score > 0 after 360 ticks, got ${finalScore}`,
    };
  }

  return {
    ok: true,
    ticks: 360,
    colors: finalColors,
    score: finalScore,
    lines: lineCount,
    elapsedMs: Math.round(performance.now() - t0),
  };
}

function runPolicyPlaytest(cartPath, card, policy, seconds, seed, outDir, lineCount, createFn) {
  const runner = createCartRunner({ card, seed });
  runner.setCreateFn(createFn);
  const inputRng = createMulberry32((seed ^ 0x9e3779b9) >>> 0);

  // Press START at t = 0
  runner.stepTick({ start: true });
  runner.render();

  const totalTicks = Math.max(60, Math.round(seconds * 60));
  const tickTimes = [];
  const scoreCurve = [];
  let fbAt1s = null;
  let fbAt5s = null;
  const sheetFrames = {};
  let gameOverTick = null;
  let maxScore = 0;

  let curRandomInput = { left: false, right: true, up: false, down: false, a: true, b: false, start: false };

  for (let t = 1; t <= totalTicks; t++) {
    let input;
    if (policy === "idle") {
      input = { left: false, right: false, up: false, down: false, a: false, b: false, start: false };
    } else if (policy === "hold-right") {
      input = { left: false, right: true, up: false, down: false, a: t % 12 < 6, b: false, start: false };
    } else {
      if (t % 10 === 1) {
        const r = inputRng();
        curRandomInput = {
          left: r < 0.28,
          right: r >= 0.28 && r < 0.78,
          up: inputRng() < 0.35,
          down: inputRng() < 0.2,
          a: inputRng() < 0.45,
          b: inputRng() < 0.2,
          start: false,
        };
      }
      input = curRandomInput;
    }

    const t0 = performance.now();
    runner.stepTick(input);
    runner.render();
    tickTimes.push(performance.now() - t0);

    const st = runner.getState();
    if (st.score > maxScore) maxScore = st.score;
    if (t % 60 === 0) scoreCurve.push(st.score);

    if (st.mode === "gameover" && gameOverTick === null) {
      gameOverTick = t;
    }

    if (t === 60) fbAt1s = new Uint8Array(runner.getFramebuffer());
    if (t === 300) fbAt5s = new Uint8Array(runner.getFramebuffer());
    if (t === 60 || t === 300 || t === 900 || t === 1800) {
      sheetFrames[t / 60] = new Uint8Array(runner.getFramebuffer());
    }
  }

  const st = runner.getState();
  const sortedTimes = [...tickTimes].sort((a, b) => a - b);
  const p95TickMs = sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0;

  let pixelsChanged1to5 = false;
  if (fbAt1s && fbAt5s) {
    for (let i = 20 * W; i < fbAt1s.length; i++) {
      if (fbAt1s[i] !== fbAt5s[i]) {
        pixelsChanged1to5 = true;
        break;
      }
    }
  } else {
    pixelsChanged1to5 = countDistinctColors(runner.getFramebuffer()) >= 2;
  }

  const survived5s = gameOverTick === null || gameOverTick >= 300;
  const reachedGameOver = gameOverTick !== null && gameOverTick <= 120 * 60;
  const finalColors = countDistinctColors(runner.getFramebuffer());

  const checks = {
    lineCountOk: lineCount <= 300,
    noExceptions: st.violations.exceptions.length === 0,
    validPaletteOnly: !st.violations.invalidPaletteIndex,
    pixelsChange: pixelsChanged1to5,
    p95Under4ms: p95TickMs < 4.0,
    scoreChanges: policy === "random" ? maxScore > 0 : true,
    survives5s: policy === "idle" || policy === "hold-right" ? survived5s : true,
    gameOverWithin120s: policy === "idle" ? reachedGameOver : true,
  };

  const pass = Object.values(checks).every(Boolean);
  const report = {
    pass,
    policy,
    seconds,
    seed,
    lines: lineCount,
    score: Math.max(maxScore, st.score),
    colors: finalColors,
    gameOverAtSec: gameOverTick ? +(gameOverTick / 60).toFixed(2) : null,
    p95TickMs: +p95TickMs.toFixed(3),
    checks,
    exceptions: st.violations.exceptions,
    scoreCurve,
  };

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
    const thumbFb = fbAt5s || runner.getFramebuffer();
    fs.writeFileSync(path.join(outDir, "thumb.png"), encodePng(W, H, fbToRgba(thumbFb)));

    // 2x2 contact sheet (640x400)
    const sheetRgba = new Uint8Array(W * 2 * H * 2 * 4);
    const slots = [
      { fb: sheetFrames[1] || thumbFb, ox: 0, oy: 0 },
      { fb: sheetFrames[5] || thumbFb, ox: W, oy: 0 },
      { fb: sheetFrames[15] || thumbFb, ox: 0, oy: H },
      { fb: sheetFrames[30] || thumbFb, ox: W, oy: H },
    ];
    for (const sl of slots) {
      const rgba = fbToRgba(sl.fb);
      for (let y = 0; y < H; y++) {
        const dstRow = ((sl.oy + y) * (W * 2) + sl.ox) * 4;
        const srcRow = y * W * 4;
        sheetRgba.set(rgba.subarray(srcRow, srcRow + W * 4), dstRow);
      }
    }
    fs.writeFileSync(path.join(outDir, "sheet.png"), encodePng(W * 2, H * 2, sheetRgba));
  }

  return report;
}

function main() {
  const { cartPath, cardPath, policy, seconds, seed, outDir } = parseCli(process.argv.slice(2));
  if (!cartPath) {
    console.error("Usage: node engine/headless.mjs <cart-path> [card-json-path]");
    process.exit(1);
  }

  const resolvedCart = path.resolve(cartPath);
  if (!fs.existsSync(resolvedCart)) {
    console.error(`FAIL: Cart file not found: ${resolvedCart}`);
    process.exit(1);
  }

  const source = fs.readFileSync(resolvedCart, "utf8");
  const lineCount = source.replace(/\r?\n$/, "").split(/\r?\n/).length;
  if (lineCount > 300) {
    console.error(`FAIL: Cart has ${lineCount} lines, exceeding the 300-line maximum`);
    process.exit(1);
  }

  const scan = scanSource(source);
  if (!scan.ok) {
    console.error(`FAIL: Static source scan failed: ${scan.issues.join("; ")}`);
    process.exit(1);
  }

  let card = defaultCardForFile(resolvedCart);
  const resolvedCardPath =
    cardPath && fs.existsSync(path.resolve(cardPath))
      ? path.resolve(cardPath)
      : !cardPath && path.basename(resolvedCart) === "game.js" && fs.existsSync("/workspace/card.json")
        ? "/workspace/card.json"
        : null;
  if (resolvedCardPath) {
    try {
      const loaded = JSON.parse(fs.readFileSync(resolvedCardPath, "utf8"));
      card = { ...card, ...loaded, engine_palette: loaded.engine_palette || card.engine_palette };
    } catch (err) {
      console.error(`FAIL: Invalid card JSON at ${resolvedCardPath}: ${err.message}`);
      process.exit(1);
    }
  }

  const baseName = path.basename(resolvedCart);
  let mod;
  try {
    mod = loadModuleInVm(source, baseName);
  } catch (err) {
    const loc = formatStackLocation(err?.stack, baseName);
    console.error(`FAIL: Syntax or load error${loc}: ${err?.message || String(err)}`);
    process.exit(1);
  }

  let createFn = mod.exports.create;
  if (typeof createFn !== "function" && typeof mod.exports.boot === "function") {
    createFn = makeBootAdapter(mod.exports.boot);
  }
  if (typeof createFn !== "function") {
    console.error("FAIL: Cart must export function create(engine, card)");
    process.exit(1);
  }

  if (policy) {
    const report = runPolicyPlaytest(
      resolvedCart,
      card,
      policy,
      seconds,
      seed,
      outDir,
      lineCount,
      createFn
    );
    console.log(JSON.stringify(report));
    if (!report.pass) {
      console.error(`FAIL: Policy '${policy}' failed checks: ${JSON.stringify(report.checks)}`);
      process.exit(1);
    }
    console.log(
      `PASS: ${Math.round(seconds * 60)} ticks (${policy}), ${report.colors} colours, final score ${report.score}, ${lineCount} lines`
    );
    process.exit(0);
  }

  const res = runQuickVerification(
    resolvedCart,
    card,
    card.seed ?? seed,
    source,
    lineCount,
    createFn
  );
  if (!res.ok) {
    console.error(`FAIL: ${res.reason}`);
    process.exit(1);
  }

  console.log(
    `PASS: ${res.ticks} ticks, ${res.colors} colours, final score ${res.score}, ${res.lines} lines`
  );
  process.exit(0);
}

main();
