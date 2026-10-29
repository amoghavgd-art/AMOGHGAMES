import * as THREE from "three";
import { C } from "./skinCompositor";

export type DayNightPhase = "night" | "dawn" | "day" | "sunset" | "dusk";

export interface DayNightState {
  timeHours: number; // 0..24
  cycleProgress: number; // 0..1
  phase: DayNightPhase;
  phaseLabel: string;
  phaseIcon: string;
  isAutoCycle: boolean;
}

export interface RoomLightingState {
  sunLight: {
    color: string;
    intensity: number;
    pos: [number, number, number];
  };
  hemiLight: {
    skyColor: string;
    groundColor: string;
    intensity: number;
  };
  lampLight: {
    color: string;
    intensity: number;
    shadeEmissive: string;
    shadeIntensity: number;
  };
  rimLight: {
    color: string;
    intensity: number;
  };
  rim2Light: {
    color: string;
    intensity: number;
  };
  fog: {
    color: string;
    near: number;
    far: number;
  };
  dust: {
    color: string;
    opacity: number;
  };
  stringLightsIntensity: number;
}

// 4x4 Bayer matrix for authentic retro dithering
const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const hx = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

function lerpRgb(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number
): [number, number, number] {
  const f = Math.max(0, Math.min(1, t));
  return [
    c1[0] + (c2[0] - c1[0]) * f,
    c1[1] + (c2[1] - c1[1]) * f,
    c1[2] + (c2[2] - c1[2]) * f,
  ];
}

function lerpHex(hex1: string, hex2: string, t: number): string {
  const rgb = lerpRgb(hexToRgb(hex1), hexToRgb(hex2), t);
  return rgbToHex(rgb[0], rgb[1], rgb[2]);
}

interface Cloud {
  x: number;
  y: number;
  w: number;
  h: number;
  speed: number;
  shapeSeed: number;
}

interface Star {
  x: number;
  y: number;
  size: number;
  twinkleSpeed: number;
  twinklePhase: number;
  brightness: number;
}

export class WindowScenery {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;

  private width = 256;
  private height = 144;

  // Day/Night progression
  // 0.0 / 24.0 = midnight, 6.0 = dawn/sunrise, 12.0 = midday, 18.0 = sunset, 21.0 = dusk
  private timeHours = 17.5; // Start in glorious late afternoon / sunset
  private isAutoCycle = true;
  private cycleDurationSeconds = 72; // Full day/night in 72s

  // Scenery procedural assets
  private stars: Star[] = [];
  private clouds: Cloud[] = [];
  private mountainsNear: number[] = [];
  private mountainsFar: number[] = [];
  private treePositions: Array<{ x: number; h: number; type: number }> = [];
  private cabinWindows: Array<{ x: number; y: number; onPhase: number }> = [];

  // Animation timers
  private animTime = 0;
  private shootingStar: { x: number; y: number; dx: number; dy: number; life: number } | null = null;
  private shootingStarTimer = 8;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;

    this.initLandscape();
  }

  public getTexture(): THREE.CanvasTexture {
    return this.texture;
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public getState(): DayNightState {
    const cycleProgress = (this.timeHours % 24) / 24;
    let phase: DayNightPhase = "day";
    let phaseLabel = "Daylight";
    let phaseIcon = "☀️";

    if (this.timeHours >= 4.5 && this.timeHours < 7.5) {
      phase = "dawn";
      phaseLabel = "Sunrise";
      phaseIcon = "🌅";
    } else if (this.timeHours >= 7.5 && this.timeHours < 16.5) {
      phase = "day";
      phaseLabel = "Daylight";
      phaseIcon = "☀️";
    } else if (this.timeHours >= 16.5 && this.timeHours < 19.5) {
      phase = "sunset";
      phaseLabel = "Golden Hour";
      phaseIcon = "🌇";
    } else if (this.timeHours >= 19.5 && this.timeHours < 22) {
      phase = "dusk";
      phaseLabel = "Twilight";
      phaseIcon = "🌌";
    } else {
      phase = "night";
      phaseLabel = "Midnight";
      phaseIcon = "🌙";
    }

    return {
      timeHours: this.timeHours,
      cycleProgress,
      phase,
      phaseLabel,
      phaseIcon,
      isAutoCycle: this.isAutoCycle,
    };
  }

  public setTimeHours(hours: number): void {
    this.timeHours = ((hours % 24) + 24) % 24;
    this.renderScenery();
  }

  public setAutoCycle(auto: boolean): void {
    this.isAutoCycle = auto;
  }

  public toggleAutoCycle(): boolean {
    this.isAutoCycle = !this.isAutoCycle;
    return this.isAutoCycle;
  }

  public cycleNextPreset(): DayNightState {
    const current = this.getState().phase;
    if (current === "night") this.setTimeHours(6.2); // Dawn
    else if (current === "dawn") this.setTimeHours(12.0); // Day
    else if (current === "day") this.setTimeHours(17.8); // Sunset
    else if (current === "sunset") this.setTimeHours(20.5); // Dusk
    else this.setTimeHours(0.5); // Night

    return this.getState();
  }

  private initLandscape(): void {
    // Generate stars
    this.stars = [];
    for (let i = 0; i < 70; i++) {
      this.stars.push({
        x: Math.floor(Math.sin(i * 123.45) * 43758.5453 * 1000) % this.width,
        y: Math.abs(Math.floor(Math.cos(i * 678.9) * 43758.5453 * 1000)) % 72,
        size: i % 7 === 0 ? 2 : 1,
        twinkleSpeed: 1.5 + (i % 5) * 0.8,
        twinklePhase: (i * 0.7) % (Math.PI * 2),
        brightness: 0.6 + (i % 4) * 0.13,
      });
    }

    // Generate procedural clouds
    this.clouds = [
      { x: 20, y: 16, w: 54, h: 18, speed: 1.8, shapeSeed: 1 },
      { x: 110, y: 28, w: 72, h: 22, speed: 1.4, shapeSeed: 2 },
      { x: 195, y: 12, w: 48, h: 16, speed: 2.1, shapeSeed: 3 },
      { x: 270, y: 34, w: 62, h: 20, speed: 1.6, shapeSeed: 4 },
    ];

    // Distant mountain range heights (256 points)
    this.mountainsFar = [];
    for (let x = 0; x < this.width; x++) {
      const n1 = Math.sin(x * 0.02) * 22;
      const n2 = Math.sin(x * 0.06 + 1.2) * 11;
      const n3 = Math.sin(x * 0.12 + 2.5) * 5;
      this.mountainsFar.push(Math.round(62 + n1 + n2 + n3));
    }

    // Near mountain range & rolling hills heights
    this.mountainsNear = [];
    for (let x = 0; x < this.width; x++) {
      const n1 = Math.sin(x * 0.035 + 0.8) * 18;
      const n2 = Math.sin(x * 0.08 + 3.1) * 8;
      this.mountainsNear.push(Math.round(84 + n1 + n2));
    }

    // Pine trees along foreground ridges
    this.treePositions = [];
    for (let x = 4; x < this.width - 4; x += 6 + (x % 5)) {
      if ((x > 90 && x < 155) || (x > 210 && x < 235)) {
        // Leave gaps for serene lake and cabin vistas
        continue;
      }
      this.treePositions.push({
        x,
        h: 12 + ((x * 7) % 9),
        type: x % 3,
      });
    }

    // Distant cozy cabins on the hillside
    this.cabinWindows = [
      { x: 104, y: 92, onPhase: 0.72 },
      { x: 122, y: 95, onPhase: 0.7 },
      { x: 220, y: 90, onPhase: 0.75 },
    ];
  }

  public update(dt: number): void {
    this.animTime += dt;

    if (this.isAutoCycle) {
      // 24 hours over cycleDurationSeconds
      const deltaHours = (dt / this.cycleDurationSeconds) * 24;
      this.timeHours = (this.timeHours + deltaHours) % 24;
    }

    // Move clouds
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x - c.w > this.width) {
        c.x = -c.w - 10;
      }
    }

    // Shooting star at night
    if (this.timeHours < 4.5 || this.timeHours > 20.5) {
      this.shootingStarTimer -= dt;
      if (this.shootingStarTimer <= 0 && !this.shootingStar) {
        this.shootingStar = {
          x: 40 + Math.random() * 160,
          y: 5 + Math.random() * 25,
          dx: -45 - Math.random() * 30,
          dy: 20 + Math.random() * 15,
          life: 0.65,
        };
        this.shootingStarTimer = 9 + Math.random() * 12;
      }
    }

    if (this.shootingStar) {
      this.shootingStar.x += this.shootingStar.dx * dt;
      this.shootingStar.y += this.shootingStar.dy * dt;
      this.shootingStar.life -= dt;
      if (this.shootingStar.life <= 0) {
        this.shootingStar = null;
      }
    }

    this.renderScenery();
  }

  private renderScenery(): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const t = this.animTime;
    const hr = this.timeHours;

    // 1. SKY GRADIENT CALCULATION
    const skyStops = this.getSkyColorStops(hr);
    this.drawDitheredVerticalGradient(0, 0, w, h, skyStops);

    // 2. STARS & CELESTIAL BODIES
    const nightBlend = this.getNightBlendFactor(hr);
    if (nightBlend > 0.05) {
      this.drawStars(nightBlend);
    }

    // Celestial Bodies (Sun and Moon)
    this.drawCelestialBodies(hr);

    // 3. SHOOTING STAR
    if (this.shootingStar && nightBlend > 0.3) {
      ctx.strokeStyle = "#fff1e8";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.shootingStar.x, this.shootingStar.y);
      ctx.lineTo(
        this.shootingStar.x - this.shootingStar.dx * 0.12,
        this.shootingStar.y - this.shootingStar.dy * 0.12
      );
      ctx.stroke();
    }

    // 4. CLOUDS (Lit by current daylight / sunset / moon tint)
    this.drawClouds(hr);

    // 5. DISTANT MOUNTAINS
    this.drawDistantMountains(hr);

    // 6. NEAR MOUNTAINS & HILLS
    this.drawNearMountains(hr);

    // 7. SERENE LAKE WITH WATER REFLECTION
    this.drawLakeAndReflections(hr);

    // 8. FOREGROUND CABINS & TREELINE
    this.drawForegroundAndTrees(hr);

    // 9. DUSK / NIGHT FIREFLIES
    if (nightBlend > 0.35) {
      this.drawFireflies(t);
    }

    this.texture.needsUpdate = true;
  }

  private getSkyColorStops(hr: number): string[] {
    // Return vertical gradient stops from sky top to horizon
    if (hr >= 0 && hr < 4.5) {
      // Midnight
      return ["#080816", "#0d132b", "#141b3d", "#1c183f", "#261542"];
    } else if (hr >= 4.5 && hr < 6.0) {
      // Early Dawn
      const f = (hr - 4.5) / 1.5;
      return [
        lerpHex("#080816", "#141b3d", f),
        lerpHex("#0d132b", "#2c1c4e", f),
        lerpHex("#141b3d", "#5c2448", f),
        lerpHex("#1c183f", "#be1250", f),
        lerpHex("#261542", "#ff6e59", f),
      ];
    } else if (hr >= 6.0 && hr < 7.5) {
      // Sunrise
      const f = (hr - 6.0) / 1.5;
      return [
        lerpHex("#141b3d", "#1d75c2", f),
        lerpHex("#2c1c4e", "#29adff", f),
        lerpHex("#5c2448", "#ff77a8", f),
        lerpHex("#be1250", "#ffaa5e", f),
        lerpHex("#ff6e59", "#ffec27", f),
      ];
    } else if (hr >= 7.5 && hr < 11.0) {
      // Morning to Midday
      const f = (hr - 7.5) / 3.5;
      return [
        lerpHex("#1d75c2", "#1369b8", f),
        lerpHex("#29adff", "#29adff", f),
        lerpHex("#ff77a8", "#63c5ff", f),
        lerpHex("#ffaa5e", "#a6e5ff", f),
        lerpHex("#ffec27", "#fff4e0", f),
      ];
    } else if (hr >= 11.0 && hr < 16.0) {
      // Full Daylight
      return ["#115d9e", "#2188db", "#45aeff", "#8fe0ff", "#e0f6ff"];
    } else if (hr >= 16.0 && hr < 18.0) {
      // Golden Hour to Sunset
      const f = (hr - 16.0) / 2.0;
      return [
        lerpHex("#115d9e", "#1b2552", f),
        lerpHex("#2188db", "#462e60", f),
        lerpHex("#45aeff", "#823668", f),
        lerpHex("#8fe0ff", "#ff6c24", f),
        lerpHex("#e0f6ff", "#ffec27", f),
      ];
    } else if (hr >= 18.0 && hr < 20.0) {
      // Sunset to Twilight
      const f = (hr - 18.0) / 2.0;
      return [
        lerpHex("#1b2552", "#111536", f),
        lerpHex("#462e60", "#2c1c46", f),
        lerpHex("#823668", "#5c1e44", f),
        lerpHex("#ff6c24", "#a12347", f),
        lerpHex("#ffec27", "#ff77a8", f),
      ];
    } else if (hr >= 20.0 && hr < 22.0) {
      // Twilight to Dusk
      const f = (hr - 20.0) / 2.0;
      return [
        lerpHex("#111536", "#080816", f),
        lerpHex("#2c1c46", "#0d132b", f),
        lerpHex("#5c1e44", "#141b3d", f),
        lerpHex("#a12347", "#1c183f", f),
        lerpHex("#ff77a8", "#261542", f),
      ];
    } else {
      // Late Night
      return ["#080816", "#0d132b", "#141b3d", "#1c183f", "#261542"];
    }
  }

  private getNightBlendFactor(hr: number): number {
    if (hr >= 21 || hr < 4.5) return 1.0;
    if (hr >= 4.5 && hr < 6.5) return 1.0 - (hr - 4.5) / 2.0;
    if (hr >= 19.5 && hr < 21) return (hr - 19.5) / 1.5;
    return 0.0;
  }

  private drawStars(nightBlend: number): void {
    const ctx = this.ctx;
    const t = this.animTime;
    for (const s of this.stars) {
      const tw = Math.sin(t * s.twinkleSpeed + s.twinklePhase) * 0.4 + 0.6;
      const alpha = s.brightness * tw * nightBlend;
      if (alpha < 0.15) continue;

      ctx.fillStyle = s.size > 1 ? `rgba(255, 241, 232, ${alpha})` : `rgba(215, 230, 255, ${alpha})`;
      ctx.fillRect(s.x, s.y, s.size, s.size);

      // Star cross sparkle for larger stars
      if (s.size > 1 && tw > 0.85 && alpha > 0.6) {
        ctx.fillStyle = `rgba(255, 241, 232, ${alpha * 0.45})`;
        ctx.fillRect(s.x - 1, s.y, 3, 1);
        ctx.fillRect(s.x, s.y - 1, 1, 3);
      }
    }
  }

  private drawCelestialBodies(hr: number): void {
    const ctx = this.ctx;

    // SUN: Visible between 5.5 and 19.0
    if (hr >= 5.2 && hr <= 19.2) {
      // Arc formula across sky
      const sunProgress = (hr - 5.2) / 14.0; // 0..1
      const sunX = Math.round(25 + sunProgress * (this.width - 50));
      // Peak height at noon: y = 22, rises from y = 92, sets at y = 94
      const arc = Math.sin(sunProgress * Math.PI);
      const sunY = Math.round(92 - arc * 70);

      const isSunriseOrSet = hr < 7.0 || hr > 17.5;
      const sunRadius = isSunriseOrSet ? 13 : 10;
      const sunTopColor = isSunriseOrSet ? "#fff1e8" : "#fffbe8";
      const sunBotColor = isSunriseOrSet ? "#ff8824" : "#ffec27";

      // Radiant sun corona
      ctx.fillStyle = isSunriseOrSet
        ? "rgba(255, 163, 0, 0.28)"
        : "rgba(255, 236, 39, 0.22)";
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunRadius + 6, 0, Math.PI * 2);
      ctx.fill();

      // Dithered Sun Disc with retro scanline stripes when setting
      const stripes = hr > 16.8 ? 3 : 0;
      this.drawDitherDisc(sunX, sunY, sunRadius, sunTopColor, sunBotColor, stripes);

      // Sun flare rays in bright midday
      if (hr >= 10 && hr <= 14) {
        ctx.strokeStyle = "rgba(255, 248, 220, 0.35)";
        ctx.lineWidth = 1;
        const r1 = sunRadius + 2;
        const r2 = sunRadius + 7;
        const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4];
        for (const a of angles) {
          ctx.beginPath();
          ctx.moveTo(sunX + Math.cos(a) * r1, sunY + Math.sin(a) * r1);
          ctx.lineTo(sunX + Math.cos(a) * r2, sunY + Math.sin(a) * r2);
          ctx.stroke();
        }
      }
    }

    // MOON: Visible between 18.8 and 6.2
    let moonProgress = -1;
    if (hr >= 18.5) {
      moonProgress = (hr - 18.5) / 11.0;
    } else if (hr <= 5.8) {
      moonProgress = (hr + 5.5) / 11.0;
    }

    if (moonProgress >= 0 && moonProgress <= 1.0) {
      const moonX = Math.round(210 - moonProgress * 165);
      const moonArc = Math.sin(moonProgress * Math.PI);
      const moonY = Math.round(85 - moonArc * 62);
      const moonR = 9;

      // Soft lunar aura
      ctx.fillStyle = "rgba(130, 180, 255, 0.16)";
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR + 5, 0, Math.PI * 2);
      ctx.fill();

      // Luminous crescent / moon body
      this.drawDitherDisc(moonX, moonY, moonR, "#ffffff", "#c8d8f0");

      // Craters / maria
      ctx.fillStyle = "#8a9eb8";
      ctx.fillRect(moonX - 2, moonY - 3, 3, 2);
      ctx.fillRect(moonX + 1, moonY + 1, 2, 2);
      ctx.fillRect(moonX - 4, moonY + 2, 2, 2);
    }
  }

  private drawClouds(hr: number): void {
    const ctx = this.ctx;
    const isNight = hr < 5.0 || hr > 20.0;
    const isSunset = (hr >= 16.5 && hr <= 19.5) || (hr >= 5.0 && hr <= 7.0);

    let topColor = "#ffffff";
    let botColor = "#c2c3c7";
    let edgeColor = "#e6e6e6";

    if (isNight) {
      topColor = "rgba(40, 50, 85, 0.85)";
      botColor = "rgba(20, 25, 45, 0.9)";
      edgeColor = "rgba(65, 80, 120, 0.6)";
    } else if (isSunset) {
      topColor = "#fff1e8";
      botColor = "#ff77a8";
      edgeColor = "#ffa300";
    }

    for (const c of this.clouds) {
      const cx = Math.round(c.x);
      const cy = Math.round(c.y);

      // Fluffy rounded cloud constructed of overlapping circles/rectangles
      ctx.fillStyle = botColor;
      ctx.fillRect(cx + 6, cy + 6, c.w - 12, c.h - 6);
      ctx.fillRect(cx, cy + 8, c.w, c.h - 8);

      ctx.fillStyle = topColor;
      ctx.fillRect(cx + 8, cy + 2, c.w - 20, c.h - 8);
      ctx.fillRect(cx + 14, cy, c.w - 32, c.h - 10);
      ctx.fillRect(cx + 4, cy + 4, c.w - 8, c.h - 6);

      // Accent edge highlight
      ctx.fillStyle = edgeColor;
      ctx.fillRect(cx + 12, cy + 1, c.w - 28, 2);
      ctx.fillRect(cx + 6, cy + 3, 8, 2);
    }
  }

  private drawDistantMountains(hr: number): void {
    const ctx = this.ctx;
    const isNight = hr < 5.0 || hr > 20.0;
    const isSunset = (hr >= 16.5 && hr <= 19.5) || (hr >= 5.0 && hr <= 7.0);

    let mountainCol = "#4d6b8c";
    let peakCol = "#fff1e8";

    if (isNight) {
      mountainCol = "#121b36";
      peakCol = "#31446b";
    } else if (isSunset) {
      mountainCol = "#592b4a";
      peakCol = "#ffa3a8";
    }

    ctx.fillStyle = mountainCol;
    for (let x = 0; x < this.width; x++) {
      const top = this.mountainsFar[x];
      ctx.fillRect(x, top, 1, this.height - top);
    }

    // Snow caps on peaks
    ctx.fillStyle = peakCol;
    for (let x = 0; x < this.width; x++) {
      const top = this.mountainsFar[x];
      if (top < 56) {
        const snowDepth = 56 - top;
        ctx.fillRect(x, top, 1, Math.min(snowDepth, 4));
      }
    }
  }

  private drawNearMountains(hr: number): void {
    const ctx = this.ctx;
    const isNight = hr < 5.0 || hr > 20.0;
    const isSunset = (hr >= 16.5 && hr <= 19.5) || (hr >= 5.0 && hr <= 7.0);

    let ridgeCol = "#2e5244";
    let ridgeHighlight = "#428258";

    if (isNight) {
      ridgeCol = "#0c1724";
      ridgeHighlight = "#1a2c42";
    } else if (isSunset) {
      ridgeCol = "#3b1e36";
      ridgeHighlight = "#7a374b";
    }

    for (let x = 0; x < this.width; x++) {
      const top = this.mountainsNear[x];
      ctx.fillStyle = ridgeHighlight;
      ctx.fillRect(x, top, 1, 2);
      ctx.fillStyle = ridgeCol;
      ctx.fillRect(x, top + 2, 1, this.height - top);
    }
  }

  private drawLakeAndReflections(hr: number): void {
    const ctx = this.ctx;
    const lakeY = 96;
    const lakeH = 26;
    const isNight = hr < 5.0 || hr > 20.0;
    const isSunset = (hr >= 16.5 && hr <= 19.5) || (hr >= 5.0 && hr <= 7.0);

    let waterBase = "#1c4a75";
    let rippleCol = "#3a7eb8";

    if (isNight) {
      waterBase = "#0b1224";
      rippleCol = "#19284a";
    } else if (isSunset) {
      waterBase = "#421832";
      rippleCol = "#9e3852";
    }

    // Lake surface
    ctx.fillStyle = waterBase;
    ctx.fillRect(0, lakeY, this.width, lakeH);

    // Animated water ripples
    ctx.fillStyle = rippleCol;
    const t = this.animTime;
    for (let y = lakeY + 2; y < lakeY + lakeH; y += 3) {
      const rowOffset = Math.sin(t * 2.0 + y * 0.8) * 4;
      for (let x = 10; x < this.width - 10; x += 18) {
        ctx.fillRect(Math.round(x + rowOffset), y, 10, 1);
      }
    }

    // Reflection of celestial body
    if (hr >= 5.5 && hr <= 18.8) {
      // Sun reflection
      const sunProgress = (hr - 5.5) / 13.3;
      const sunX = Math.round(25 + sunProgress * (this.width - 50));
      ctx.fillStyle = isSunset ? "#ffaa44" : "#fff1e8";
      for (let y = lakeY + 1; y < lakeY + lakeH - 2; y += 2) {
        const jitter = Math.sin(y * 3.1 + t * 4.0) * ((y - lakeY) * 0.4);
        const rw = Math.max(2, 14 - (y - lakeY) * 0.35);
        ctx.fillRect(Math.round(sunX - rw / 2 + jitter), y, Math.round(rw), 1);
      }
    } else {
      // Moon reflection
      let moonProgress = hr >= 18.8 ? (hr - 18.8) / 10.7 : (hr + 5.2) / 10.7;
      if (moonProgress >= 0 && moonProgress <= 1) {
        const moonX = Math.round(210 - moonProgress * 165);
        ctx.fillStyle = "#c8d8f0";
        for (let y = lakeY + 2; y < lakeY + lakeH - 4; y += 3) {
          const jitter = Math.sin(y * 2.5 + t * 3.0) * 3;
          ctx.fillRect(Math.round(moonX - 3 + jitter), y, 6, 1);
        }
      }
    }
  }

  private drawForegroundAndTrees(hr: number): void {
    const ctx = this.ctx;
    const isNight = hr < 5.0 || hr > 20.0;
    const isSunset = (hr >= 16.5 && hr <= 19.5) || (hr >= 5.0 && hr <= 7.0);

    let groundCol = "#183321";
    let pineCol = "#004724";
    let pineHighlight = "#008751";
    let cabinRoof = "#3d2319";
    let cabinWall = "#291814";

    if (isNight) {
      groundCol = "#081014";
      pineCol = "#050d12";
      pineHighlight = "#0d1d26";
      cabinRoof = "#140e1a";
      cabinWall = "#0a0710";
    } else if (isSunset) {
      groundCol = "#291624";
      pineCol = "#210f1e";
      pineHighlight = "#4a1c38";
      cabinRoof = "#4a1f1b";
      cabinWall = "#2e1215";
    }

    // Shoreline / foreground ground
    ctx.fillStyle = groundCol;
    ctx.fillRect(0, 116, this.width, this.height - 116);
    ctx.fillRect(0, 112, 100, 10);
    ctx.fillRect(150, 114, this.width - 150, 12);

    // Cabins
    for (const c of this.cabinWindows) {
      ctx.fillStyle = cabinWall;
      ctx.fillRect(c.x - 6, c.y, 14, 10);
      ctx.fillStyle = cabinRoof;
      ctx.fillRect(c.x - 8, c.y - 4, 18, 4);
      ctx.fillRect(c.x - 5, c.y - 6, 12, 2);

      // Window light turns on in the evening/night!
      const windowLit = hr >= 17.5 || hr < 6.5;
      if (windowLit) {
        ctx.fillStyle = "#ffec27";
        ctx.fillRect(c.x - 2, c.y + 2, 4, 4);
        ctx.fillStyle = "#ffa300";
        ctx.fillRect(c.x - 1, c.y + 3, 2, 2);
      } else {
        ctx.fillStyle = "#111d35";
        ctx.fillRect(c.x - 2, c.y + 2, 4, 4);
      }
    }

    // Pine trees
    for (const t of this.treePositions) {
      const baseY = t.x < 100 ? 116 : 118;
      const h = t.h;
      const tx = t.x;

      // Trunk
      ctx.fillStyle = isNight ? "#080c10" : "#291814";
      ctx.fillRect(tx, baseY - 4, 2, 6);

      // Tiered pine foliage
      const tiers = 3;
      for (let ti = 0; ti < tiers; ti++) {
        const tierY = baseY - 4 - Math.round(((ti + 1) / tiers) * h);
        const tierW = Math.round((1 - ti / (tiers + 0.5)) * 10);
        ctx.fillStyle = pineCol;
        ctx.fillRect(tx - Math.floor(tierW / 2) + 1, tierY, tierW, Math.round(h / tiers) + 2);

        // Highlight tip
        if (!isNight) {
          ctx.fillStyle = pineHighlight;
          ctx.fillRect(tx - Math.floor(tierW / 4) + 1, tierY, Math.max(1, Math.floor(tierW / 2)), 1);
        }
      }
    }
  }

  private drawFireflies(t: number): void {
    const ctx = this.ctx;
    for (let i = 0; i < 9; i++) {
      const fx = Math.round(30 + ((i * 37 + t * 8) % (this.width - 60)));
      const fy = Math.round(102 + Math.sin(t * 1.8 + i * 2.1) * 12);
      const glow = Math.sin(t * 3.5 + i * 1.7) * 0.5 + 0.5;
      if (glow > 0.4) {
        ctx.fillStyle = `rgba(180, 255, 60, ${glow * 0.85})`;
        ctx.fillRect(fx, fy, 2, 2);
        ctx.fillStyle = `rgba(255, 255, 180, ${glow})`;
        ctx.fillRect(fx, fy, 1, 1);
      }
    }
  }

  private drawDitherDisc(
    cx: number,
    cy: number,
    r: number,
    colTop: string,
    colBot: string,
    stripes = 0
  ): void {
    const ctx = this.ctx;
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        const f = (y + r) / (2 * r);
        const th = (BAYER_4X4[((cy + y) & 3) * 4 + ((cx + x) & 3)] + 0.5) / 16;
        if (stripes && y > 0 && (y + 1) % stripes < Math.max(1, Math.floor((y / r) * 3))) continue;
        ctx.fillStyle = f > th ? colBot : colTop;
        ctx.fillRect(cx + x, cy + y, 1, 1);
      }
    }
  }

  private drawDitheredVerticalGradient(
    x0: number,
    y0: number,
    w: number,
    h: number,
    hexStops: string[]
  ): void {
    const ctx = this.ctx;
    const id = ctx.createImageData(w, h);
    const d = id.data;
    const rgb = hexStops.map(hexToRgb);
    const maxIdx = Math.max(0, rgb.length - 1);

    for (let j = 0; j < h; j++) {
      const f = (j / Math.max(1, h - 1)) * maxIdx;
      const i0 = Math.min(maxIdx, Math.floor(f));
      const fr = f - i0;
      for (let i = 0; i < w; i++) {
        const th = (BAYER_4X4[((y0 + j) & 3) * 4 + ((x0 + i) & 3)] + 0.5) / 16;
        const c = rgb[Math.min(maxIdx, fr > th ? i0 + 1 : i0)];
        const k = (j * w + i) * 4;
        d[k] = c[0];
        d[k + 1] = c[1];
        d[k + 2] = c[2];
        d[k + 3] = 255;
      }
    }
    ctx.putImageData(id, x0, y0);
  }

  /**
   * Computes cohesive physical lighting for the 3D ArcadeStage room
   * based on the exact current time of day!
   */
  public getRoomLightingState(): RoomLightingState {
    const hr = this.timeHours;

    let sunColor = "#fff8e8";
    let sunIntensity = 2.8;
    let sunPos: [number, number, number] = [-1.5, 4.6, -2.4];

    let hemiSky = "#7ec4eb";
    let hemiGround = "#5c3d2e";
    let hemiIntensity = 0.95;

    let lampColor = "#ffa347";
    let lampIntensity = 0.5; // low during day
    let lampShadeEmissive = "#553a2a";
    let lampShadeIntensity = 0.15;

    let rimColor = "#ffa86a";
    let rimIntensity = 2.0;

    let rim2Color = "#e67aa2";
    let rim2Intensity = 1.0;

    let fogColor = "#506d8a";
    let fogNear = 5.5;
    let fogFar = 13.5;

    let dustColor = "#ffcca0";
    let dustOpacity = 0.5;

    let stringLightsIntensity = 0.6; // dimmer in daytime

    if (hr >= 0 && hr < 4.5) {
      // Midnight
      sunColor = "#6d8ec9"; // Cool moonlight
      sunIntensity = 0.65;
      sunPos = [-2.8, 3.8, -2.6];

      hemiSky = "#141836";
      hemiGround = "#080914";
      hemiIntensity = 0.28;

      lampColor = "#ff9a38";
      lampIntensity = 3.6; // Lamp is hero light at night!
      lampShadeEmissive = "#ffa040";
      lampShadeIntensity = 1.35;

      rimColor = "#29adff";
      rimIntensity = 1.4;
      rim2Color = "#754665";
      rim2Intensity = 0.8;

      fogColor = "#080816";
      fogNear = 4.8;
      fogFar = 10.5;

      dustColor = "#7aa2e8";
      dustOpacity = 0.35;
      stringLightsIntensity = 1.75; // Party string lights shine bright!
    } else if (hr >= 4.5 && hr < 7.5) {
      // Dawn / Sunrise
      const f = (hr - 4.5) / 3.0;
      sunColor = lerpHex("#ff7048", "#ffbe73", f);
      sunIntensity = 1.0 + f * 1.5;
      sunPos = [-3.2 + f * 1.2, 2.4 + f * 1.8, -2.8];

      hemiSky = lerpHex("#2c1836", "#72aad6", f);
      hemiGround = lerpHex("#1a1020", "#54382c", f);
      hemiIntensity = 0.35 + f * 0.5;

      lampColor = "#ffa347";
      lampIntensity = 3.2 - f * 2.2;
      lampShadeEmissive = lerpHex("#ffa040", "#664030", f);
      lampShadeIntensity = 1.2 - f * 0.9;

      rimColor = lerpHex("#be1250", "#ffaa5e", f);
      rimIntensity = 2.2;
      rim2Color = lerpHex("#754665", "#ff77a8", f);
      rim2Intensity = 1.1;

      fogColor = lerpHex("#1a1020", "#463042", f);
      fogNear = 5.0;
      fogFar = 12.0;

      dustColor = "#ff9d81";
      dustOpacity = 0.45;
      stringLightsIntensity = 1.5 - f * 0.7;
    } else if (hr >= 7.5 && hr < 16.5) {
      // Full Daylight
      const middayFactor = 1 - Math.abs(hr - 12) / 4.5;
      sunColor = "#fff8ea";
      sunIntensity = 2.7 + middayFactor * 0.4;
      sunPos = [-1.5, 4.8 + middayFactor * 0.6, -2.4];

      hemiSky = "#78c0e8";
      hemiGround = "#5c3d2e";
      hemiIntensity = 0.95;

      lampColor = "#ffa347";
      lampIntensity = 0.4;
      lampShadeEmissive = "#443026";
      lampShadeIntensity = 0.1;

      rimColor = "#ffbe85";
      rimIntensity = 2.0;
      rim2Color = "#e694b8";
      rim2Intensity = 0.9;

      fogColor = "#4d6b88";
      fogNear = 6.0;
      fogFar = 14.0;

      dustColor = "#fff2d6";
      dustOpacity = 0.55;
      stringLightsIntensity = 0.5;
    } else if (hr >= 16.5 && hr < 19.5) {
      // Golden Hour & Sunset
      const f = (hr - 16.5) / 3.0;
      sunColor = lerpHex("#ffa338", "#ff4a20", f);
      sunIntensity = 2.8 - f * 0.6;
      sunPos = [-1.0 + f * 1.6, 3.8 - f * 1.5, -2.3];

      hemiSky = lerpHex("#82506e", "#3a172c", f);
      hemiGround = lerpHex("#543028", "#24101e", f);
      hemiIntensity = 0.85 - f * 0.35;

      lampColor = "#ffa040";
      lampIntensity = 0.8 + f * 2.2;
      lampShadeEmissive = lerpHex("#664030", "#ffa040", f);
      lampShadeIntensity = 0.2 + f * 0.95;

      rimColor = lerpHex("#ff6c24", "#be1250", f);
      rimIntensity = 2.8;
      rim2Color = lerpHex("#ff77a8", "#754665", f);
      rim2Intensity = 1.3;

      fogColor = lerpHex("#422136", "#291325", f);
      fogNear = 5.0;
      fogFar = 12.0;

      dustColor = "#ffa338";
      dustOpacity = 0.6;
      stringLightsIntensity = 0.8 + f * 0.8;
    } else {
      // Dusk into Night (19.5 .. 24.0)
      const f = (hr - 19.5) / 4.5;
      sunColor = lerpHex("#9d528b", "#6d8ec9", f);
      sunIntensity = 1.8 - f * 1.15;
      sunPos = [0.6 - f * 3.4, 2.3 + f * 1.5, -2.5];

      hemiSky = lerpHex("#291325", "#141836", f);
      hemiGround = lerpHex("#180c16", "#080914", f);
      hemiIntensity = 0.5 - f * 0.22;

      lampColor = "#ff9a38";
      lampIntensity = 3.0 + f * 0.6;
      lampShadeEmissive = "#ffa040";
      lampShadeIntensity = 1.15 + f * 0.2;

      rimColor = lerpHex("#be1250", "#29adff", f);
      rimIntensity = 2.0 - f * 0.6;
      rim2Color = lerpHex("#5c2448", "#1c183f", f);
      rim2Intensity = 1.0 - f * 0.2;

      fogColor = lerpHex("#200f1c", "#080816", f);
      fogNear = 4.8;
      fogFar = 11.0;

      dustColor = lerpHex("#ff9d81", "#7aa2e8", f);
      dustOpacity = 0.4;
      stringLightsIntensity = 1.6 + f * 0.15;
    }

    return {
      sunLight: {
        color: sunColor,
        intensity: sunIntensity,
        pos: sunPos,
      },
      hemiLight: {
        skyColor: hemiSky,
        groundColor: hemiGround,
        intensity: hemiIntensity,
      },
      lampLight: {
        color: lampColor,
        intensity: lampIntensity,
        shadeEmissive: lampShadeEmissive,
        shadeIntensity: lampShadeIntensity,
      },
      rimLight: {
        color: rimColor,
        intensity: rimIntensity,
      },
      rim2Light: {
        color: rim2Color,
        intensity: rim2Intensity,
      },
      fog: {
        color: fogColor,
        near: fogNear,
        far: fogFar,
      },
      dust: {
        color: dustColor,
        opacity: dustOpacity,
      },
      stringLightsIntensity,
    };
  }
}
