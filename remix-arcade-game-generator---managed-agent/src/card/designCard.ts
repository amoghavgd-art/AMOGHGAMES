import Ajv from "ajv";
import { CARD_JSON_SCHEMA, type GameDesignCard, type RawGameDesignCard } from "./schema";
import { FLASH_CARD_SYSTEM_PROMPT } from "./prompt";
import { GENRE_PRESETS, GENRE_LIST, type GenreName } from "./presets";
import { VIBES, VIBE_LIST, type VibeName } from "./vibes";
import { flash } from "../gemini";

const ajv = new Ajv({ allErrors: true, strict: false });
const validateRawCard = ajv.compile(CARD_JSON_SCHEMA);

export interface CreateAnswers {
  name: string;
  genre: GenreName;
  hero: string;
  vibe: VibeName;
}

const TRAILING_STOPWORDS = new Set([
  "A",
  "AN",
  "THE",
  "MY",
  "YOUR",
  "OUR",
  "IN",
  "ON",
  "WITH",
  "OF",
  "AND",
  "OR",
  "BY",
  "FOR",
  "TO",
  "AT",
  "FROM",
  "INTO",
  "AS",
  "BUT",
  "IS",
  "WEARING",
  "HOLDING",
  "RIDING",
  "CHASING",
  "FIGHTING",
  "CARRYING",
  "UNDER",
  "OVER",
  "NEAR",
  "WITHOUT",
  "THROUGH",
  "AROUND",
  "BEHIND",
  "INSIDE",
  "LIKE",
  "WHO",
  "THAT",
  "HIS",
  "HER",
  "ITS",
  "THEIR",
]);

/**
 * Remove dangling trailing prepositions/articles/conjunctions left behind after word-boundary truncation
 * (e.g. so "KIWI IN GUMBOOTS" never truncates to "KIWI IN").
 */
export function stripTrailingStopwords(str: string): string {
  const words = str.trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && TRAILING_STOPWORDS.has(words[words.length - 1].toUpperCase())) {
    words.pop();
  }
  return words.join(" ");
}

/**
 * Truncate string to maxLen on a word boundary where possible (per 03-design-card-and-art.md).
 */
export function truncateStr(str: unknown, maxLen: number): string {
  if (typeof str !== "string") return "";
  const s = str.trim();
  if (s.length <= maxLen) return s;
  const sub = s.slice(0, maxLen);
  const lastSpace = sub.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxLen * 0.5)) {
    return sub.slice(0, lastSpace).trim();
  }
  return sub.trim();
}

export function deriveTitleFromHero(rawHero: string, defaultTitle: string): string {
  const heroWords = (rawHero || "")
    .trim()
    .replace(/^(a|an|the|my|your|our)\s+/i, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  if (heroWords.length === 0) return defaultTitle;

  const suffix = defaultTitle.split(/\s+/).pop() || "RUN";
  if (heroWords.length === 1) {
    return truncateStr(`${heroWords[0].toUpperCase()} ${suffix}`, 18) || defaultTitle;
  }

  const fullUpper = heroWords.join(" ").toUpperCase();
  if (fullUpper.length <= 18) {
    return fullUpper;
  }

  const fitted = stripTrailingStopwords(truncateStr(fullUpper, 18));
  const fittedWords = fitted.split(/\s+/).filter(Boolean);
  const hasBrokenPrepositionalClause = fittedWords
    .slice(1)
    .some((w) => TRAILING_STOPWORDS.has(w.toUpperCase()));

  if (fittedWords.length >= 2 && !hasBrokenPrepositionalClause) {
    return fitted;
  }

  const first = heroWords[0].toUpperCase();
  const last = heroWords[heroWords.length - 1].toUpperCase();
  if (first !== last && `${first} ${last}`.length <= 18 && !TRAILING_STOPWORDS.has(last)) {
    return `${first} ${last}`;
  }

  return truncateStr(`${first} ${suffix}`, 18) || defaultTitle;
}

export function deriveShortHero(rawHero: string, defaultShort = "fox", maxLen = 14): string {
  const heroWords = (rawHero || "")
    .trim()
    .replace(/^(a|an|the|my|your|our)\s+/i, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  if (heroWords.length === 0) return defaultShort;

  const fullLower = heroWords.join(" ").toLowerCase();
  if (fullLower.length <= maxLen) {
    return fullLower;
  }

  const fitted = stripTrailingStopwords(truncateStr(fullLower, maxLen));
  const fittedWords = fitted.split(/\s+/).filter(Boolean);
  const hasBrokenPrepositionalClause = fittedWords
    .slice(1)
    .some((w) => TRAILING_STOPWORDS.has(w.toUpperCase()));

  if (fitted && fitted.length <= maxLen && !hasBrokenPrepositionalClause) {
    return fitted;
  }

  return truncateStr(heroWords[0].toLowerCase(), maxLen) || defaultShort;
}

/**
 * Truncate all string fields in a raw card to their schema limits before validation,
 * and report whether any field exceeded maxLength prior to truncation.
 */
export function sanitizeAndTruncateRawCard(
  raw: any,
  answers: CreateAnswers
): { truncated: RawGameDesignCard; hadOverflow: boolean } {
  let hadOverflow = false;
  const trunc = (val: unknown, max: number, fallback = ""): string => {
    const str = typeof val === "string" && val.trim() ? val.trim() : fallback;
    if (str.length > max) hadOverflow = true;
    return truncateStr(str, max);
  };

  const genre: GenreName = GENRE_LIST.includes(raw?.genre) ? raw.genre : answers.genre;
  const vibe: VibeName = VIBE_LIST.includes(raw?.vibe) ? raw.vibe : answers.vibe;
  const preset = GENRE_PRESETS[genre] || GENRE_PRESETS.runner;

  const rawEnemies = Array.isArray(raw?.enemies) && raw.enemies.length > 0
    ? raw.enemies.slice(0, 2)
    : preset.defaultEnemies || [preset.defaultEnemy];

  const enemies = rawEnemies.map((e: any, idx: number) => {
    const fallbackEnemy = preset.defaultEnemies?.[idx] || preset.defaultEnemy;
    return {
      description: trunc(e?.description, 60, fallbackEnemy.description),
      behaviour: trunc(e?.behaviour, 80, fallbackEnemy.behaviour),
    };
  });

  const rawMechanics = Array.isArray(raw?.mechanics)
    ? raw.mechanics.slice(0, 2).map((m: any) => trunc(m, 48, preset.defaultTwist)).filter(Boolean)
    : preset.defaultMechanics || [preset.defaultTwist];

  const safetyOk = typeof raw?.safety?.ok === "boolean" ? raw.safety.ok : true;
  const safety: RawGameDesignCard["safety"] = { ok: safetyOk };
  if (!safetyOk) {
    safety.field = raw?.safety?.field === "name" ? "name" : "hero";
    safety.nudge = trunc(
      raw?.safety?.nudge,
      80,
      "ooh, let's keep it arcade-friendly. try another hero?"
    );
  } else if (raw?.safety?.field === "name" || raw?.safety?.field === "hero") {
    safety.field = raw.safety.field;
    if (raw?.safety?.nudge) safety.nudge = trunc(raw.safety.nudge, 80);
  }

  const rawTitle = stripTrailingStopwords(
    trunc(raw?.title, 18, deriveTitleFromHero(answers.hero, preset.defaultTitle)).toUpperCase()
  );
  const cleanedRawShort =
    typeof raw?.hero?.short === "string"
      ? raw.hero.short.trim().replace(/^(a|an|the|my|your|our)\s+/i, "")
      : "";
  const rawShortHero = stripTrailingStopwords(
    trunc(cleanedRawShort, 14, deriveShortHero(answers.hero, preset.defaultHero.short, 14)).toLowerCase()
  );

  const truncated: RawGameDesignCard = {
    title: rawTitle || preset.defaultTitle,
    tagline: trunc(raw?.tagline, 40, preset.defaultTagline).toLowerCase(),
    player_name: trunc(raw?.player_name || answers.name || "player 1", 12, "player 1"),
    genre,
    vibe,
    hero: {
      description: trunc(raw?.hero?.description, 120, preset.defaultHero.description),
      short: rawShortHero || preset.defaultHero.short,
    },
    enemies,
    collectible: trunc(raw?.collectible, 20, preset.defaultCollectible),
    mechanics: rawMechanics.length > 0 ? rawMechanics : preset.defaultMechanics || [preset.defaultTwist],
    win_lose: trunc(raw?.win_lose, 80, preset.defaultWinLose),
    art: {
      scene: trunc(raw?.art?.scene, 80, preset.defaultArt.scene),
      hero_pose: trunc(raw?.art?.hero_pose, 60, preset.defaultArt.hero_pose),
    },
    safety,
  };

  return { truncated, hadOverflow };
}

export function enrichCard(raw: RawGameDesignCard, seed?: number): GameDesignCard {
  const vibeDef = VIBES[raw.vibe] || VIBES.sunset;
  const actualSeed = seed ?? (Math.floor(Math.random() * 90000) + 10000);
  const id = `c_${Math.random().toString(36).slice(2, 6)}`;
  return {
    ...raw,
    palette: { ...vibeDef.palette },
    engine_palette: { ...vibeDef.engine_palette },
    id,
    seed: actualSeed,
    created_at: new Date().toISOString(),
  };
}

export function buildPresetCard(answers: CreateAnswers): GameDesignCard {
  const genre = GENRE_LIST.includes(answers.genre) ? answers.genre : "runner";
  const vibe = VIBE_LIST.includes(answers.vibe) ? answers.vibe : "sunset";
  const preset = GENRE_PRESETS[genre];
  const cleanHero = (answers.hero || "").trim();
  const titleFromHero = deriveTitleFromHero(cleanHero, preset.defaultTitle);
  const shortHero = deriveShortHero(cleanHero, preset.defaultHero.short, 14);

  const customHeroPose = cleanHero
    ? stripTrailingStopwords(truncateStr(`${cleanHero} in a heroic retro arcade action pose`, 60)) ||
      preset.defaultArt.hero_pose
    : preset.defaultArt.hero_pose;

  const raw: RawGameDesignCard = {
    title: titleFromHero || preset.defaultTitle,
    tagline: preset.defaultTagline,
    player_name: truncateStr((answers.name || "").trim() || "player 1", 12),
    genre,
    vibe,
    hero: {
      description: truncateStr(cleanHero || preset.defaultHero.description, 100),
      short: shortHero,
    },
    enemies: [...(preset.defaultEnemies || [preset.defaultEnemy])],
    collectible: preset.defaultCollectible,
    mechanics: [...(preset.defaultMechanics || [preset.defaultTwist])],
    win_lose: preset.defaultWinLose,
    art: {
      scene: preset.defaultArt.scene,
      hero_pose: customHeroPose,
    },
    safety: { ok: true },
  };
  return enrichCard(raw);
}

export function validateCardObject(card: unknown): { valid: boolean; errors: string[] } {
  const valid = Boolean(validateRawCard(card));
  const errors = (validateRawCard.errors || []).map(
    (e) => `${e.instancePath || "/"} ${e.message || "invalid"}`
  );
  return { valid, errors };
}

/**
 * Generate a GameDesignCard from visitor answers via Gemini Flash, with truncation,
 * ajv validation, 1 retry on validation failure, and genre preset fallback.
 */
export async function generateDesignCard(
  answers: CreateAnswers,
  opts: { timeoutMs?: number } = {}
): Promise<{
  card: GameDesignCard;
  latencyMs: number;
  maxLengthRespected: boolean;
  fallbackUsed: boolean;
  model: string;
}> {
  const normalized: CreateAnswers = {
    name: (answers.name || "").trim() || "player 1",
    genre: GENRE_LIST.includes(answers.genre) ? answers.genre : "runner",
    hero: (answers.hero || "").trim(),
    vibe: VIBE_LIST.includes(answers.vibe) ? answers.vibe : "sunset",
  };

  const t0 = performance.now();
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const promptPayload =
        attempt === 0
          ? JSON.stringify(normalized)
          : `${JSON.stringify(normalized)}\n\nPrevious output failed schema validation: ${lastErrors.join("; ")}. Fix and return valid JSON.`;

      const res = await flash<RawGameDesignCard>(promptPayload, {
        systemInstruction: FLASH_CARD_SYSTEM_PROMPT,
        responseJsonSchema: CARD_JSON_SCHEMA,
        timeoutMs: opts.timeoutMs ?? 10000,
      });

      const { truncated, hadOverflow } = sanitizeAndTruncateRawCard(res.data, normalized);
      const check = validateCardObject(truncated);
      if (check.valid) {
        return {
          card: enrichCard(truncated),
          latencyMs: attempt === 0 ? res.latencyMs : Math.round(performance.now() - t0),
          maxLengthRespected: !hadOverflow,
          fallbackUsed: false,
          model: res.model,
        };
      }
      lastErrors = check.errors;
    } catch (err: unknown) {
      lastErrors = [err instanceof Error ? err.message : String(err)];
    }
  }

  return {
    card: buildPresetCard(normalized),
    latencyMs: Math.round(performance.now() - t0),
    maxLengthRespected: true,
    fallbackUsed: true,
    model: "preset-fallback",
  };
}

export {
  CARD_JSON_SCHEMA,
  FLASH_CARD_SYSTEM_PROMPT,
  GENRE_LIST,
  GENRE_PRESETS,
  VIBES,
  VIBE_LIST,
  type GameDesignCard,
  type GenreName,
  type RawGameDesignCard,
  type VibeName,
};
