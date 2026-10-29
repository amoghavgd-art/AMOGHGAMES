import * as THREE from "three";
import { VIBES, type VibeName } from "../card/vibes";
import type { GenreName } from "../card/presets";
import { stripTrailingStopwords, truncateStr } from "../card/designCard";
import {
  C,
  ditherVerticalGradient,
  ditherDisc,
  drawPixelText,
  makeGenreSpriteCanvas,
  marqueeArt,
  sideArt,
  splitSideTitleLines,
  type MockMarqueeOpts,
  type MockSideOpts,
} from "./skinCompositor";

export type BuildStageName =
  | "designing"
  | "coding"
  | "playtesting"
  | "testing"
  | "finishing"
  | "painting"
  | "ready";

export type MockScreenMode =
  | "create"
  | "build"
  | "play"
  | "switch"
  | "attract";

export interface AttractPreviewState {
  step: number;
  qStep?: "name" | "genre" | "hero" | "vibe" | "ready";
  name: string;
  genre: GenreName;
  hero: string;
  vibe: VibeName;
  vibeSelected?: boolean;
  mode?: MockScreenMode;
  mockGameKey?: MockGameKey;
  buildMode?: boolean;
  buildStage?: BuildStageName;
  buildPct?: number;
  buildTitle?: string;
  attractArt?: HTMLImageElement | HTMLCanvasElement | null;
  heroOffsetX?: number;
  heroJumpY?: number;
}

const SW = 160;
const SH = 100;

function mk(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function spriteFromRows(
  rows: string[],
  map: Record<string, string>
): HTMLCanvasElement {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = mk(w, h);
  const x = c.getContext("2d")!;
  rows.forEach((r, j) => {
    [...r].forEach((ch, i) => {
      const col = map[ch];
      if (col) {
        x.fillStyle = col;
        x.fillRect(i, j, 1, 1);
      }
    });
  });
  return c;
}

// 3x5 bitmap font matching mocks/playglow/index.html lines 197–216
const F35: Record<string, string> = {
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
  A: "010101111101101",
  B: "110101110101110",
  C: "011100100100011",
  D: "110101101101110",
  E: "111100110100111",
  F: "111100110100100",
  G: "011100101101011",
  H: "101101111101101",
  I: "111010010010111",
  J: "001001001101010",
  K: "101101110101101",
  L: "100100100100111",
  M: "101111111101101",
  N: "110101101101101",
  O: "010101101101010",
  P: "110101110100100",
  Q: "010101101110011",
  R: "110101110101101",
  S: "011100010001110",
  T: "111010010010010",
  U: "101101101101111",
  V: "101101101101010",
  W: "101101111111101",
  X: "101101010101101",
  Y: "101101010010010",
  Z: "111001010100111",
  " ": "000000000000000",
  ":": "000010000010000",
  "-": "000000111000000",
  "!": "010010010000010",
  ".": "000000000000010",
  ",": "000000000010100",
  "*": "000101111111010",
  "/": "001001010100100",
  ">": "100010001010100",
  "_": "000000000000111",
  "%": "101001010100101",
  "?": "111001011000010",
  "'": "010010000000000",
  "=": "000111000111000",
  "+": "000010111010000",
};

export const tinyW = (s: string): number => s.length * 4 - 1;

export function tiny(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  col: string,
  sh?: string
): void {
  if (sh) tiny(ctx, str, x + 1, y + 1, sh);
  ctx.fillStyle = col;
  [...str.toUpperCase()].forEach((ch, n) => {
    const g = F35[ch] || F35[" "];
    for (let i = 0; i < 15; i++) {
      if (g[i] === "1") {
        ctx.fillRect(x + n * 4 + (i % 3), y + Math.floor(i / 3), 1, 1);
      }
    }
  });
}

export function tiny2(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  col: string,
  sh?: string
): void {
  const w = Math.max(1, tinyW(str) + 2);
  const c = mk(w, 7);
  const cx = c.getContext("2d")!;
  tiny(cx, str, 0, 0, col, sh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, x, y, c.width * 2, c.height * 2);
}

// ---------------- Sprites from mocks/playglow/index.html lines 218–309 ----------------
const PIP_ROWS = [
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
];
const PIP_MAP = {
  o: C.dplum,
  r: C.orange,
  R: C.dorange,
  y: C.yellow,
  Y: C.lyellow,
  k: C.dbrown,
  w: C.cream,
  p: C.pink,
};
const pipCan = spriteFromRows(PIP_ROWS, PIP_MAP);
const pipBlink = spriteFromRows(
  PIP_ROWS.map((r, j) => (j === 6 || j === 7 ? r.replace(/wk|kk/g, "yy") : r)),
  PIP_MAP
);

const FOX_TOP = [
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
];
const FOX_A = [...FOX_TOP, "....orro..orro..", "....ooo...ooo..."];
const FOX_B = [...FOX_TOP, "...orro....orro.", "...ooo.....ooo.."];
const FOX_MAP = {
  o: C.dbrown,
  r: C.dorange,
  w: C.cream,
  k: C.black,
  s: C.blue,
};
export const foxA = spriteFromRows(FOX_A, FOX_MAP);
export const foxB = spriteFromRows(FOX_B, FOX_MAP);

export const SHIP = spriteFromRows(
  [
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
  { o: C.dnavy, c: C.blue, w: C.lgray, r: C.red, y: C.orange }
);

export const MOTH = spriteFromRows(
  [
    ".oo.....oo.",
    "owwo.k.owwo",
    "owwwokowwwo",
    "owpwokowpwo",
    ".owwokowwo.",
    "..oo.o.oo..",
  ],
  { o: C.dnavy, w: C.cream, p: C.pink, k: C.lav }
);

export const SLIME = spriteFromRows(
  [
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
  { o: C.navy, g: C.ylime, h: C.lyellow, k: C.dnavy, m: C.green }
);

export const CUPCAKE = spriteFromRows(
  [
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
  { o: C.dplum, p: C.pink, w: C.cream, b: C.brown, t: C.peach, r: C.red }
);

const makeCoin = (f: number): HTMLCanvasElement => {
  const w = [6, 4, 2, 4][f % 4];
  const c = mk(6, 7);
  const x = c.getContext("2d")!;
  const l = (6 - w) / 2;
  x.fillStyle = C.dorange;
  x.fillRect(l, 1, w, 5);
  x.fillRect(l + (w > 2 ? 1 : 0), 0, Math.max(1, w - 2), 7);
  x.fillStyle = C.yellow;
  x.fillRect(l + (w > 2 ? 1 : 0), 1, Math.max(1, w - 2), 5);
  if (w > 2) {
    x.fillStyle = C.cream;
    x.fillRect(l + 1, 1, 1, 2);
  }
  return c;
};
const coins = [0, 1, 2, 3].map(makeCoin);
const STAR = spriteFromRows(
  ["..y..", ".yYy.", "yYwYy", ".yYy.", "..y.."],
  { y: C.orange, Y: C.yellow, w: C.cream }
);

// ---------------- Game Screens (160x100) from mocks/playglow/index.html lines 310–453 ----------------
function hillStrip(
  w: number,
  h: number,
  base: number,
  amp: number,
  col: string,
  top: string | null,
  seed: number
): HTMLCanvasElement {
  const c = mk(w, h);
  const x = c.getContext("2d")!;
  for (let i = 0; i < w; i++) {
    const a = (i / w) * Math.PI * 2;
    const y = Math.round(
      base + Math.sin(a * 2 + seed) * amp + Math.sin(a * 5 + seed * 2) * amp * 0.4
    );
    x.fillStyle = col;
    x.fillRect(i, y, 1, h - y);
    if (top) {
      x.fillStyle = top;
      x.fillRect(i, y, 1, 1);
    }
  }
  return c;
}

const runnerSky = (() => {
  const c = mk(SW, SH);
  const x = c.getContext("2d")!;
  ditherVerticalGradient(x, 0, 0, SW, 72, [
    C.dnavy,
    C.navy,
    C.dmauve,
    C.plum,
    C.crimson,
    C.dorange,
    C.orange,
    C.yellow,
  ]);
  ditherDisc(x, 112, 58, 20, C.yellow, C.dorange, 4);
  x.fillStyle = C.cream;
  [
    [14, 8],
    [40, 14],
    [70, 5],
    [96, 11],
    [150, 7],
    [130, 18],
    [24, 24],
  ].forEach(([a, b]) => x.fillRect(a, b, 1, 1));
  return c;
})();

const farHills = hillStrip(320, 100, 56, 6, C.plum, C.crimson, 1);
const nearHills = hillStrip(320, 100, 68, 5, C.dplum, C.dmauve, 3);

const groundTile = (() => {
  const c = mk(16, 22);
  const x = c.getContext("2d")!;
  x.fillStyle = C.rust;
  x.fillRect(0, 0, 16, 22);
  x.fillStyle = C.mgreen;
  x.fillRect(0, 0, 16, 3);
  x.fillStyle = C.ylime;
  x.fillRect(0, 0, 16, 1);
  x.fillRect(3, 1, 1, 1);
  x.fillRect(11, 1, 2, 1);
  x.fillStyle = C.green;
  x.fillRect(0, 3, 16, 1);
  x.fillRect(5, 4, 1, 1);
  x.fillRect(13, 4, 1, 1);
  x.fillStyle = C.brown;
  x.fillRect(2, 8, 3, 2);
  x.fillRect(10, 13, 4, 2);
  x.fillRect(5, 18, 2, 1);
  x.fillStyle = C.dbrown;
  x.fillRect(0, 21, 16, 1);
  x.fillRect(7, 10, 1, 1);
  x.fillRect(12, 17, 1, 1);
  return c;
})();

const crate = (() => {
  const c = mk(10, 10);
  const x = c.getContext("2d")!;
  x.fillStyle = C.dbrown;
  x.fillRect(0, 0, 10, 10);
  x.fillStyle = C.brown;
  x.fillRect(1, 1, 8, 8);
  x.fillStyle = C.peach;
  x.fillRect(1, 1, 8, 1);
  x.fillStyle = C.rust;
  for (let i = 1; i < 9; i++) {
    x.fillRect(i, i, 1, 1);
    x.fillRect(9 - i, i, 1, 1);
  }
  return c;
})();

export function drawRunner(
  x: CanvasRenderingContext2D,
  t: number,
  opts: { debug?: boolean } = {}
): number {
  const speed = 46;
  const scroll = t * speed;
  x.imageSmoothingEnabled = false;
  x.drawImage(runnerSky, 0, 0);
  const fh = Math.floor(scroll * 0.15) % 320;
  const nh = Math.floor(scroll * 0.45) % 320;
  x.drawImage(farHills, -fh, 0);
  x.drawImage(farHills, 320 - fh, 0);
  x.drawImage(nearHills, -nh, 0);
  x.drawImage(nearHills, 320 - nh, 0);
  // falling stars
  for (let i = 0; i < 4; i++) {
    const p = (t * 0.35 + i * 0.27) % 1;
    const sx = ((i * 53 + 20 - p * 40 + 400) % 170) - 5;
    const sy = -6 + p * 60;
    x.fillStyle = C.lyellow;
    x.fillRect(Math.round(sx + 3), Math.round(sy - 3), 1, 1);
    x.fillRect(Math.round(sx + 5), Math.round(sy - 5), 1, 1);
    x.drawImage(STAR, Math.round(sx - 2), Math.round(sy - 2));
  }
  const gy = 78;
  const gs = Math.floor(scroll) % 16;
  for (let i = -1; i < 12; i++) {
    x.drawImage(groundTile, i * 16 - gs, gy);
  }
  // obstacles + coins
  const per = 96;
  const foxX = 34;
  for (let k = Math.floor(scroll / per) - 1; k < Math.floor(scroll / per) + 3; k++) {
    const ox = Math.round(k * per + 70 - scroll + 60);
    x.drawImage(crate, ox, gy - 10);
    if (k % 2 === 0) x.drawImage(crate, ox, gy - 20);
    for (let j = 0; j < 3; j++) {
      x.drawImage(
        coins[(Math.floor(t * 8) + j) % 4],
        ox - 14 + j * 14,
        gy - (k % 2 === 0 ? 38 : 30) - (j === 1 ? 4 : 0)
      );
    }
  }
  // fox: jump when crate approaches
  const d = (((scroll + foxX - 130) % per) + per) % per;
  const u = d >= 72 ? (d - 72) / 44 : (d + 24) / 44;
  const air = u < 1 ? Math.sin(Math.PI * u) * 30 : 0;
  const fy = Math.round(gy - 13 - air);
  if (air < 1) {
    x.fillStyle = C.peach;
    const p = Math.floor(t * 12) % 3;
    x.fillRect(foxX - 2 - p, gy - 2, 1, 1);
    x.fillRect(foxX - 5 - p, gy - 3, 1, 1);
  }
  x.drawImage(air > 0 ? foxB : Math.floor(t * 10) % 2 ? foxA : foxB, foxX, fy);
  if (opts.debug) {
    x.strokeStyle = C.lime;
    x.lineWidth = 1;
    x.strokeRect(foxX + 0.5, fy + 0.5, 15, 12);
    tiny(x, "PLAYTEST 27", 4, 92, C.lime, C.black);
  }
  // HUD
  const score = Math.floor(scroll * 3) % 100000;
  tiny(x, "SCORE " + String(score).padStart(6, "0"), 4, 4, C.cream, C.dnavy);
  x.drawImage(coins[0], 104, 3);
  tiny(x, "X" + String(12 + (Math.floor(t) % 40)).padStart(2, "0"), 112, 4, C.yellow, C.dnavy);
  x.fillStyle = C.red;
  for (let i = 0; i < 3; i++) tiny(x, "*", 140 + i * 6, 4, C.red, C.dnavy);
  return score;
}

export function drawShooter(
  x: CanvasRenderingContext2D,
  t: number,
  opts: { debug?: boolean } = {}
): void {
  x.imageSmoothingEnabled = false;
  x.fillStyle = C.black;
  x.fillRect(0, 0, SW, SH);
  for (let i = 0; i < 40; i++) {
    const sy = (i * 37 + t * (10 + (i % 3) * 14)) % SH;
    x.fillStyle = i % 3 ? C.dblue : C.lgray;
    x.fillRect((i * 71) % SW, Math.floor(sy), 1, i % 5 ? 1 : 2);
  }
  ditherDisc(x, 130, 22, 12, C.pink, C.plum);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 7; c++) {
      const ex = 24 + c * 16 + Math.round(Math.sin(t * 2 + r) * 6);
      const ey = 12 + r * 12;
      x.fillStyle = [C.red, C.pink, C.orange][r];
      x.fillRect(ex, ey, 8, 5);
      x.fillStyle = C.black;
      x.fillRect(ex + 2, ey + 2, 1, 1);
      x.fillRect(ex + 5, ey + 2, 1, 1);
      x.fillStyle = [C.red, C.pink, C.orange][r];
      x.fillRect(ex + (Math.floor(t * 4) % 2 ? 0 : 6), ey + 5, 2, 2);
    }
  }
  const sx = Math.round(74 + Math.sin(t * 1.3) * 50);
  for (let b = 0; b < 4; b++) {
    const by = 84 - ((t * 90 + b * 22) % 80);
    x.fillStyle = C.yellow;
    x.fillRect(sx + 5, Math.floor(by), 1, 4);
  }
  x.drawImage(SHIP, sx, 84);
  if (opts.debug) {
    x.strokeStyle = C.lime;
    x.lineWidth = 1;
    x.strokeRect(sx + 0.5, 84.5, 11, 9);
    tiny(x, "PLAYTEST 27", 4, 92, C.lime, C.black);
  }
  tiny(x, "1UP 008870", 4, 3, C.cream);
  tiny(x, "WAVE 3", 132, 3, C.blue);
}

const mazeGrid = [
  "###################################",
  "#.......#.........#.........#.....#",
  "#.###.#.#.#######.#.#######.#.###.#",
  "#.#...#...#.....#...#.....#...#...#",
  "#.#.#####.#.###.#####.###.#####.#.#",
  "#...#.....#.#.......#.#.......#.#.#",
  "###.#.#####.#.#####.#.#.#####.#.#.#",
  "#...#.......#.#...#...#.#...#...#.#",
  "#.#########.#.#.#.#####.#.#.#####.#",
  "#.........#...#.#.......#.#.......#",
  "#.#######.#####.#########.#######.#",
  "#.................................#",
  "###################################",
];

export function drawMaze(
  x: CanvasRenderingContext2D,
  t: number,
  opts: { debug?: boolean } = {}
): void {
  x.imageSmoothingEnabled = false;
  x.fillStyle = C.dnavy;
  x.fillRect(0, 0, SW, SH);
  const cs = 4;
  const ox = 10;
  const oy = 18;
  mazeGrid.forEach((r, j) => {
    [...r].forEach((ch, i) => {
      if (ch === "#") {
        x.fillStyle = C.blue;
        x.fillRect(ox + i * cs, oy + j * 6, cs, 6);
        x.fillStyle = C.dblue;
        x.fillRect(ox + i * cs, oy + j * 6 + 5, cs, 1);
      } else if ((i + j) % 2) {
        x.fillStyle = C.yellow;
        x.fillRect(ox + i * cs + 1, oy + j * 6 + 2, 1, 1);
      }
    });
  });
  const p = (t * 0.08) % 1;
  const mx = ox + 4 + p * 128;
  const my = oy + 66;
  const mDrawY = Math.round(my - 2 + Math.sin(t * 10) * 1);
  x.drawImage(MOTH, Math.round(mx), mDrawY);
  x.fillStyle = C.lime;
  x.fillRect(Math.round(ox + 136 - p * 60), oy + 7, 5, 5);
  if (opts.debug) {
    x.strokeStyle = C.lime;
    x.lineWidth = 1;
    x.strokeRect(Math.round(mx) + 0.5, mDrawY + 0.5, 11, 6);
    tiny(x, "PLAYTEST 27", 4, 92, C.lime, C.black);
  }
  tiny(x, "MOTH MAZE", 4, 4, C.cream);
  tiny(x, "0340", 140, 4, C.yellow);
}

export function drawBreakout(
  x: CanvasRenderingContext2D,
  t: number,
  opts: { debug?: boolean } = {}
): void {
  x.imageSmoothingEnabled = false;
  ditherVerticalGradient(x, 0, 0, SW, SH, [C.dplum, C.dplum, C.mauve]);
  const cols = [C.pink, C.lpeach, C.peach, C.lyellow, C.salmon];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 10; c++) {
      if ((r * 7 + c * 3) % 9 === 0) continue;
      x.fillStyle = cols[r];
      x.fillRect(6 + c * 15, 14 + r * 7, 14, 6);
      x.fillStyle = C.cream;
      x.fillRect(6 + c * 15, 14 + r * 7, 14, 1);
    }
  }
  const bx = 80 + Math.sin(t * 2.1) * 66;
  const by = 60 + Math.abs(Math.sin(t * 3.0)) * -20 + 22;
  x.drawImage(CUPCAKE, Math.round(bx - 6), Math.round(by - 6));
  x.fillStyle = C.cream;
  x.fillRect(Math.round(bx - 14), 92, 28, 3);
  x.fillStyle = C.pink;
  x.fillRect(Math.round(bx - 14), 95, 28, 1);
  if (opts.debug) {
    x.strokeStyle = C.lime;
    x.lineWidth = 1;
    x.strokeRect(Math.round(bx - 6) + 0.5, Math.round(by - 6) + 0.5, 12, 12);
    tiny(x, "PLAYTEST 27", 4, 92, C.lime, C.black);
  }
  tiny(x, "BRICK BAKERY", 4, 4, C.cream);
  tiny(x, "L4", 150, 4, C.pink);
}

export function drawPlatform(
  x: CanvasRenderingContext2D,
  t: number,
  opts: { debug?: boolean } = {}
): void {
  x.imageSmoothingEnabled = false;
  ditherVerticalGradient(x, 0, 0, SW, SH, [C.dnavy, C.teal, C.mgreen]);
  x.fillStyle = C.cream;
  for (let i = 0; i < 6; i++) {
    const cx = (i * 41 - t * 6) % 200;
    x.fillRect(Math.round((cx + 200) % 200) - 20, 10 + (i % 3) * 8, 14, 3);
  }
  const plats = [
    [8, 80, 40],
    [56, 66, 34],
    [100, 52, 30],
    [126, 80, 34],
    [20, 40, 26],
  ];
  plats.forEach(([px, py, pw]) => {
    x.fillStyle = C.green;
    x.fillRect(px, py, pw, 5);
    x.fillStyle = C.ylime;
    x.fillRect(px, py, pw, 1);
    x.fillStyle = C.teal;
    x.fillRect(px, py + 5, pw, 2);
  });
  const ph = (t * 0.5) % 1;
  const seg = Math.floor(ph * 3);
  const u = (ph * 3) % 1;
  const path = [
    [16, 80],
    [62, 66],
    [106, 52],
    [140, 80],
  ];
  const a = path[seg];
  const b = path[seg + 1];
  const sx = a[0] + (b[0] - a[0]) * u;
  const sy = a[1] + (b[1] - a[1]) * u - Math.sin(Math.PI * u) * 20;
  x.drawImage(SLIME, Math.round(sx), Math.round(sy - 10));
  x.fillStyle = C.yellow;
  x.fillRect(118, 38, 1, 14);
  x.fillStyle = C.red;
  x.fillRect(119, 38, 6, 4);
  if (opts.debug) {
    x.strokeStyle = C.lime;
    x.lineWidth = 1;
    x.strokeRect(Math.round(sx) + 0.5, Math.round(sy - 10) + 0.5, 12, 10);
    tiny(x, "PLAYTEST 27", 4, 92, C.lime, C.black);
  }
  tiny(x, "SLIME HOP", 4, 4, C.cream);
  tiny(x, "*3", 150, 4, C.ylime);
}

export function drawDodger(
  x: CanvasRenderingContext2D,
  t: number,
  opts: { debug?: boolean } = {}
): void {
  x.imageSmoothingEnabled = false;
  ditherVerticalGradient(x, 0, 0, SW, SH, [C.dnavy, C.plum, C.crimson, C.dorange]);
  ditherDisc(x, 80, 46, 18, C.yellow, C.orange, 3);
  x.fillStyle = C.dplum;
  x.fillRect(0, 82, SW, 18);
  x.fillStyle = C.orange;
  x.fillRect(0, 82, SW, 2);
  for (let i = 0; i < 6; i++) {
    const rx = (i * 27 + 12) % (SW - 14);
    const ry = Math.floor((t * 48 + i * 19) % 80);
    x.drawImage(crate, rx, ry);
  }
  const px = Math.round(72 + Math.sin(t * 2.4) * 48);
  x.drawImage(pipCan, px, 66);
  if (opts.debug) {
    x.strokeStyle = C.lime;
    x.lineWidth = 1;
    x.strokeRect(px + 0.5, 66.5, 16, 17);
    tiny(x, "PLAYTEST 27", 4, 92, C.lime, C.black);
  }
  tiny(x, "SKY DODGER", 4, 4, C.cream, C.dplum);
  tiny(x, String(Math.floor(t * 25) % 9999).padStart(4, "0"), 138, 4, C.yellow, C.dplum);
}

export function drawAttract(x: CanvasRenderingContext2D, t: number): void {
  x.imageSmoothingEnabled = false;
  x.fillStyle = C.dnavy;
  x.fillRect(0, 0, SW, SH);
  for (let i = 0; i < 40; i++) {
    x.fillStyle = (i + Math.floor(t * 6)) % 3 ? C.navy : C.dblue;
    x.fillRect((i * 53 + Math.floor(t * 3)) % SW, (i * 29) % SH, 1, 1);
  }
  const b = Math.round(Math.sin(t * 4) * 2);
  x.drawImage(Math.floor(t * 1.3) % 5 === 0 ? pipBlink : pipCan, 64, 22 + b, 32, 34);
  if (Math.floor(t * 2) % 2 === 0) {
    drawPixelText(x, "PRESS START", 80, 68, {
      size: 8,
      align: "center",
      color: C.yellow,
      shadow: C.plum,
    });
  }
  tiny(x, "PLAYGLOW OS", 80 - Math.floor(tinyW("PLAYGLOW OS") / 2), 86, C.lav);
}

export function drawPowerDown(x: CanvasRenderingContext2D, t: number): void {
  x.fillStyle = C.black;
  x.fillRect(0, 0, SW, SH);
  const k = 0.5 + 0.5 * Math.sin(t * 2.2);
  x.fillStyle = C.dnavy;
  x.fillRect(30, 49, 100, 2);
  x.fillStyle = C.dblue;
  x.fillRect(60 - Math.round(k * 10), 49, 40 + Math.round(k * 20), 2);
  x.fillStyle = C.cream;
  x.fillRect(78, 48, 4, 4);
}

const CODE_LINES = [
  "FN JUMP:",
  " VY = -4.2",
  " IF AIR: DBL",
  "FN COIN:",
  " SCORE += 50",
  " SFX BLIP",
  "FN STARS:",
  " RATE = 0.8",
  "LOOP:",
  " RUN FOX",
  " DRAW HILLS",
  " CHECK HIT",
];

const GENRE_DRAW_MAP: Record<
  GenreName,
  (x: CanvasRenderingContext2D, t: number, opts?: { debug?: boolean }) => void
> = {
  runner: drawRunner,
  shooter: drawShooter,
  maze: drawMaze,
  breakout: drawBreakout,
  platformer: drawPlatform,
  dodger: drawDodger,
};

// ---------------- Game Catalogue from mocks/playglow/index.html lines 543–559 ----------------
export type MockGameKey = "fox" | "comet" | "moth" | "cake" | "slime" | "dodger";

export interface MockGameDef {
  key: MockGameKey;
  genre: GenreName;
  title: string;
  by: string;
  plays: string;
  hearts: number;
  draw: (x: CanvasRenderingContext2D, t: number, opts?: { debug?: boolean }) => void;
  trim: string;
  body: string;
  btn: string;
  mq: MockMarqueeOpts;
  side: MockSideOpts;
}

export const MOCK_GAMES: Record<MockGameKey, MockGameDef> = {
  fox: {
    key: "fox",
    genre: "runner",
    title: "FOXFIRE RUN",
    by: "JAMES",
    plays: "NEW",
    hearts: 12,
    draw: drawRunner,
    trim: C.orange,
    body: C.dplum,
    btn: C.dorange,
    mq: {
      title: "FOXFIRE RUN",
      bg: [C.dnavy, C.plum, C.crimson, C.dorange],
      grad: [C.yellow, C.orange],
      outline: C.dbrown,
      shadow: C.crimson,
      hero: foxA,
      deco: C.lyellow,
    },
    side: {
      bg: [C.dnavy, C.navy, C.plum, C.crimson, C.dorange, C.orange],
      sun: [50, 120, 30, 4],
      sunCols: [C.yellow, C.dorange],
      hills: [
        [132, 7, C.plum, C.crimson, 1],
        [150, 6, C.dplum, C.dmauve, 2.5],
      ],
      hero: foxA,
      heroScale: 4,
      title: ["FOXFIRE", "RUN"],
      stripes: [C.orange, C.dorange, C.crimson],
      sub: "BY JAMES",
    },
  },
  comet: {
    key: "comet",
    genre: "shooter",
    title: "COMET POP",
    by: "NOVA",
    plays: "412",
    hearts: 88,
    draw: drawShooter,
    trim: C.blue,
    body: C.dnavy,
    btn: C.blue,
    mq: {
      title: "COMET POP",
      bg: [C.black, C.dnavy, C.dblue],
      grad: [C.cream, C.blue],
      outline: C.dnavy,
      shadow: C.dblue,
      hero: SHIP,
      deco: C.cream,
    },
    side: {
      bg: [C.black, C.dnavy, C.navy, C.dblue],
      sun: [62, 56, 22],
      sunCols: [C.pink, C.plum],
      hero: SHIP,
      heroScale: 5,
      title: ["COMET", "POP"],
      stripes: [C.blue, C.dblue, C.navy],
      sub: "BY NOVA",
    },
  },
  moth: {
    key: "moth",
    genre: "maze",
    title: "MOTH MAZE",
    by: "LUMEN",
    plays: "238",
    hearts: 51,
    draw: drawMaze,
    trim: C.lime,
    body: C.teal,
    btn: C.lime,
    mq: {
      title: "MOTH MAZE",
      bg: [C.dnavy, C.teal, C.dnavy],
      grad: [C.lyellow, C.ylime],
      outline: C.dnavy,
      shadow: C.teal,
      hero: MOTH,
      deco: C.lyellow,
    },
    side: {
      bg: [C.dnavy, C.teal, C.green],
      sun: [70, 50, 16],
      sunCols: [C.lyellow, C.yellow],
      hills: [[150, 5, C.teal, C.mgreen, 4]],
      hero: MOTH,
      heroScale: 6,
      title: ["MOTH", "MAZE"],
      stripes: [C.ylime, C.mgreen, C.green],
      sub: "BY LUMEN",
    },
  },
  cake: {
    key: "cake",
    genre: "breakout",
    title: "BRICK BAKERY",
    by: "SUGAR",
    plays: "301",
    hearts: 64,
    draw: drawBreakout,
    trim: C.pink,
    body: C.dplum,
    btn: C.pink,
    mq: {
      title: "BRICK BAKERY",
      bg: [C.dplum, C.dmauve, C.pink],
      grad: [C.cream, C.peach],
      outline: C.dplum,
      shadow: C.crimson,
      hero: CUPCAKE,
      deco: C.peach,
    },
    side: {
      bg: [C.lpeach, C.pink, C.dmauve, C.dplum],
      sun: [50, 60, 24],
      sunCols: [C.cream, C.peach],
      hero: CUPCAKE,
      heroScale: 5,
      title: ["BRICK", "BAKERY"],
      stripes: [C.cream, C.peach, C.pink],
      sub: "BY SUGAR",
    },
  },
  slime: {
    key: "slime",
    genre: "platformer",
    title: "SLIME HOP",
    by: "GOOBY",
    plays: "176",
    hearts: 39,
    draw: drawPlatform,
    trim: C.ylime,
    body: C.navy,
    btn: C.ylime,
    mq: {
      title: "SLIME HOP",
      bg: [C.dnavy, C.teal, C.mgreen],
      grad: [C.lyellow, C.ylime],
      outline: C.dnavy,
      shadow: C.green,
      hero: SLIME,
      deco: C.cream,
    },
    side: {
      bg: [C.dnavy, C.teal, C.mgreen, C.ylime],
      sun: [30, 50, 14],
      sunCols: [C.cream, C.lyellow],
      hills: [
        [140, 8, C.green, C.mgreen, 1],
        [160, 5, C.teal, null, 3],
      ],
      hero: SLIME,
      heroScale: 5,
      title: ["SLIME", "HOP"],
      stripes: [C.lyellow, C.ylime, C.mgreen],
      sub: "BY GOOBY",
    },
  },
  dodger: {
    key: "dodger",
    genre: "dodger",
    title: "SKY DODGER",
    by: "PIP",
    plays: "194",
    hearts: 47,
    draw: drawDodger,
    trim: C.yellow,
    body: C.dplum,
    btn: C.orange,
    mq: {
      title: "SKY DODGER",
      bg: [C.dnavy, C.plum, C.crimson, C.dorange],
      grad: [C.yellow, C.orange],
      outline: C.dbrown,
      shadow: C.crimson,
      hero: pipCan,
      deco: C.yellow,
    },
    side: {
      bg: [C.dnavy, C.plum, C.crimson, C.dorange, C.orange],
      sun: [50, 80, 24, 3],
      sunCols: [C.yellow, C.dorange],
      hills: [[148, 6, C.dplum, C.crimson, 2]],
      hero: pipCan,
      heroScale: 4,
      title: ["SKY", "DODGER"],
      stripes: [C.yellow, C.orange, C.crimson],
      sub: "BY PIP",
    },
  },
};

export const GENRE_TO_MOCK_KEY: Record<GenreName, MockGameKey> = {
  runner: "fox",
  shooter: "comet",
  maze: "moth",
  breakout: "cake",
  platformer: "slime",
  dodger: "dodger",
};

const cachedMockSkins: Partial<
  Record<MockGameKey, { marquee: HTMLCanvasElement; side: HTMLCanvasElement }>
> = {};

export function getMockSkinCanvases(key: MockGameKey): {
  marquee: HTMLCanvasElement;
  side: HTMLCanvasElement;
  def: MockGameDef;
} {
  const def = MOCK_GAMES[key] || MOCK_GAMES.fox;
  if (!cachedMockSkins[def.key]) {
    cachedMockSkins[def.key] = {
      marquee: marqueeArt(def.mq),
      side: sideArt(def.side),
    };
  }
  return {
    marquee: cachedMockSkins[def.key]!.marquee,
    side: cachedMockSkins[def.key]!.side,
    def,
  };
}

function formatHeroShortLabel(rawHero: string): string {
  const h = rawHero.trim().toLowerCase();
  if (!h || h.includes("fox in a tiny blue scarf") || h === "scarf fox") {
    return "SCARF FOX";
  }
  const cleaned = rawHero
    .trim()
    .replace(/^(a|an|the|my|your|our)\s+/i, "")
    .toUpperCase();
  const fitted = stripTrailingStopwords(truncateStr(cleaned, 18));
  return fitted || cleaned.slice(0, 11) || "SCARF FOX";
}

// ---------------- Create & Build CRT Drawings from mocks/playglow/index.html lines 873–939 ----------------
export function drawCard(
  x: CanvasRenderingContext2D,
  t: number,
  opts: {
    qStep?: "name" | "genre" | "hero" | "vibe" | "ready";
    genre?: GenreName;
    hero?: string;
    vibe?: VibeName;
    vibeSelected?: boolean;
    heroSprite?: HTMLCanvasElement;
  } = {}
): void {
  const genre = opts.genre || "runner";
  const qStep = opts.qStep || "hero";
  ditherVerticalGradient(x, 0, 0, SW, SH, [C.dnavy, C.dnavy, C.navy]);
  x.imageSmoothingEnabled = false;

  // Dashed lavender sprite box on the left (10..56, 20..62)
  x.fillStyle = C.lav;
  for (let i = 10; i < 56; i += 2) {
    x.fillRect(i, 20, 1, 1);
    x.fillRect(i, 61, 1, 1);
  }
  for (let j = 20; j < 62; j += 2) {
    x.fillRect(10, j, 1, 1);
    x.fillRect(55, j, 1, 1);
  }

  // Genre title at (64, 26) in tiny2
  tiny2(x, genre.toUpperCase(), 64, 26, C.yellow, C.crimson);

  if (qStep === "genre") {
    tiny2(x, "?", 29, 34, Math.floor(t * 3) % 2 ? C.yellow : C.lav);
    tiny2(x, "HERO", 64, 66, C.lav);
    tiny2(x, "NEXT...", 64, 80, C.dmauve);
    for (let i = 0; i < 4; i++) {
      const sx = 64 + i * 20;
      const sy = 44;
      x.fillStyle = C.dmauve;
      for (let k = 0; k < 16; k += 2) {
        x.fillRect(sx + k, sy, 1, 1);
        x.fillRect(sx + k, sy + 11, 1, 1);
      }
    }
    return;
  }

  const b = Math.round(Math.sin(t * 5) * 1.5);
  if (genre === "runner") {
    x.drawImage(Math.floor(t * 8) % 2 ? foxA : foxB, 17, 28 + b, 32, 26);
  } else {
    const spr = opts.heroSprite || makeGenreSpriteCanvas(genre);
    x.drawImage(spr, 17, 28 + b, 32, 26);
  }

  // 4 vibe swatch boxes at (64 + i * 20, 44, 16, 12)
  const vibeDef = VIBES[opts.vibe || "sunset"] || VIBES.sunset;
  const showSwatches = Boolean(opts.vibeSelected || qStep === "vibe" || qStep === "ready");
  for (let i = 0; i < 4; i++) {
    const sx = 64 + i * 20;
    const sy = 44;
    const w = 16;
    const h = 12;
    if (showSwatches) {
      x.fillStyle = vibeDef.swatches[i];
      x.fillRect(sx + 1, sy + 1, w - 2, h - 2);
    }
    x.fillStyle = showSwatches ? C.cream : C.dmauve;
    for (let k = 0; k < w; k += 2) {
      x.fillRect(sx + k, sy, 1, 1);
      x.fillRect(sx + k, sy + h - 1, 1, 1);
    }
    for (let k = 0; k < h; k += 2) {
      x.fillRect(sx, sy + k, 1, 1);
      x.fillRect(sx + w - 1, sy + k, 1, 1);
    }
  }

  tiny2(x, "HERO", 64, 66, C.lav);
  const label = formatHeroShortLabel(opts.hero || "");
  if (label.length <= 11) {
    const n = Math.min(label.length, Math.floor(t * 4) % (label.length + 8));
    tiny2(x, label.slice(0, n), 64, 80, C.cream);
    if (Math.floor(t * 3) % 2) {
      x.fillStyle = C.yellow;
      x.fillRect(64 + n * 8, 80, 2, 10);
    }
  } else {
    const [l1, l2] = splitSideTitleLines(label, 11);
    tiny2(x, l1, 64, 75, C.cream);
    if (l2) {
      tiny2(x, l2, 64, 86, C.cream);
    }
  }
}

const _buildGameCanvas = typeof document !== "undefined" ? mk(SW, SH) : null;
const _buildGameCtx = _buildGameCanvas ? _buildGameCanvas.getContext("2d")! : null;

export function drawBuildCRT(
  x: CanvasRenderingContext2D,
  t: number,
  p: number,
  stage: number | BuildStageName,
  opts: {
    title?: string;
    genre?: GenreName;
    attractArt?: HTMLImageElement | HTMLCanvasElement | null;
    heroOffsetX?: number;
    heroJumpY?: number;
  } = {}
): void {
  const clampedP = Math.max(0, Math.min(1, p));
  const title = (opts.title || "FOXFIRE RUN").toUpperCase();
  const genre = opts.genre || "runner";

  ditherVerticalGradient(x, 0, 0, SW, SH, [C.black, C.dnavy, C.dnavy]);
  x.imageSmoothingEnabled = false;
  tiny2(x, title, 80 - tinyW(title), 3, C.yellow, C.crimson);

  let stageIdx = 0;
  let stageLabelStr = "DESIGNING";
  if (typeof stage === "number") {
    stageIdx = stage;
    stageLabelStr = ["DESIGNING", "CODING", "TESTING", "PAINTING"][stageIdx] || "PAINTING";
  } else {
    if (stage === "designing") {
      stageIdx = 0;
      stageLabelStr = "DESIGNING";
    } else if (stage === "coding") {
      stageIdx = 1;
      stageLabelStr = "CODING";
    } else if (stage === "playtesting" || stage === "testing") {
      stageIdx = 2;
      stageLabelStr = "TESTING";
    } else if (stage === "painting") {
      stageIdx = 3;
      stageLabelStr = "PAINTING";
    } else {
      stageIdx = 3;
      stageLabelStr = "FINISHING";
    }
  }

  const px = 36;
  const py = 20;
  const pw = 88;
  const ph = 50;
  const ox = Math.round((opts.heroOffsetX || 0) * 0.4);
  const oy = Math.round((opts.heroJumpY || 0) * 0.5);

  if (stageIdx === 0) {
    x.fillStyle = C.dnavy;
    x.fillRect(px, py, pw, ph);
    x.fillStyle = C.navy;
    for (let i = px; i < px + pw; i += 8) x.fillRect(i, py, 1, ph);
    for (let j = py; j < py + ph; j += 8) x.fillRect(px, j, pw, 1);
    x.globalAlpha = ox !== 0 || oy !== 0 ? 1.0 : 0.7;
    const spr = genre === "runner" ? foxA : makeGenreSpriteCanvas(genre);
    x.drawImage(spr, px + 32 + ox, py + 14 - oy, 32, 26);
    x.globalAlpha = 1;
  } else if (stageIdx === 1) {
    if (opts.attractArt) {
      x.drawImage(opts.attractArt, px, py, pw, ph);
      x.fillStyle = "rgba(18, 12, 28, 0.55)";
      x.fillRect(px, py, pw, ph);
    } else {
      x.fillStyle = C.dnavy;
      x.fillRect(px, py, pw, ph);
    }
    const off = Math.floor(t * 6);
    for (let i = 0; i < 6; i++) {
      const l = CODE_LINES[(i + off) % CODE_LINES.length];
      tiny(
        x,
        l,
        px + 4,
        py + 4 + i * 7,
        l.startsWith("FN") || l.startsWith("LOOP") ? C.pink : C.lime
      );
    }
    const spr = genre === "runner" ? foxA : makeGenreSpriteCanvas(genre);
    const bob = Math.round(Math.sin(t * 6) * 2);
    x.drawImage(spr, px + 52 + ox, py + 14 + bob - oy, 32, 26);
  } else if (_buildGameCtx && _buildGameCanvas) {
    const drawFn = GENRE_DRAW_MAP[genre] || drawRunner;
    drawFn(_buildGameCtx, t, { debug: stageIdx === 2 });
    x.drawImage(_buildGameCanvas, 0, 0, SW, SH, px, py, pw, ph);
  }

  // Preview box 1px border in lavender
  x.fillStyle = C.lav;
  x.fillRect(px - 1, py - 1, pw + 2, 1);
  x.fillRect(px - 1, py + ph, pw + 2, 1);
  x.fillRect(px - 1, py, 1, ph);
  x.fillRect(px + pw, py, 1, ph);

  // Stage label & right-aligned percentage in tiny2
  const pct = Math.floor(clampedP * 100) + "%";
  tiny2(x, stageLabelStr, 12, 74, C.peach);
  tiny2(x, pct, 108 + (40 - tinyW(pct) * 2 - 2), 74, C.yellow);

  // Progress bar at (12, 86, 136, 8)
  x.fillStyle = C.dmauve;
  x.fillRect(12, 86, 136, 8);
  const w = Math.round(134 * clampedP);
  x.fillStyle = C.dorange;
  x.fillRect(13, 87, w, 6);
  x.fillStyle = C.yellow;
  x.fillRect(13, 87, w, 3);
  if (Math.floor(t * 4) % 2) {
    x.fillStyle = C.cream;
    x.fillRect(13 + w, 87, 1, 6);
  }
}

export class AttractScreen {
  public readonly canvas: HTMLCanvasElement;
  public readonly ctx: CanvasRenderingContext2D;
  public readonly lowCanvas: HTMLCanvasElement;
  public readonly lowCtx: CanvasRenderingContext2D;
  public readonly texture: THREE.CanvasTexture;
  private state: AttractPreviewState = {
    step: 3,
    qStep: "hero",
    name: "JAMES",
    genre: "runner",
    hero: "a fox in a tiny blue scarf",
    vibe: "sunset",
    mode: "create",
    mockGameKey: "fox",
  };
  private sprites: Record<GenreName, HTMLCanvasElement>;
  private flashFrames = 0;

  constructor(width = 320, height = 200) {
    this.canvas = mk(width, height);
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;

    this.lowCanvas = mk(SW, SH);
    this.lowCtx = this.lowCanvas.getContext("2d")!;
    this.lowCtx.imageSmoothingEnabled = false;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;

    this.sprites = {
      runner: makeGenreSpriteCanvas("runner"),
      shooter: makeGenreSpriteCanvas("shooter"),
      maze: makeGenreSpriteCanvas("maze"),
      breakout: makeGenreSpriteCanvas("breakout"),
      platformer: makeGenreSpriteCanvas("platformer"),
      dodger: makeGenreSpriteCanvas("dodger"),
    };

    this.render(0);
  }

  public setState(next: Partial<AttractPreviewState>): void {
    const changed =
      (next.step !== undefined && next.step !== this.state.step) ||
      (next.qStep !== undefined && next.qStep !== this.state.qStep) ||
      (next.genre !== undefined && next.genre !== this.state.genre) ||
      (next.vibe !== undefined && next.vibe !== this.state.vibe);
    this.state = { ...this.state, ...next };
    if (changed && next.mode === undefined) {
      this.flashFrames = 1;
    }
  }

  public getState(): AttractPreviewState {
    return this.state;
  }

  public setAttractImage(
    img: HTMLImageElement | HTMLCanvasElement | null
  ): void {
    this.state.attractArt = img;
  }

  public nudgeHero(dx: number, jump = false): void {
    const nextX = Math.max(
      -70,
      Math.min(70, (this.state.heroOffsetX || 0) + dx)
    );
    this.state.heroOffsetX = nextX;
    if (jump) {
      this.state.heroJumpY = 18;
    }
  }

  public render(t: number): void {
    const lx = this.lowCtx;
    lx.imageSmoothingEnabled = false;

    // Decay hero jump if active
    if (this.state.heroJumpY && this.state.heroJumpY > 0) {
      this.state.heroJumpY = Math.max(0, this.state.heroJumpY - 1.2);
    }

    if (this.flashFrames > 0) {
      this.flashFrames--;
      lx.fillStyle = C.cream;
      lx.fillRect(0, 0, SW, SH);
      this.blitLowToOutput();
      return;
    }

    const mode = this.state.buildMode ? "build" : this.state.mode || "create";

    if (mode === "switch") {
      drawPowerDown(lx, t);
      this.blitLowToOutput();
      return;
    }

    if (mode === "play") {
      const gameKey =
        this.state.mockGameKey || GENRE_TO_MOCK_KEY[this.state.genre] || "fox";
      const def = MOCK_GAMES[gameKey] || MOCK_GAMES.fox;
      def.draw(lx, t);
      this.blitLowToOutput();
      return;
    }

    if (mode === "build") {
      const p =
        this.state.buildPct !== undefined
          ? this.state.buildPct / 100
          : Math.min(1, (t % 48) / 40);
      const stage: number | BuildStageName =
        this.state.buildStage !== undefined
          ? this.state.buildStage
          : p < 0.2
          ? 0
          : p < 0.45
          ? 1
          : p < 0.65
          ? 2
          : 3;
      drawBuildCRT(lx, t, p, stage, {
        title: this.state.buildTitle || "FOXFIRE RUN",
        genre: this.state.genre,
        attractArt: this.state.attractArt,
        heroOffsetX: this.state.heroOffsetX,
        heroJumpY: this.state.heroJumpY,
      });
      this.blitLowToOutput();
      return;
    }

    if (mode === "attract") {
      drawAttract(lx, t);
      this.blitLowToOutput();
      return;
    }

    // Default: Create mode (drawCard)
    const qStep =
      this.state.qStep ||
      (this.state.step === 2 ? "genre" : this.state.step >= 4 ? "vibe" : "hero");
    drawCard(lx, t, {
      qStep,
      genre: this.state.genre,
      hero: this.state.hero,
      vibe: this.state.vibe,
      vibeSelected: Boolean(this.state.vibeSelected || this.state.step >= 4),
      heroSprite: this.sprites[this.state.genre],
    });
    this.blitLowToOutput();
  }

  private blitLowToOutput(): void {
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(
      this.lowCanvas,
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );
    this.texture.needsUpdate = true;
  }
}
