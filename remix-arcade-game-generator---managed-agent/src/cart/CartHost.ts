import type { GameDesignCard } from "../card/schema";
import type { SfxName } from "../../engine/cart";
import { scanSource } from "../../engine/runtime.js";

export interface CartInputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  a: boolean;
  b: boolean;
  start: boolean;
}

export interface CartCallbacks {
  onReady?: (info: { title: string }) => void;
  onFrame?: (rgba: Uint8Array) => void;
  onSfx?: (name: SfxName, note?: number) => void;
  onFx?: (fx: { kind: string; intensity?: number }) => void;
  onScore?: (info: { score: number; lives: number }) => void;
  onSave?: (info: { key: string; value: number }) => void;
  onGameOver?: (info: { score: number; best: number; reason: string }) => void;
  onError?: (err: { phase: string; message: string; stack?: string }) => void;
}

export type CartHostCallbacks = CartCallbacks;

export class CartHost {
  private iframe: HTMLIFrameElement | null = null;
  private mountPromise: Promise<void> | null = null;
  private hostReadyResolve: (() => void) | null = null;
  private container: HTMLElement;
  private callbacks: CartCallbacks;
  private messageListener: (e: MessageEvent) => void;
  private frameCopy = new Uint8Array(320 * 200 * 4);
  private ticksSinceLastFrame = 0;
  private firstTickWithoutFrameAt = 0;
  private isPlaying = false;
  private paused = false;
  private lastScore = 0;
  private lastLives = 3;
  private lastFxAt = 0;
  private activeLoadCleanup: (() => void) | null = null;
  private readyResolve: ((info: { title: string }) => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private loadSeq = 0;
  private activeLoadId = 0;

  constructor(container: HTMLElement = document.body, callbacks: CartCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.messageListener = (e: MessageEvent) => this.handleMessage(e);
    window.addEventListener("message", this.messageListener);
    this.mountPromise = this.mountIframe();
  }

  private mountIframe(): Promise<void> {
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    this.mountPromise = new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.hostReadyResolve = null;
        resolve();
      };
      this.hostReadyResolve = done;
      const iframe = document.createElement("iframe");
      // Relative path as required by 05-m0-runbook.md ("Built for AI Studio")
      iframe.src = "cart/host.html";
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.setAttribute("referrerpolicy", "no-referrer");
      iframe.style.cssText =
        "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;";
      iframe.addEventListener("load", () => done(), { once: true });
      this.container.appendChild(iframe);
      this.iframe = iframe;
    });
    return this.mountPromise;
  }

  private handleMessage(e: MessageEvent): void {
    if (!this.iframe || e.source !== this.iframe.contentWindow) return;
    const msg = e.data;
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "host-ready": {
        this.hostReadyResolve?.();
        break;
      }
      case "ready": {
        if (msg.loadId && this.activeLoadId && msg.loadId !== this.activeLoadId) {
          break;
        }
        if (this.readyResolve) {
          this.readyResolve({ title: msg.title });
          this.readyResolve = null;
          this.readyReject = null;
        }
        this.callbacks.onReady?.({ title: msg.title });
        break;
      }
      case "frame": {
        if (msg.rgba instanceof ArrayBuffer && msg.rgba.byteLength === 320 * 200 * 4) {
          this.ticksSinceLastFrame = 0;
          this.firstTickWithoutFrameAt = 0;
          // Copy into our own Uint8Array and immediately return the transferred buffer to the cart pool
          this.frameCopy.set(new Uint8Array(msg.rgba));
          this.iframe.contentWindow?.postMessage({ type: "return", rgba: msg.rgba }, "*", [msg.rgba]);
          this.callbacks.onFrame?.(this.frameCopy);
        }
        break;
      }
      case "sfx":
      case "cart:sfx": {
        const note = Number(msg.note) || 0;
        this.callbacks.onSfx?.(msg.name as SfxName, note);
        const sfxName = String(msg.name || "");
        if (performance.now() - this.lastFxAt > 40) {
          if (
            sfxName === "hit" ||
            sfxName === "boom" ||
            sfxName === "explode" ||
            sfxName === "explosion" ||
            sfxName === "hurt" ||
            sfxName === "damage"
          ) {
            this.lastFxAt = performance.now();
            this.callbacks.onFx?.({
              kind: "hit",
              intensity:
                sfxName === "boom" || sfxName === "explode" || sfxName === "explosion"
                  ? 0.75
                  : 0.45,
            });
          } else if (sfxName === "powerup" || sfxName === "win" || sfxName === "shield") {
            this.lastFxAt = performance.now();
            this.callbacks.onFx?.({ kind: "powerup", intensity: 0.65 });
          }
        }
        break;
      }
      case "fx":
      case "cart:fx": {
        this.lastFxAt = performance.now();
        this.callbacks.onFx?.({
          kind: String(msg.kind || ""),
          intensity: Number(msg.intensity ?? 0.5),
        });
        break;
      }
      case "score":
      case "cart:score": {
        const nextScore = Number(msg.score) || 0;
        const nextLives = typeof msg.lives === "number" ? msg.lives : this.lastLives;
        const delta = nextScore - this.lastScore;
        if (delta >= 25 && performance.now() - this.lastFxAt > 30) {
          this.lastFxAt = performance.now();
          this.callbacks.onFx?.({
            kind: "score",
            intensity: Math.max(0.4, Math.min(1, delta / 100)),
          });
        } else if (nextLives < this.lastLives && performance.now() - this.lastFxAt > 30) {
          this.lastFxAt = performance.now();
          this.callbacks.onFx?.({ kind: "loseLife", intensity: 0.75 });
        }
        this.lastScore = nextScore;
        this.lastLives = nextLives;
        this.callbacks.onScore?.({ score: msg.score, lives: msg.lives });
        break;
      }
      case "save":
      case "cart:save":
        this.callbacks.onSave?.({ key: msg.key, value: msg.value });
        break;
      case "gameover":
      case "cart:gameover":
        if (performance.now() - this.lastFxAt > 30) {
          this.lastFxAt = performance.now();
          this.callbacks.onFx?.({
            kind: msg.reason === "win" ? "win" : "gameover",
            intensity: 0.85,
          });
        }
        this.callbacks.onGameOver?.({ score: msg.score, best: msg.best, reason: msg.reason });
        break;
      case "error": {
        if (msg.loadId && this.activeLoadId && msg.loadId !== this.activeLoadId) {
          break;
        }
        if (this.readyReject) {
          this.readyReject(new Error(msg.message || "Cart load error"));
          this.readyResolve = null;
          this.readyReject = null;
        }
        this.callbacks.onError?.({ phase: msg.phase, message: msg.message, stack: msg.stack });
        break;
      }
    }
  }

  async load(
    source: string,
    card: GameDesignCard,
    opts: { seed?: number; save?: Record<string, number>; timeoutMs?: number } = {}
  ): Promise<{ title: string }> {
    this.activeLoadCleanup?.();
    this.activeLoadCleanup = null;
    if (this.readyResolve) {
      const prevResolve = this.readyResolve;
      this.readyResolve = null;
      this.readyReject = null;
      prevResolve({ title: card.title || "" });
    }
    this.paused = false;
    this.lastScore = 0;
    this.lastLives = 3;
    const loadId = ++this.loadSeq;
    this.activeLoadId = loadId;

    const scan = scanSource(source);
    if (!scan.ok) {
      const err = { phase: "load", message: scan.issues.join("; ") };
      this.callbacks.onError?.(err);
      throw new Error(err.message);
    }

    if (!this.iframe || !this.iframe.contentWindow) {
      await this.mountIframe();
    } else if (this.mountPromise) {
      await this.mountPromise;
    }
    if (this.activeLoadId !== loadId) {
      return { title: card.title || "" };
    }

    const timeoutMs = opts.timeoutMs ?? 4000;
    return new Promise((resolve, reject) => {
      const sendLoadMessage = () => {
        if (this.activeLoadId !== loadId) return;
        this.iframe?.contentWindow?.postMessage(
          {
            type: "load",
            loadId,
            source,
            card,
            seed: opts.seed ?? card.seed ?? 7,
            save: opts.save ?? {},
          },
          "*"
        );
      };

      const retryTimer = setInterval(sendLoadMessage, 120);

      const cleanup = () => {
        clearInterval(retryTimer);
        clearTimeout(timer);
        if (this.activeLoadCleanup === cleanup) {
          this.activeLoadCleanup = null;
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        if (this.activeLoadId === loadId) {
          this.readyResolve = null;
          this.readyReject = null;
        }
        const msg = `Cart did not send ready within ${timeoutMs}ms`;
        this.callbacks.onError?.({ phase: "load", message: msg });
        reject(new Error(msg));
      }, timeoutMs);

      this.activeLoadCleanup = cleanup;

      this.readyResolve = (info) => {
        cleanup();
        this.isPlaying = !this.paused;
        if (this.paused) {
          this.iframe?.contentWindow?.postMessage({ type: "pause" }, "*");
        }
        this.ticksSinceLastFrame = 0;
        this.firstTickWithoutFrameAt = 0;
        resolve(info);
      };
      this.readyReject = (err) => {
        cleanup();
        reject(err);
      };

      sendLoadMessage();
    });
  }

  tick(dtMs: number, input: CartInputState): void {
    if (!this.iframe?.contentWindow || !this.isPlaying) return;
    const now = performance.now();
    if (this.ticksSinceLastFrame === 0) {
      this.firstTickWithoutFrameAt = now;
    }
    this.ticksSinceLastFrame++;

    // Watchdog: if no frame arrives within 2s of active ticks, recreate the iframe
    if (
      this.ticksSinceLastFrame > 10 &&
      this.firstTickWithoutFrameAt > 0 &&
      now - this.firstTickWithoutFrameAt > 2000
    ) {
      this.isPlaying = false;
      this.mountIframe();
      this.callbacks.onError?.({
        phase: "update",
        message: "Cart watchdog timeout: no frame received within 2s",
      });
      return;
    }

    this.iframe.contentWindow.postMessage(
      {
        type: "tick",
        dt_ms: dtMs,
        input,
      },
      "*"
    );
  }

  pause(): void {
    this.isPlaying = false;
    this.paused = true;
    this.iframe?.contentWindow?.postMessage({ type: "pause" }, "*");
  }

  resume(): void {
    this.isPlaying = true;
    this.paused = false;
    this.ticksSinceLastFrame = 0;
    this.firstTickWithoutFrameAt = 0;
    this.iframe?.contentWindow?.postMessage({ type: "resume" }, "*");
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public togglePause(): boolean {
    if (this.paused) {
      this.resume();
    } else {
      this.pause();
    }
    return this.paused;
  }

  reset(): void {
    this.lastScore = 0;
    this.lastLives = 3;
    this.iframe?.contentWindow?.postMessage({ type: "reset" }, "*");
  }

  destroy(): void {
    this.activeLoadCleanup?.();
    this.activeLoadCleanup = null;
    this.isPlaying = false;
    this.paused = false;
    this.hostReadyResolve = null;
    this.readyResolve = null;
    this.readyReject = null;
    window.removeEventListener("message", this.messageListener);
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
  }
}
