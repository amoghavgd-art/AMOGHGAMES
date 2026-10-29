// engine/cart.d.ts — TypeScript declarations for the playglow cart engine

export const PALETTE: readonly [
  "#000000", "#1D2B53", "#7E2553", "#008751",
  "#AB5236", "#5F574F", "#C2C3C7", "#FFF1E8",
  "#FF004D", "#FFA300", "#FFEC27", "#00E436",
  "#29ADFF", "#83769C", "#FF77A8", "#FFCCAA",
  "#291814", "#111D35", "#422136", "#125359",
  "#742F29", "#49333B", "#A28879", "#F3EF7D",
  "#BE1250", "#FF6C24", "#A8E72E", "#00B543",
  "#065AB5", "#754665", "#FF6E59", "#FF9D81"
];

export interface GameDesignCard {
  title: string;
  tagline: string;
  player_name: string;
  genre: "runner" | "shooter" | "maze" | "breakout" | "platformer" | "dodger";
  vibe: "sunset" | "mint" | "cosmic" | "candy";
  hero: { description: string; short: string };
  enemies: Array<{ description: string; behaviour: string }>;
  collectible: string;
  mechanics: string[];
  win_lose: string;
  art: { scene: string; hero_pose: string };
  safety: { ok: boolean; field?: "name" | "hero"; nudge?: string };
  palette: { bg: string; fg: string; accent1: string; accent2: string; ui: string };
  engine_palette: { bg: number; fg: number; accent1: number; accent2: number; ui: number };
  id: string;
  seed: number;
}

// game.js must default-export nothing; it must export exactly this:
export function create(engine: Engine, card: GameDesignCard, g?: Gfx): Game;

export interface Game {
  update(dt: number, input: Input): void;   // dt is always 1/60
  draw(g: Gfx): void;
}

export interface BurstOptions {
  count?: number;
  color?: number | number[];
  colors?: number[];
  speed?: number;
  life?: number;
  gravity?: number;
  size?: number;
}

export interface SprOptions {
  flipX?: boolean;
  flipY?: boolean;
  scale?: 1 | 2 | 3 | 4;
  flash?: number | boolean;
  outline?: number | boolean;
}

export interface TextOptions {
  scale?: 1 | 2 | 3;
  align?: "left" | "center" | "right";
  shadow?: number | boolean;
  outline?: number | boolean;
}

export interface RectBox {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface CircleBox {
  x: number;
  y: number;
  r?: number;
}

export interface Engine {
  readonly W: 320;
  readonly H: 200;
  readonly time: number;            // seconds since start (sim time, NOT wall clock)
  readonly frame: number;           // tick count
  rng(): number;                    // seeded [0,1) — the ONLY randomness allowed
  rngInt(min: number, maxIncl: number): number;
  rngFloat(min?: number, max?: number): number;
  rngChoice<T>(arr: readonly T[]): T | undefined;
  pick<T>(arr: readonly T[]): T | undefined;
  chance(p?: number): boolean;
  clamp(v: number, lo?: number, hi?: number): number;
  lerp(a: number, b: number, t: number): number;
  dist(x1: number, y1: number, x2: number, y2: number): number;
  angle(x1: number, y1: number, x2: number, y2: number): number;
  aabb(a: RectBox, b: RectBox): boolean;
  aabb(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean;
  circleHit(a: CircleBox, b: CircleBox): boolean;
  circleHit(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean;
  btn(k: string | number): boolean;
  btnp(k: string | number): boolean;
  score(add: number): void;         // adds to score; engine owns the number and posts it to the parent
  readonly scoreValue: number;
  lives(n?: number): number;        // set/get lives shown in the engine's HUD helper
  loseLife(n?: number): number;
  readonly livesValue: number;
  gameOver(reason?: string): void;  // ends the round; engine shows "game over" + score, then waits for START
  sfx(name: SfxName | string, noteOrOpts?: number | { note?: number }): void;
  shake(frames?: number, px?: number): void;  // screen shake (applied by the engine when presenting the frame)
  burst(x: number, y: number, opts?: BurstOptions): void;
  particles(x: number, y: number, opts?: BurstOptions): void;
  popup(str: string | number, x: number, y: number, c?: number, life?: number): void;
  floatText(str: string | number, x: number, y: number, c?: number, life?: number): void;
  flash(frames?: number, c?: number): void;
  hitstop(frames?: number): void;
  freeze(frames?: number): void;
  hud(g?: Gfx): void;               // standard top bar: score left, collectible center, 5x5 pixel hearts right
  sprite(art: string | string[], palette?: Record<string, number>): Sprite;
  save: { get(key: string): number | undefined; set(key: string, v: number): void };
}

export type SfxName =
  | "jump"
  | "coin"
  | "hit"
  | "shoot"
  | "laser"
  | "explode"
  | "boom"
  | "powerup"
  | "select"
  | "lose"
  | "win"
  | "bounce"
  | "paddle"
  | "wall"
  | "step"
  | "walk"
  | "land"
  | "dash"
  | "whoosh"
  | "dodge"
  | "boost"
  | "pickup"
  | "gem"
  | "star"
  | "collect"
  | "eat"
  | "chomp"
  | "hurt"
  | "damage"
  | "die"
  | "death"
  | "gameover"
  | "start"
  | "ready"
  | "go"
  | "wave"
  | "levelup"
  | "clear"
  | "boss"
  | "warning"
  | "alarm"
  | "siren"
  | "shield"
  | "heal"
  | "1up"
  | "combo"
  | "bonus"
  | "tick";

export interface Input {
  left: boolean; right: boolean; up: boolean; down: boolean;
  a: boolean; b: boolean; start: boolean;
  pressed: { left: boolean; right: boolean; up: boolean; down: boolean; a: boolean; b: boolean; start: boolean };
}

export interface Gfx {
  readonly W: 320;
  readonly H: 200;
  cls(c?: number): void;
  pset(x: number, y: number, c: number): void;
  pix(x: number, y: number, c: number): void;
  pget(x: number, y: number): number;
  clip(x?: number, y?: number, w?: number, h?: number): void;
  rect(x: number, y: number, w: number, h: number, c: number): void;      // filled
  rectfill(x: number, y: number, w: number, h: number, c: number): void;  // filled alias
  rectb(x: number, y: number, w: number, h: number, c: number): void;     // outline
  rrect(x: number, y: number, w: number, h: number, r?: number, c?: number): void;
  rrectb(x: number, y: number, w: number, h: number, r?: number, c?: number): void;
  circ(x: number, y: number, r: number, c: number): void;                 // filled
  circfill(x: number, y: number, r: number, c: number): void;             // filled alias
  circb(x: number, y: number, r: number, c: number): void;                // outline
  oval(x: number, y: number, rx: number, ry: number, c: number): void;
  ovalb(x: number, y: number, rx: number, ry: number, c: number): void;
  tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number): void;
  trifill(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number): void;
  trib(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number): void;
  line(x0: number, y0: number, x1: number, y1: number, c: number): void;
  spr(s: Sprite | string | string[], x: number, y: number, opts?: SprOptions | boolean): void;
  text(str: string | number, x: number, y: number, c?: number, opts?: TextOptions): void;
  print(str: string | number, x: number, y: number, c?: number, opts?: TextOptions): void;
  dither(x: number, y: number, w: number, h: number, c1: number, c2: number, level: 0 | 1 | 2 | 3 | 4): void;
  starfield(scrollX?: number, scrollY?: number, count?: number, c1?: number, c2?: number): void;
  bar(x: number, y: number, w: number, h: number, pct: number, fgCol?: number, bgCol?: number, borderCol?: number | boolean): void;
  camera(x?: number, y?: number): void;
  cam(x?: number, y?: number): void;
  pal(c0?: number, c1?: number): void;
  resetPal(): void;
  vibePalette(): {
    bg: number;
    fg: number;
    primary: number;
    secondary: number;
    accent: number;
    accent1: number;
    accent2: number;
    ui: number;
    hazard: number;
  };
  fx(): void;
  hud(g?: Gfx): void;
}

export interface Sprite {
  readonly w: number;
  readonly h: number;
}
