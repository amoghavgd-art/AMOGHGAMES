/**
 * Web Audio API 60 Hz CRT transformer hum, tactile wizard chimes,
 * and procedural retro arcade SFX synthesizer.
 *
 * Persists mute state in `localStorage.getItem('playglow:mute')` and
 * ramps gain smoothly over 80 ms on mute/unmute.
 */

const MUTE_STORAGE_KEY = "playglow:mute";
const HUM_GAIN_LINEAR = 0.0251188643150958; // -32 dBFS (10^(-32/20))
const RAMP_SECONDS = 0.08;

export type ChimeKind =
  | "step"
  | "ready"
  | "coin"
  | "click"
  | "select"
  | "stage"
  | "poweron"
  | "poweroff";

export class HumController {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private humGain: GainNode | null = null;
  private osc60: OscillatorNode | null = null;
  private osc120: OscillatorNode | null = null;
  private started = false;
  private _muted = false;
  private unlockHandler: (() => void) | null = null;
  private lastSfxAt: Map<string, number> = new Map();

  constructor() {
    this._muted = this.readStoredMute();
    if (typeof window !== "undefined") {
      this.unlockHandler = () => {
        this.ensureStarted();
      };
      window.addEventListener("pointerdown", this.unlockHandler, {
        once: true,
        passive: true,
      });
      window.addEventListener("keydown", this.unlockHandler, {
        once: true,
        passive: true,
      });
    }
  }

  private readStoredMute(): boolean {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const val = window.localStorage.getItem(MUTE_STORAGE_KEY);
        return val === "1" || val === "true";
      }
    } catch {
      // Ignore storage errors in sandboxed/incognito contexts
    }
    return false;
  }

  private writeStoredMute(muted: boolean): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
      }
    } catch {
      // Ignore storage errors
    }
  }

  public isMuted(): boolean {
    return this._muted;
  }

  /**
   * Initializes or resumes the AudioContext and starts the 60 Hz + 120 Hz
   * low-pass filtered CRT hum oscillators.
   */
  public ensureStarted(): void {
    if (typeof window === "undefined") return;

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
    }

    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }

    if (this.started || !this.ctx) return;
    this.started = true;

    const now = this.ctx.currentTime;

    // Master output gain for mute/unmute ramping
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this._muted ? 0 : 1, now);
    this.masterGain.connect(this.ctx.destination);

    // Low-pass filter at 280 Hz for warm transformer cabinet resonance
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(280, now);
    lowpass.Q.setValueAtTime(0.85, now);

    // Hum gain (-32 dBFS = ~0.0251)
    this.humGain = this.ctx.createGain();
    this.humGain.gain.setValueAtTime(HUM_GAIN_LINEAR, now);

    // 60 Hz fundamental sine
    this.osc60 = this.ctx.createOscillator();
    this.osc60.type = "sine";
    this.osc60.frequency.setValueAtTime(60, now);
    const gain60 = this.ctx.createGain();
    gain60.gain.setValueAtTime(1.0, now);

    // 120 Hz second harmonic at 0.3x amplitude
    this.osc120 = this.ctx.createOscillator();
    this.osc120.type = "sine";
    this.osc120.frequency.setValueAtTime(120, now);
    const gain120 = this.ctx.createGain();
    gain120.gain.setValueAtTime(0.3, now);

    this.osc60.connect(gain60);
    this.osc120.connect(gain120);
    gain60.connect(lowpass);
    gain120.connect(lowpass);
    lowpass.connect(this.humGain);
    this.humGain.connect(this.masterGain);

    this.osc60.start(now);
    this.osc120.start(now);
  }

  public setMuted(muted: boolean): void {
    this._muted = muted;
    this.writeStoredMute(muted);
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(
      muted ? 0 : 1,
      now + RAMP_SECONDS,
    );
  }

  public toggleMute(): boolean {
    this.ensureStarted();
    this.setMuted(!this._muted);
    return this._muted;
  }

  /**
   * Plays tactile UI/cabinet synth chimes when not muted.
   */
  public playChime(kind: ChimeKind): void {
    if (this._muted) return;
    this.ensureStarted();
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;

    if (kind === "step" || kind === "select") {
      // Crisp two-tone arcade step arpeggio
      this.triggerTone(523.25, "triangle", now, 0.07, 0.08, 659.25);
      this.triggerTone(783.99, "sine", now + 0.055, 0.11, 0.06);
    } else if (kind === "ready") {
      // Triumphant 4-note cabinet ready fanfare (C5 - E5 - G5 - C6)
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        this.triggerTone(
          freq,
          idx === 3 ? "triangle" : "square",
          now + idx * 0.065,
          idx === 3 ? 0.28 : 0.09,
          idx === 3 ? 0.09 : 0.05,
        );
      });
    } else if (kind === "coin") {
      // Classic arcade coin mech B5 -> E6 ring
      this.triggerTone(987.77, "square", now, 0.075, 0.07);
      this.triggerTone(1318.51, "square", now + 0.075, 0.28, 0.08);
    } else if (kind === "stage") {
      // Subtle stage milestone completion pulse
      this.triggerTone(440, "sine", now, 0.08, 0.05, 587.33);
    } else if (kind === "click") {
      // Micro-switch button click
      this.triggerTone(260, "triangle", now, 0.035, 0.06, 140);
    } else if (kind === "poweron") {
      this.triggerTone(110, "sine", now, 0.22, 0.07, 440);
    } else if (kind === "poweroff") {
      this.triggerTone(440, "sine", now, 0.22, 0.07, 90);
    }
  }

  /**
   * Plays a retro cartridge sound effect (`sfx(name, note)` from the engine API).
   */
  public playSfx(name: string, note = 0): void {
    if (this._muted) return;
    this.ensureStarted();
    if (!this.ctx || !this.masterGain) return;

    const key = String(name || "tick").trim().toLowerCase();
    const nowMs =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const prevMs = this.lastSfxAt.get(key) ?? -Infinity;
    if (nowMs - prevMs < 25) return;
    this.lastSfxAt.set(key, nowMs);

    const now = this.ctx.currentTime;
    const pitchMult = Math.pow(
      2,
      Math.max(-24, Math.min(24, Number(note) || 0)) / 12,
    );

    switch (key) {
      case "jump":
      case "hop":
      case "flap":
        this.triggerTone(
          220 * pitchMult,
          "square",
          now,
          0.14,
          0.06,
          540 * pitchMult,
        );
        break;
      case "coin":
        this.triggerTone(987.77 * pitchMult, "square", now, 0.06, 0.06);
        this.triggerTone(
          1318.51 * pitchMult,
          "square",
          now + 0.06,
          0.2,
          0.07,
        );
        break;
      case "pickup":
      case "gem":
      case "star":
      case "collect":
      case "eat":
      case "chomp":
        this.triggerTone(740 * pitchMult, "triangle", now, 0.055, 0.065);
        this.triggerTone(
          1108.73 * pitchMult,
          "square",
          now + 0.045,
          0.14,
          0.065,
          1480 * pitchMult,
        );
        break;
      case "laser":
      case "shoot":
      case "fire":
      case "pew":
        this.triggerTone(
          780 * pitchMult,
          "sawtooth",
          now,
          0.11,
          0.055,
          180 * pitchMult,
        );
        break;
      case "bounce":
      case "paddle":
      case "wall":
        this.triggerTone(
          260 * pitchMult,
          "triangle",
          now,
          0.065,
          0.065,
          420 * pitchMult,
        );
        break;
      case "step":
      case "walk":
      case "land":
        this.triggerTone(
          150 * pitchMult,
          "triangle",
          now,
          0.045,
          0.05,
          70 * pitchMult,
        );
        break;
      case "dash":
      case "whoosh":
      case "dodge":
      case "boost":
        this.triggerNoiseBurst(now, 0.085, 0.055);
        this.triggerTone(
          320 * pitchMult,
          "triangle",
          now,
          0.09,
          0.055,
          680 * pitchMult,
        );
        break;
      case "hit":
        this.triggerTone(
          190 * pitchMult,
          "sawtooth",
          now,
          0.09,
          0.07,
          75 * pitchMult,
        );
        break;
      case "hurt":
      case "damage":
      case "die":
      case "death":
      case "gameover":
        this.triggerNoiseBurst(now, 0.12, 0.06);
        this.triggerTone(
          240 * pitchMult,
          "sawtooth",
          now,
          0.11,
          0.07,
          110 * pitchMult,
        );
        this.triggerTone(
          140 * pitchMult,
          "sawtooth",
          now + 0.08,
          0.18,
          0.065,
          55 * pitchMult,
        );
        break;
      case "boom":
      case "explode":
      case "explosion":
        this.triggerNoiseBurst(now, 0.24, 0.08);
        this.triggerTone(
          120 * pitchMult,
          "sawtooth",
          now,
          0.22,
          0.06,
          42 * pitchMult,
        );
        break;
      case "powerup": {
        const arp = [330, 440, 554.37, 659.25];
        arp.forEach((f, i) => {
          this.triggerTone(
            f * pitchMult,
            "triangle",
            now + i * 0.045,
            0.08,
            0.06,
          );
        });
        break;
      }
      case "shield":
      case "heal":
      case "1up":
      case "combo":
      case "bonus": {
        const chord = [587.33, 740, 880, 1174.66];
        chord.forEach((f, i) => {
          this.triggerTone(
            f * pitchMult,
            i === 3 ? "square" : "triangle",
            now + i * 0.04,
            0.09,
            0.06,
          );
        });
        break;
      }
      case "start":
      case "ready":
      case "go":
      case "wave":
      case "levelup":
      case "clear": {
        const notes = [440, 554.37, 659.25, 880];
        notes.forEach((f, i) => {
          this.triggerTone(
            f * pitchMult,
            "square",
            now + i * 0.05,
            i === 3 ? 0.16 : 0.07,
            0.06,
          );
        });
        break;
      }
      case "boss":
      case "warning":
      case "alarm":
      case "siren":
        this.triggerTone(
          165 * pitchMult,
          "sawtooth",
          now,
          0.13,
          0.065,
          240 * pitchMult,
        );
        this.triggerTone(
          240 * pitchMult,
          "sawtooth",
          now + 0.13,
          0.17,
          0.065,
          130 * pitchMult,
        );
        break;
      case "win": {
        const fanfare = [523.25, 659.25, 783.99, 1046.5];
        fanfare.forEach((f, i) => {
          this.triggerTone(
            f * pitchMult,
            "square",
            now + i * 0.06,
            0.14,
            0.06,
          );
        });
        break;
      }
      case "lose": {
        const sad = [392.0, 369.99, 349.23, 311.13];
        sad.forEach((f, i) => {
          this.triggerTone(
            f * pitchMult,
            "sawtooth",
            now + i * 0.09,
            0.14,
            0.055,
          );
        });
        break;
      }
      case "select":
        this.triggerTone(
          523.25 * pitchMult,
          "square",
          now,
          0.06,
          0.055,
          659.25 * pitchMult,
        );
        break;
      case "tick":
        this.triggerTone(440 * pitchMult, "triangle", now, 0.035, 0.045);
        break;
      default: {
        let h = 2166136261;
        for (let i = 0; i < key.length; i++) {
          h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
        }
        const waves: OscillatorType[] = [
          "square",
          "triangle",
          "sawtooth",
          "sine",
        ];
        const wave = waves[h % waves.length];
        const baseFreq = (180 + (h % 520)) * pitchMult;
        const sweepRatio = (h >>> 8) % 2 === 0 ? 1.45 : 0.62;
        const dur = 0.06 + ((h >>> 12) % 8) * 0.012;
        this.triggerTone(
          baseFreq,
          wave,
          now,
          dur,
          0.055,
          baseFreq * sweepRatio,
        );
        break;
      }
    }
  }

  private triggerTone(
    freqStart: number,
    type: OscillatorType,
    startTime: number,
    duration: number,
    peakGain: number,
    freqEnd?: number,
  ): void {
    if (!this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freqStart), startTime);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, freqEnd),
        startTime + duration,
      );
    }

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };

    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  private triggerNoiseBurst(
    startTime: number,
    duration: number,
    peakGain: number,
  ): void {
    if (!this.ctx || !this.masterGain) return;

    const sampleRate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(420, startTime);
    filter.Q.setValueAtTime(0.9, startTime);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.onended = () => {
      try {
        src.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };

    src.start(startTime);
    src.stop(startTime + duration + 0.01);
  }

  public destroy(): void {
    if (typeof window !== "undefined" && this.unlockHandler) {
      window.removeEventListener("pointerdown", this.unlockHandler);
      window.removeEventListener("keydown", this.unlockHandler);
      this.unlockHandler = null;
    }
    try {
      this.osc60?.stop();
      this.osc120?.stop();
    } catch {
      // Ignore if already stopped
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.started = false;
  }
}

export const humController = new HumController();
export default HumController;
