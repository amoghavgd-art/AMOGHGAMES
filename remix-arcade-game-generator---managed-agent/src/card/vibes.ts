export type VibeName = "sunset" | "mint" | "cosmic" | "candy";

export interface VibePaletteHex {
  bg: string;
  fg: string;
  accent1: string;
  accent2: string;
  ui: string;
}

export interface VibePaletteIndices {
  bg: number;
  fg: number;
  accent1: number;
  accent2: number;
  ui: number;
}

export interface VibeDef {
  name: VibeName;
  feel: string;
  vibeDesc: string;
  trim: string;
  body: string;
  palette: VibePaletteHex;
  engine_palette: VibePaletteIndices;
  swatches: [string, string, string, string];
}

// 32-colour PICO-8 + secret palette (exact order from mocks/playglow/NOTES.md)
export const PALETTE_32: readonly string[] = [
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

export const VIBES: Record<VibeName, VibeDef> = {
  sunset: {
    name: "sunset",
    feel: "warm, golden-hour",
    vibeDesc: "warm golden-hour dusk",
    trim: "#FFA300",
    body: "#422136",
    palette: {
      bg: "#7E2553",
      fg: "#FF6C24",
      accent1: "#FFA300",
      accent2: "#FFEC27",
      ui: "#FFF1E8",
    },
    engine_palette: {
      bg: 2,
      fg: 25,
      accent1: 9,
      accent2: 10,
      ui: 7,
    },
    swatches: ["#7E2553", "#FF6C24", "#FFA300", "#FFEC27"],
  },
  mint: {
    name: "mint",
    feel: "fresh, garden, calm",
    vibeDesc: "fresh minty garden",
    trim: "#00E436",
    body: "#125359",
    palette: {
      bg: "#125359",
      fg: "#00B543",
      accent1: "#00E436",
      accent2: "#FFCCAA",
      ui: "#FFF1E8",
    },
    engine_palette: {
      bg: 19,
      fg: 27,
      accent1: 11,
      accent2: 15,
      ui: 7,
    },
    swatches: ["#125359", "#00B543", "#00E436", "#FFCCAA"],
  },
  cosmic: {
    name: "cosmic",
    feel: "night sky, space",
    vibeDesc: "deep starry night",
    trim: "#29ADFF",
    body: "#111D35",
    palette: {
      bg: "#111D35",
      fg: "#065AB5",
      accent1: "#29ADFF",
      accent2: "#FF77A8",
      ui: "#FFF1E8",
    },
    engine_palette: {
      bg: 17,
      fg: 28,
      accent1: 12,
      accent2: 14,
      ui: 7,
    },
    swatches: ["#111D35", "#065AB5", "#29ADFF", "#FF77A8"],
  },
  candy: {
    name: "candy",
    feel: "sweet, bubbly",
    vibeDesc: "sweet candy-pink",
    trim: "#FF77A8",
    body: "#422136",
    palette: {
      bg: "#422136",
      fg: "#FF77A8",
      accent1: "#FFCCAA",
      accent2: "#FFEC27",
      ui: "#FFF1E8",
    },
    engine_palette: {
      bg: 18,
      fg: 14,
      accent1: 15,
      accent2: 10,
      ui: 7,
    },
    swatches: ["#422136", "#FF77A8", "#FFCCAA", "#FFEC27"],
  },
};

export const VIBE_LIST: VibeName[] = ["sunset", "mint", "cosmic", "candy"];
