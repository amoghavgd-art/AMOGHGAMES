import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import GUI from "lil-gui";
import type { GameDesignCard } from "../card/schema";
import { buildPresetCard } from "../card/designCard";
import { PALETTE_32 } from "../card/vibes";
import {
  makeCRTMaterial,
  createCrtDataTexture,
  updateCrtDataTexture,
  computeFrameAverageColor,
} from "./crtShader";
import {
  C,
  composeCabinetSkin,
  composeProceduralSkin,
  composeUvTestCard,
  loadBaseCabinetImage,
  loadImageSource,
  ditherVerticalGradient,
  ditherDisc,
  blankSide,
  pendingMarquee,
  wipeMarqueeStep,
  wipeSideStep,
  dissolve,
  type VibeId,
  type GenreId,
  type ComposedRegions,
} from "./skinCompositor";
import {
  AttractScreen,
  MOCK_GAMES,
  getMockSkinCanvases,
  drawBuildCRT,
  type BuildStageName,
  type MockGameKey,
} from "./attract";
import {
  WindowScenery,
  type DayNightState,
  type DayNightPhase,
} from "./windowScenery";

export type StepCameraMode =
  | 1
  | 2
  | 3
  | 4
  | "create"
  | "build"
  | "play"
  | "attract"
  | "switch"
  | "uv-left";

export interface PreviewState {
  step?: 1 | 2 | 3 | 4 | "create" | "build" | "play" | "switch";
  qStep?: "name" | "genre" | "hero" | "vibe" | "ready";
  name?: string;
  arcadeName?: string;
  genre?: GenreId | null;
  hero?: string;
  vibe?: VibeId | null;
  vibeSelected?: boolean;
  mockGameKey?: MockGameKey;
  buildMode?: boolean;
  buildStage?: BuildStageName;
  buildProgress?: number;
  buildPct?: number;
  buildTitle?: string;
  heroOffsetX?: number;
  heroJumpY?: number;
}

export interface ApplyCardSkinArt {
  bannerUrl?: string;
  sideUrl?: string;
  attractUrl?: string;
  banner?: HTMLImageElement | HTMLCanvasElement | null;
  side?: HTMLImageElement | HTMLCanvasElement | null;
  attract?: HTMLImageElement | HTMLCanvasElement | null;
}

export interface SwitchSkinInput {
  marquee: HTMLCanvasElement;
  side: HTMLCanvasElement;
  trim: string;
  body?: string;
  btn?: string;
  buttons?: string[];
}

export interface BenchResult {
  mode: string;
  frames: number;
  durationMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMsAfterWarmup: number;
  maxDrawCalls: number;
  maxTriangles: number;
  avgDrawCalls: number;
  avgTriangles: number;
  renderer: string;
  isSoftwareRenderer: boolean;
  passed: boolean;
}

function mk(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function hexRgb(h: string): [number, number, number] {
  const clean = h.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

const lin = (h: string): THREE.Color => new THREE.Color(h);
const lam = (
  col: string,
  o: THREE.MeshLambertMaterialParameters = {}
): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color: col, ...o });

function canTex(c: HTMLCanvasElement, rx = 1, ry = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  if (rx !== 1 || ry !== 1) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
  }
  t.needsUpdate = true;
  return t;
}

function planks(): HTMLCanvasElement {
  const c = mk(64, 64);
  const x = c.getContext("2d")!;
  const cols = [C.rust, C.rust, C.mauve, C.rust];
  for (let r = 0; r < 8; r++) {
    x.fillStyle = cols[r % 4];
    x.fillRect(0, r * 8, 64, 8);
    x.fillStyle = C.mauve;
    x.fillRect(0, r * 8 + 7, 64, 1);
    x.fillRect(((r * 23) % 56) + 4, r * 8, 1, 7);
    x.fillStyle = r % 2 ? C.brown : C.tan;
    x.fillRect((r * 17) % 60, r * 8 + 3, 5, 1);
  }
  return c;
}

function rugTex(): HTMLCanvasElement {
  const c = mk(48, 32);
  const x = c.getContext("2d")!;
  x.fillStyle = C.plum;
  x.fillRect(0, 0, 48, 32);
  x.fillStyle = C.dplum;
  x.fillRect(2, 2, 44, 28);
  x.fillStyle = C.salmon;
  x.fillRect(4, 4, 40, 24);
  x.fillStyle = C.crimson;
  x.fillRect(5, 5, 38, 22);
  for (let i = 0; i < 6; i++) {
    x.fillStyle = [C.orange, C.lpeach, C.pink][i % 3];
    x.fillRect(7 + i * 6, 8, 3, 16);
  }
  x.fillStyle = C.peach;
  for (let i = 0; i < 48; i += 2) {
    x.fillRect(i, 0, 1, 1);
    x.fillRect(i, 31, 1, 1);
  }
  return c;
}

function wallTex(): HTMLCanvasElement {
  const c = mk(32, 32);
  const x = c.getContext("2d")!;
  x.fillStyle = C.mauve;
  x.fillRect(0, 0, 32, 32);
  x.fillStyle = C.dplum;
  x.fillRect(0, 0, 14, 32);
  x.fillStyle = C.tan;
  x.fillRect(22, 10, 1, 1);
  x.fillRect(6, 26, 1, 1);
  return c;
}

function windowTex(sunDropOffset = 0): HTMLCanvasElement {
  const c = mk(64, 52);
  const x = c.getContext("2d")!;
  ditherVerticalGradient(x, 0, 0, 64, 52, [
    C.navy,
    C.dmauve,
    C.plum,
    C.crimson,
    C.salmon,
    C.dorange,
    C.orange,
    C.yellow,
  ]);
  ditherDisc(x, 40, Math.round(40 + sunDropOffset), 11, C.yellow, C.orange, 3);
  x.fillStyle = C.lpeach;
  x.fillRect(6, 14, 14, 2);
  x.fillRect(10, 12, 7, 2);
  x.fillRect(44, 8, 12, 2);
  x.fillRect(48, 6, 5, 2);
  // rooftops silhouette
  x.fillStyle = C.dplum;
  const r = [44, 42, 46, 40, 43, 38, 45, 41, 44, 47, 42, 39, 44, 46, 43, 45];
  r.forEach((h, i) => x.fillRect(i * 4, h, 4, 52 - h));
  x.fillStyle = C.yellow;
  [
    [5, 46],
    [13, 44],
    [26, 45],
    [41, 48],
    [53, 47],
  ].forEach(([a, b]) => x.fillRect(a, b, 1, 1));
  x.fillStyle = C.lyellow;
  x.fillRect(3, 3, 1, 1);
  x.fillRect(22, 6, 1, 1);
  x.fillRect(58, 3, 1, 1);
  return c;
}

/**
 * Merge an array of positioned/rotated BufferGeometries into a single BufferGeometry
 * so static room props with identical materials render in 1 draw call.
 */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  let hasUv = false;
  let hasColor = false;

  for (const g of geos) {
    const pos = g.attributes.position;
    totalVerts += pos.count;
    if (g.index) totalIndices += g.index.count;
    else totalIndices += pos.count;
    if (g.attributes.uv) hasUv = true;
    if (g.attributes.color) hasColor = true;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = hasUv ? new Float32Array(totalVerts * 2) : null;
  const colors = hasColor ? new Float32Array(totalVerts * 3) : null;
  const indices = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;

  for (const g of geos) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const uv = g.attributes.uv;
    const col = g.attributes.color;
    const count = pos.count;

    for (let i = 0; i < count; i++) {
      positions[(vOffset + i) * 3] = pos.getX(i);
      positions[(vOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vOffset + i) * 3 + 2] = pos.getZ(i);
      if (norm) {
        normals[(vOffset + i) * 3] = norm.getX(i);
        normals[(vOffset + i) * 3 + 1] = norm.getY(i);
        normals[(vOffset + i) * 3 + 2] = norm.getZ(i);
      }
      if (uvs && uv) {
        uvs[(vOffset + i) * 2] = uv.getX(i);
        uvs[(vOffset + i) * 2 + 1] = uv.getY(i);
      }
      if (colors && col) {
        colors[(vOffset + i) * 3] = col.getX(i);
        colors[(vOffset + i) * 3 + 1] = col.getY(i);
        colors[(vOffset + i) * 3 + 2] = col.getZ(i);
      }
    }

    if (g.index) {
      const idxAttr = g.index;
      for (let i = 0; i < idxAttr.count; i++) {
        indices[iOffset + i] = idxAttr.getX(i) + vOffset;
      }
      iOffset += idxAttr.count;
    } else {
      for (let i = 0; i < count; i++) {
        indices[iOffset + i] = vOffset + i;
      }
      iOffset += count;
    }

    vOffset += count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  if (uvs) merged.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  if (colors) merged.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

interface ButtonAnimState {
  mesh: THREE.Mesh;
  basePos: THREE.Vector3;
  pressOffset: number;
  targetPress: number;
  mat: THREE.MeshStandardMaterial;
  baseEmissiveIntensity: number;
}

interface JoystickAnimState {
  ballMeshes: THREE.Mesh[];
  shaftMeshes: THREE.Mesh[];
  ballBasePos: THREE.Vector3[];
  shaftBasePos: THREE.Vector3[];
  tiltX: number;
  tiltZ: number;
  targetTiltX: number;
  targetTiltZ: number;
  releaseTimer: number;
}

export class ArcadeStage {
  private container: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;

  // Low-res pixel pipeline + crisp layer (ported 1:1 from mocks/playglow/index.html lines 617–686)
  private rtScene!: THREE.WebGLRenderTarget;
  private rtPost!: THREE.WebGLRenderTarget;
  private quantMat!: THREE.ShaderMaterial;
  private blitMat!: THREE.ShaderMaterial;
  private depthOnly!: THREE.MeshBasicMaterial;
  private postScene!: THREE.Scene;
  private postCam!: THREE.OrthographicCamera;
  private postQuad!: THREE.Mesh;
  private pxs = 3;
  private rw = 1;
  private rh = 1;
  private customPxs: number | null = null;
  private postEnabled = true;

  // CRT & Attract / Mock states
  private crtTex: THREE.DataTexture;
  private crtMat: THREE.ShaderMaterial;
  private attractScreen: AttractScreen;
  private usingAttract = true;
  private fixedTime: number | null = null;
  private reducedMotion = false;

  // Cabinet & Room references
  private cabinetGroup: THREE.Group = new THREE.Group();
  private cabinetRoot: THREE.Group | null = null;
  private dustPoints: THREE.Points | null = null;
  private windowMesh: THREE.Mesh | null = null;
  private lampShadeMesh: THREE.Mesh | null = null;
  private stringLightsMesh: THREE.Mesh | null = null;
  private windowScenery: WindowScenery = new WindowScenery();
  private lastSunDropStep = -1;
  public onDayNightChange?: (state: DayNightState) => void;

  // Lights from mocks/playglow/index.html
  private hemiLight!: THREE.HemisphereLight;
  private rimLight!: THREE.DirectionalLight;
  private rim2Light!: THREE.DirectionalLight;
  private keySpotLight!: THREE.SpotLight;
  private sunLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private lampLight!: THREE.PointLight;
  private screenLight!: THREE.PointLight;
  private screenLightTargetColor = new THREE.Color(C.orange);

  // Cabinet materials
  private matCabinetBody!: THREE.MeshStandardMaterial;
  private matMarquee!: THREE.MeshStandardMaterial;
  private matSidePanel!: THREE.MeshStandardMaterial;
  private matTrim!: THREE.MeshStandardMaterial;
  private matControlBase!: THREE.MeshStandardMaterial;
  private matButtonsPrimary!: THREE.MeshStandardMaterial;
  private matButtonsSecondary!: THREE.MeshStandardMaterial;

  // Live offscreen canvases for marquee (288x40) and side (100x202) progressive wipes / switch dissolve
  private currentMarqueeCanvas: HTMLCanvasElement;
  private currentSideCanvas: HTMLCanvasElement;
  private marqueeTex: THREE.CanvasTexture;
  private sideTex: THREE.CanvasTexture;

  // Active progressive wipes & switch transitions
  private activeMarqueeWipe: {
    from: HTMLCanvasElement;
    to: HTMLCanvasElement;
    elapsed: number;
    duration: number;
    resolve?: () => void;
  } | null = null;

  private activeSideWipe: {
    from: HTMLCanvasElement;
    to: HTMLCanvasElement;
    elapsed: number;
    duration: number;
    resolve?: () => void;
  } | null = null;

  private activeSwitch: {
    fromMq: HTMLCanvasElement;
    toMq: HTMLCanvasElement;
    fromSd: HTMLCanvasElement;
    toSd: HTMLCanvasElement;
    fromTrim: THREE.Color;
    toTrim: THREE.Color;
    fromBody: THREE.Color;
    toBody: THREE.Color;
    fromBtn: THREE.Color;
    toBtn: THREE.Color;
    elapsed: number;
    duration: number;
    continuousMock?: boolean;
    onComplete?: () => void;
    resolve?: () => void;
  } | null = null;

  private mockBuildCtx: {
    fullMq: HTMLCanvasElement;
    fullSd: HTMLCanvasElement;
    blankMq: HTMLCanvasElement;
    blankSd: HTMLCanvasElement;
  } | null = null;

  private buttonStates: Map<string, ButtonAnimState> = new Map();
  private joystickState: JoystickAnimState = {
    ballMeshes: [],
    shaftMeshes: [],
    ballBasePos: [],
    shaftBasePos: [],
    tiltX: 0,
    tiltZ: 0,
    targetTiltX: 0,
    targetTiltZ: 0,
    releaseTimer: 0,
  };

  // Camera framing & spring state (ported from mocks/playglow/index.html lines 968–985)
  private cameraMode: StepCameraMode = "create";
  private camDesiredPos = new THREE.Vector3(0.95, 1.22, 2.2);
  private camDesiredTarget = new THREE.Vector3(0.0, 0.9, 0.0);
  private camDesiredFov = 30;
  private camDesiredShiftX = -0.3;

  private camCurrentPos = new THREE.Vector3(0.95, 1.22, 2.2);
  private camCurrentTarget = new THREE.Vector3(0.0, 0.9, 0.0);
  private camCurrentFov = 30;
  private camCurrentShiftX = -0.3;

  private camVelPos = new THREE.Vector3();
  private camVelTarget = new THREE.Vector3();
  private camVelFov = 0;
  private camVelShiftX = 0;

  // Mouse pointer orbit state (only active during Create / Build / Attract, never during Play)
  private pointerTargetX = 0;
  private pointerTargetY = 0;
  private boundOnPointerMove: (e: PointerEvent) => void;
  private boundOnPointerReset: () => void;

  // Live cartridge <-> 3D cabinet reactive FX state
  private fxGlowBoost = 0;
  private fxJoltAmp = 0;
  private fxJoltPhase = 0;
  private fxJoltDir = 1;
  private baseTrimGlow = 0.9;
  private baseScreenGlow = 1.4;

  private currentVibe: VibeId = "sunset";
  private lastCard: GameDesignCard | null = null;
  private hasCustomSkin = false;
  private skinApplySeq = 0;
  private lastWipedBannerKey: unknown = undefined;
  private lastWipedSideKey: unknown = undefined;

  private clock = new THREE.Clock();
  private t0 = performance.now();
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private boundOnWindowResize: () => void;
  private destroyed = false;
  private powerAnimState: { active: boolean; elapsed: number } = {
    active: false,
    elapsed: 0,
  };
  private gui: GUI | null = null;

  // Benchmark recording state
  private benchRecording: {
    frameTimes: number[];
    drawCalls: number[];
    triangles: number[];
    lastFrameStamp: number;
  } | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.crtTex = createCrtDataTexture(320, 200);
    this.attractScreen = new AttractScreen(320, 200);
    this.crtMat = makeCRTMaterial(this.attractScreen.texture);

    this.currentMarqueeCanvas = pendingMarquee("JAMES");
    this.currentSideCanvas = blankSide();
    this.marqueeTex = canTex(this.currentMarqueeCanvas);
    this.sideTex = canTex(this.currentSideCanvas);

    this.boundOnWindowResize = () => this.handleResize();
    this.boundOnPointerMove = (e: PointerEvent) => {
      if (typeof window === "undefined") return;
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      this.pointerTargetX = Math.max(-1, Math.min(1, (e.clientX / w) * 2 - 1));
      this.pointerTargetY = Math.max(-1, Math.min(1, -((e.clientY / h) * 2 - 1)));
    };
    this.boundOnPointerReset = () => {
      this.pointerTargetX = 0;
      this.pointerTargetY = 0;
    };

    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search);
      if (q.has("t")) {
        const parsed = parseFloat(q.get("t") || "0");
        if (!Number.isNaN(parsed)) this.fixedTime = parsed;
      }
      if (q.get("post") === "0") {
        this.postEnabled = false;
      }
      if (typeof window.matchMedia === "function") {
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }
    }
  }

  public async init(): Promise<void> {
    if (this.destroyed) return;

    // Preload pixel & UI fonts like mocks/playglow/index.html line 1000
    if (typeof document !== "undefined" && document.fonts) {
      await Promise.allSettled([
        document.fonts.load('16px "Press Start 2P"'),
        document.fonts.load('8px "Press Start 2P"'),
        document.fonts.load('700 34px "Bricolage Grotesque"'),
        document.fonts.load('500 14px "JetBrains Mono"'),
      ]);
    }

    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.imageRendering = "pixelated";
    this.container.appendChild(this.renderer.domElement);

    // Scene & Dusk Fog (exact from mocks/playglow/index.html lines 623–626)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(C.dplum).convertSRGBToLinear();
    this.scene.fog = new THREE.Fog(
      new THREE.Color(C.dplum).convertSRGBToLinear(),
      5,
      12
    );

    this.camera = new THREE.PerspectiveCamera(30, width / height, 0.05, 50);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.enabled = false;

    // Setup Low-Res Pixel Pipeline + Crisp Layer (exact from mocks/playglow/index.html lines 628–675)
    this.initPixelPipeline();

    // Build Dusk Room & Lights (exact from mocks/playglow/index.html lines 753–829)
    this.buildRoom();

    // Init Cabinet Materials & Load GLB
    this.initCabinetMaterials();
    await Promise.all([loadBaseCabinetImage(), this.loadCabinetModel()]);

    // Configure initial state from URL query params (?state=create|build|play|switch, ?q=genre, ?uvtest=1)
    this.applyInitialUrlState();

    // Resize & frame camera
    this.handleResize(true);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.container);
    }
    window.addEventListener("resize", this.boundOnWindowResize);
    window.addEventListener("pointermove", this.boundOnPointerMove, { passive: true });
    window.addEventListener("blur", this.boundOnPointerReset);
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.addEventListener("mouseleave", this.boundOnPointerReset);
    }

    // Optional ?debug GUI
    if (typeof window !== "undefined") {
      window.__ARCADE_STAGE__ = this;
      window.__PLAYGLOW_STAGE__ = this;
      const q = new URLSearchParams(window.location.search);
      if (q.has("debug")) {
        this.initDebugGui();
      }
      if (q.has("bench")) {
        window.__BENCH_RUNNING__ = true;
        const isFast = q.get("bench") === "fast";
        setTimeout(() => {
          this.runBenchmark({ fast: isFast }).catch((err) => {
            console.error("[bench] error:", err);
          });
        }, 50);
      }
    }

    this.clock.start();
    this.t0 = performance.now();
    const tick = () => {
      if (this.destroyed) return;
      this.rafId = requestAnimationFrame(tick);
      this.updateFrame();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private initPixelPipeline(): void {
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.rtPost = new THREE.WebGLRenderTarget(4, 4, {
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      depthBuffer: false,
    });

    const palUniform = PALETTE_32.map(
      (h) => new THREE.Vector3(...hexRgb(h).map((v) => v / 255))
    );

    this.quantMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rtScene.texture },
        res: { value: new THREE.Vector2(1, 1) },
        pal: { value: palUniform },
        dither: { value: 0.035 },
        enable: { value: this.postEnabled ? 1 : 0 },
        exposure: { value: 1.0 },
        vig: { value: 1.25 },
        bloomGain: { value: 0.07 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0., 1.);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec2 res;
        uniform vec3 pal[32];
        uniform float dither, enable, exposure, vig, bloomGain;
        varying vec2 vUv;

        float b2(vec2 a) {
          a = floor(a);
          return fract(dot(a, vec2(.5, a.y * .75)));
        }
        float b4(vec2 a) {
          return b2(.5 * a) * .25 + b2(a);
        }

        void main() {
          vec2 px = 1. / res;
          vec3 c = texture2D(tScene, vUv).rgb * exposure;
          vec3 g = vec3(0.);
          for (int i = 0; i < 10; i++) {
            float a = float(i) * .6283;
            vec2 o = vec2(cos(a), sin(a));
            g += max(texture2D(tScene, vUv + o * px * 2.).rgb - .7, 0.);
            g += max(texture2D(tScene, vUv + o * px * 5.).rgb - .7, 0.) * .7;
          }
          c += g * bloomGain;
          vec3 s = pow(clamp(c, 0., 1.), vec3(1. / 2.2));
          vec2 q = vUv - .5;
          s *= 1. - dot(q * vec2(1., .8), q) * vig;
          if (enable < .5) {
            gl_FragColor = vec4(s, 1.);
            return;
          }
          s = max(s, vec3(.20, .11, .14));
          float lum = dot(s, vec3(.299, .587, .114));
          s += (b4(gl_FragCoord.xy) - .5) * dither * smoothstep(.12, .35, lum);
          float best = 1e9;
          vec3 bc = vec3(0.);
          for (int i = 0; i < 32; i++) {
            vec3 p = pal[i];
            vec3 e = s - p;
            float rm = (s.r + p.r) * .5;
            float d = (2. + rm) * e.r * e.r + 4. * e.g * e.g + (3. - rm) * e.b * e.b;
            if (d < best) {
              best = d;
              bc = p;
            }
          }
          gl_FragColor = vec4(bc, 1.);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.blitMat = new THREE.ShaderMaterial({
      uniforms: {
        tPost: { value: this.rtPost.texture },
        px: { value: 3 },
        rsize: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = vec4(position.xy, 0., 1.);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tPost;
        uniform float px;
        uniform vec2 rsize;
        void main() {
          vec2 uv = (floor(gl_FragCoord.xy / px) + .5) / rsize;
          gl_FragColor = texture2D(tPost, uv);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quantMat);
    this.postQuad.frustumCulled = false;
    this.postScene.add(this.postQuad);
  }

  /**
   * Ported 1:1 from mocks/playglow/index.html buildRoom() (lines 753–829).
   * Static same-material boxes and the 40 string-light bulbs are merged by material
   * so the room looks 100% identical while staying well under the 120 draw-call budget.
   */
  private buildRoom(): void {
    const room = new THREE.Group();
    room.name = "DuskArcadeRoom";

    // Wooden plank floor (64x64 canvas repeated 7x7 on 14x14 PlaneGeometry at (0, 0, -1))
    const floorMat = lam("#ffffff", { map: canTex(planks(), 7, 7) });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -1);
    floor.receiveShadow = true;
    room.add(floor);

    const wz = -1.8;
    const wx = -0.9;
    const wy = 1.6;
    const ww = 2.6;
    const wh = 1.5;

    // Back wall built around an expansive scenic window hole
    const wallPiece = (x0: number, x1: number, y0: number, y1: number) => {
      const w = x1 - x0;
      const h = y1 - y0;
      const t = canTex(wallTex(), w / 0.78, 1);
      t.offset.x = x0 / 0.78;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, 0.06),
        lam("#ffffff", { map: t })
      );
      const g = m.geometry.attributes.uv;
      for (let i = 0; i < g.count; i++) {
        g.setY(i, (y0 + g.getY(i) * h) / 4.2);
      }
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, wz - 0.03);
      m.castShadow = true;
      m.receiveShadow = true;
      room.add(m);
    };
    wallPiece(-7, wx - ww / 2, 0, 4.2);
    wallPiece(wx + ww / 2, 7, 0, 4.2);
    wallPiece(wx - ww / 2, wx + ww / 2, 0, wy - wh / 2);
    wallPiece(wx - ww / 2, wx + ww / 2, wy + wh / 2, 4.2);

    // Left wall
    const lwall = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 4.2),
      lam("#ffffff", { map: canTex(wallTex(), 13, 1) })
    );
    lwall.rotation.y = Math.PI / 2;
    lwall.position.set(-4.2, 2.1, wz + 5);
    lwall.receiveShadow = true;
    room.add(lwall);

    // Scenic window with living day/night pixel landscape
    this.windowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(ww, wh),
      new THREE.MeshBasicMaterial({
        map: this.windowScenery.getTexture(),
        color: lin("#ffffff"),
      })
    );
    this.windowMesh.position.set(wx, wy, wz - 0.05);
    room.add(this.windowMesh);

    // Helper to build positioned/rotated box geometry for material-grouped merging
    const makeBoxGeo = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      ry = 0,
      rx = 0,
      rz = 0
    ): THREE.BufferGeometry => {
      const g = new THREE.BoxGeometry(w, h, d);
      const m4 = new THREE.Matrix4();
      const euler = new THREE.Euler(rx, ry, rz, "XYZ");
      m4.makeRotationFromEuler(euler);
      m4.setPosition(x, y, z);
      g.applyMatrix4(m4);
      return g;
    };

    // Rust boxes: skirting board + window frame with mullions and transom
    const rustGeos = [
      makeBoxGeo(14, 0.14, 0.04, 0, 0.07, wz + 0.02),
      makeBoxGeo(ww + 0.14, 0.08, 0.08, wx, wy + wh / 2, wz + 0.04),
      makeBoxGeo(0.08, wh, 0.08, wx - ww / 2, wy, wz + 0.04),
      makeBoxGeo(0.08, wh, 0.08, wx + ww / 2, wy, wz + 0.04),
      makeBoxGeo(0.045, wh, 0.05, wx - ww * 0.28, wy, wz + 0.01),
      makeBoxGeo(0.045, wh, 0.05, wx + ww * 0.28, wy, wz + 0.01),
      makeBoxGeo(ww, 0.045, 0.05, wx, wy, wz + 0.01),
    ];
    const rustMesh = new THREE.Mesh(mergeGeometries(rustGeos), lam(C.rust));
    rustMesh.castShadow = true;
    rustMesh.receiveShadow = true;
    room.add(rustMesh);

    // Brown window sill
    const sillMesh = new THREE.Mesh(
      makeBoxGeo(ww + 0.26, 0.07, 0.22, wx, wy - wh / 2 - 0.02, wz + 0.1),
      lam(C.brown)
    );
    sillMesh.castShadow = true;
    sillMesh.receiveShadow = true;
    room.add(sillMesh);

    // Crimson curtains framing the scenery
    const curtainGeos = [
      makeBoxGeo(0.28, wh + 0.4, 0.06, wx - ww / 2 - 0.18, wy - 0.06, wz + 0.1),
      makeBoxGeo(0.28, wh + 0.4, 0.06, wx + ww / 2 + 0.18, wy - 0.06, wz + 0.1),
    ];
    const curtainMesh = new THREE.Mesh(mergeGeometries(curtainGeos), lam(C.crimson));
    curtainMesh.castShadow = true;
    curtainMesh.receiveShadow = true;
    room.add(curtainMesh);

    // Floor lamp + curtain rod (dbrown)
    const lx = 1.45;
    const lz = -1.15;
    const dbrownGeos = [
      makeBoxGeo(ww + 0.9, 0.05, 0.05, wx, wy + wh / 2 + 0.16, wz + 0.12),
      makeBoxGeo(0.32, 0.04, 0.32, lx, 0.02, lz),
      makeBoxGeo(0.035, 1.45, 0.035, lx, 0.74, lz),
    ];
    const dbrownMesh = new THREE.Mesh(mergeGeometries(dbrownGeos), lam(C.dbrown));
    dbrownMesh.castShadow = true;
    dbrownMesh.receiveShadow = true;
    room.add(dbrownMesh);

    // Lamp shade with night glow support
    const shadeMat = new THREE.MeshStandardMaterial({
      color: lin(C.peach).multiplyScalar(0.7),
      emissive: lin(C.orange),
      emissiveIntensity: 0.25,
      side: THREE.DoubleSide,
      roughness: 0.7,
    });
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.26, 0.3, 8, 1, true),
      shadeMat
    );
    shade.position.set(lx, 1.55, lz);
    room.add(shade);
    this.lampShadeMesh = shade;

    // Potted plant (plx = -0.72, plz = -1.45) + cactus on sill
    const plx = -0.72;
    const plz = -1.45;
    const potGeo = new THREE.CylinderGeometry(0.17, 0.13, 0.32, 8);
    potGeo.translate(plx, 0.16, plz);
    const cactusPotGeo = makeBoxGeo(
      0.12,
      0.1,
      0.12,
      wx - ww * 0.35,
      wy - wh / 2 + 0.06,
      wz + 0.1
    );
    const potsMesh = new THREE.Mesh(
      mergeGeometries([potGeo, cactusPotGeo]),
      lam(C.dorange)
    );
    potsMesh.castShadow = true;
    potsMesh.receiveShadow = true;
    room.add(potsMesh);

    const mgreenGeos: THREE.BufferGeometry[] = [
      makeBoxGeo(0.06, 0.16, 0.06, wx - ww * 0.35, wy - wh / 2 + 0.19, wz + 0.1),
    ];
    const greenGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const l = 0.3 + (i % 3) * 0.1;
      const g = new THREE.BoxGeometry(0.08, l, 0.03);
      const leafMesh = new THREE.Mesh(g);
      leafMesh.position.set(
        plx + Math.cos(a) * 0.06,
        0.32 + l / 2,
        plz + Math.sin(a) * 0.06
      );
      leafMesh.rotation.y = a;
      leafMesh.rotation.z = Math.cos(a) * 0.45;
      leafMesh.rotation.x = Math.sin(a) * 0.45;
      leafMesh.updateMatrix();
      g.applyMatrix4(leafMesh.matrix);
      if (i % 2) mgreenGeos.push(g);
      else greenGeos.push(g);
    }
    const mgreenMesh = new THREE.Mesh(mergeGeometries(mgreenGeos), lam(C.mgreen));
    mgreenMesh.castShadow = true;
    mgreenMesh.receiveShadow = true;
    room.add(mgreenMesh);

    const greenMesh = new THREE.Mesh(mergeGeometries(greenGeos), lam(C.green));
    greenMesh.castShadow = true;
    greenMesh.receiveShadow = true;
    room.add(greenMesh);

    // 40 string lights along the back wall (merged into 1 mesh with vertex colors)
    const bulbCols = [C.orange, C.pink, C.yellow, C.blue, C.lime];
    const bulbGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 40; i++) {
      const t = i / 39;
      const x = -5 + t * 10;
      const y = 2.6 - Math.sin(((t * 5) % 1) * Math.PI) * 0.2;
      const bg = makeBoxGeo(0.05, 0.06, 0.05, x, y, wz + 0.06);
      const col = lin(bulbCols[i % 5]).multiplyScalar(0.45);
      const vCount = bg.attributes.position.count;
      const cArr = new Float32Array(vCount * 3);
      for (let v = 0; v < vCount; v++) {
        cArr[v * 3] = col.r;
        cArr[v * 3 + 1] = col.g;
        cArr[v * 3 + 2] = col.b;
      }
      bg.setAttribute("color", new THREE.BufferAttribute(cArr, 3));
      bulbGeos.push(bg);
    }
    const stringLightsMesh = new THREE.Mesh(
      mergeGeometries(bulbGeos),
      new THREE.MeshBasicMaterial({ vertexColors: true })
    );
    room.add(stringLightsMesh);
    this.stringLightsMesh = stringLightsMesh;

    // Blue beanbag sitting in the sun patch + woven rug
    const bb = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 7), lam(C.dblue));
    bb.scale.set(1, 0.6, 1);
    bb.position.set(-1.45, 0.2, 0.05);
    bb.castShadow = true;
    bb.receiveShadow = true;
    room.add(bb);

    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 1.4),
      lam("#ffffff", { map: canTex(rugTex()) })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.1, 0.006, 0.55);
    rug.receiveShadow = true;
    room.add(rug);

    // Floating window dust motes (BRIEF.md §7)
    const dustCount = 42;
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      // Seeded deterministic positions in the sunlight beam
      const s1 = Math.sin(i * 12.9898) * 43758.5453;
      const s2 = Math.sin(i * 78.233) * 43758.5453;
      const s3 = Math.sin(i * 39.346) * 43758.5453;
      const rx = s1 - Math.floor(s1);
      const ry = s2 - Math.floor(s2);
      const rz = s3 - Math.floor(s3);
      dustPos[i * 3] = -2.0 + rx * 2.8;
      dustPos[i * 3 + 1] = 0.25 + ry * 1.9;
      dustPos[i * 3 + 2] = -1.4 + rz * 2.2;
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      color: lin(C.peach),
      size: 0.025,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.dustPoints = new THREE.Points(dustGeo, dustMat);
    room.add(this.dustPoints);

    this.scene.add(room);

    // Exact lights from mocks/playglow/index.html lines 801 & 816–828
    this.lampLight = new THREE.PointLight(lin(C.orange), 2.2, 6, 1.4);
    this.lampLight.position.set(lx, 1.45, lz + 0.05);
    this.scene.add(this.lampLight);

    this.hemiLight = new THREE.HemisphereLight(lin(C.lpeach), lin(C.dplum), 0.7);
    this.scene.add(this.hemiLight);

    this.rimLight = new THREE.DirectionalLight(lin(C.dorange), 2.6);
    this.rimLight.position.set(2.2, 2.6, -2.2);
    this.rimLight.target.position.set(0, 0.8, 0.2);
    this.scene.add(this.rimLight, this.rimLight.target);

    this.rim2Light = new THREE.DirectionalLight(lin(C.pink), 1.2);
    this.rim2Light.position.set(-2.4, 2.2, -1.8);
    this.rim2Light.target.position.set(0, 0.8, 0.2);
    this.scene.add(this.rim2Light, this.rim2Light.target);

    this.keySpotLight = new THREE.SpotLight(lin(C.peach), 3.2, 8, 0.45, 0.8, 1.2);
    this.keySpotLight.position.set(-0.8, 2.8, 2.6);
    this.keySpotLight.target.position.set(0, 0.8, 0);
    this.scene.add(this.keySpotLight, this.keySpotLight.target);

    this.sunLight = new THREE.DirectionalLight(lin(C.orange), 2.6);
    this.sunLight.position.set(wx - 0.9, 4.6, wz - 2.4);
    this.sunLight.target.position.set(wx + 0.8, 0, wz + 2.6);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sunLight.shadow.camera, {
      left: -4,
      right: 4,
      top: 4,
      bottom: -4,
      near: 0.5,
      far: 14,
    });
    this.sunLight.shadow.bias = -0.002;
    this.scene.add(this.sunLight, this.sunLight.target);

    this.fillLight = new THREE.DirectionalLight(lin(C.pink), 0.35);
    this.fillLight.position.set(3, 2.5, 3);
    this.scene.add(this.fillLight);

    // screenGlow PointLight at [0, 0.85, 0.75] (mocks/playglow/index.html line 997)
    this.screenLight = new THREE.PointLight(lin(C.orange), 1.4, 2.6, 1.6);
    this.screenLight.position.set(0, 0.85, 0.75);
    this.scene.add(this.screenLight);
  }

  private initCabinetMaterials(): void {
    // Matches mocks/shared/arcade.js applySkin + mocks/playglow/index.html tuneCab
    this.matCabinetBody = new THREE.MeshStandardMaterial({
      name: "Mat_Cabinet",
      color: C.dplum,
      roughness: 0.55,
      metalness: 0.05,
    });

    this.matMarquee = new THREE.MeshStandardMaterial({
      name: "Mat_Marquee",
      color: "#ffffff",
      map: this.marqueeTex,
      emissive: new THREE.Color("#ffffff"),
      emissiveMap: this.marqueeTex,
      emissiveIntensity: 1.0,
      roughness: 0.4,
      metalness: 0.05,
      fog: false,
    });

    this.matSidePanel = new THREE.MeshStandardMaterial({
      name: "Mat_SidePanel",
      color: "#ffffff",
      map: this.sideTex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: this.sideTex,
      emissiveIntensity: 0.3,
      roughness: 0.8,
      metalness: 0.05,
    });

    this.matTrim = new THREE.MeshStandardMaterial({
      name: "Mat_Trim",
      color: C.orange,
      emissive: new THREE.Color(C.orange),
      emissiveIntensity: 0.9,
      roughness: 0.3,
    });

    this.matControlBase = new THREE.MeshStandardMaterial({
      name: "Mat_Control_Base",
      color: "#111118",
      roughness: 0.7,
    });

    this.matButtonsPrimary = new THREE.MeshStandardMaterial({
      name: "Mat_Buttons",
      color: C.dorange,
      emissive: new THREE.Color(C.dorange),
      emissiveIntensity: 0.25,
      roughness: 0.3,
    });

    this.matButtonsSecondary = new THREE.MeshStandardMaterial({
      name: "Mat_Buttons_Secondary",
      color: C.yellow,
      emissive: new THREE.Color(C.yellow),
      emissiveIntensity: 0.25,
      roughness: 0.3,
    });
  }

  private async loadCabinetModel(): Promise<void> {
    const loader = new GLTFLoader();
    const candidateUrls = ["assets/arcade.glb", "assets/cabinet.glb"];

    for (const url of candidateUrls) {
      try {
        const gltf = await loader.loadAsync(url);
        this.cabinetRoot = gltf.scene;
        break;
      } catch {
        // Try next URL
      }
    }

    if (!this.cabinetRoot) {
      this.cabinetRoot = this.buildFallbackCabinet();
    }

    // Ensure cabinet scale/position matches mocks/shared/arcade.js (height 1.417m, floor y=0, centered X/Z)
    this.cabinetRoot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.cabinetRoot);
    const height = box.max.y - box.min.y;
    if (height > 2.0) {
      // If an unscaled or oversized GLB is loaded, normalize to 1.417m tall like mocks/shared/arcade.js
      const scale = 1.417 / height;
      this.cabinetRoot.scale.multiplyScalar(scale);
      this.cabinetRoot.updateMatrixWorld(true);
      box.setFromObject(this.cabinetRoot);
      this.cabinetRoot.position.x -= (box.min.x + box.max.x) / 2;
      this.cabinetRoot.position.z -= (box.min.z + box.max.z) / 2;
      this.cabinetRoot.position.y -= box.min.y;
    }

    this.buttonStates.clear();
    this.joystickState.ballMeshes = [];
    this.joystickState.shaftMeshes = [];
    this.joystickState.ballBasePos = [];
    this.joystickState.shaftBasePos = [];

    const coindoorMat = new THREE.MeshStandardMaterial({
      color: "#2a2a2a",
      metalness: 0.8,
      roughness: 0.35,
    });
    const speakerGrilleMat = new THREE.MeshStandardMaterial({
      color: "#050507",
      roughness: 0.9,
    });
    const shaftMat = new THREE.MeshStandardMaterial({
      color: "#9aa0b4",
      metalness: 0.9,
      roughness: 0.2,
    });
    const ringMat = new THREE.MeshStandardMaterial({
      color: "#111111",
      roughness: 0.5,
    });

    this.cabinetRoot.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      mesh.receiveShadow = true;

      const name = (mesh.name || "").toLowerCase();

      if (name === "screen") {
        mesh.material = this.crtMat;
        mesh.layers.enable(1);
        mesh.layers.enable(2);
      } else if (name === "marquee_art") {
        mesh.material = this.matMarquee;
        mesh.layers.enable(1);
        mesh.layers.enable(2);
      } else if (name === "side_panel") {
        mesh.material = this.matSidePanel;
        mesh.castShadow = true;
        mesh.layers.enable(2);
      } else if (name === "tmolding") {
        mesh.material = this.matTrim;
        mesh.castShadow = true;
        mesh.layers.enable(2);
      } else if (name === "cp_surface") {
        mesh.material = this.matControlBase;
      } else if (name === "coindoor") {
        mesh.material = coindoorMat;
      } else if (name === "speaker_grille" || name === "speaker_grill") {
        mesh.material = speakerGrilleMat;
      } else if (name.startsWith("joystick_shaft")) {
        mesh.material = shaftMat;
        this.joystickState.shaftMeshes.push(mesh);
        this.joystickState.shaftBasePos.push(mesh.position.clone());
      } else if (name === "joystick_ring" || name === "button_ring") {
        mesh.material = ringMat;
      } else if (name.startsWith("joystick_ball")) {
        const ballMat = this.matButtonsPrimary.clone();
        ballMat.roughness = 0.25;
        ballMat.emissiveIntensity = 0.15;
        mesh.material = ballMat;
        this.joystickState.ballMeshes.push(mesh);
        this.joystickState.ballBasePos.push(mesh.position.clone());
      } else if (name.startsWith("button")) {
        const idxMatch = name.match(/button_(\d+)/);
        const idx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
        const baseMat =
          idx % 2 === 0 ? this.matButtonsPrimary : this.matButtonsSecondary;
        const instMat = baseMat.clone();
        mesh.material = instMat;
        this.buttonStates.set(mesh.name, {
          mesh,
          basePos: mesh.position.clone(),
          pressOffset: 0,
          targetPress: 0,
          mat: instMat,
          baseEmissiveIntensity: 0.25,
        });
      } else {
        // cabinet_body, coindoor_frame, bezel, marquee_frame, speaker_frame
        mesh.material = this.matCabinetBody;
        mesh.castShadow = true;
        mesh.layers.enable(2);
      }
    });

    this.cabinetGroup.name = "CabinetGroup";
    this.cabinetGroup.position.set(0, 0, 0);
    this.cabinetGroup.rotation.set(0, 0, 0);
    this.cabinetGroup.clear();
    this.cabinetGroup.add(this.cabinetRoot);
    this.scene.add(this.cabinetGroup);
  }

  private buildFallbackCabinet(): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.67, 1.417, 0.7),
      this.matCabinetBody
    );
    body.name = "cabinet_body";
    body.position.set(0, 0.7085, 0);
    body.layers.enable(2);
    group.add(body);

    const side = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 1.417, 0.7),
      this.matSidePanel
    );
    side.name = "side_panel";
    side.position.set(0, 0.7085, 0);
    side.layers.enable(2);
    group.add(side);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.566, 0.343),
      this.crtMat
    );
    screen.name = "screen";
    screen.position.set(0, 0.96, 0.355);
    screen.rotation.x = -0.18;
    screen.layers.enable(1);
    screen.layers.enable(2);
    group.add(screen);

    const marquee = new THREE.Mesh(
      new THREE.PlaneGeometry(0.575, 0.075),
      this.matMarquee
    );
    marquee.name = "marquee_art";
    marquee.position.set(0, 1.32, 0.355);
    marquee.layers.enable(1);
    marquee.layers.enable(2);
    group.add(marquee);

    return group;
  }

  private applyInitialUrlState(): void {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const urlState = q.get("state");
    const qParam = q.get("q");
    const gameParam = (q.get("game") as MockGameKey) || "fox";

    if (q.has("tod")) {
      const todVal = q.get("tod")?.toLowerCase();
      if (todVal === "day") this.windowScenery.setTimeHours(12);
      else if (todVal === "sunset") this.windowScenery.setTimeHours(17.8);
      else if (todVal === "night") this.windowScenery.setTimeHours(0.5);
      else if (todVal === "dawn") this.windowScenery.setTimeHours(6.2);
      else if (todVal === "dusk") this.windowScenery.setTimeHours(20.5);
      else {
        const num = parseFloat(todVal || "17.5");
        if (!Number.isNaN(num)) this.windowScenery.setTimeHours(num);
      }
    }

    if (q.get("uvtest") === "1") {
      this.applyUvTestCard();
      return;
    }

    if (urlState === "build") {
      const foxSkin = getMockSkinCanvases("fox");
      this.mockBuildCtx = {
        fullMq: foxSkin.marquee,
        fullSd: foxSkin.side,
        blankMq: pendingMarquee("JAMES"),
        blankSd: blankSide(),
      };
      this.setCabinetColors({
        trim: foxSkin.def.trim,
        trimGlow: 0.9,
        body: foxSkin.def.body,
        btn: foxSkin.def.btn,
      });
      this.screenLight.color.copy(lin(C.orange));
      this.screenLight.intensity = 1.4;
      this.screenLightTargetColor.copy(lin(C.orange));
      this.attractScreen.setState({
        mode: "build",
        buildMode: true,
        buildTitle: "FOXFIRE RUN",
        genre: "runner",
      });
      this.setStepCamera("build");
      return;
    }

    if (urlState === "play") {
      this.applyMockGameSkin(gameParam);
      this.attractScreen.setState({
        mode: "play",
        buildMode: false,
        mockGameKey: gameParam,
        genre: MOCK_GAMES[gameParam]?.genre || "runner",
      });
      this.setStepCamera("play");
      return;
    }

    if (urlState === "switch") {
      const fromSkin = getMockSkinCanvases("fox");
      const toSkin = getMockSkinCanvases("comet");
      this.setCabinetColors({
        trim: toSkin.def.trim,
        trimGlow: 0.5,
        body: C.dnavy,
        btn: toSkin.def.btn,
      });
      this.screenLight.color.copy(lin(C.blue));
      this.screenLight.intensity = 0.7;
      this.screenLightTargetColor.copy(lin(C.blue));
      this.attractScreen.setState({
        mode: "switch",
        buildMode: false,
      });
      this.activeSwitch = {
        fromMq: fromSkin.marquee,
        toMq: toSkin.marquee,
        fromSd: fromSkin.side,
        toSd: toSkin.side,
        fromTrim: lin(fromSkin.def.trim),
        toTrim: lin(toSkin.def.trim),
        fromBody: lin(C.dnavy),
        toBody: lin(C.dnavy),
        fromBtn: lin(toSkin.def.btn),
        toBtn: lin(toSkin.def.btn),
        elapsed: 0,
        duration: 1.1,
        continuousMock: true,
      };
      this.setStepCamera("switch");
      return;
    }

    // Default: Create state (matches mocks/playglow/index.html lines 1003–1009)
    this.setMarqueeCanvas(pendingMarquee("JAMES"));
    this.setSideCanvas(blankSide());
    this.setCabinetColors({
      trim: C.dmauve,
      trimGlow: 0.3,
      body: C.dplum,
      btn: C.lgray,
    });
    this.screenLight.color.copy(lin(C.blue));
    this.screenLight.intensity = 1.4 * 0.8;
    this.screenLightTargetColor.copy(lin(C.blue));
    this.attractScreen.setState({
      mode: "create",
      buildMode: false,
      qStep: qParam === "genre" ? "genre" : "hero",
      step: qParam === "genre" ? 2 : 3,
      name: "JAMES",
      genre: "runner",
      hero: "a fox in a tiny blue scarf",
      vibe: "sunset",
      vibeSelected: false,
    });
    this.setStepCamera("create");
  }

  public applyMockGameSkin(key: MockGameKey): void {
    const skin = getMockSkinCanvases(key);
    this.setMarqueeCanvas(skin.marquee);
    this.setSideCanvas(skin.side);
    this.setCabinetColors({
      trim: skin.def.trim,
      trimGlow: 0.9,
      body: skin.def.body,
      btn: skin.def.btn,
    });
    this.screenLightTargetColor.copy(lin(skin.def.trim));
  }

  private setMarqueeCanvas(src: HTMLCanvasElement): void {
    if (this.activeMarqueeWipe) {
      this.activeMarqueeWipe.resolve?.();
      this.activeMarqueeWipe = null;
    }
    this.currentMarqueeCanvas.width = src.width;
    this.currentMarqueeCanvas.height = src.height;
    const ctx = this.currentMarqueeCanvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
    this.marqueeTex.needsUpdate = true;
  }

  private setSideCanvas(src: HTMLCanvasElement): void {
    if (this.activeSideWipe) {
      this.activeSideWipe.resolve?.();
      this.activeSideWipe = null;
    }
    this.currentSideCanvas.width = src.width;
    this.currentSideCanvas.height = src.height;
    const ctx = this.currentSideCanvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
    this.sideTex.needsUpdate = true;
  }

  private setCabinetColors(opts: {
    trim: string;
    trimGlow?: number;
    body?: string;
    btn?: string;
    buttons?: string[];
  }): void {
    if (this.matTrim) {
      this.matTrim.color.set(opts.trim);
      this.matTrim.emissive.set(opts.trim);
      const glow =
        opts.trimGlow !== undefined
          ? opts.trimGlow
          : opts.trim === C.dmauve
            ? 0.3
            : 0.9;
      this.baseTrimGlow = glow;
      this.matTrim.emissiveIntensity = glow;
    }
    if (opts.body && this.matCabinetBody) {
      this.matCabinetBody.color.set(opts.body);
    }
    const primaryBtn = opts.buttons?.[0] || opts.btn || C.dorange;
    const secondaryBtn = opts.buttons?.[1] || opts.btn || primaryBtn;
    if (this.matButtonsPrimary) {
      this.matButtonsPrimary.color.set(primaryBtn);
      this.matButtonsPrimary.emissive.set(primaryBtn);
    }
    if (this.matButtonsSecondary) {
      this.matButtonsSecondary.color.set(secondaryBtn);
      this.matButtonsSecondary.emissive.set(secondaryBtn);
    }
    this.buttonStates.forEach((bState, name) => {
      const idxMatch = name.match(/button_(\d+)/);
      const idx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
      const col =
        opts.buttons && opts.buttons.length > 0
          ? opts.buttons[idx % opts.buttons.length]
          : idx % 2 === 0
          ? primaryBtn
          : secondaryBtn;
      bState.mat.color.set(col);
      bState.mat.emissive.set(col);
    });
    this.joystickState.ballMeshes.forEach((mesh) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat && mat.color) {
        mat.color.set(primaryBtn);
        mat.emissive?.set(primaryBtn);
      }
    });
  }

  /**
   * Progressive left -> right marquee wipe with a 2px #FFF1E8 cream leading column
   * (Requirement 4, mocks/playglow/index.html lines 1039–1042).
   */
  public wipeMarqueeIn(
    canvas: HTMLCanvasElement,
    durationMs = 550
  ): Promise<void> {
    if (this.reducedMotion || this.fixedTime !== null || durationMs <= 0) {
      this.setMarqueeCanvas(canvas);
      return Promise.resolve();
    }
    if (this.activeMarqueeWipe) {
      this.activeMarqueeWipe.resolve?.();
      this.activeMarqueeWipe = null;
    }
    const fromCopy = mk(
      this.currentMarqueeCanvas.width,
      this.currentMarqueeCanvas.height
    );
    fromCopy.getContext("2d")!.drawImage(this.currentMarqueeCanvas, 0, 0);
    return new Promise((resolve) => {
      this.activeMarqueeWipe = {
        from: fromCopy,
        to: canvas,
        elapsed: 0,
        duration: durationMs / 1000,
        resolve,
      };
    });
  }

  /**
   * Progressive bottom -> up side panel wipe with orange/yellow paint drips
   * (Requirement 4, mocks/playglow/index.html lines 1044–1053).
   */
  public wipeSideIn(
    canvas: HTMLCanvasElement,
    durationMs = 800
  ): Promise<void> {
    if (this.reducedMotion || this.fixedTime !== null || durationMs <= 0) {
      this.setSideCanvas(canvas);
      return Promise.resolve();
    }
    if (this.activeSideWipe) {
      this.activeSideWipe.resolve?.();
      this.activeSideWipe = null;
    }
    const fromCopy = mk(
      this.currentSideCanvas.width,
      this.currentSideCanvas.height
    );
    fromCopy.getContext("2d")!.drawImage(this.currentSideCanvas, 0, 0);
    return new Promise((resolve) => {
      this.activeSideWipe = {
        from: fromCopy,
        to: canvas,
        elapsed: 0,
        duration: durationMs / 1000,
        resolve,
      };
    });
  }

  /**
   * Switch transition in 1.1s (<= 1.2s per 04-app-spec.md):
   * - 0..200ms: CRT collapses to a horizontal line then a dot
   * - 200..1000ms: Diagonal 4x4 Bayer pixel-dissolve on marquee (288x40) and side (100x202)
   *   with #FFF1E8 cream and #FFEC27 yellow leading edge; trim colour lerps
   * - 1000..1100ms: CRT warm-up flash and boots the new game
   */
  public startSwitchTransition(
    toSkin: SwitchSkinInput,
    onComplete?: () => void
  ): Promise<void> {
    this.skinApplySeq += 1;
    if (this.activeMarqueeWipe) {
      this.activeMarqueeWipe.resolve?.();
      this.activeMarqueeWipe = null;
    }
    if (this.activeSideWipe) {
      this.activeSideWipe.resolve?.();
      this.activeSideWipe = null;
    }
    this.lastWipedBannerKey = undefined;
    this.lastWipedSideKey = undefined;
    if (this.activeSwitch) {
      this.activeSwitch.resolve?.();
      this.activeSwitch = null;
    }
    if (this.reducedMotion) {
      this.setMarqueeCanvas(toSkin.marquee);
      this.setSideCanvas(toSkin.side);
      this.setCabinetColors({
        trim: toSkin.trim,
        body: toSkin.body,
        btn: toSkin.btn,
        buttons: toSkin.buttons,
      });
      onComplete?.();
      return Promise.resolve();
    }

    const fromMq = mk(288, 40);
    fromMq.getContext("2d")!.drawImage(this.currentMarqueeCanvas, 0, 0, 288, 40);
    const fromSd = mk(100, 202);
    fromSd.getContext("2d")!.drawImage(this.currentSideCanvas, 0, 0, 100, 202);

    const toMqLow = mk(288, 40);
    toMqLow.getContext("2d")!.drawImage(toSkin.marquee, 0, 0, 288, 40);
    const toSdLow = mk(100, 202);
    toSdLow.getContext("2d")!.drawImage(toSkin.side, 0, 0, 100, 202);

    this.currentMarqueeCanvas.width = 288;
    this.currentMarqueeCanvas.height = 40;
    this.currentSideCanvas.width = 100;
    this.currentSideCanvas.height = 202;

    this.attractScreen.setState({
      mode: "switch",
      buildMode: false,
    });
    this.useAttractScreen(true);

    return new Promise((resolve) => {
      this.activeSwitch = {
        fromMq,
        toMq: toMqLow,
        fromSd,
        toSd: toSdLow,
        fromTrim: this.matTrim.color.clone(),
        toTrim: new THREE.Color(toSkin.trim),
        fromBody: this.matCabinetBody.color.clone(),
        toBody: new THREE.Color(toSkin.body || C.dplum),
        fromBtn: this.matButtonsPrimary.color.clone(),
        toBtn: new THREE.Color(
          toSkin.buttons?.[0] || toSkin.btn || toSkin.trim
        ),
        elapsed: 0,
        duration: 1.1,
        continuousMock: false,
        onComplete,
        resolve,
      };
    });
  }

  private async refreshDefaultSkin(): Promise<void> {
    if (this.lastCard) {
      await this.applyCardSkin(this.lastCard);
      this.hasCustomSkin = false;
      return;
    }

    const st = this.attractScreen.getState();
    const tex = composeProceduralSkin({
      name: st.name,
      vibe: this.currentVibe,
      genre: st.genre || "runner",
      hero: st.hero,
      step: st.step || 1,
    });
    this.applySkinTextureToMaterials(tex);
  }

  private applySkinTextureToMaterials(skinTex: THREE.CanvasTexture): void {
    const regions = (skinTex.userData?.regions ||
      skinTex.userData) as ComposedRegions | undefined;
    if (regions) {
      if (regions.marqueeLow || regions.marquee) {
        this.setMarqueeCanvas(regions.marqueeLow || regions.marquee);
      }
      if (regions.sideLow || regions.side) {
        this.setSideCanvas(regions.sideLow || regions.side);
      }
      if (regions.attract) {
        this.attractScreen.setAttractImage(regions.attract);
      }
      this.setCabinetColors({
        trim: regions.trim || C.orange,
        body: regions.body || C.dplum,
        buttons: regions.buttons,
      });
    }
  }

  /**
   * Computes desired camera framing per state and aspect ratio
   * (ported 1:1 from mocks/playglow/index.html lines 968–985 & BRIEF.md §6–7).
   */
  private computeCameraFraming(
    mode: StepCameraMode,
    aspect: number
  ): {
    fov: number;
    pos: THREE.Vector3;
    target: THREE.Vector3;
    shiftX: number;
  } {
    const mob = aspect < 1;
    if (mode === "play") {
      if (mob) {
        return {
          fov: 40,
          pos: new THREE.Vector3(0.0, 1.4, 1.85),
          target: new THREE.Vector3(0, 1.08, 0.08),
          shiftX: 0,
        };
      }
      return {
        fov: 27,
        pos: new THREE.Vector3(0.04, 1.14, 1.36),
        target: new THREE.Vector3(0, 1.10, 0.1),
        shiftX: 0,
      };
    }

    if (mode === "uv-left") {
      return {
        fov: 30,
        pos: new THREE.Vector3(-0.95, 1.22, 2.2),
        target: new THREE.Vector3(0.0, 0.9, 0.0),
        shiftX: 0,
      };
    }

    // create (steps 1..4), build, switch, attract
    if (mob) {
      return {
        fov: 40,
        pos: new THREE.Vector3(1.1, 1.35, 3.6),
        target: new THREE.Vector3(0, 0.95, 0),
        shiftX: 0,
      };
    }
    return {
      fov: 30,
      pos: new THREE.Vector3(0.95, 1.22, 2.2),
      target: new THREE.Vector3(0.0, 0.9, 0.0),
      shiftX: -0.3,
    };
  }

  private applyCameraToThree(): void {
    this.camera.fov = this.camCurrentFov;
    this.camera.position.copy(this.camCurrentPos);
    this.camera.lookAt(this.camCurrentTarget);
    this.camera.filmOffset =
      this.camCurrentShiftX *
      this.camera.getFilmWidth() *
      Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) *
      this.camera.aspect;
    this.camera.updateProjectionMatrix();
  }

  public setStepCamera(mode: StepCameraMode, immediate = false): void {
    this.cameraMode = mode;
    const aspect = this.rw / Math.max(1, this.rh);
    const desired = this.computeCameraFraming(mode, aspect);
    this.camDesiredFov = desired.fov;
    this.camDesiredPos.copy(desired.pos);
    this.camDesiredTarget.copy(desired.target);
    this.camDesiredShiftX = desired.shiftX;

    if (immediate || this.reducedMotion || this.fixedTime !== null) {
      this.camCurrentFov = desired.fov;
      this.camCurrentPos.copy(desired.pos);
      this.camCurrentTarget.copy(desired.target);
      this.camCurrentShiftX = desired.shiftX;
      this.camVelPos.set(0, 0, 0);
      this.camVelTarget.set(0, 0, 0);
      this.camVelFov = 0;
      this.camVelShiftX = 0;
      if (this.camera) {
        this.applyCameraToThree();
      }
    }
  }

  public getDayNightState(): DayNightState {
    return this.windowScenery.getState();
  }

  public setTimeOfDay(hours: number): void {
    this.windowScenery.setTimeHours(hours);
  }

  public toggleDayNightCycle(): boolean {
    return this.windowScenery.toggleAutoCycle();
  }

  public cycleNextDayNight(): DayNightState {
    return this.windowScenery.cycleNextPreset();
  }

  public setVibe(vibe: VibeId): void {
    this.currentVibe = vibe;
    this.attractScreen.setState({ vibe, vibeSelected: true });
    if (!this.hasCustomSkin) {
      this.refreshDefaultSkin().catch(() => {});
    }
  }

  public setPreviewState(state: PreviewState): void {
    const cur = this.attractScreen.getState();
    let numericStep = cur.step;
    let buildMode = state.buildMode ?? cur.buildMode;
    let mode = cur.mode || "create";

    if (typeof state.step === "number") {
      numericStep = state.step;
      buildMode = false;
      mode = "create";
    } else if (state.step === "create") {
      buildMode = false;
      mode = "create";
    } else if (state.step === "build") {
      buildMode = true;
      mode = "build";
    } else if (state.step === "play") {
      buildMode = false;
      mode = "play";
    } else if (state.step === "switch") {
      buildMode = false;
      mode = "switch";
    }

    const nextQStep =
      state.qStep ??
      (numericStep === 2
        ? "genre"
        : numericStep >= 4
        ? "vibe"
        : "hero");

    const nextName = state.arcadeName ?? state.name ?? cur.name;

    const prevVibeSelected = cur.vibeSelected;
    this.attractScreen.setState({
      step: numericStep,
      qStep: nextQStep,
      mode,
      mockGameKey: state.mockGameKey ?? cur.mockGameKey,
      name: nextName,
      genre: state.genre ?? cur.genre,
      hero: state.hero ?? cur.hero,
      vibe: state.vibe ?? cur.vibe,
      vibeSelected:
        state.vibeSelected ??
        (state.vibe !== undefined && state.vibe !== null
          ? true
          : cur.vibeSelected),
      buildMode,
      buildStage: state.buildStage ?? cur.buildStage,
      buildPct: state.buildProgress ?? state.buildPct ?? cur.buildPct,
      buildTitle: state.buildTitle ?? cur.buildTitle,
      heroOffsetX: state.heroOffsetX ?? cur.heroOffsetX,
      heroJumpY: state.heroJumpY ?? cur.heroJumpY,
    });

    if (mode === "create") {
      this.skinApplySeq += 1;
      this.lastWipedBannerKey = undefined;
      this.lastWipedSideKey = undefined;
      const hadCustomSkin = Boolean(this.hasCustomSkin || this.lastCard);
      this.hasCustomSkin = false;
      this.lastCard = null;
      if (hadCustomSkin) {
        this.refreshDefaultSkin().catch(() => {});
      }
    }
    if (mode === "create" && !this.hasCustomSkin) {
      this.setMarqueeCanvas(pendingMarquee(nextName));
    }

    const nextVibeSelected = this.attractScreen.getState().vibeSelected;
    if (
      state.vibe &&
      (state.vibe !== this.currentVibe || (nextVibeSelected && !prevVibeSelected))
    ) {
      this.setVibe(state.vibe);
    }
  }

  public async applyCardSkin(
    card?: GameDesignCard,
    art?: ApplyCardSkinArt,
    opts?: { instant?: boolean }
  ): Promise<void> {
    const seq = ++this.skinApplySeq;
    const resolvedCard =
      card ||
      this.lastCard ||
      buildPresetCard({
        name: "Player 1",
        genre: "runner",
        hero: "Pip",
        vibe: this.currentVibe,
      });
    this.lastCard = resolvedCard;
    this.hasCustomSkin = Boolean(
      art?.bannerUrl ||
        art?.sideUrl ||
        art?.attractUrl ||
        art?.banner ||
        art?.side ||
        art?.attract
    );

    const [baseImage, bannerImg, sideImg, attractImg] = await Promise.all([
      loadBaseCabinetImage(),
      art?.banner
        ? Promise.resolve(art.banner)
        : loadImageSource(art?.bannerUrl),
      art?.side ? Promise.resolve(art.side) : loadImageSource(art?.sideUrl),
      art?.attract
        ? Promise.resolve(art.attract)
        : loadImageSource(art?.attractUrl),
    ]);
    if (seq !== this.skinApplySeq || this.destroyed) return;

    const skinTex = composeCabinetSkin({
      baseImage,
      card: resolvedCard,
      bannerImage: bannerImg,
      sideImage: sideImg,
      attractImage: attractImg,
    });

    const regions = skinTex.userData?.regions as ComposedRegions | undefined;
    if (regions) {
      const bannerKey = art?.banner || art?.bannerUrl || bannerImg;
      const sideKey = art?.side || art?.sideUrl || sideImg;
      if (bannerKey && !opts?.instant && bannerKey !== this.lastWipedBannerKey) {
        this.lastWipedBannerKey = bannerKey;
        await this.wipeMarqueeIn(regions.marqueeLow || regions.marquee);
        if (seq !== this.skinApplySeq || this.destroyed) return;
      } else {
        if (bannerKey) this.lastWipedBannerKey = bannerKey;
        this.setMarqueeCanvas(regions.marqueeLow || regions.marquee);
      }
      if (sideKey && !opts?.instant && sideKey !== this.lastWipedSideKey) {
        this.lastWipedSideKey = sideKey;
        await this.wipeSideIn(regions.sideLow || regions.side);
        if (seq !== this.skinApplySeq || this.destroyed) return;
      } else {
        if (sideKey) this.lastWipedSideKey = sideKey;
        this.setSideCanvas(regions.sideLow || regions.side);
      }
      if (regions.attract && (attractImg || art?.attractUrl)) {
        this.attractScreen.setAttractImage(regions.attract);
      }
      this.setCabinetColors({
        trim: regions.trim,
        body: regions.body,
        buttons: regions.buttons,
      });
    }

    this.attractScreen.setState({
      genre: resolvedCard.genre,
      hero: resolvedCard.hero?.short || resolvedCard.hero?.description || "",
      vibe: resolvedCard.vibe,
      buildTitle: resolvedCard.title,
    });
  }

  private uvTestActive = false;

  public applyUvTestCard(side: "right" | "left" = "right"): void {
    this.uvTestActive = true;
    if (side === "left") {
      this.setStepCamera("uv-left", true);
    } else {
      this.setStepCamera("create", true);
    }
    const test = composeUvTestCard();
    this.setMarqueeCanvas(test.marquee);
    this.setSideCanvas(test.side);
    this.attractScreen.ctx.imageSmoothingEnabled = false;
    this.attractScreen.ctx.drawImage(
      test.screen,
      0,
      0,
      this.attractScreen.canvas.width,
      this.attractScreen.canvas.height
    );
    this.attractScreen.texture.needsUpdate = true;
    this.crtMat.uniforms.uTex.value = this.attractScreen.texture;
    this.crtMat.uniforms.map.value = this.attractScreen.texture;
  }

  public updateCrtFramebuffer(rgba: Uint8ClampedArray | Uint8Array): void {
    this.crtTex = updateCrtDataTexture(this.crtTex, rgba);
    computeFrameAverageColor(rgba, this.screenLightTargetColor);
    if (!this.usingAttract) {
      this.crtMat.uniforms.uTex.value = this.crtTex;
      this.crtMat.uniforms.map.value = this.crtTex;
    }
  }

  public useAttractScreen(enabled: boolean): void {
    this.usingAttract = enabled;
    const activeTex = enabled ? this.attractScreen.texture : this.crtTex;
    this.crtMat.uniforms.uTex.value = activeTex;
    this.crtMat.uniforms.map.value = activeTex;
  }

  public triggerPowerCycle(): void {
    this.powerAnimState.active = true;
    this.powerAnimState.elapsed = 0;
  }

  /**
   * Live cartridge <-> 3D cabinet reactive feedback:
   * - "score" / "powerup" / "win" / "coin": pulses marquee emissive intensity, trim glow, and CRT room light
   * - "shake" / "hit" / "boom" / "loseLife": applies a physical micro-jolt to the 3D cabinet mesh in sync with 2D shake
   * - "gameover": pulses cabinet glow and brief shudder
   */
  public pulseCabinetFx(kind: string, intensity = 0.5): void {
    if (this.fixedTime !== null || this.reducedMotion || this.uvTestActive) {
      return;
    }
    const clamped = Math.max(0.15, Math.min(1.2, Number(intensity) || 0.5));
    const k = (kind || "").toLowerCase();

    if (k === "score" || k === "powerup" || k === "win" || k === "coin") {
      this.fxGlowBoost = Math.min(0.6, this.fxGlowBoost + 0.3 * clamped);
    } else if (
      k === "shake" ||
      k === "hit" ||
      k === "boom" ||
      k === "explode" ||
      k === "loselife"
    ) {
      this.fxJoltAmp = Math.min(1.0, Math.max(this.fxJoltAmp, clamped));
      this.fxJoltPhase = 0;
      this.fxJoltDir = -this.fxJoltDir;
      this.fxGlowBoost = Math.min(0.6, this.fxGlowBoost + 0.15 * clamped);
    } else if (k === "gameover") {
      this.fxGlowBoost = Math.min(0.6, this.fxGlowBoost + 0.4 * clamped);
      this.fxJoltAmp = Math.min(1.0, Math.max(this.fxJoltAmp, 0.7 * clamped));
      this.fxJoltPhase = 0;
      this.fxJoltDir = -this.fxJoltDir;
    }
  }

  public nudgeAttractHero(dx: number, jump = false): void {
    this.attractScreen.nudgeHero(dx, jump);
  }

  public pressCabinetButton(key: string): void {
    const k = key.toLowerCase();

    if (k === "arrowleft" || k === "keya" || k === "a" || k === "left") {
      this.joystickState.targetTiltX = -1;
      this.joystickState.releaseTimer = 0.16;
      this.nudgeAttractHero(-8, false);
      return;
    }
    if (k === "arrowright" || k === "keyd" || k === "d" || k === "right") {
      this.joystickState.targetTiltX = 1;
      this.joystickState.releaseTimer = 0.16;
      this.nudgeAttractHero(8, false);
      return;
    }
    if (k === "arrowup" || k === "keyw" || k === "w" || k === "up") {
      this.joystickState.targetTiltZ = -1;
      this.joystickState.releaseTimer = 0.16;
      return;
    }
    if (k === "arrowdown" || k === "keys" || k === "s" || k === "down") {
      this.joystickState.targetTiltZ = 1;
      this.joystickState.releaseTimer = 0.16;
      return;
    }

    const targetNames: string[] = [];
    if (
      k === "space" ||
      k === " " ||
      k === "keyz" ||
      k === "z" ||
      k === "keyj" ||
      k === "j" ||
      k === "enter" ||
      k === "action"
    ) {
      targetNames.push("button_2", "button_3", "button_8", "button_9");
      this.nudgeAttractHero(0, true);
    } else if (
      k === "keyx" ||
      k === "x" ||
      k === "keyk" ||
      k === "k" ||
      k === "shiftleft" ||
      k === "shiftright" ||
      k === "b"
    ) {
      targetNames.push("button_4", "button_5", "button_10", "button_11");
    } else {
      targetNames.push("button", "button_1", "button_6", "button_7");
    }

    for (const name of targetNames) {
      const st = this.buttonStates.get(name);
      if (st) {
        st.targetPress = 1;
        st.mat.emissiveIntensity = 1.25;
      }
    }
  }

  private nowSeconds(): number {
    return this.fixedTime !== null
      ? this.fixedTime
      : (performance.now() - this.t0) / 1000;
  }

  private stepSpringScalar(
    current: number,
    target: number,
    vel: number,
    dt: number,
    omega = 7.5
  ): [number, number] {
    // Critically damped spring
    const f = 1 + 2 * dt * omega;
    const oo = omega * omega;
    const hoo = dt * oo;
    const hhoo = dt * hoo;
    const detInv = 1 / (f + hhoo);
    const detX = f * current + dt * vel + hhoo * target;
    const detV = vel + hoo * (target - current);
    return [detX * detInv, detV * detInv];
  }

  private updateCameraSpring(dt: number, t: number): void {
    const aspect = this.rw / Math.max(1, this.rh);
    const base = this.computeCameraFraming(this.cameraMode, aspect);
    this.camDesiredFov = base.fov;
    this.camDesiredPos.copy(base.pos);
    this.camDesiredTarget.copy(base.target);
    this.camDesiredShiftX = base.shiftX;

    // Subtle camera choreography when not in deterministic fixed-time screenshot mode
    if (this.fixedTime === null && !this.reducedMotion) {
      if (
        this.cameraMode === "create" ||
        typeof this.cameraMode === "number" ||
        this.cameraMode === "attract"
      ) {
        this.camDesiredPos.x += Math.sin(t * 0.45) * 0.035;
        this.camDesiredPos.y += Math.cos(t * 0.35) * 0.015;
      } else if (this.cameraMode === "build") {
        // Slow dolly in during Build
        const dolly = Math.sin(t * 0.3) * 0.08;
        this.camDesiredPos.z -= 0.08 + dolly;
        this.camDesiredPos.x += Math.cos(t * 0.4) * 0.04;
      }

      // Mouse-controlled 3D cabinet orbit ONLY when not playing (create / build / attract)
      const mouseOrbitActive =
        this.cameraMode !== "play" &&
        this.cameraMode !== "switch" &&
        !this.uvTestActive &&
        !this.benchRecording;

      if (mouseOrbitActive && (this.pointerTargetX !== 0 || this.pointerTargetY !== 0)) {
        const dx = this.camDesiredPos.x - this.camDesiredTarget.x;
        const dz = this.camDesiredPos.z - this.camDesiredTarget.z;
        const yaw = -this.pointerTargetX * 0.16;
        const cosY = Math.cos(yaw);
        const sinY = Math.sin(yaw);
        this.camDesiredPos.x = this.camDesiredTarget.x + dx * cosY + dz * sinY;
        this.camDesiredPos.z = this.camDesiredTarget.z - dx * sinY + dz * cosY;
        this.camDesiredPos.y += this.pointerTargetY * 0.08;
      }
    }

    if (this.fixedTime !== null || this.reducedMotion) {
      this.camCurrentFov = this.camDesiredFov;
      this.camCurrentPos.copy(this.camDesiredPos);
      this.camCurrentTarget.copy(this.camDesiredTarget);
      this.camCurrentShiftX = this.camDesiredShiftX;
    } else {
      const [px, vx] = this.stepSpringScalar(
        this.camCurrentPos.x,
        this.camDesiredPos.x,
        this.camVelPos.x,
        dt
      );
      const [py, vy] = this.stepSpringScalar(
        this.camCurrentPos.y,
        this.camDesiredPos.y,
        this.camVelPos.y,
        dt
      );
      const [pz, vz] = this.stepSpringScalar(
        this.camCurrentPos.z,
        this.camDesiredPos.z,
        this.camVelPos.z,
        dt
      );
      this.camCurrentPos.set(px, py, pz);
      this.camVelPos.set(vx, vy, vz);

      const [tx, vtx] = this.stepSpringScalar(
        this.camCurrentTarget.x,
        this.camDesiredTarget.x,
        this.camVelTarget.x,
        dt
      );
      const [ty, vty] = this.stepSpringScalar(
        this.camCurrentTarget.y,
        this.camDesiredTarget.y,
        this.camVelTarget.y,
        dt
      );
      const [tz, vtz] = this.stepSpringScalar(
        this.camCurrentTarget.z,
        this.camDesiredTarget.z,
        this.camVelTarget.z,
        dt
      );
      this.camCurrentTarget.set(tx, ty, tz);
      this.camVelTarget.set(vtx, vty, vtz);

      const [fov, vFov] = this.stepSpringScalar(
        this.camCurrentFov,
        this.camDesiredFov,
        this.camVelFov,
        dt
      );
      this.camCurrentFov = fov;
      this.camVelFov = vFov;

      const [sx, vsx] = this.stepSpringScalar(
        this.camCurrentShiftX,
        this.camDesiredShiftX,
        this.camVelShiftX,
        dt
      );
      this.camCurrentShiftX = sx;
      this.camVelShiftX = vsx;
    }

    this.applyCameraToThree();
  }

  private updateMockBuild(t: number): void {
    const b = this.mockBuildCtx;
    if (!b) return;
    const p =
      this.fixedTime !== null && this.fixedTime < 10
        ? 0.85
        : Math.min(1, (t % 48) / 40);
    const stages = [0.2, 0.45, 0.65, 1.0];
    let stage = stages.findIndex((s) => p < s);
    if (stage === -1) stage = 3;

    // Marquee wipes in left->right at p > 0.12
    const fMq = p > 0.12 ? Math.min(1, (p - 0.12) / 0.08) : 0;
    wipeMarqueeStep(this.currentMarqueeCanvas, b.blankMq, b.fullMq, fMq);
    this.marqueeTex.needsUpdate = true;

    // Side painted bottom-up at p > 0.65
    const fSd = p > 0.65 ? Math.min(1, (p - 0.65) / 0.33) : 0;
    wipeSideStep(this.currentSideCanvas, b.blankSd, b.fullSd, fSd);
    this.sideTex.needsUpdate = true;

    drawBuildCRT(this.attractScreen.lowCtx, t, p, stage, {
      title: "FOXFIRE RUN",
      genre: "runner",
    });
    this.attractScreen.ctx.imageSmoothingEnabled = false;
    this.attractScreen.ctx.drawImage(
      this.attractScreen.lowCanvas,
      0,
      0,
      this.attractScreen.canvas.width,
      this.attractScreen.canvas.height
    );
    this.attractScreen.texture.needsUpdate = true;

    // Animate living scenery sunset across the build wait (BRIEF.md §7)
    this.windowScenery.setTimeHours(16.0 + p * 3.5);
  }

  private updateProgressiveTransitions(dt: number, t: number): void {
    if (this.activeMarqueeWipe) {
      const w = this.activeMarqueeWipe;
      w.elapsed += dt;
      const f = Math.min(1, w.elapsed / Math.max(0.001, w.duration));
      wipeMarqueeStep(this.currentMarqueeCanvas, w.from, w.to, f);
      this.marqueeTex.needsUpdate = true;
      // Subtle buzz-on flicker while wiping
      this.matMarquee.emissiveIntensity =
        f < 1 ? 0.7 + 0.5 * Math.abs(Math.sin(t * 50)) : 1.0;
      if (f >= 1) {
        const res = w.resolve;
        this.activeMarqueeWipe = null;
        res?.();
      }
    }

    if (this.activeSideWipe) {
      const w = this.activeSideWipe;
      w.elapsed += dt;
      const f = Math.min(1, w.elapsed / Math.max(0.001, w.duration));
      wipeSideStep(this.currentSideCanvas, w.from, w.to, f);
      this.sideTex.needsUpdate = true;
      if (f >= 1) {
        const res = w.resolve;
        this.activeSideWipe = null;
        res?.();
      }
    }

    if (this.activeSwitch) {
      const sw = this.activeSwitch;
      if (sw.continuousMock) {
        // Exact formula from mocks/playglow/index.html line 962
        const f =
          this.fixedTime !== null && this.fixedTime < 1
            ? 0.55
            : Math.min(1, Math.max(0, (t * 0.35) % 1.3));
        dissolve(this.currentMarqueeCanvas, sw.fromMq, sw.toMq, f, 4);
        dissolve(this.currentSideCanvas, sw.fromSd, sw.toSd, f, 4);
        this.marqueeTex.needsUpdate = true;
        this.sideTex.needsUpdate = true;
      } else {
        sw.elapsed += dt;
        const ms = sw.elapsed * 1000;
        if (ms <= 200) {
          // 0..200ms: CRT collapses to horizontal line + glowing centre dot (rendered via drawPowerDown)
          this.crtMat.uniforms.uPower.value = 1.0;
        } else if (ms <= 1000) {
          // 200..1000ms: 800ms diagonal 4x4 Bayer pixel-dissolve while CRT shows collapse line + dot
          this.crtMat.uniforms.uPower.value = 1.0;
          const f = Math.min(1, (ms - 200) / 800);
          dissolve(this.currentMarqueeCanvas, sw.fromMq, sw.toMq, f, 4);
          dissolve(this.currentSideCanvas, sw.fromSd, sw.toSd, f, 4);
          this.marqueeTex.needsUpdate = true;
          this.sideTex.needsUpdate = true;

          // Lerp trim, body, and button colors
          this.matTrim.color.lerpColors(sw.fromTrim, sw.toTrim, f);
          this.matTrim.emissive.copy(this.matTrim.color);
          this.matCabinetBody.color.lerpColors(sw.fromBody, sw.toBody, f);
          this.matButtonsPrimary.color.lerpColors(sw.fromBtn, sw.toBtn, f);
          this.matButtonsPrimary.emissive.copy(this.matButtonsPrimary.color);
          this.screenLightTargetColor.copy(this.matTrim.color);
        } else if (ms <= 1100) {
          // 1000..1100ms: CRT warm-up flash & expand
          const f = Math.min(1, (ms - 1000) / 100);
          dissolve(this.currentMarqueeCanvas, sw.fromMq, sw.toMq, 1, 4);
          dissolve(this.currentSideCanvas, sw.fromSd, sw.toSd, 1, 4);
          this.marqueeTex.needsUpdate = true;
          this.sideTex.needsUpdate = true;
          this.crtMat.uniforms.uPower.value = f;
          this.crtMat.uniforms.uBrightness.value = 1.08 + (1 - f) * 0.6;
        } else {
          this.crtMat.uniforms.uPower.value = 1.0;
          this.crtMat.uniforms.uBrightness.value = 1.08;
          this.baseTrimGlow = 0.9;
          this.matTrim.emissiveIntensity = 0.9;
          this.setCabinetColors({
            trim: "#" + sw.toTrim.getHexString(),
            body: "#" + sw.toBody.getHexString(),
            btn: "#" + sw.toBtn.getHexString(),
          });
          const cb = sw.onComplete;
          const res = sw.resolve;
          this.activeSwitch = null;
          cb?.();
          res?.();
        }
      }
    }
  }

  private updateFrame(): void {
    const nowPerf = performance.now();
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.nowSeconds();

    // Reset renderer stats at start of frame so renderer.info reflects all passes in this frame
    this.renderer.info.reset();

    // 1. Update CRT shader uniforms
    this.crtMat.uniforms.uTime.value = t;
    if (this.powerAnimState.active && !this.activeSwitch) {
      this.powerAnimState.elapsed += dt;
      const pt = this.powerAnimState.elapsed;
      if (pt < 0.2) {
        this.crtMat.uniforms.uPower.value = Math.max(0.0, 1.0 - pt / 0.2);
      } else if (pt < 0.4) {
        this.crtMat.uniforms.uPower.value = (pt - 0.2) / 0.2;
      } else {
        this.crtMat.uniforms.uPower.value = 1.0;
        this.powerAnimState.active = false;
      }
    }

    // 2. Update CRT content & progressive skinning
    if (this.uvTestActive) {
      // Keep the UV test card untouched on screen, marquee, and side panels
    } else if (this.mockBuildCtx && this.attractScreen.getState().mode === "build") {
      this.updateMockBuild(t);
    } else if (this.usingAttract) {
      this.attractScreen.render(t);
      if (this.crtMat.uniforms.uTex.value !== this.attractScreen.texture) {
        this.crtMat.uniforms.uTex.value = this.attractScreen.texture;
        this.crtMat.uniforms.map.value = this.attractScreen.texture;
      }
      // Sample average color from attractScreen.lowCanvas every ~4 frames for dynamic room glow
      if (this.fixedTime === null && Math.floor(t * 60) % 4 === 0) {
        const imgData = this.attractScreen.lowCtx.getImageData(0, 0, 160, 100);
        computeFrameAverageColor(imgData.data, this.screenLightTargetColor);
      }
    }

    this.updateProgressiveTransitions(dt, t);

    // 3. Update camera framing & spring
    this.updateCameraSpring(dt, t);

    // 4. Animate physical buttons & joysticks
    this.buttonStates.forEach((st) => {
      st.pressOffset +=
        (st.targetPress - st.pressOffset) * Math.min(1, dt * 24);
      if (st.targetPress > 0 && st.pressOffset > 0.75) {
        st.targetPress = 0;
      }
      st.mesh.position.set(
        st.basePos.x,
        st.basePos.y - st.pressOffset * 0.0055,
        st.basePos.z - st.pressOffset * 0.0025
      );
      st.mat.emissiveIntensity +=
        (st.baseEmissiveIntensity - st.mat.emissiveIntensity) *
        Math.min(1, dt * 10);
    });

    if (this.joystickState.releaseTimer > 0) {
      this.joystickState.releaseTimer -= dt;
      if (this.joystickState.releaseTimer <= 0) {
        this.joystickState.targetTiltX = 0;
        this.joystickState.targetTiltZ = 0;
      }
    }
    this.joystickState.tiltX +=
      (this.joystickState.targetTiltX - this.joystickState.tiltX) *
      Math.min(1, dt * 18);
    this.joystickState.tiltZ +=
      (this.joystickState.targetTiltZ - this.joystickState.tiltZ) *
      Math.min(1, dt * 18);

    const dx = this.joystickState.tiltX * 0.012;
    const dz = this.joystickState.tiltZ * 0.012;
    this.joystickState.ballMeshes.forEach((mesh, i) => {
      const base = this.joystickState.ballBasePos[i];
      if (base) mesh.position.set(base.x + dx, base.y, base.z + dz);
    });
    this.joystickState.shaftMeshes.forEach((mesh, i) => {
      const base = this.joystickState.shaftBasePos[i];
      if (base) mesh.position.set(base.x + dx * 0.5, base.y, base.z + dz * 0.5);
    });

    // 5. Dynamic screen light color lerp, marquee/trim breathing, & live cartridge reactive FX
    if (this.fixedTime === null && !this.reducedMotion) {
      if (this.fxGlowBoost > 0.001) {
        this.fxGlowBoost = Math.max(0, this.fxGlowBoost - dt * 2.4);
      } else {
        this.fxGlowBoost = 0;
      }

      if (this.fxJoltAmp > 0.001) {
        this.fxJoltPhase += dt * 58;
        this.fxJoltAmp = Math.max(0, this.fxJoltAmp - dt * 5.6);
        const wave = Math.sin(this.fxJoltPhase) * this.fxJoltDir;
        this.cabinetGroup.position.x = wave * 0.005 * this.fxJoltAmp;
        this.cabinetGroup.rotation.z = -wave * 0.0045 * this.fxJoltAmp;
      } else if (
        this.cabinetGroup.position.x !== 0 ||
        this.cabinetGroup.rotation.z !== 0
      ) {
        this.fxJoltAmp = 0;
        this.cabinetGroup.position.x = 0;
        this.cabinetGroup.rotation.z = 0;
      }

      if (!this.activeSwitch && this.matTrim) {
        this.matTrim.emissiveIntensity =
          this.baseTrimGlow + this.fxGlowBoost * 0.65;
      }
      if (!this.activeMarqueeWipe && !this.activeSwitch && this.matMarquee) {
        this.matMarquee.emissiveIntensity = 1.0 + this.fxGlowBoost * 0.45;
      }
    } else if (
      this.cabinetGroup.position.x !== 0 ||
      this.cabinetGroup.rotation.z !== 0
    ) {
      this.cabinetGroup.position.x = 0;
      this.cabinetGroup.rotation.z = 0;
    }

    if (this.screenLight && this.fixedTime === null) {
      this.screenLight.color.lerp(
        this.screenLightTargetColor,
        Math.min(1, dt * 6)
      );
      // Idle cabinet glow breathes ±4% over 3s (NOTES.md line 86) + reactive FX glow boost
      this.screenLight.intensity =
        this.baseScreenGlow * (1 + 0.04 * Math.sin((t * Math.PI * 2) / 3)) +
        this.fxGlowBoost * 0.9;
    }

    // 5b. Update window scenery & full day/night room atmosphere and lighting
    if (this.fixedTime === null) {
      this.windowScenery.update(dt);
      const lighting = this.windowScenery.getRoomLightingState();

      if (this.sunLight) {
        this.sunLight.color.set(lighting.sunLight.color);
        this.sunLight.intensity = lighting.sunLight.intensity;
        this.sunLight.position.set(...lighting.sunLight.pos);
      }
      if (this.hemiLight) {
        this.hemiLight.color.set(lighting.hemiLight.skyColor);
        this.hemiLight.groundColor.set(lighting.hemiLight.groundColor);
        this.hemiLight.intensity = lighting.hemiLight.intensity;
      }
      if (this.lampLight) {
        this.lampLight.color.set(lighting.lampLight.color);
        this.lampLight.intensity = lighting.lampLight.intensity;
      }
      if (this.rimLight) {
        this.rimLight.color.set(lighting.rimLight.color);
        this.rimLight.intensity = lighting.rimLight.intensity;
      }
      if (this.rim2Light) {
        this.rim2Light.color.set(lighting.rim2Light.color);
        this.rim2Light.intensity = lighting.rim2Light.intensity;
      }
      if (this.scene.fog) {
        this.scene.fog.color.set(lighting.fog.color);
        if (this.scene.fog instanceof THREE.Fog) {
          this.scene.fog.near = lighting.fog.near;
          this.scene.fog.far = lighting.fog.far;
        }
      }
      this.scene.background = new THREE.Color(lighting.fog.color).convertSRGBToLinear();

      if (this.dustPoints) {
        const dpMat = this.dustPoints.material as THREE.PointsMaterial;
        dpMat.color.set(lighting.dust.color);
        dpMat.opacity = lighting.dust.opacity;
        this.dustPoints.position.y = Math.sin(t * 0.5) * 0.04;
      }
      if (this.lampShadeMesh) {
        const sm = this.lampShadeMesh.material as THREE.MeshStandardMaterial;
        sm.emissive.set(lighting.lampLight.shadeEmissive);
        sm.emissiveIntensity = lighting.lampLight.shadeIntensity;
      }
      if (this.stringLightsMesh) {
        const slm = this.stringLightsMesh.material as THREE.MeshBasicMaterial;
        slm.color.setScalar(lighting.stringLightsIntensity);
      }

      this.onDayNightChange?.(this.windowScenery.getState());
    } else if (this.dustPoints) {
      this.dustPoints.position.y = Math.sin(t * 0.5) * 0.04;
    }

    // 6. Render exact two-pass low-res pixel pipeline + full-res crisp layer
    // (ported 1:1 from mocks/playglow/index.html lines 1064–1072)
    this.renderer.setRenderTarget(this.rtScene);
    this.renderer.render(this.scene, this.camera);

    this.postQuad.material = this.quantMat;
    this.renderer.setRenderTarget(this.rtPost);
    this.renderer.render(this.postScene, this.postCam);

    this.postQuad.material = this.blitMat;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);

    // Crisp pass: full-res depth prepass, then only the CRT + marquee faces (layer 1) on top
    const bg = this.scene.background;
    this.scene.background = null;
    this.renderer.autoClear = false;
    this.renderer.clearDepth();

    this.camera.layers.set(2);
    this.scene.overrideMaterial = this.depthOnly;
    this.renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;

    this.camera.layers.set(1);
    this.renderer.render(this.scene, this.camera);
    this.camera.layers.set(0);

    this.renderer.autoClear = true;
    this.scene.background = bg;

    // 7. Record benchmark metrics if active
    if (this.benchRecording) {
      const frameDelta = nowPerf - this.benchRecording.lastFrameStamp;
      this.benchRecording.lastFrameStamp = nowPerf;
      this.benchRecording.frameTimes.push(frameDelta);
      this.benchRecording.drawCalls.push(this.renderer.info.render.calls);
      this.benchRecording.triangles.push(this.renderer.info.render.triangles);
    }
  }

  private handleResize(immediateCamera = false): void {
    if (this.destroyed || !this.renderer || !this.camera) return;
    const W = Math.max(1, this.container.clientWidth || window.innerWidth);
    const H = Math.max(1, this.container.clientHeight || window.innerHeight);

    this.pxs = this.customPxs ?? (W < 700 ? 2 : 3);
    this.rw = Math.ceil(W / this.pxs);
    this.rh = Math.ceil(H / this.pxs);

    this.renderer.setSize(W, H, false);
    this.rtScene.setSize(this.rw, this.rh);
    this.rtPost.setSize(this.rw, this.rh);

    this.quantMat.uniforms.res.value.set(this.rw, this.rh);
    this.blitMat.uniforms.px.value = this.pxs;
    this.blitMat.uniforms.rsize.value.set(this.rw, this.rh);

    this.camera.aspect = this.rw / this.rh;
    this.setStepCamera(this.cameraMode, immediateCamera);
  }

  /**
   * Hidden `?debug` panel via lil-gui (BRIEF.md §7):
   * tunes render scale, dither amplitude, bloom, light intensities, CRT settings,
   * and displays telemetry logs stored in localStorage.
   */
  private initDebugGui(): void {
    this.gui = new GUI({ title: "playglow debug" });
    const params = {
      pxScale: this.pxs,
      paletteSnap: this.postEnabled,
      dither: 0.035,
      exposure: 1.0,
      vignette: 1.25,
      bloomGain: 0.07,
      sunIntensity: this.sunLight.intensity,
      rimIntensity: this.rimLight.intensity,
      keyIntensity: this.keySpotLight.intensity,
      screenGlow: this.screenLight.intensity,
      crtCurve: 0.09,
      crtScanlines: 0.28,
      state: "create",
      uvTest: () => this.applyUvTestCard(),
    };

    const fPost = this.gui.addFolder("Pixel Pipeline");
    fPost
      .add(params, "pxScale", [1, 2, 3, 4])
      .name("Pixel Scale")
      .onChange((v: number) => {
        this.customPxs = Number(v);
        this.handleResize(true);
      });
    fPost
      .add(params, "paletteSnap")
      .name("PICO-8 Palette Snap")
      .onChange((v: boolean) => {
        this.postEnabled = v;
        this.quantMat.uniforms.enable.value = v ? 1 : 0;
      });
    fPost
      .add(params, "dither", 0, 0.12, 0.005)
      .name("Bayer Dither")
      .onChange((v: number) => {
        this.quantMat.uniforms.dither.value = v;
      });
    fPost
      .add(params, "bloomGain", 0, 0.25, 0.01)
      .name("Ring Bloom")
      .onChange((v: number) => {
        this.quantMat.uniforms.bloomGain.value = v;
      });
    fPost
      .add(params, "vignette", 0, 2.5, 0.05)
      .name("Vignette")
      .onChange((v: number) => {
        this.quantMat.uniforms.vig.value = v;
      });

    const fLights = this.gui.addFolder("Dusk Lighting");
    fLights
      .add(params, "sunIntensity", 0, 6, 0.1)
      .name("Window Sun")
      .onChange((v: number) => {
        this.sunLight.intensity = v;
      });
    fLights
      .add(params, "rimIntensity", 0, 6, 0.1)
      .name("Warm Rim")
      .onChange((v: number) => {
        this.rimLight.intensity = v;
      });
    fLights
      .add(params, "keyIntensity", 0, 6, 0.1)
      .name("Key Spot")
      .onChange((v: number) => {
        this.keySpotLight.intensity = v;
      });
    fLights
      .add(params, "screenGlow", 0, 4, 0.1)
      .name("CRT Glow")
      .onChange((v: number) => {
        this.baseScreenGlow = v;
        this.screenLight.intensity = v;
      });

    const fDayNight = this.gui.addFolder("Day & Night Scenery");
    const dnProxy = {
      hour: this.windowScenery.getState().timeHours,
      autoCycle: this.windowScenery.getState().isAutoCycle,
      preset: "Sunset",
    };
    fDayNight
      .add(dnProxy, "hour", 0, 24, 0.25)
      .name("Time (0-24h)")
      .listen()
      .onChange((v: number) => {
        this.windowScenery.setTimeHours(v);
      });
    fDayNight
      .add(dnProxy, "autoCycle")
      .name("Cycle Naturally")
      .onChange((v: boolean) => {
        this.windowScenery.setAutoCycle(v);
      });
    fDayNight
      .add(dnProxy, "preset", ["Dawn", "Daylight", "Sunset", "Twilight", "Midnight"])
      .name("Quick Atmosphere")
      .onChange((v: string) => {
        if (v === "Dawn") this.windowScenery.setTimeHours(6.2);
        else if (v === "Daylight") this.windowScenery.setTimeHours(12.0);
        else if (v === "Sunset") this.windowScenery.setTimeHours(17.8);
        else if (v === "Twilight") this.windowScenery.setTimeHours(20.5);
        else if (v === "Midnight") this.windowScenery.setTimeHours(0.5);
      });

    const fCrt = this.gui.addFolder("Crisp CRT");
    fCrt
      .add(params, "crtCurve", 0, 0.2, 0.01)
      .name("Barrel Curve")
      .onChange((v: number) => {
        this.crtMat.uniforms.uCurve.value = v;
      });
    fCrt
      .add(params, "crtScanlines", 0, 0.6, 0.02)
      .name("Scanline Depth")
      .onChange((v: number) => {
        this.crtMat.uniforms.uScanIntensity.value = v;
      });
    fCrt.add(params, "uvTest").name("Apply UV Test Card");
  }

  private activeBenchmarkPromise: Promise<BenchResult> | null = null;

  /**
   * Runs the scripted M1(c) performance benchmark across all 4 states:
   * Create orbit -> Build dolly -> Play with house game -> Switch pixel-dissolve.
   */
  public async runBenchmark(
    opts: { fast?: boolean; durationSec?: number } = {}
  ): Promise<BenchResult> {
    if (this.activeBenchmarkPromise) {
      return this.activeBenchmarkPromise;
    }
    this.activeBenchmarkPromise = this.executeBenchmark(opts).finally(() => {
      this.activeBenchmarkPromise = null;
    });
    return this.activeBenchmarkPromise;
  }

  private async executeBenchmark(
    opts: { fast?: boolean; durationSec?: number } = {}
  ): Promise<BenchResult> {
    if (typeof window !== "undefined") {
      window.__BENCH_RUNNING__ = true;
    }

    const isFast =
      opts.fast ??
      (typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("bench") === "fast");
    const totalSec = opts.durationSec ?? (isFast ? 6.5 : 30);

    // Detect WebGL renderer string (hardware vs SwiftShader software WebGL)
    let rendererStr = "unknown";
    try {
      const gl = this.renderer.getContext();
      const dbgInfo = gl.getExtension("WEBGL_debug_renderer_info");
      rendererStr = dbgInfo
        ? String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER));
    } catch {
      // ignore
    }
    const isSoftwareRenderer = /swiftshader|llvmpipe|software|basic render/i.test(
      rendererStr
    );

    // Warm-up 15 frames before recording
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }

    this.benchRecording = {
      frameTimes: [],
      drawCalls: [],
      triangles: [],
      lastFrameStamp: performance.now(),
    };

    const startMs = performance.now();
    const createEnd = totalSec * 0.25;
    const buildEnd = totalSec * 0.5;
    const playEnd = totalSec * 0.85;

    // Phase 1: Create
    this.setPreviewState({
      step: "create",
      qStep: "hero",
      name: "JAMES",
      genre: "runner",
      hero: "a fox in a tiny blue scarf",
      vibe: "sunset",
    });
    this.setStepCamera("create");

    let phase = 1;
    while (
      (performance.now() - startMs) / 1000 < totalSec ||
      this.benchRecording.frameTimes.length < 120
    ) {
      const elapsedSec = (performance.now() - startMs) / 1000;
      if (phase === 1 && elapsedSec >= createEnd) {
        phase = 2;
        const foxSkin = getMockSkinCanvases("fox");
        this.mockBuildCtx = {
          fullMq: foxSkin.marquee,
          fullSd: foxSkin.side,
          blankMq: pendingMarquee("JAMES"),
          blankSd: blankSide(),
        };
        this.setPreviewState({
          step: "build",
          buildMode: true,
          buildTitle: "FOXFIRE RUN",
          genre: "runner",
        });
        this.setStepCamera("build");
      } else if (phase === 2 && elapsedSec >= buildEnd) {
        phase = 3;
        this.mockBuildCtx = null;
        this.applyMockGameSkin("fox");
        this.setPreviewState({
          step: "play",
          buildMode: false,
          mockGameKey: "fox",
          genre: "runner",
        });
        this.setStepCamera("play");
      } else if (phase === 3 && elapsedSec >= playEnd) {
        phase = 4;
        const cometSkin = getMockSkinCanvases("comet");
        this.setPreviewState({
          step: "switch",
          buildMode: false,
        });
        this.setStepCamera("switch");
        this.startSwitchTransition({
          marquee: cometSkin.marquee,
          side: cometSkin.side,
          trim: cometSkin.def.trim,
          body: cometSkin.def.body,
          btn: cometSkin.def.btn,
        });
      }

      await new Promise((r) => requestAnimationFrame(r));
    }

    const rec = this.benchRecording;
    this.benchRecording = null;

    const sortedTimes = [...rec.frameTimes].sort((a, b) => a - b);
    const p50Ms =
      sortedTimes[Math.floor(sortedTimes.length * 0.5)] ?? 0;
    const p95Ms =
      sortedTimes[Math.floor(sortedTimes.length * 0.95)] ?? 0;
    const afterWarmup = rec.frameTimes.slice(Math.min(10, rec.frameTimes.length - 1));
    const maxMsAfterWarmup =
      afterWarmup.length > 0 ? Math.max(...afterWarmup) : 0;
    const maxDrawCalls =
      rec.drawCalls.length > 0 ? Math.max(...rec.drawCalls) : 0;
    const maxTriangles =
      rec.triangles.length > 0 ? Math.max(...rec.triangles) : 0;
    const avgDrawCalls =
      rec.drawCalls.length > 0
        ? Math.round(
            rec.drawCalls.reduce((a, b) => a + b, 0) / rec.drawCalls.length
          )
        : 0;
    const avgTriangles =
      rec.triangles.length > 0
        ? Math.round(
            rec.triangles.reduce((a, b) => a + b, 0) / rec.triangles.length
          )
        : 0;

    const geometryBudgetPassed =
      maxDrawCalls <= 120 && maxTriangles <= 250_000;
    const timingPassed =
      isSoftwareRenderer || (p95Ms <= 16.7 && maxMsAfterWarmup <= 50);

    const result: BenchResult = {
      mode: isFast ? "fast" : "full",
      frames: rec.frameTimes.length,
      durationMs: Math.round(performance.now() - startMs),
      p50Ms: Number(p50Ms.toFixed(2)),
      p95Ms: Number(p95Ms.toFixed(2)),
      maxMsAfterWarmup: Number(maxMsAfterWarmup.toFixed(2)),
      maxDrawCalls,
      maxTriangles,
      avgDrawCalls,
      avgTriangles,
      renderer: rendererStr,
      isSoftwareRenderer,
      passed: geometryBudgetPassed && timingPassed,
    };

    if (typeof window !== "undefined") {
      window.__BENCH_RESULT__ = result;
      window.__BENCH_RUNNING__ = false;
      this.renderBenchBadge(result);
    }

    return result;
  }

  private renderBenchBadge(res: BenchResult): void {
    if (typeof document === "undefined") return;
    let badge = document.getElementById("bench-result-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "bench-result-badge";
      document.body.appendChild(badge);
    }
    badge.setAttribute("data-bench-done", "true");
    badge.style.cssText =
      "position:fixed;left:24px;top:80px;z-index:9999;padding:16px 20px;border-radius:16px;background:rgba(22,11,13,0.88);backdrop-filter:blur(16px);color:#FFF1E8;font:500 13px 'JetBrains Mono',monospace;box-shadow:inset 0 0 0 1px rgba(255,241,232,0.16);line-height:1.6;";
    badge.innerHTML = `
      <div style="color:#FFEC27;font-weight:700;margin-bottom:4px;">?bench ${res.passed ? "PASS" : "FAIL"} (${res.frames} frames)</div>
      <div>p50: ${res.p50Ms} ms · p95: ${res.p95Ms} ms · max: ${res.maxMsAfterWarmup} ms</div>
      <div>draw calls: ${res.maxDrawCalls} / 120 · tris: ${res.maxTriangles.toLocaleString()} / 250,000</div>
      <div style="opacity:0.65;font-size:11px;">renderer: ${res.renderer}${res.isSoftwareRenderer ? " (software WebGL — frame-time waived per §1.4)" : ""}</div>
    `;
  }

  public getRendererInfo(): { calls: number; triangles: number } {
    if (!this.renderer) return { calls: 0, triangles: 0 };
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this.boundOnWindowResize);
    window.removeEventListener("pointermove", this.boundOnPointerMove);
    window.removeEventListener("blur", this.boundOnPointerReset);
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.removeEventListener(
        "mouseleave",
        this.boundOnPointerReset
      );
    }

    this.gui?.destroy();
    this.gui = null;
    this.controls?.dispose();
    this.rtScene?.dispose();
    this.rtPost?.dispose();
    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}

export default ArcadeStage;
