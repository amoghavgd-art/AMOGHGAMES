import type { GenreName } from "../card/presets";
import { GENRE_LIST, GENRE_PRESETS } from "../card/presets";
import type { VibeName } from "../card/vibes";
import { VIBES, VIBE_LIST } from "../card/vibes";
import type { GameDesignCard } from "../card/schema";
import {
  C,
  ditherVerticalGradient as ditherV,
  ditherDisc,
  drawPixelText as ptext,
  makeGenreSpriteCanvas,
  splitSideTitleLines,
} from "../stage/skinCompositor";
import { tiny, tinyW } from "../stage/attract";

export { C, ditherV, ditherDisc, ptext, tiny, tinyW };

function mk(w: number, h: number): HTMLCanvasElement {
  if (typeof document === "undefined") {
    return { width: w, height: h } as unknown as HTMLCanvasElement;
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

let _spritesCache: Record<GenreName, HTMLCanvasElement> | null = null;
export function getGenreSprites(): Record<GenreName, HTMLCanvasElement> {
  if (_spritesCache) return _spritesCache;
  _spritesCache = {
    runner: makeGenreSpriteCanvas("runner"),
    shooter: makeGenreSpriteCanvas("shooter"),
    maze: makeGenreSpriteCanvas("maze"),
    breakout: makeGenreSpriteCanvas("breakout"),
    platformer: makeGenreSpriteCanvas("platformer"),
    dodger: makeGenreSpriteCanvas("dodger"),
  };
  return _spritesCache;
}

export interface MarqueeArtConfig {
  title: string;
  bg: string[];
  color?: string;
  grad?: [string, string];
  outline: string;
  shadow: string;
  hero?: HTMLCanvasElement;
  deco?: string;
}

export interface SideArtConfig {
  bg: string[];
  sun?: [number, number, number, number?];
  sunCols?: [string, string];
  hills?: Array<[number, number, string, string | null, number]>;
  hero?: HTMLCanvasElement;
  heroScale?: number;
  title?: [string, string?];
  sub?: string;
  stripes?: string[];
  deco?: string;
}

/**
 * Generates 288x40 pixel-art marquee canvas (exact port of marqueeArt in mocks/playglow/index.html).
 */
export function marqueeArt(cfg: MarqueeArtConfig): HTMLCanvasElement {
  const c = mk(288, 40);
  if (typeof document === "undefined") return c;
  const x = c.getContext("2d")!;
  x.imageSmoothingEnabled = false;
  ditherV(x, 0, 0, 288, 40, cfg.bg);
  x.fillStyle = cfg.deco || C.cream;
  for (let i = 0; i < 30; i++) {
    x.fillRect((i * 97) % 288, (i * 23) % 22, 1, 1);
  }
  x.fillStyle = C.dbrown;
  x.fillRect(0, 0, 288, 2);
  x.fillRect(0, 38, 288, 2);
  x.fillStyle = cfg.shadow;
  x.fillRect(0, 34, 288, 2);

  const title = (cfg.title || "PLAYGLOW").toUpperCase();
  if (cfg.hero) {
    const s = cfg.hero;
    const sc = 2;
    const w = s.width * sc;
    const h = s.height * sc;
    x.imageSmoothingEnabled = false;
    x.drawImage(s, 10, Math.max(2, 38 - h - 2), w, h);
    x.save();
    x.translate(278, 0);
    x.scale(-1, 1);
    x.drawImage(s, 0, Math.max(2, 38 - h - 2), w, h);
    x.restore();
  }

  const fSize =
    title.length > 16 ? 9 : title.length > 13 ? 10 : title.length > 10 ? 13 : 15;
  const fY = Math.round((40 - fSize) / 2) + 1;
  ptext(x, title, 144, fY, {
    size: fSize,
    align: "center",
    grad: cfg.grad,
    color: cfg.color,
    outline: cfg.outline,
    shadow: cfg.outline,
    shadowD: 2,
  });
  return c;
}

/**
 * Generates 100x202 pixel-art side panel canvas (exact port of sideArt in mocks/playglow/index.html).
 */
export function sideArt(cfg: SideArtConfig): HTMLCanvasElement {
  const W = 100;
  const H = 202;
  const c = mk(W, H);
  if (typeof document === "undefined") return c;
  const x = c.getContext("2d")!;
  x.imageSmoothingEnabled = false;
  ditherV(x, 0, 0, W, H, cfg.bg);
  x.fillStyle = cfg.deco || C.cream;
  for (let i = 0; i < 40; i++) {
    x.fillRect((i * 37) % W, (i * 53) % 110, 1, 1);
  }
  if (cfg.sun && cfg.sunCols) {
    ditherDisc(
      x,
      cfg.sun[0],
      cfg.sun[1],
      cfg.sun[2],
      cfg.sunCols[0],
      cfg.sunCols[1],
      cfg.sun[3] || 0
    );
  }
  if (cfg.hills) {
    cfg.hills.forEach(([base, amp, col, top, seed]) => {
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
  if (cfg.stripes) {
    cfg.stripes.forEach((col, k) => {
      x.fillStyle = col;
      for (let i = 0; i < W; i++) {
        x.fillRect(i, Math.round(176 - k * 7 - i * 0.35), 1, 4);
      }
    });
  }
  if (cfg.hero) {
    const heroScale = cfg.heroScale || 4;
    const w = cfg.hero.width * heroScale;
    const h = cfg.hero.height * heroScale;
    x.drawImage(cfg.hero, Math.round((W - w) / 2) + 4, 100 - Math.round(h / 2), w, h);
  }
  if (cfg.title) {
    ptext(x, cfg.title[0], W / 2, 12, {
      size: 8,
      align: "center",
      color: C.yellow,
      outline: C.dbrown,
      shadow: C.dbrown,
      shadowD: 2,
    });
    if (cfg.title[1]) {
      ptext(x, cfg.title[1], W / 2, 24, {
        size: 8,
        align: "center",
        color: C.yellow,
        outline: C.dbrown,
        shadow: C.dbrown,
        shadowD: 2,
      });
    }
  }
  if (cfg.sub) {
    tiny(x, cfg.sub, Math.round(W / 2 - tinyW(cfg.sub) / 2), 192, C.cream, C.dbrown);
  }
  return c;
}

/**
 * Generates 160x100 pixel-art attract screen canvas for a given genre + vibe.
 */
export function attractArt(
  genre: GenreName,
  vibe: VibeName,
  title?: string
): HTMLCanvasElement {
  const SW = 160;
  const SH = 100;
  const c = mk(SW, SH);
  if (typeof document === "undefined") return c;
  const x = c.getContext("2d")!;
  x.imageSmoothingEnabled = false;
  const v = VIBES[vibe] || VIBES.sunset;
  const pal = v.palette;
  const sprites = getGenreSprites();
  const hero = sprites[genre] || sprites.runner;

  ditherV(x, 0, 0, SW, SH, [C.dnavy, pal.bg, pal.fg, pal.accent1]);
  ditherDisc(x, 114, 48, 22, pal.accent2, pal.fg, 4);

  // Stars
  x.fillStyle = pal.ui;
  for (let i = 0; i < 18; i++) {
    x.fillRect((i * 53 + 11) % SW, (i * 29 + 5) % 52, 1, 1);
  }

  // Silhouette hills
  for (let i = 0; i < SW; i++) {
    const y = Math.round(68 + Math.sin((i / SW) * Math.PI * 3 + 1.2) * 6);
    x.fillStyle = pal.bg;
    x.fillRect(i, y, 1, SH - y);
    x.fillStyle = pal.accent1;
    x.fillRect(i, y, 1, 1);
  }

  // Hero centred in heroic pose
  const sc = 3;
  const hw = hero.width * sc;
  const hh = hero.height * sc;
  x.drawImage(hero, Math.round((SW - hw) / 2), Math.round(52 - hh / 2), hw, hh);

  if (title) {
    tiny(
      x,
      title.slice(0, 18),
      Math.round(SW / 2 - tinyW(title.slice(0, 18)) / 2),
      6,
      pal.ui,
      C.dnavy
    );
  }
  return c;
}

export type HouseGameKey = "fox" | "comet" | "moth" | "cake" | "slime" | "dodger";

export interface HouseGameSpec {
  key: HouseGameKey;
  title: string;
  by: string;
  genre: GenreName;
  vibe: VibeName;
  trim: string;
  body: string;
  btn: string;
  mq: Omit<MarqueeArtConfig, "hero">;
  side: Omit<SideArtConfig, "hero">;
}

export const HOUSE_GAME_SPECS: Record<HouseGameKey, HouseGameSpec> = {
  fox: {
    key: "fox",
    title: "FOXFIRE RUN",
    by: "JAMES",
    genre: "runner",
    vibe: "sunset",
    trim: C.orange,
    body: C.dplum,
    btn: C.dorange,
    mq: {
      title: "FOXFIRE RUN",
      bg: [C.dnavy, C.plum, C.crimson, C.dorange],
      grad: [C.yellow, C.orange],
      outline: C.dbrown,
      shadow: C.crimson,
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
      heroScale: 4,
      title: ["FOXFIRE", "RUN"],
      stripes: [C.orange, C.dorange, C.crimson],
      sub: "BY JAMES",
    },
  },
  comet: {
    key: "comet",
    title: "COMET POP",
    by: "NOVA",
    genre: "shooter",
    vibe: "cosmic",
    trim: C.blue,
    body: C.dnavy,
    btn: C.blue,
    mq: {
      title: "COMET POP",
      bg: [C.black, C.dnavy, C.dblue],
      grad: [C.cream, C.blue],
      outline: C.dnavy,
      shadow: C.dblue,
      deco: C.cream,
    },
    side: {
      bg: [C.black, C.dnavy, C.navy, C.dblue],
      sun: [62, 56, 22],
      sunCols: [C.pink, C.plum],
      heroScale: 5,
      title: ["COMET", "POP"],
      stripes: [C.blue, C.dblue, C.navy],
      sub: "BY NOVA",
    },
  },
  moth: {
    key: "moth",
    title: "MOTH MAZE",
    by: "LUMEN",
    genre: "maze",
    vibe: "mint",
    trim: C.lime,
    body: C.teal,
    btn: C.lime,
    mq: {
      title: "MOTH MAZE",
      bg: [C.dnavy, C.teal, C.dnavy],
      grad: [C.lyellow, C.ylime],
      outline: C.dnavy,
      shadow: C.teal,
      deco: C.lyellow,
    },
    side: {
      bg: [C.dnavy, C.teal, C.green],
      sun: [70, 50, 16],
      sunCols: [C.lyellow, C.yellow],
      hills: [[150, 5, C.teal, C.mgreen, 4]],
      heroScale: 6,
      title: ["MOTH", "MAZE"],
      stripes: [C.ylime, C.mgreen, C.green],
      sub: "BY LUMEN",
    },
  },
  cake: {
    key: "cake",
    title: "BRICK BAKERY",
    by: "SUGAR",
    genre: "breakout",
    vibe: "candy",
    trim: C.pink,
    body: C.dplum,
    btn: C.pink,
    mq: {
      title: "BRICK BAKERY",
      bg: [C.dplum, C.dmauve, C.pink],
      grad: [C.cream, C.peach],
      outline: C.dplum,
      shadow: C.crimson,
      deco: C.peach,
    },
    side: {
      bg: [C.lpeach, C.pink, C.dmauve, C.dplum],
      sun: [50, 60, 24],
      sunCols: [C.cream, C.peach],
      heroScale: 5,
      title: ["BRICK", "BAKERY"],
      stripes: [C.cream, C.peach, C.pink],
      sub: "BY SUGAR",
    },
  },
  slime: {
    key: "slime",
    title: "SLIME HOP",
    by: "GOOBY",
    genre: "platformer",
    vibe: "mint",
    trim: C.ylime,
    body: C.navy,
    btn: C.ylime,
    mq: {
      title: "SLIME HOP",
      bg: [C.dnavy, C.teal, C.mgreen],
      grad: [C.lyellow, C.ylime],
      outline: C.dnavy,
      shadow: C.green,
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
      heroScale: 5,
      title: ["SLIME", "HOP"],
      stripes: [C.lyellow, C.ylime, C.mgreen],
      sub: "BY GOOBY",
    },
  },
  dodger: {
    key: "dodger",
    title: "SKY DODGER",
    by: "PIP",
    genre: "dodger",
    vibe: "sunset",
    trim: C.orange,
    body: C.dplum,
    btn: C.yellow,
    mq: {
      title: "SKY DODGER",
      bg: [C.dnavy, C.plum, C.rust, C.orange],
      grad: [C.yellow, C.dorange],
      outline: C.dbrown,
      shadow: C.rust,
      deco: C.yellow,
    },
    side: {
      bg: [C.dnavy, C.plum, C.crimson, C.dorange, C.yellow],
      sun: [50, 64, 24, 3],
      sunCols: [C.yellow, C.orange],
      hills: [
        [138, 7, C.rust, C.dorange, 2],
        [156, 5, C.dplum, C.plum, 4],
      ],
      heroScale: 4,
      title: ["SKY", "DODGER"],
      stripes: [C.yellow, C.orange, C.crimson],
      sub: "BY PIP",
    },
  },
};

export const GENRE_TO_HOUSE_KEY: Record<GenreName, HouseGameKey> = {
  runner: "fox",
  shooter: "comet",
  maze: "moth",
  breakout: "cake",
  platformer: "slime",
  dodger: "dodger",
};

export interface HouseSkinBundle {
  key: string;
  genre: GenreName;
  vibe: VibeName;
  title: string;
  by: string;
  marqueeCanvas: HTMLCanvasElement;
  sideCanvas: HTMLCanvasElement;
  attractCanvas: HTMLCanvasElement;
  marqueeDataUrl: string;
  sideDataUrl: string;
  attractDataUrl: string;
  trim: string;
  body: string;
  btn: string;
}

const skinCache = new Map<string, HouseSkinBundle>();

function safeToDataUrl(canvas: HTMLCanvasElement): string {
  if (typeof canvas.toDataURL === "function") {
    try {
      return canvas.toDataURL("image/png");
    } catch {
      // ignore
    }
  }
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}

/**
 * Returns the exact mock game skin for one of the 6 iconic house games (`fox`, `comet`, `moth`, `cake`, `slime`, `dodger`).
 */
export function getMockGameSkin(key: HouseGameKey): HouseSkinBundle {
  const cacheKey = `mock:${key}`;
  const existing = skinCache.get(cacheKey);
  if (existing) return existing;

  const spec = HOUSE_GAME_SPECS[key] || HOUSE_GAME_SPECS.fox;
  const sprites = getGenreSprites();
  const hero = sprites[spec.genre] || sprites.runner;

  const mqCanvas = marqueeArt({ ...spec.mq, hero });
  const sdCanvas = sideArt({ ...spec.side, hero });
  const atCanvas = attractArt(spec.genre, spec.vibe, spec.title);

  const bundle: HouseSkinBundle = {
    key: cacheKey,
    genre: spec.genre,
    vibe: spec.vibe,
    title: spec.title,
    by: spec.by,
    marqueeCanvas: mqCanvas,
    sideCanvas: sdCanvas,
    attractCanvas: atCanvas,
    marqueeDataUrl: safeToDataUrl(mqCanvas),
    sideDataUrl: safeToDataUrl(sdCanvas),
    attractDataUrl: safeToDataUrl(atCanvas),
    trim: spec.trim,
    body: spec.body,
    btn: spec.btn,
  };
  skinCache.set(cacheKey, bundle);
  return bundle;
}

/**
 * Generates or retrieves from cache one of the 24 house skins (6 genres × 4 vibes),
 * optionally customized with the visitor's game title and player name.
 */
export function getHouseSkin(
  genre: GenreName,
  vibe: VibeName,
  opts: { title?: string; by?: string } = {}
): HouseSkinBundle {
  const defaultKey = GENRE_TO_HOUSE_KEY[genre] || "fox";
  const baseSpec = HOUSE_GAME_SPECS[defaultKey];
  const preset = GENRE_PRESETS[genre] || GENRE_PRESETS.runner;
  const vibeDef = VIBES[vibe] || VIBES.sunset;
  const pal = vibeDef.palette;

  const title = (opts.title || baseSpec?.title || preset.defaultTitle).toUpperCase();
  const by = (opts.by || baseSpec?.by || "PLAYER 1").toUpperCase();
  const cacheKey = `house:${genre}:${vibe}:${title}:${by}`;
  const existing = skinCache.get(cacheKey);
  if (existing) return existing;

  // If this matches the default vibe + title of the iconic house game, use its exact palette stops
  if (
    baseSpec &&
    baseSpec.vibe === vibe &&
    title === baseSpec.title &&
    by === baseSpec.by
  ) {
    return getMockGameSkin(defaultKey);
  }

  const sprites = getGenreSprites();
  const hero = sprites[genre] || sprites.runner;
  const [line1, line2] = splitSideTitleLines(title, 11);

  const mqCanvas = marqueeArt({
    title,
    bg: [C.dnavy, pal.bg, pal.fg, pal.accent1],
    grad: [pal.accent2, pal.accent1],
    outline: C.dbrown,
    shadow: pal.fg,
    hero,
    deco: pal.ui,
  });

  const sdCanvas = sideArt({
    bg: [C.dnavy, pal.bg, pal.fg, pal.accent1],
    sun: [50, 74, 24, 4],
    sunCols: [pal.accent2, pal.fg],
    hills: [
      [134, 7, pal.bg, pal.fg, 1.2],
      [152, 6, vibeDef.body, pal.accent1, 2.8],
    ],
    hero,
    heroScale: baseSpec?.side.heroScale || 4,
    title: [line1, line2 || undefined],
    stripes: [pal.accent2, pal.accent1, pal.fg],
    sub: `BY ${by.slice(0, 12)}`,
    deco: pal.ui,
  });

  const atCanvas = attractArt(genre, vibe, title);

  const bundle: HouseSkinBundle = {
    key: cacheKey,
    genre,
    vibe,
    title,
    by,
    marqueeCanvas: mqCanvas,
    sideCanvas: sdCanvas,
    attractCanvas: atCanvas,
    marqueeDataUrl: safeToDataUrl(mqCanvas),
    sideDataUrl: safeToDataUrl(sdCanvas),
    attractDataUrl: safeToDataUrl(atCanvas),
    trim: vibeDef.trim,
    body: vibeDef.body,
    btn: pal.accent1,
  };
  skinCache.set(cacheKey, bundle);
  return bundle;
}

/**
 * Returns the house skin bundle tailored to a GameDesignCard.
 */
export function getHouseSkinForCard(card: GameDesignCard): HouseSkinBundle {
  return getHouseSkin(card.genre, card.vibe, {
    title: card.title,
    by: card.player_name,
  });
}

/**
 * Pre-warms all 24 house skins (6 genres × 4 vibes) + the 6 iconic house games incrementally
 * across idle slices so it never blocks the main thread on initial page load.
 */
export function prewarmAllHouseSkins(): HouseSkinBundle[] {
  const results: HouseSkinBundle[] = [];
  const tasks: Array<() => void> = [];
  for (const key of Object.keys(HOUSE_GAME_SPECS) as HouseGameKey[]) {
    tasks.push(() => {
      results.push(getMockGameSkin(key));
    });
  }
  for (const genre of GENRE_LIST) {
    for (const vibe of VIBE_LIST) {
      tasks.push(() => {
        results.push(getHouseSkin(genre, vibe));
      });
    }
  }
  const runNext = () => {
    const fn = tasks.shift();
    if (!fn) return;
    fn();
    if (tasks.length > 0) {
      setTimeout(runNext, 24);
    }
  };
  setTimeout(runNext, 120);
  return results;
}
