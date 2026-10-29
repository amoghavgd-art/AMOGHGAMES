import { get as idbGet, set as idbSet } from "idb-keyval";
import type { GameDesignCard } from "../card/schema";
import { buildPresetCard } from "../card/designCard";
import type { GenreName } from "../card/presets";
import type { VibeName } from "../card/vibes";
import { CONFIG } from "../config";
import { loadHouseGameSource } from "../build/buildSession";
import {
  HOUSE_GAME_SPECS,
  getMockGameSkin,
  type HouseGameKey,
} from "../skin/houseSkins";

const IDB_OWN_GAMES_KEY = "playglow:own-games";
const IDB_BEST_SCORES_KEY = "playglow:best-scores";
const IDB_CART_SAVES_KEY = "playglow:cart-saves";
const LS_TELEMETRY_KEY = "playglow:telemetry";
const LS_BEST_SCORES_KEY = "playglow:best-scores";
const SS_RUNS_KEY = "playglow:runs";
const SS_STATE_KEY = "playglow:state";

export interface StoredSkinArt {
  marqueeUrl?: string;
  sideUrl?: string;
  attractUrl?: string;
  trimColor?: string;
  bodyColor?: string;
}

export interface LibraryGameItem {
  id: string;
  title: string;
  by: string;
  genre: GenreName;
  vibe: VibeName;
  card: GameDesignCard;
  source: string;
  skin: StoredSkinArt;
  bestScore: number;
  isHouse: boolean;
  houseKey?: HouseGameKey;
  createdAt: number;
}

export interface TelemetryRecord {
  run_id: string;
  genre: GenreName;
  vibe: VibeName;
  card_ms: number;
  images_ms: number[];
  agent_ms: number;
  agent_status: "ready" | "fallback" | "demo" | "offline" | "error" | "cancelled";
  tokens: number;
  playtest_pass: boolean;
  fallback_used: boolean;
  cart_errors: number;
  timestamp: string;
}

export interface PersistedAppState {
  state: "create" | "build" | "play" | "switch";
  createStep?: "name" | "genre" | "hero" | "vibe" | "ready";
  answers: {
    name: string;
    genre: GenreName;
    hero: string;
    vibe: VibeName;
  };
  card?: GameDesignCard | null;
  interactionId?: string | null;
  environmentId?: string | null;
  activeGameId?: string | null;
  updatedAt: number;
}

const HOUSE_ORDER: HouseGameKey[] = [
  "fox",
  "comet",
  "moth",
  "cake",
  "slime",
  "dodger",
];

let memoryOwnGames: LibraryGameItem[] = [];
let memoryBestScores: Record<string, number> = {};
let memoryCartSaves: Record<string, Record<string, number>> = {};
let houseGamesCache: LibraryGameItem[] | null = null;

async function safeIdbGet<T>(key: string, fallback: T): Promise<T> {
  if (typeof indexedDB === "undefined") return fallback;
  try {
    const val = await idbGet<T>(key);
    return val !== undefined ? val : fallback;
  } catch {
    return fallback;
  }
}

async function safeIdbSet<T>(key: string, val: T): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await idbSet(key, val);
  } catch {
    // ignore storage quota / private mode errors
  }
}

function readLocalBestScores(): Record<string, number> {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(LS_BEST_SCORES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    }
  } catch {
    // ignore
  }
  return {};
}

function writeLocalBestScores(scores: Record<string, number>): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_BEST_SCORES_KEY, JSON.stringify(scores));
    }
  } catch {
    // ignore
  }
}

/**
 * Builds the 6 canonical house games (`FOXFIRE RUN`, `COMET POP`, `MOTH MAZE`,
 * `BRICK BAKERY`, `SLIME HOP`, `SKY DODGER`) with their skins and preloaded sources.
 */
export async function getHouseGames(): Promise<LibraryGameItem[]> {
  if (houseGamesCache) {
    const scores = { ...readLocalBestScores(), ...memoryBestScores };
    return houseGamesCache.map((g) => ({
      ...g,
      bestScore: Math.max(g.bestScore, scores[g.id] || 0),
    }));
  }

  const scores = { ...readLocalBestScores(), ...memoryBestScores };
  const items: LibraryGameItem[] = await Promise.all(
    HOUSE_ORDER.map(async (key, idx) => {
      const spec = HOUSE_GAME_SPECS[key];
      const skinBundle = getMockGameSkin(key);
      const source = await loadHouseGameSource(spec.genre);
      const baseCard = buildPresetCard({
        name: spec.by.toLowerCase(),
        genre: spec.genre,
        hero: "",
        vibe: spec.vibe,
      });
      const card: GameDesignCard = {
        ...baseCard,
        id: `house_${key}`,
        title: spec.title,
        player_name: spec.by.toLowerCase(),
        genre: spec.genre,
        vibe: spec.vibe,
      };
      const id = `house_${key}`;
      return {
        id,
        title: spec.title,
        by: spec.by,
        genre: spec.genre,
        vibe: spec.vibe,
        card,
        source,
        skin: {
          marqueeUrl: skinBundle.marqueeDataUrl,
          sideUrl: skinBundle.sideDataUrl,
          attractUrl: skinBundle.attractDataUrl,
          trimColor: skinBundle.trim,
          bodyColor: skinBundle.body,
        },
        bestScore: scores[id] || 0,
        isHouse: true,
        houseKey: key,
        createdAt: 1700000000000 - idx * 1000,
      };
    })
  );

  houseGamesCache = items;
  return items;
}

/**
 * Loads all visitor-created games from IndexedDB (newest first) followed by the 6 house games.
 */
export async function loadGameLibrary(): Promise<LibraryGameItem[]> {
  const [storedOwn, storedScores, house] = await Promise.all([
    safeIdbGet<LibraryGameItem[]>(IDB_OWN_GAMES_KEY, memoryOwnGames),
    safeIdbGet<Record<string, number>>(IDB_BEST_SCORES_KEY, readLocalBestScores()),
    getHouseGames(),
  ]);

  memoryOwnGames = Array.isArray(storedOwn) ? storedOwn : [];
  memoryBestScores = { ...readLocalBestScores(), ...(storedScores || {}) };

  const ownWithScores = memoryOwnGames.map((g) => ({
    ...g,
    bestScore: Math.max(g.bestScore || 0, memoryBestScores[g.id] || 0),
  }));
  const houseWithScores = house.map((g) => ({
    ...g,
    bestScore: Math.max(g.bestScore || 0, memoryBestScores[g.id] || 0),
  }));

  return [...ownWithScores, ...houseWithScores];
}

/**
 * Saves a newly built visitor game (card + source + skin URLs) to IndexedDB (`playglow:own-games`).
 * Keeps up to 20 visitor games in IndexedDB so storage stays fast.
 */
export async function saveVisitorGame(params: {
  card: GameDesignCard;
  source: string;
  skin: StoredSkinArt;
}): Promise<LibraryGameItem> {
  const { card, source, skin } = params;
  const existing = await safeIdbGet<LibraryGameItem[]>(
    IDB_OWN_GAMES_KEY,
    memoryOwnGames
  );
  const list = Array.isArray(existing) ? [...existing] : [];
  const bestScore = memoryBestScores[card.id] || 0;

  const item: LibraryGameItem = {
    id: card.id || `c_${Date.now().toString(36)}`,
    title: (card.title || "MY GAME").toUpperCase(),
    by: (card.player_name || "PLAYER 1").toUpperCase(),
    genre: card.genre,
    vibe: card.vibe,
    card,
    source,
    skin,
    bestScore,
    isHouse: false,
    createdAt: Date.now(),
  };

  const filtered = list.filter((g) => g.id !== item.id);
  const updated = [item, ...filtered].slice(0, 20);
  memoryOwnGames = updated;
  await safeIdbSet(IDB_OWN_GAMES_KEY, updated);
  return item;
}

/**
 * Updates and persists the visitor's best score for a game ID in IndexedDB and localStorage.
 */
export async function updateBestScore(
  gameId: string,
  score: number
): Promise<number> {
  const cleanScore = Math.max(0, Math.floor(score || 0));
  const current = memoryBestScores[gameId] ?? readLocalBestScores()[gameId] ?? 0;
  const best = Math.max(current, cleanScore);
  memoryBestScores[gameId] = best;
  writeLocalBestScores(memoryBestScores);
  await safeIdbSet(IDB_BEST_SCORES_KEY, memoryBestScores);

  // Also update inside memoryOwnGames if present
  const idx = memoryOwnGames.findIndex((g) => g.id === gameId);
  if (idx >= 0 && memoryOwnGames[idx].bestScore < best) {
    memoryOwnGames[idx] = { ...memoryOwnGames[idx], bestScore: best };
    await safeIdbSet(IDB_OWN_GAMES_KEY, memoryOwnGames);
  }
  return best;
}

export function getBestScoreSync(gameId: string): number {
  return memoryBestScores[gameId] ?? readLocalBestScores()[gameId] ?? 0;
}

/**
 * Persists a cartridge `engine.save.set(key, val)` slot in IndexedDB.
 */
export async function saveCartSlot(
  gameId: string,
  key: string,
  value: number
): Promise<void> {
  const all = await safeIdbGet<Record<string, Record<string, number>>>(
    IDB_CART_SAVES_KEY,
    memoryCartSaves
  );
  const gameMap = { ...(all[gameId] || {}), [key]: value };
  memoryCartSaves = { ...all, [gameId]: gameMap };
  await safeIdbSet(IDB_CART_SAVES_KEY, memoryCartSaves);
}

export async function getCartSlots(
  gameId: string
): Promise<Record<string, number>> {
  const all = await safeIdbGet<Record<string, Record<string, number>>>(
    IDB_CART_SAVES_KEY,
    memoryCartSaves
  );
  memoryCartSaves = all || {};
  return memoryCartSaves[gameId] || {};
}

/**
 * Session run counter in `sessionStorage['playglow:runs']`.
 */
export function getSessionRunCount(): number {
  try {
    if (typeof sessionStorage !== "undefined") {
      return parseInt(sessionStorage.getItem(SS_RUNS_KEY) || "0", 10) || 0;
    }
  } catch {
    // ignore
  }
  return 0;
}

export function incrementSessionRunCount(): number {
  const next = getSessionRunCount() + 1;
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(SS_RUNS_KEY, String(next));
    }
  } catch {
    // ignore
  }
  return next;
}

export function isSessionRunCapReached(): boolean {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.has("admin")) return false;
  }
  return getSessionRunCount() >= (CONFIG.RUNS_PER_SESSION ?? 3);
}

/**
 * Session state persistence in `sessionStorage['playglow:state']` for refresh recovery.
 */
export function saveSessionState(state: PersistedAppState): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(SS_STATE_KEY, JSON.stringify(state));
    }
  } catch {
    // ignore
  }
}

export function loadSessionState(): PersistedAppState | null {
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(SS_STATE_KEY);
      if (raw) {
        return JSON.parse(raw) as PersistedAppState;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Logs a telemetry JSON line to `console.info` and stores the last 50 records in
 * `localStorage['playglow:telemetry']` (per brief/04-app-spec.md §Telemetry).
 */
export function recordTelemetry(entry: TelemetryRecord): void {
  try {
    console.info(JSON.stringify(entry));
  } catch {
    // ignore
  }

  try {
    if (typeof localStorage !== "undefined") {
      const existing = getTelemetryRecords();
      const updated = [entry, ...existing.filter((e) => e.run_id !== entry.run_id)].slice(
        0,
        50
      );
      localStorage.setItem(LS_TELEMETRY_KEY, JSON.stringify(updated));
    }
  } catch {
    // ignore
  }
}

export function getTelemetryRecords(): TelemetryRecord[] {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(LS_TELEMETRY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    }
  } catch {
    // ignore
  }
  return [];
}
