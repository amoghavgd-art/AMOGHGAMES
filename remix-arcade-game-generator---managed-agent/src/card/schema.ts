import type { GenreName } from "./presets";
import type { VibeName, VibePaletteHex, VibePaletteIndices } from "./vibes";

export interface RawGameDesignCard {
  title: string;
  tagline: string;
  player_name: string;
  genre: GenreName;
  vibe: VibeName;
  hero: {
    description: string;
    short: string;
  };
  enemies: Array<{
    description: string;
    behaviour: string;
  }>;
  collectible: string;
  mechanics: string[];
  win_lose: string;
  art: {
    scene: string;
    hero_pose: string;
  };
  safety: {
    ok: boolean;
    field?: "name" | "hero";
    nudge?: string;
  };
}

export interface GameDesignCard extends RawGameDesignCard {
  palette: VibePaletteHex;
  engine_palette: VibePaletteIndices;
  id: string;
  seed: number;
  created_at?: string;
}

export const CARD_JSON_SCHEMA = {
  type: "object",
  required: [
    "title",
    "tagline",
    "player_name",
    "genre",
    "vibe",
    "hero",
    "enemies",
    "collectible",
    "mechanics",
    "win_lose",
    "art",
    "safety",
  ],
  properties: {
    title: {
      type: "string",
      maxLength: 18,
      description: "Arcade title, 1-3 words, ALL CAPS, fun, from the hero",
    },
    tagline: {
      type: "string",
      maxLength: 40,
    },
    player_name: {
      type: "string",
      maxLength: 12,
    },
    genre: {
      type: "string",
      enum: ["runner", "shooter", "maze", "breakout", "platformer", "dodger"],
    },
    vibe: {
      type: "string",
      enum: ["sunset", "mint", "cosmic", "candy"],
    },
    hero: {
      type: "object",
      required: ["description", "short"],
      properties: {
        description: {
          type: "string",
          maxLength: 120,
          description: "visual description for sprites and art",
        },
        short: {
          type: "string",
          maxLength: 14,
          description: "1-2 words for UI copy, e.g. 'fox'",
        },
      },
    },
    enemies: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        required: ["description", "behaviour"],
        properties: {
          description: { type: "string", maxLength: 60 },
          behaviour: { type: "string", maxLength: 80 },
        },
      },
    },
    collectible: {
      type: "string",
      maxLength: 20,
    },
    mechanics: {
      type: "array",
      maxItems: 2,
      items: {
        type: "string",
        maxLength: 48,
      },
    },
    win_lose: {
      type: "string",
      maxLength: 80,
    },
    art: {
      type: "object",
      required: ["scene", "hero_pose"],
      properties: {
        scene: {
          type: "string",
          maxLength: 80,
          description: "background setting for the art",
        },
        hero_pose: {
          type: "string",
          maxLength: 60,
        },
      },
    },
    safety: {
      type: "object",
      required: ["ok"],
      properties: {
        ok: { type: "boolean" },
        field: { type: "string", enum: ["name", "hero"] },
        nudge: { type: "string", maxLength: 80 },
      },
    },
  },
} as const;
