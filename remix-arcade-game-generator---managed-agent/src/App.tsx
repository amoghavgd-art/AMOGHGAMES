import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles/playglow.css";
import { SelfTest } from "./selftest/SelfTest";
import { ArcadeStage } from "./stage/ArcadeStage";
import type { BuildStageName } from "./stage/attract";
import { CartHost, type CartInputState } from "./cart/CartHost";
import { humController } from "./audio/hum";
import { CONFIG } from "./config";
import {
  generateDesignCard,
  buildPresetCard,
  deriveShortHero,
  type CreateAnswers,
} from "./card/designCard";
import { GENRE_LIST, type GenreName } from "./card/presets";
import { VIBES, VIBE_LIST, type VibeName } from "./card/vibes";
import type { GameDesignCard } from "./card/schema";
import {
  BuildSession,
  loadHouseGameSource,
  type BuildSnapshot,
} from "./build/buildSession";
import { runSkinSession, type SkinImageKind } from "./build/skinSession";
import {
  loadGameLibrary,
  saveVisitorGame,
  updateBestScore,
  getBestScoreSync,
  saveCartSlot,
  getCartSlots,
  incrementSessionRunCount,
  isSessionRunCapReached,
  saveSessionState,
  loadSessionState,
  recordTelemetry,
  getTelemetryRecords,
  type LibraryGameItem,
  type TelemetryRecord,
} from "./store/games";
import {
  getHouseSkinForCard,
  prewarmAllHouseSkins,
} from "./skin/houseSkins";
import { shareTradingCard } from "./share/shareCard";
import type { DayNightState } from "./stage/windowScenery";

export type AppMode = "create" | "build" | "play" | "switch";
export type CreateStep = "name" | "genre" | "hero" | "vibe" | "ready";

const HERO_PLACEHOLDERS: readonly string[] = [
  "a fox in a tiny scarf",
  "your boss, but a pigeon",
  "a sandwich with dreams",
  "grandma in a jetpack",
];

const STAGE_CAPTIONS: Record<BuildStageName, readonly string[]> = {
  designing: [
    "sketching your {hero}…",
    "naming things. naming is hard.",
  ],
  coding: [
    "teaching your {hero} to move.",
    "writing the rules. no cheating.",
    "adding bad guys. sorry.",
  ],
  playtesting: [
    "playtesting. your {hero} died twice. fixing.",
    "making it fair-ish.",
  ],
  testing: [
    "playtesting. your {hero} died twice. fixing.",
    "making it fair-ish.",
  ],
  finishing: ["polishing the pixels."],
  painting: ["painting the sides now."],
  ready: ["it's alive. go go go."],
};

const LATE_BUILD_CAPTIONS: readonly string[] = [
  "taking its time. good games do.",
  "almost. probably. definitely almost.",
];

function fillHeroSlot(template: string, card?: GameDesignCard | null, rawHero?: string): string {
  const shortHero =
    card?.hero?.short ||
    deriveShortHero(rawHero || "", "fox", 18);
  return template.replace(/\{hero\}/g, shortHero);
}

function getInitialUrlState(): {
  mode: AppMode;
  createStep: CreateStep;
  explicitStateParam: boolean;
} {
  if (typeof window === "undefined") {
    return {
      mode: "create",
      createStep: "name",
      explicitStateParam: false,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const rawState = params.get("state");
  const rawQ = params.get("q");
  const explicitStateParam = params.has("state");

  const mode: AppMode =
    rawState === "build" || rawState === "play" || rawState === "switch" || rawState === "create"
      ? rawState
      : "create";

  let createStep: CreateStep = "name";
  if (rawQ === "name" || rawQ === "1") createStep = "name";
  else if (rawQ === "genre" || rawQ === "2") createStep = "genre";
  else if (rawQ === "hero" || rawQ === "3") createStep = "hero";
  else if (rawQ === "vibe" || rawQ === "4") createStep = "vibe";
  else if (rawQ === "ready" || rawQ === "5") createStep = "ready";
  else if (rawState === "create" && !rawQ) {
    // Match mocks/playglow/index.html?state=create which defaults to the hero step
    createStep = "hero";
  }

  return { mode, createStep, explicitStateParam };
}

function applyCartKeyInput(
  input: CartInputState,
  lowerKey: string,
  pressed: boolean
): boolean {
  if (lowerKey === "arrowleft" || lowerKey === "a") {
    input.left = pressed;
    return true;
  }
  if (lowerKey === "arrowright" || lowerKey === "d") {
    input.right = pressed;
    return true;
  }
  if (lowerKey === "arrowup" || lowerKey === "w") {
    input.up = pressed;
    return true;
  }
  if (lowerKey === "arrowdown" || lowerKey === "s") {
    input.down = pressed;
    return true;
  }
  if (lowerKey === "z" || lowerKey === "j" || lowerKey === " ") {
    input.a = pressed;
    return true;
  }
  if (lowerKey === "x" || lowerKey === "k") {
    input.b = pressed;
    return true;
  }
  if (lowerKey === "enter") {
    input.start = pressed;
    return true;
  }
  return false;
}

class ArcadeErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.warn("[playglow] recovered from UI error:", error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div id="ui" data-state="create">
          <div className="wordmark">
            <i />
            AMOGH GAMES
          </div>
          <div className="host">
            <div className="step">oops</div>
            <div className="say">
              that one got away from us. try a house game while we reset?
            </div>
            <div className="row">
              <button
                type="button"
                className="pill primary"
                onClick={() => {
                  this.setState({ hasError: false });
                  window.location.href = "/";
                }}
              >
                reboot cabinet &rarr;
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const App: React.FC = () => {
  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();

  if (params.has("selftest")) {
    return <SelfTest />;
  }

  return (
    <ArcadeErrorBoundary>
      <PlayglowArcade />
    </ArcadeErrorBoundary>
  );
};

const PlayglowArcade: React.FC = () => {
  const initialUrl = useRef(getInitialUrlState());
  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const isUvTest = params.has("uvtest");
  const isBench = params.has("bench");
  const isDebug = params.has("debug");

  const [appState, setAppState] = useState<AppMode>(initialUrl.current.mode);
  const appStateRef = useRef<AppMode>(appState);
  appStateRef.current = appState;
  const [createStep, setCreateStep] = useState<CreateStep>(
    initialUrl.current.createStep
  );

  // Visitor Create answers
  const [name, setName] = useState<string>(() =>
    initialUrl.current.explicitStateParam &&
    initialUrl.current.createStep === "hero"
      ? "james"
      : ""
  );
  const [genre, setGenre] = useState<GenreName>("runner");
  const [hero, setHero] = useState<string>(() =>
    initialUrl.current.explicitStateParam &&
    initialUrl.current.createStep === "hero"
      ? "a fox in a tiny blue scarf"
      : ""
  );
  const [vibe, setVibe] = useState<VibeName>("sunset");
  const [hoverVibe, setHoverVibe] = useState<VibeName | null>(null);

  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [safetyNudge, setSafetyNudge] = useState<string | null>(null);
  const [designCard, setDesignCard] = useState<GameDesignCard | null>(null);
  const [cardLatencyMs, setCardLatencyMs] = useState<number>(0);
  const [isGeneratingCard, setIsGeneratingCard] = useState(false);
  const [isStartingBuild, setIsStartingBuild] = useState<boolean>(false);

  // Build state
  const [buildPct, setBuildPct] = useState<number>(() =>
    initialUrl.current.mode === "build" ? 85 : 6
  );
  const [buildStage, setBuildStage] = useState<BuildStageName>(() =>
    initialUrl.current.mode === "build" ? "playtesting" : "designing"
  );
  const [buildCaption, setBuildCaption] = useState<string>(() =>
    initialUrl.current.mode === "build"
      ? "your fox just learned to double\u2011jump. painting the sides now."
      : "sketching your fox…"
  );
  const [interjectionCaption, setInterjectionCaption] = useState<string | null>(
    null
  );
  const [fallbackToast, setFallbackToast] = useState<string | null>(null);
  const [playingWhileBuilding, setPlayingWhileBuilding] =
    useState<boolean>(false);
  const playingWhileBuildingRef = useRef<boolean>(false);
  playingWhileBuildingRef.current = playingWhileBuilding;
  const [stageReady, setStageReady] = useState<boolean>(() =>
    Boolean(
      initialUrl.current.explicitStateParam || isUvTest || isBench
    )
  );

  // Library, Play & Switch state
  const [library, setLibrary] = useState<LibraryGameItem[]>([]);
  const [activeGameIdx, setActiveGameIdx] = useState<number>(0);
  const [switchTargetIdx, setSwitchTargetIdx] = useState<number>(1);
  const [switchDir, setSwitchDir] = useState<1 | -1>(1);
  const [controlsIdle, setControlsIdle] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(() => humController.isMuted());
  const [dayNight, setDayNight] = useState<DayNightState>({
    timeHours: 17.5,
    cycleProgress: 17.5 / 24,
    phase: "sunset",
    phaseLabel: "Golden Hour",
    phaseIcon: "🌇",
    isAutoCycle: true,
  });
  const [benchDone, setBenchDone] = useState<boolean>(false);
  const [telemetryLog, setTelemetryLog] = useState<TelemetryRecord[]>(() =>
    getTelemetryRecords()
  );

  // Refs for imperative 3D stage, cart iframe, and input loop
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<ArcadeStage | null>(null);
  const cartRef = useRef<CartHost | null>(null);
  const buildSessionRef = useRef<BuildSession | null>(null);
  const skinAbortRef = useRef<AbortController | null>(null);
  const cardPromiseRef = useRef<Promise<GameDesignCard | null> | null>(null);
  const cardAnswersKeyRef = useRef<string>("");
  const isStartingBuildRef = useRef<boolean>(false);
  const buildRunIdRef = useRef<number>(0);
  const isSwitchingRef = useRef<boolean>(false);
  const cartPausedRef = useRef<boolean>(false);
  const activeSkinArtRef = useRef<{
    bannerUrl?: string;
    sideUrl?: string;
    attractUrl?: string;
  }>({});
  const keyStateRef = useRef<CartInputState>({
    left: false,
    right: false,
    up: false,
    down: false,
    a: false,
    b: false,
    start: false,
  });
  const touchStateRef = useRef<CartInputState>({
    left: false,
    right: false,
    up: false,
    down: false,
    a: false,
    b: false,
    start: false,
  });
  const syntheticStartUntilRef = useRef<number>(0);
  const cartErrorsRef = useRef<number>(0);
  const cartBootedRef = useRef<boolean>(false);
  const userInteractedRef = useRef<boolean>(false);
  const touchSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const activeGameRef = useRef<LibraryGameItem | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const heroInputRef = useRef<HTMLInputElement | null>(null);
  const lastTypeTickRef = useRef<number>(0);
  const interjectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const idleMouseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevGamepadButtonsRef = useRef<boolean[]>([false, false]);

  const activeGame = library[activeGameIdx] || null;
  activeGameRef.current = activeGame;
  const switchTargetGame =
    library[switchTargetIdx] || library[0] || activeGame || null;

  // Reset held keys/touch states on appState transitions or window blur so inputs never stick
  useEffect(() => {
    const clearInputs = () => {
      keyStateRef.current = {
        left: false,
        right: false,
        up: false,
        down: false,
        a: false,
        b: false,
        start: false,
      };
      touchStateRef.current = {
        left: false,
        right: false,
        up: false,
        down: false,
        a: false,
        b: false,
        start: false,
      };
    };
    clearInputs();
    window.addEventListener("blur", clearInputs);
    return () => window.removeEventListener("blur", clearInputs);
  }, [appState, playingWhileBuilding]);

  // Clear cached designCard and in-flight promise if answers change away from cardAnswersKeyRef
  useEffect(() => {
    const currentKey = JSON.stringify({
      name: name.trim() || "player 1",
      genre,
      hero: hero.trim(),
      vibe,
    });
    if (cardAnswersKeyRef.current && cardAnswersKeyRef.current !== currentKey) {
      cardPromiseRef.current = null;
      cardAnswersKeyRef.current = "";
      setDesignCard(null);
    }
  }, [name, genre, hero, vibe]);

  // Rotate hero placeholder every 2.5s (brief/04-app-spec.md line 70)
  useEffect(() => {
    if (appState !== "create" || createStep !== "hero") return;
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % HERO_PLACEHOLDERS.length);
    }, 2500);
    return () => clearInterval(id);
  }, [appState, createStep]);

  // Focus text input when entering Step 1 (name) or Step 3 (hero)
  useEffect(() => {
    if (appState !== "create") return;
    const timer = setTimeout(() => {
      if (createStep === "name") nameInputRef.current?.focus();
      if (createStep === "hero") heroInputRef.current?.focus();
    }, 40);
    return () => clearTimeout(timer);
  }, [appState, createStep]);

  // Persist state to sessionStorage (brief/04-app-spec.md line 62)
  useEffect(() => {
    saveSessionState({
      state: appState,
      createStep,
      answers: { name, genre, hero, vibe },
      card: designCard,
      interactionId: buildSessionRef.current?.interactionId || null,
      environmentId: buildSessionRef.current?.environmentId || null,
      activeGameId: activeGame?.id || null,
      updatedAt: Date.now(),
    });
  }, [appState, createStep, name, genre, hero, vibe, designCard, activeGame]);

  // Restore answers from sessionStorage if visiting root URL with no explicit state param
  useEffect(() => {
    if (initialUrl.current.explicitStateParam) return;
    const saved = loadSessionState();
    if (saved?.answers) {
      if (saved.answers.name) setName(saved.answers.name);
      if (saved.answers.genre) setGenre(saved.answers.genre);
      if (saved.answers.hero) setHero(saved.answers.hero);
      if (saved.answers.vibe) setVibe(saved.answers.vibe);
    }
  }, []);

  // Load game library + prewarm 24 house skins on mount
  useEffect(() => {
    let cancelled = false;
    loadGameLibrary().then((items) => {
      if (cancelled) return;
      setLibrary(items);
    });
    const idleTimer = setTimeout(() => {
      prewarmAllHouseSkins();
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(idleTimer);
    };
  }, []);

  const bootSeqRef = useRef<number>(0);

  // Boot a game into CartHost and switch stage to CRT framebuffer
  const bootGameInCart = useCallback(
    async (game: LibraryGameItem) => {
      const stage = stageRef.current;
      const cart = cartRef.current;
      if (!cart || !game) return;
      const seq = ++bootSeqRef.current;
      cartBootedRef.current = true;
      cartPausedRef.current = false;

      if (stage) {
        stage.setStepCamera("play", true);
        stage.useAttractScreen(false);
        await stage.applyCardSkin(
          game.card,
          {
            bannerUrl: game.skin.marqueeUrl,
            sideUrl: game.skin.sideUrl,
            attractUrl: game.skin.attractUrl,
          },
          { instant: true }
        );
        if (bootSeqRef.current !== seq) return;
      }

      const saveSlots = await getCartSlots(game.id);
      if (bootSeqRef.current !== seq) return;
      const best = getBestScoreSync(game.id);
      const pulseImmediateStart = () => {
        if (bootSeqRef.current !== seq) return;
        syntheticStartUntilRef.current = performance.now() + 240;
        cart.tick(16.67, {
          left: false,
          right: false,
          up: false,
          down: false,
          a: false,
          b: false,
          start: true,
        });
        cart.tick(16.67, {
          left: false,
          right: true,
          up: false,
          down: false,
          a: true,
          b: false,
          start: false,
        });
      };

      try {
        await cart.load(game.source, game.card, {
          seed: game.card.seed,
          save: { ...saveSlots, highScore: best, best },
          timeoutMs: 2500,
        });
        if (bootSeqRef.current !== seq) return;
        pulseImmediateStart();
      } catch {
        if (bootSeqRef.current !== seq) return;
        // Fallback to genre house game if custom source errored at load
        cartErrorsRef.current += 1;
        const fallbackSrc = await loadHouseGameSource(game.genre);
        if (bootSeqRef.current !== seq) return;
        await cart
          .load(fallbackSrc, game.card, {
            seed: game.card.seed,
            timeoutMs: 2500,
          })
          .catch(() => {});
        if (bootSeqRef.current !== seq) return;
        pulseImmediateStart();
      }
    },
    []
  );

  // Initialize 3D ArcadeStage + CartHost
  useEffect(() => {
    const container = stageWrapRef.current;
    if (!container) return;

    const stage = new ArcadeStage(container);
    stageRef.current = stage;
    stage.onDayNightChange = (dnState) => {
      setDayNight((prev) => {
        if (
          prev.phase !== dnState.phase ||
          prev.isAutoCycle !== dnState.isAutoCycle ||
          Math.abs(prev.timeHours - dnState.timeHours) > 0.25
        ) {
          return dnState;
        }
        return prev;
      });
    };

    const cart = new CartHost(document.body, {
      onFrame: (rgba) => {
        stageRef.current?.updateCrtFramebuffer(rgba);
      },
      onSfx: (sfxName, note) => {
        humController.playSfx(sfxName, note);
      },
      onFx: (fx) => {
        stageRef.current?.pulseCabinetFx(fx.kind, fx.intensity);
      },
      onScore: ({ score }) => {
        const cur = activeGameRef.current;
        if (cur && score > cur.bestScore) {
          updateBestScore(cur.id, score).then((best) => {
            setLibrary((prev) =>
              prev.map((g) => (g.id === cur.id ? { ...g, bestScore: best } : g))
            );
          });
        }
      },
      onSave: ({ key, value }) => {
        const cur = activeGameRef.current;
        if (cur) {
          saveCartSlot(cur.id, key, value).catch(() => {});
        }
      },
      onGameOver: ({ score, best, reason }) => {
        stageRef.current?.pulseCabinetFx(
          reason === "win" ? "win" : "gameover",
          0.85
        );
        const cur = activeGameRef.current;
        if (cur) {
          const high = Math.max(score || 0, best || 0);
          updateBestScore(cur.id, high).then((newBest) => {
            setLibrary((prev) =>
              prev.map((g) =>
                g.id === cur.id ? { ...g, bestScore: newBest } : g
              )
            );
          });
        }
      },
      onError: () => {
        cartErrorsRef.current += 1;
        const cur = activeGameRef.current;
        if (cartErrorsRef.current >= 3 && cur && !cur.isHouse) {
          // 3x runtime error -> fallback to house game of that genre
          loadHouseGameSource(cur.genre).then((houseSrc) => {
            cartRef.current?.load(houseSrc, cur.card).catch(() => {});
          });
        }
      },
    });
    cartRef.current = cart;

    let disposed = false;
    stage.init().then(async () => {
      if (disposed) return;
      const glCanvas = container.querySelector("canvas");
      if (glCanvas) {
        glCanvas.id = "gl";
      }

      if (isUvTest) {
        stage.applyUvTestCard();
        return;
      }

      if (isBench) {
        const res = await stage.runBenchmark();
        window.__BENCH_RESULT__ = res;
        setBenchDone(true);
        return;
      }

      // If no explicit ?state= param was passed in the URL, configure Step 1 (name) on the stage.
      // When ?state=create|build|play|switch is passed, ArcadeStage.init()'s applyInitialUrlState()
      // has already configured the exact 1:1 mock stage state.
      if (!initialUrl.current.explicitStateParam) {
        stage.useAttractScreen(true);
        stage.setStepCamera(1);
        stage.setPreviewState({
          step: 1,
          qStep: "name",
          name: "",
          genre: "runner",
          hero: "",
          vibeSelected: false,
          buildMode: false,
        });
      } else if (
        initialUrl.current.mode === "create" &&
        (initialUrl.current.createStep === "name" ||
          initialUrl.current.createStep === "vibe" ||
          initialUrl.current.createStep === "ready")
      ) {
        const stepNum = initialUrl.current.createStep === "name" ? 1 : 4;
        const vSel =
          initialUrl.current.createStep === "vibe" ||
          initialUrl.current.createStep === "ready";
        stage.useAttractScreen(true);
        stage.setStepCamera(stepNum);
        stage.setPreviewState({
          step: stepNum,
          qStep: initialUrl.current.createStep,
          name: "JAMES",
          genre: "runner",
          hero: "a fox in a tiny blue scarf",
          vibe: vSel ? "sunset" : undefined,
          vibeSelected: vSel,
          buildMode: false,
        });
      }

      if (typeof document !== "undefined" && document.fonts?.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise((r) => setTimeout(r, 350)),
        ]);
      }
      requestAnimationFrame(() => {
        if (!disposed) setStageReady(true);
      });
    });

    return () => {
      disposed = true;
      skinAbortRef.current?.abort();
      buildSessionRef.current?.cleanup().catch(() => {});
      cart.destroy();
      stage.destroy();
      stageRef.current = null;
      cartRef.current = null;
    };
  }, [bootGameInCart, isBench, isUvTest]);

  // Sync Create wizard answers live onto the 3D cabinet marquee, CRT, and trim
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || appState !== "create") return;
    if (
      initialUrl.current.explicitStateParam &&
      !userInteractedRef.current &&
      (createStep === "hero" || createStep === "genre")
    ) {
      return;
    }

    const effectiveVibe = hoverVibe || vibe;
    const vSel =
      createStep === "vibe" || createStep === "ready" || hoverVibe !== null;
    const stepNum: 1 | 2 | 3 | 4 =
      createStep === "name"
        ? 1
        : createStep === "genre"
        ? 2
        : createStep === "hero"
        ? 3
        : 4;

    stage.useAttractScreen(true);
    stage.setStepCamera(stepNum);
    stage.setPreviewState({
      step: stepNum,
      qStep: createStep,
      name: name.trim() || (stepNum >= 2 ? "player 1" : ""),
      genre,
      hero: hero.trim() || "a fox in a tiny blue scarf",
      vibe: vSel ? effectiveVibe : undefined,
      vibeSelected: vSel,
      buildMode: false,
    });
  }, [appState, createStep, name, genre, hero, vibe, hoverVibe]);

  // Pause CartHost automatically when browser tab is hidden (brief/04-app-spec.md line 132)
  useEffect(() => {
    const onVisChange = () => {
      if (document.hidden) {
        cartRef.current?.pause();
      } else if (
        appState === "play" ||
        (appState === "build" && playingWhileBuilding)
      ) {
        cartRef.current?.resume();
      }
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, [appState, playingWhileBuilding]);

  // 60 Hz input polling (Keyboard + Gamepad + Touch) during Play (or while playing classics during Build)
  useEffect(() => {
    if (
      appState !== "play" &&
      !(appState === "build" && playingWhileBuilding)
    ) {
      return;
    }

    let rafId = 0;
    let lastTick = performance.now();

    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      const dt = now - lastTick;
      if (dt < 14) return;
      lastTick = now;

      let gpLeft = false;
      let gpRight = false;
      let gpUp = false;
      let gpDown = false;
      let gpA = false;
      let gpB = false;
      let gpStart = false;

      if (typeof navigator !== "undefined" && navigator.getGamepads) {
        try {
          const pad = navigator.getGamepads()[0];
          if (pad) {
            const axX = pad.axes[0] || 0;
            const axY = pad.axes[1] || 0;
            gpLeft = Boolean(pad.buttons[14]?.pressed) || axX < -0.35;
            gpRight = Boolean(pad.buttons[15]?.pressed) || axX > 0.35;
            gpUp = Boolean(pad.buttons[12]?.pressed) || axY < -0.35;
            gpDown = Boolean(pad.buttons[13]?.pressed) || axY > 0.35;
            gpA = Boolean(pad.buttons[0]?.pressed);
            gpB = Boolean(pad.buttons[1]?.pressed);
            gpStart = Boolean(pad.buttons[9]?.pressed);

            // L1 / R1 edge detection for switching games
            const l1 = Boolean(pad.buttons[4]?.pressed);
            const r1 = Boolean(pad.buttons[5]?.pressed);
            if (l1 && !prevGamepadButtonsRef.current[0]) {
              handleSwitch(-1);
            } else if (r1 && !prevGamepadButtonsRef.current[1]) {
              handleSwitch(1);
            }
            prevGamepadButtonsRef.current = [l1, r1];
          }
        } catch {
          // ignore gamepad permission issues
        }
      }

      const k = keyStateRef.current;
      const t = touchStateRef.current;
      const synthStart = now < syntheticStartUntilRef.current;

      const combined: CartInputState = {
        left: k.left || t.left || gpLeft,
        right: k.right || t.right || gpRight,
        up: k.up || t.up || gpUp,
        down: k.down || t.down || gpDown,
        a: k.a || t.a || gpA,
        b: k.b || t.b || gpB,
        start: k.start || t.start || gpStart || synthStart,
      };

      cartRef.current?.tick(Math.min(33, dt), combined);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  });

  // Trigger a 4s interjection caption when marquee or side art lands (brief/04-app-spec.md line 100)
  const triggerInterjection = useCallback((line: string) => {
    if (interjectionTimerRef.current) {
      clearTimeout(interjectionTimerRef.current);
    }
    setInterjectionCaption(line);
    interjectionTimerRef.current = setTimeout(() => {
      setInterjectionCaption(null);
    }, 4000);
  }, []);

  // Rotate main-track build captions every 4s during Build (brief/04-app-spec.md line 102)
  useEffect(() => {
    if (appState !== "build") return;
    if (initialUrl.current.explicitStateParam && !buildSessionRef.current) {
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const pool =
        elapsedSec > 150
          ? LATE_BUILD_CAPTIONS
          : STAGE_CAPTIONS[buildStage] || STAGE_CAPTIONS.coding;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setBuildCaption(fillHeroSlot(pick, designCard, hero));
    }, 4000);
    return () => clearInterval(id);
  }, [appState, buildStage, designCard, hero]);

  // Step 4 -> Ready: Generate GameDesignCard via Flash and check safety
  const prepareDesignCard = useCallback(
    async (
      chosenVibe: VibeName,
      opts?: { timeoutMs?: number }
    ): Promise<GameDesignCard | null> => {
      const answers: CreateAnswers = {
        name: name.trim() || "player 1",
        genre,
        hero: hero.trim(),
        vibe: chosenVibe,
      };
      const answersKey = JSON.stringify(answers);
      if (cardPromiseRef.current && cardAnswersKeyRef.current === answersKey) {
        return cardPromiseRef.current;
      }

      setSafetyNudge(null);
      setIsGeneratingCard(true);
      cardAnswersKeyRef.current = answersKey;

      const promise = (async (): Promise<GameDesignCard | null> => {
        try {
          const isOnline =
            typeof navigator === "undefined"
              ? true
              : navigator.onLine !== false;
          if (!CONFIG.LIVE || !isOnline) {
            const preset = buildPresetCard(answers);
            if (cardAnswersKeyRef.current !== answersKey) return null;
            setDesignCard(preset);
            setCardLatencyMs(12);
            return preset;
          }

          const res = await generateDesignCard(answers, {
            timeoutMs: opts?.timeoutMs ?? 10000,
          });
          if (cardAnswersKeyRef.current !== answersKey) return null;
          setCardLatencyMs(res.latencyMs);

          if (res.card.safety && res.card.safety.ok === false) {
            const targetField =
              res.card.safety.field === "name" ? "name" : "hero";
            const nudge =
              res.card.safety.nudge ||
              "ooh, let's keep it arcade-friendly. try another hero?";
            setSafetyNudge(nudge);
            setDesignCard(null);
            if (cardAnswersKeyRef.current === answersKey) {
              cardPromiseRef.current = null;
            }
            if (appStateRef.current === "create") {
              setCreateStep(targetField);
            }
            return null;
          }

          setDesignCard(res.card);
          return res.card;
        } finally {
          setIsGeneratingCard(false);
        }
      })();

      cardPromiseRef.current = promise;
      return promise;
    },
    [name, genre, hero]
  );

  // Advance through Create steps 1 -> 2 -> 3 -> 4 -> ready
  const handleNextStep = useCallback(() => {
    userInteractedRef.current = true;
    humController.playChime("select");
    setSafetyNudge(null);

    if (createStep === "name") {
      if (!name.trim()) setName("player 1");
      setCreateStep("genre");
    } else if (createStep === "genre") {
      setCreateStep("hero");
    } else if (createStep === "hero") {
      setCreateStep("vibe");
    } else if (createStep === "vibe") {
      setCreateStep("ready");
      prepareDesignCard(vibe);
    }
  }, [createStep, name, vibe, prepareDesignCard]);

  const handleSelectGenre = useCallback((g: GenreName) => {
    userInteractedRef.current = true;
    humController.playChime("select");
    setGenre(g);
    setCreateStep("hero");
  }, []);

  const handleSelectVibe = useCallback(
    (v: VibeName) => {
      userInteractedRef.current = true;
      humController.playChime("select");
      setVibe(v);
      setHoverVibe(null);
      setCreateStep("ready");
      prepareDesignCard(v);
    },
    [prepareDesignCard]
  );

  // Start Build when visitor presses "insert coin →"
  const handleInsertCoin = useCallback(async () => {
    if (isStartingBuildRef.current || appState === "build") return;
    isStartingBuildRef.current = true;
    setIsStartingBuild(true);
    const myRunId = ++buildRunIdRef.current;

    try {
      userInteractedRef.current = true;
      humController.playChime("coin");
      buildSessionRef.current?.cancel().catch(() => {});

      const answers: CreateAnswers = {
        name: name.trim() || "player 1",
        genre,
        hero: hero.trim(),
        vibe,
      };
      const answersKey = JSON.stringify(answers);

      let activeCard: GameDesignCard | null =
        designCard && cardAnswersKeyRef.current === answersKey
          ? designCard
          : null;
      if (!activeCard) {
        if (
          cardPromiseRef.current &&
          cardAnswersKeyRef.current === answersKey
        ) {
          activeCard = await cardPromiseRef.current;
        } else {
          activeCard = await prepareDesignCard(vibe, { timeoutMs: 10000 });
        }
      }

      if (buildRunIdRef.current !== myRunId) return;

      if (!activeCard) {
        isStartingBuildRef.current = false;
        setIsStartingBuild(false);
        return;
      }

      // Enter Build state
      setAppState("build");
      setIsStartingBuild(false);
      setBuildStage("designing");
      setBuildPct(6);
      setInterjectionCaption(null);
      setBuildCaption(
        fillHeroSlot(STAGE_CAPTIONS.designing[0], activeCard, hero)
      );
      activeSkinArtRef.current = {};
      cartErrorsRef.current = 0;

      const stage = stageRef.current;
      if (stage) {
        stage.useAttractScreen(true);
        stage.setStepCamera("build");
        stage.setPreviewState({
          step: "build",
          name: activeCard.player_name,
          genre: activeCard.genre,
          hero: activeCard.hero.short,
          vibe: activeCard.vibe,
          buildMode: true,
          buildStage: "designing",
          buildPct: 6,
          buildTitle: activeCard.title,
        });
      }

      const isOnline =
        typeof navigator === "undefined" ? true : navigator.onLine !== false;
      const capReached = isSessionRunCapReached();
      const useDemoOrOffline = !CONFIG.LIVE || !isOnline || capReached;

      const buildStartedAt = performance.now();
      let imagesMs: number[] = [0, 0, 0];

      // Track 2 (Paint track): Run 3 parallel Nano Banana calls and paint cabinet progressively as each lands
      skinAbortRef.current?.abort();
      const skinAbort = new AbortController();
      skinAbortRef.current = skinAbort;

      const skinPromise = runSkinSession(activeCard, {
        signal: skinAbort.signal,
        onImageReady: (kind: SkinImageKind, dataUrl: string) => {
          if (buildRunIdRef.current !== myRunId || skinAbort.signal.aborted) {
            return;
          }
          if (kind === "marquee") {
            activeSkinArtRef.current.bannerUrl = dataUrl;
            if (!playingWhileBuildingRef.current) {
              humController.playChime("stage");
              triggerInterjection("your marquee is getting fancy.");
            }
          } else if (kind === "side") {
            activeSkinArtRef.current.sideUrl = dataUrl;
            if (!playingWhileBuildingRef.current) {
              humController.playChime("stage");
              triggerInterjection("painting the sides now.");
            }
          } else if (kind === "attract") {
            activeSkinArtRef.current.attractUrl = dataUrl;
          }
          if (!playingWhileBuildingRef.current) {
            stageRef.current?.applyCardSkin(activeCard!, {
              ...activeSkinArtRef.current,
            });
          }
        },
      }).then((skinRes) => {
        imagesMs = skinRes.imagesMs;
        return skinRes;
      });

      if (useDemoOrOffline) {
        // Fast simulated build (demo mode / session cap / offline)
        const statusCopy = !isOnline
          ? "you're offline. house games still work."
          : "the arcade's packed. here's one we made earlier.";
        const steps: Array<{ pct: number; st: BuildStageName; msg?: string }> =
          [
            { pct: 22, st: "coding", msg: !isOnline ? statusCopy : undefined },
            { pct: 54, st: "coding", msg: !isOnline ? statusCopy : undefined },
            { pct: 78, st: "playtesting", msg: statusCopy },
            { pct: 94, st: "finishing", msg: statusCopy },
            { pct: 100, st: "ready", msg: "it's alive. go go go." },
          ];

        for (const s of steps) {
          await new Promise((r) => setTimeout(r, 650));
          if (buildRunIdRef.current !== myRunId) return;
          setBuildStage(s.st);
          setBuildPct(s.pct);
          if (s.msg) {
            if (interjectionTimerRef.current) {
              clearTimeout(interjectionTimerRef.current);
              interjectionTimerRef.current = null;
            }
            setInterjectionCaption(null);
            setBuildCaption(s.msg);
          } else {
            const pool = STAGE_CAPTIONS[s.st];
            setBuildCaption(fillHeroSlot(pool[0], activeCard, hero));
          }
          if (!playingWhileBuildingRef.current) {
            stageRef.current?.setPreviewState({
              step: "build",
              buildMode: true,
              buildStage: s.st,
              buildPct: s.pct,
              buildTitle: activeCard.title,
            });
          }
        }

        const [skinRes, houseSource] = await Promise.all([
          skinPromise,
          loadHouseGameSource(activeCard.genre),
        ]);
        if (buildRunIdRef.current !== myRunId) return;

        const savedGame = await saveVisitorGame({
          card: activeCard,
          source: houseSource,
          skin: {
            marqueeUrl: skinRes.marqueeUrl,
            sideUrl: skinRes.sideUrl,
            attractUrl: skinRes.attractUrl,
            trimColor: skinRes.trimColor,
            bodyColor: skinRes.bodyColor,
          },
        });
        if (buildRunIdRef.current !== myRunId) return;

        const updatedLib = await loadGameLibrary();
        if (buildRunIdRef.current !== myRunId) return;
        setLibrary(updatedLib);
        setActiveGameIdx(0);

        recordTelemetry({
          run_id: activeCard.id,
          genre: activeCard.genre,
          vibe: activeCard.vibe,
          card_ms: cardLatencyMs,
          images_ms: imagesMs,
          agent_ms: Math.round(performance.now() - buildStartedAt),
          agent_status: !isOnline ? "offline" : "demo",
          tokens: 0,
          playtest_pass: true,
          fallback_used: true,
          cart_errors: cartErrorsRef.current,
          timestamp: new Date().toISOString(),
        });
        setTelemetryLog(getTelemetryRecords());

        humController.playChime("ready");
        setPlayingWhileBuilding(false);
        setAppState("play");
        await bootGameInCart(savedGame);
        return;
      }

      // Live Managed Agent build via BuildSession
      incrementSessionRunCount();

      const session = new BuildSession(activeCard, {
        onUpdate: (snap: BuildSnapshot) => {
          if (buildRunIdRef.current !== myRunId) return;
          // Map BuildSession stages to 04-app-spec.md stages & monotonic %
          const playtestItem = snap.stages.find((s) => s.id === "playtest");
          const cartridgeItem = snap.stages.find((s) => s.id === "cartridge");
          const codingItem = snap.stages.find((s) => s.id === "coding");

          let nextStage: BuildStageName = "designing";
          let targetPct = 8;

          if (snap.state === "READY" || snap.state === "FALLBACK") {
            nextStage = "ready";
            targetPct = 100;
          } else if (
            snap.state === "FETCHING_CART" ||
            snap.state === "VERIFYING" ||
            cartridgeItem?.status === "active"
          ) {
            nextStage = "finishing";
            targetPct = 94;
          } else if (
            playtestItem?.status === "active" ||
            snap.elapsedSeconds >= 95
          ) {
            nextStage = "playtesting";
            targetPct = Math.min(
              89,
              72 + Math.floor(Math.max(0, snap.elapsedSeconds - 60) * 0.4)
            );
          } else if (
            codingItem?.status === "active" ||
            snap.elapsedSeconds >= 4
          ) {
            nextStage = "coding";
            targetPct = Math.min(
              69,
              12 + Math.floor(Math.min(57, snap.elapsedSeconds * 0.75))
            );
          }

          if (snap.state === "RETRYING") {
            setBuildCaption("one more try. the first one tripped.");
          }

          setBuildStage((prev) => {
            if (prev !== nextStage) {
              humController.playChime("stage");
              const pool = STAGE_CAPTIONS[nextStage];
              setBuildCaption(fillHeroSlot(pool[0], activeCard, hero));
            }
            return nextStage;
          });

          setBuildPct((prev) => {
            const monotonic =
              targetPct === 100 ? 100 : Math.min(99, Math.max(prev, targetPct));
            if (!playingWhileBuildingRef.current) {
              stageRef.current?.setPreviewState({
                step: "build",
                buildMode: true,
                buildStage: nextStage,
                buildPct: monotonic,
                buildTitle: activeCard!.title,
              });
            }
            return monotonic;
          });
        },
      });

      buildSessionRef.current = session;
      const finalSnap = await session.start({
        runSkin: false, // We already started the 3-image progressive skinSession above
        timeoutMs: CONFIG.AGENT_TIMEOUT_MS || 240_000,
      });

      if (finalSnap.state === "CANCELLED" || buildRunIdRef.current !== myRunId)
        return;

      const skinRes = await skinPromise;
      if (buildRunIdRef.current !== myRunId) return;
      const finalSource =
        finalSnap.cartSource ||
        finalSnap.houseCartSource ||
        (await loadHouseGameSource(activeCard.genre));
      if (buildRunIdRef.current !== myRunId) return;

      if (finalSnap.isFallback) {
        const reason = (finalSnap.fallbackReason || "").toLowerCase();
        const fbCopy =
          reason.includes("timeout") || reason.includes("took too long")
            ? `that took too long. here's a fresh ${activeCard.genre} on the house.`
            : reason.includes("429") ||
              reason.includes("packed") ||
              reason.includes("rate")
            ? "the arcade's packed. here's one we made earlier."
            : "that one got away from us. try a house game while we reset?";
        setInterjectionCaption(null);
        setBuildCaption(fbCopy);
        setFallbackToast(fbCopy);
        setTimeout(() => {
          if (buildRunIdRef.current === myRunId) {
            setFallbackToast(null);
          }
        }, 6500);
      } else {
        setFallbackToast(null);
        setBuildCaption("it's alive. go go go.");
      }
      setBuildPct(100);
      setBuildStage("ready");
      setPlayingWhileBuilding(false);

      if (finalSnap.isFallback) {
        await new Promise((r) => setTimeout(r, 1200));
        if (buildRunIdRef.current !== myRunId) return;
      }

      const savedGame = await saveVisitorGame({
        card: activeCard,
        source: finalSource,
        skin: {
          marqueeUrl: skinRes.marqueeUrl,
          sideUrl: skinRes.sideUrl,
          attractUrl: skinRes.attractUrl,
          trimColor: skinRes.trimColor,
          bodyColor: skinRes.bodyColor,
        },
      });
      if (buildRunIdRef.current !== myRunId) return;

      const updatedLib = await loadGameLibrary();
      if (buildRunIdRef.current !== myRunId) return;
      setLibrary(updatedLib);
      setActiveGameIdx(0);

      recordTelemetry({
        run_id: activeCard.id,
        genre: activeCard.genre,
        vibe: activeCard.vibe,
        card_ms: cardLatencyMs,
        images_ms: imagesMs,
        agent_ms: Math.round(performance.now() - buildStartedAt),
        agent_status: finalSnap.isFallback ? "fallback" : "ready",
        tokens: CONFIG.MAX_AGENT_TOKENS,
        playtest_pass: !finalSnap.isFallback,
        fallback_used: finalSnap.isFallback,
        cart_errors: cartErrorsRef.current,
        timestamp: new Date().toISOString(),
      });
      setTelemetryLog(getTelemetryRecords());

      // Delete remote sandbox once game files have been read (BRIEF.md §3 Guardrails)
      session.cleanup().catch(() => {});

      humController.playChime("ready");
      setAppState("play");
      await bootGameInCart(savedGame);
    } finally {
      if (buildRunIdRef.current === myRunId) {
        isStartingBuildRef.current = false;
        setIsStartingBuild(false);
      }
    }
  }, [
    appState,
    name,
    genre,
    hero,
    vibe,
    designCard,
    cardLatencyMs,
    prepareDesignCard,
    triggerInterjection,
    bootGameInCart,
  ]);

  const selectClassicsGameForCurrentGenre = useCallback(async (): Promise<LibraryGameItem | null> => {
    let items = library;
    if (items.length === 0) {
      items = await loadGameLibrary();
      setLibrary(items);
    }
    if (items.length === 0) return null;
    const matchIdx = items.findIndex((g) => g.genre === genre);
    const idx = matchIdx >= 0 ? matchIdx : 0;
    setActiveGameIdx(idx);
    return items[idx] || null;
  }, [library, genre]);

  // Play house classics while waiting for custom build to finish
  const handlePlayClassicsWhileWaiting = useCallback(async () => {
    userInteractedRef.current = true;
    humController.playChime("select");
    const chosen = await selectClassicsGameForCurrentGenre();
    if (!chosen) return;
    setPlayingWhileBuilding(true);
    await bootGameInCart(chosen);
  }, [selectClassicsGameForCurrentGenre, bootGameInCart]);

  // Return from playing classics to the Build CRT progress view
  const handleReturnToBuildView = useCallback(() => {
    userInteractedRef.current = true;
    humController.playChime("select");
    bootSeqRef.current += 1;
    setPlayingWhileBuilding(false);
    cartRef.current?.pause();
    const stage = stageRef.current;
    if (stage) {
      stage.useAttractScreen(true);
      stage.setStepCamera("build");
      stage.setPreviewState({
        step: "build",
        buildMode: true,
        buildStage,
        buildPct,
        buildTitle: designCard?.title || "YOUR GAME",
      });
      if (designCard) {
        stage
          .applyCardSkin(
            designCard,
            { ...activeSkinArtRef.current },
            { instant: true }
          )
          .catch(() => {});
      }
    }
  }, [buildStage, buildPct, designCard]);

  // Switch between classics while custom game is still building in background
  const handleSwitchWhileBuilding = useCallback(
    async (dir: 1 | -1) => {
      if (library.length === 0) return;
      userInteractedRef.current = true;
      humController.playChime("select");
      const toIdx = (activeGameIdx + dir + library.length) % library.length;
      const toGame = library[toIdx];
      setActiveGameIdx(toIdx);
      if (toGame) {
        await bootGameInCart(toGame);
      }
    },
    [library, activeGameIdx, bootGameInCart]
  );

  // Jump straight from Create into playing the arcade library classics
  const handleBrowseClassicsFromCreate = useCallback(async () => {
    userInteractedRef.current = true;
    humController.playChime("coin");
    const chosen = await selectClassicsGameForCurrentGenre();
    if (!chosen) return;
    setAppState("play");
    await bootGameInCart(chosen);
  }, [selectClassicsGameForCurrentGenre, bootGameInCart]);

  // Switch between games on the single cabinet (brief/04-app-spec.md §Switch)
  const handleSwitch = useCallback(
    async (dir: 1 | -1) => {
      if (library.length === 0 || isSwitchingRef.current) return;
      isSwitchingRef.current = true;
      try {
        userInteractedRef.current = true;
        humController.playChime("poweroff");
        cartRef.current?.pause();

        const fromIdx = activeGameIdx;
        const toIdx = (fromIdx + dir + library.length) % library.length;
        const toGame = library[toIdx];

        setSwitchDir(dir);
        setSwitchTargetIdx(toIdx);
        setAppState("switch");

        const stage = stageRef.current;
        if (stage && toGame) {
          stage.setStepCamera("switch");
          stage.useAttractScreen(true);
          const toSkin = getHouseSkinForCard(toGame.card);
          await stage.startSwitchTransition({
            marquee: toSkin.marqueeCanvas,
            side: toSkin.sideCanvas,
            trim: toGame.skin.trimColor || toSkin.trim,
            body: toGame.skin.bodyColor || toSkin.body,
            btn: toSkin.btn,
          });
        } else {
          await new Promise((r) => setTimeout(r, 850));
        }

        setActiveGameIdx(toIdx);
        humController.playChime("poweron");
        setAppState("play");
        if (toGame) {
          await bootGameInCart(toGame);
        }
      } finally {
        isSwitchingRef.current = false;
      }
    },
    [library, activeGameIdx, bootGameInCart]
  );

  // Return to Create with previous answers pre-filled (brief/04-app-spec.md line 138)
  const handleBackToCreate = useCallback(() => {
    userInteractedRef.current = true;
    humController.playChime("select");
    bootSeqRef.current += 1;
    buildRunIdRef.current += 1;
    isStartingBuildRef.current = false;
    setIsStartingBuild(false);
    skinAbortRef.current?.abort();
    skinAbortRef.current = null;
    cartRef.current?.pause();
    buildSessionRef.current?.cancel().catch(() => {});
    setPlayingWhileBuilding(false);
    setSafetyNudge(null);
    setCreateStep("name");
    setAppState("create");
  }, []);

  // Share 1080x1350 PNG trading card (brief/04-app-spec.md lines 134-137)
  const handleShare = useCallback(async () => {
    humController.playChime("ready");
    const targetCard =
      activeGame?.card ||
      designCard ||
      buildPresetCard({ name: name || "player 1", genre, hero, vibe });
    const score = activeGame?.bestScore || 0;
    const glCanvas = document.getElementById("gl") as HTMLCanvasElement | null;
    await shareTradingCard({
      card: targetCard,
      bestScore: score,
      stageCanvas: glCanvas,
    });
  }, [activeGame, designCard, name, genre, hero, vibe]);

  // Global keyboard listener for Create, Build idle toy, Play, and Switch
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      userInteractedRef.current = true;
      const target = e.target as HTMLElement | null;
      const inInput =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";

      if (appState === "create") {
        stageRef.current?.pressCabinetButton(e.key);
        if (e.key === "Escape") {
          e.preventDefault();
          if (createStep === "ready") setCreateStep("vibe");
          else if (createStep === "vibe") setCreateStep("hero");
          else if (createStep === "hero") setCreateStep("genre");
          else if (createStep === "genre") setCreateStep("name");
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (createStep === "ready") {
            handleInsertCoin();
          } else {
            handleNextStep();
          }
          return;
        }
        if (inInput && e.key.length === 1) {
          const now = performance.now();
          if (now - lastTypeTickRef.current > 45) {
            lastTypeTickRef.current = now;
            humController.playSfx("tick", 2);
          }
        }
        return;
      }

      if (appState === "build") {
        stageRef.current?.pressCabinetButton(e.key);
        const k = e.key.toLowerCase();
        if (playingWhileBuilding) {
          if (!cartBootedRef.current && activeGameRef.current) {
            bootGameInCart(activeGameRef.current);
          }
          if (e.key === "[") {
            e.preventDefault();
            handleSwitchWhileBuilding(-1);
            return;
          }
          if (e.key === "]") {
            e.preventDefault();
            handleSwitchWhileBuilding(1);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            handleReturnToBuildView();
            return;
          }
          if (applyCartKeyInput(keyStateRef.current, k, true)) {
            e.preventDefault();
          }
          return;
        }
        if (k === "arrowleft" || k === "a") {
          stageRef.current?.nudgeAttractHero(-10, false);
        } else if (k === "arrowright" || k === "d") {
          stageRef.current?.nudgeAttractHero(10, false);
        } else if (
          k === "arrowup" ||
          k === "w" ||
          k === " " ||
          k === "z" ||
          k === "j"
        ) {
          e.preventDefault();
          stageRef.current?.nudgeAttractHero(0, true);
          humController.playSfx("jump");
        } else if (e.key === "Escape") {
          handleBackToCreate();
        }
        return;
      }

      if (appState === "switch") {
        if (e.key === "[" || e.key === "ArrowLeft") {
          e.preventDefault();
          handleSwitch(-1);
        } else if (e.key === "]" || e.key === "ArrowRight") {
          e.preventDefault();
          handleSwitch(1);
        } else if (e.key === "Escape") {
          if (!isSwitchingRef.current) {
            handleBackToCreate();
          }
        }
        return;
      }

      if (appState === "play") {
        if (inInput) return;
        stageRef.current?.pressCabinetButton(e.key);
        const k = e.key.toLowerCase();

        if (!cartBootedRef.current && activeGameRef.current) {
          bootGameInCart(activeGameRef.current);
        }

        if (e.key === "[") {
          e.preventDefault();
          handleSwitch(-1);
          return;
        }
        if (e.key === "]") {
          e.preventDefault();
          handleSwitch(1);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          handleBackToCreate();
          return;
        }
        if (k === "p") {
          e.preventDefault();
          const cart = cartRef.current as
            | (CartHost & { togglePause?: () => void })
            | null;
          if (cart?.togglePause) {
            cart.togglePause();
          } else if (cartPausedRef.current) {
            cartPausedRef.current = false;
            cartRef.current?.resume();
          } else {
            cartPausedRef.current = true;
            cartRef.current?.pause();
          }
          return;
        }

        if (applyCartKeyInput(keyStateRef.current, k, true)) {
          e.preventDefault();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      applyCartKeyInput(keyStateRef.current, e.key.toLowerCase(), false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    appState,
    createStep,
    playingWhileBuilding,
    handleNextStep,
    handleInsertCoin,
    handleSwitch,
    handleSwitchWhileBuilding,
    handleReturnToBuildView,
    handleBackToCreate,
    bootGameInCart,
  ]);

  // Fade Play `.corner` controls to 30% opacity after 3s without mouse movement (brief/04-app-spec.md line 126)
  useEffect(() => {
    if (appState !== "play") {
      setControlsIdle(false);
      return;
    }
    const resetIdle = () => {
      setControlsIdle(false);
      if (idleMouseTimerRef.current) {
        clearTimeout(idleMouseTimerRef.current);
      }
      idleMouseTimerRef.current = setTimeout(() => {
        setControlsIdle(true);
      }, 3000);
    };
    resetIdle();
    window.addEventListener("mousemove", resetIdle, { passive: true });
    window.addEventListener("touchstart", resetIdle, { passive: true });
    return () => {
      if (idleMouseTimerRef.current) {
        clearTimeout(idleMouseTimerRef.current);
      }
      window.removeEventListener("mousemove", resetIdle);
      window.removeEventListener("touchstart", resetIdle);
    };
  }, [appState]);

  // Mobile horizontal touch swipe to switch games in Play/Switch (brief/04-app-spec.md lines 125, 147)
  useEffect(() => {
    if (appState !== "play" && appState !== "switch") return;
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".touch-controls") || target?.closest("button")) {
        touchSwipeStartRef.current = null;
        return;
      }
      const t = e.touches[0];
      if (t) {
        touchSwipeStartRef.current = { x: t.clientX, y: t.clientY };
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      const start = touchSwipeStartRef.current;
      touchSwipeStartRef.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        handleSwitch(dx < 0 ? 1 : -1);
      }
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [appState, handleSwitch]);

  const handleToggleMute = () => {
    const nextMuted = humController.toggleMute();
    setMuted(nextMuted);
  };

  const handleCycleDayNight = () => {
    const next = stageRef.current?.cycleNextDayNight();
    if (next) setDayNight(next);
  };

  const setTouchBtn = (btn: keyof CartInputState, pressed: boolean) => {
    touchStateRef.current[btn] = pressed;
    if (pressed) {
      if (!cartBootedRef.current && activeGameRef.current) {
        bootGameInCart(activeGameRef.current);
      }
      stageRef.current?.pressCabinetButton(btn);
    }
  };

  return (
    <>
      <div
        className={`boot-loader${stageReady ? " done" : ""}`}
        aria-hidden={stageReady}
      >
        <div className="boot-loader-logo">
          <i />
          AMOGH GAMES
        </div>
        <div className="boot-loader-bar">
          <span />
        </div>
        <div className="boot-loader-sub">warming up the crt&hellip;</div>
      </div>

      <div className="stage-wrap" ref={stageWrapRef} />

      <div
        id="ui"
        data-state={appState}
        data-playing-while-building={playingWhileBuilding ? "true" : undefined}
        data-bench-done={benchDone ? "true" : undefined}
        className={createStep === "genre" ? "q-genre" : undefined}
      >
        <div className="scrim" />

        {/* Permanent Chrome */}
        <div className="wordmark">
          <i />
          AMOGH GAMES
        </div>

        {/* Dynamic Day/Night Scenery & Room Atmosphere Control */}
        <div className="tod-dock">
          <button
            type="button"
            className="tod-pill"
            onClick={handleCycleDayNight}
            aria-label={`Time of Day: ${dayNight.phaseLabel}. Click to cycle between Sunrise, Daylight, Sunset, Twilight, and Midnight.`}
            title={`${dayNight.phaseLabel} (${Math.floor(dayNight.timeHours)}:00) — Click to cycle day & night`}
          >
            <span className="tod-icon" aria-hidden="true">{dayNight.phaseIcon}</span>
            <span className="tod-text">{dayNight.phaseLabel}</span>
            <span className="tod-badge">{dayNight.isAutoCycle ? "auto" : "held"}</span>
          </button>
        </div>

        <button
          type="button"
          className="mute-btn"
          aria-label={muted ? "unmute sound" : "mute sound"}
          onClick={handleToggleMute}
        >
          {muted ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </button>

        {/* STATE 1: CREATE */}
        <section className="state s-create">
          <div className="host">
            {createStep === "name" && (
              <>
                <div className="step">1 / 4</div>
                <div className="say" aria-live="polite">
                  {safetyNudge || "what should we call you?"}
                </div>
                <label className="field">
                  <input
                    ref={nameInputRef}
                    value={name}
                    maxLength={12}
                    placeholder="your name or a handle"
                    aria-label="what should we call you"
                    onChange={(e) => setName(e.target.value.slice(0, 12))}
                  />
                  <button
                    type="button"
                    className="go"
                    aria-label="next"
                    onClick={handleNextStep}
                  >
                    &rarr;
                  </button>
                </label>
              </>
            )}

            {createStep === "genre" && (
              <>
                <div className="step q-genre">2 / 4</div>
                <div className="say q-genre" aria-live="polite">
                  what kind of game?
                </div>
                <div className="chips q-genre">
                  {GENRE_LIST.map((g) => (
                    <button
                      key={g}
                      type="button"
                      className={`chip${genre === g ? " on" : ""}`}
                      onClick={() => handleSelectGenre(g)}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </>
            )}

            {createStep === "hero" && (
              <>
                <div className="step q-hero">3 / 4</div>
                <div className="say q-hero" aria-live="polite">
                  {safetyNudge || "who's the hero?"}
                </div>
                <label className="field q-hero">
                  <input
                    ref={heroInputRef}
                    value={hero}
                    maxLength={500}
                    placeholder={HERO_PLACEHOLDERS[placeholderIdx]}
                    aria-label="your hero"
                    onChange={(e) => setHero(e.target.value.slice(0, 500))}
                  />
                  <button
                    type="button"
                    className="go"
                    aria-label="next"
                    onClick={handleNextStep}
                  >
                    &rarr;
                  </button>
                </label>
              </>
            )}

            {createStep === "vibe" && (
              <>
                <div className="step">4 / 4</div>
                <div className="say" aria-live="polite">
                  pick a vibe
                </div>
                <div className="chips">
                  {VIBE_LIST.map((v) => {
                    const def = VIBES[v];
                    return (
                      <button
                        key={v}
                        type="button"
                        className={`chip${vibe === v ? " on" : ""}`}
                        onMouseEnter={() => setHoverVibe(v)}
                        onMouseLeave={() => setHoverVibe(null)}
                        onFocus={() => setHoverVibe(v)}
                        onBlur={() => setHoverVibe(null)}
                        onClick={() => handleSelectVibe(v)}
                      >
                        <span className="chip-swatches" aria-hidden="true">
                          {def.swatches.map((hexCol, idx) => (
                            <span
                              key={idx}
                              className="chip-dot"
                              style={{ background: hexCol }}
                            />
                          ))}
                        </span>
                        {v}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {createStep === "ready" && (
              <>
                <div className="step">ready</div>
                <div className="say" aria-live="polite">
                  {isStartingBuild ? "warming up the cabinet…" : "ready when you are."}
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="pill primary"
                    disabled={isStartingBuild}
                    aria-busy={isStartingBuild}
                    onClick={handleInsertCoin}
                  >
                    {isStartingBuild ? "inserting coin…" : <>insert coin &rarr;</>}
                  </button>
                </div>
              </>
            )}
          </div>
          {!initialUrl.current.explicitStateParam && (
            <button
              type="button"
              className="pill ghost corner r"
              onClick={handleBrowseClassicsFromCreate}
            >
              play classics &rarr;
            </button>
          )}
        </section>

        {/* STATE 2: BUILD */}
        <section className="state s-build">
          {!playingWhileBuilding ? (
            <div className="host">
              <div className="step">building &middot; {buildPct}%</div>
              <div className="say" aria-live="polite">
                {interjectionCaption || buildCaption}
              </div>
              {!initialUrl.current.explicitStateParam && (
                <div className="row" style={{ marginTop: "6px" }}>
                  <button
                    type="button"
                    className="pill ghost"
                    onClick={handlePlayClassicsWhileWaiting}
                  >
                    play classics while waiting &rarr;
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="build-play-banner" aria-live="polite">
                <i className="dot" />
                <span>
                  building {(designCard?.title || "your game").toLowerCase()} &middot; {buildPct}% &mdash;{" "}
                  {interjectionCaption || buildCaption}
                </span>
              </div>

              <button
                type="button"
                className="pill ghost corner l"
                onClick={handleReturnToBuildView}
              >
                &larr; watch build ({buildPct}%)
              </button>

              <div className="corner r">
                <div className="arrows">
                  <button
                    type="button"
                    aria-label="previous classic game"
                    onClick={() => handleSwitchWhileBuilding(-1)}
                  >
                    &lsaquo;
                  </button>
                  <button
                    type="button"
                    aria-label="next classic game"
                    onClick={() => handleSwitchWhileBuilding(1)}
                  >
                    &rsaquo;
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* STATE 3: PLAY */}
        <section className="state s-play">
          {fallbackToast && (
            <div className="fallback-toast" role="status" aria-live="polite">
              <div className="say">{fallbackToast}</div>
            </div>
          )}
          <button
            type="button"
            className={`pill ghost corner l${controlsIdle ? " idle" : ""}`}
            onClick={handleBackToCreate}
          >
            &larr; back
          </button>

          <div className={`corner r${controlsIdle ? " idle" : ""}`}>
            <div className="arrows">
              <button
                type="button"
                aria-label="previous game"
                onClick={() => handleSwitch(-1)}
              >
                &lsaquo;
              </button>
              <button
                type="button"
                aria-label="next game"
                onClick={() => handleSwitch(1)}
              >
                &rsaquo;
              </button>
            </div>
            <button
              type="button"
              className="pill primary"
              onClick={handleShare}
            >
              share it &rarr;
            </button>
          </div>

          {/* Mobile Touch Controls */}
          <div className="touch-controls">
            <div className="touch-dpad">
              <button
                type="button"
                className="up"
                aria-label="up"
                onPointerDown={() => setTouchBtn("up", true)}
                onPointerUp={() => setTouchBtn("up", false)}
                onPointerLeave={() => setTouchBtn("up", false)}
              >
                ▲
              </button>
              <button
                type="button"
                className="down"
                aria-label="down"
                onPointerDown={() => setTouchBtn("down", true)}
                onPointerUp={() => setTouchBtn("down", false)}
                onPointerLeave={() => setTouchBtn("down", false)}
              >
                ▼
              </button>
              <button
                type="button"
                className="left"
                aria-label="left"
                onPointerDown={() => setTouchBtn("left", true)}
                onPointerUp={() => setTouchBtn("left", false)}
                onPointerLeave={() => setTouchBtn("left", false)}
              >
                ◀
              </button>
              <button
                type="button"
                className="right"
                aria-label="right"
                onPointerDown={() => setTouchBtn("right", true)}
                onPointerUp={() => setTouchBtn("right", false)}
                onPointerLeave={() => setTouchBtn("right", false)}
              >
                ▶
              </button>
            </div>
            <div className="touch-ab">
              <button
                type="button"
                className="btn-b"
                aria-label="button b"
                onPointerDown={() => setTouchBtn("b", true)}
                onPointerUp={() => setTouchBtn("b", false)}
                onPointerLeave={() => setTouchBtn("b", false)}
              >
                B
              </button>
              <button
                type="button"
                className="btn-a"
                aria-label="button a"
                onPointerDown={() => setTouchBtn("a", true)}
                onPointerUp={() => setTouchBtn("a", false)}
                onPointerLeave={() => setTouchBtn("a", false)}
              >
                A
              </button>
            </div>
          </div>
        </section>

        {/* STATE 4: SWITCH */}
        <section className="state s-switch">
          <div className="host">
            <div className="say next" aria-live="polite">
              <small>next up</small>
              {(switchTargetGame?.title || "comet pop").toLowerCase()}
            </div>
            <div className="arrows">
              <button
                type="button"
                className={switchDir === -1 ? "on" : undefined}
                aria-label="previous"
                onClick={() => handleSwitch(-1)}
              >
                &larr;
              </button>
              <button
                type="button"
                className={switchDir === 1 ? "on" : undefined}
                aria-label="next"
                onClick={() => handleSwitch(1)}
              >
                &rarr;
              </button>
            </div>
          </div>
        </section>

        {/* Hidden ?debug panel */}
        {isDebug && (
          <aside className="debug-panel" aria-label="debug telemetry">
            <h3>playglow telemetry ({telemetryLog.length})</h3>
            <div>
              state: {appState} · step: {createStep} · live:{" "}
              {String(CONFIG.LIVE)}
            </div>
            <pre>{JSON.stringify(telemetryLog, null, 2)}</pre>
          </aside>
        )}
      </div>
    </>
  );
};

export default App;
