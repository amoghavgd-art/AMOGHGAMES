import type { GameDesignCard } from "../card/schema";
import { VIBES } from "../card/vibes";
import { C, ditherV, getHouseSkinForCard, ptext } from "../skin/houseSkins";

export interface ShareCardOptions {
  card: GameDesignCard;
  bestScore: number;
  stageCanvas?: HTMLCanvasElement | null;
}

export interface ShareCardResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  blob: Blob | null;
  sharedViaNative: boolean;
  downloaded: boolean;
}

/**
 * Renders a 1080x1350 PNG trading card with:
 * - Dusk pixel-art backdrop & glowing cabinet trim frame
 * - `playglow` wordmark (top-left) + `built with gemini` credit (top-right)
 * - 3D cabinet hero shot at 2x pixel scale (or composited marquee/attract/side preview if WebGL buffer is unavailable)
 * - Game title, player credit, genre/vibe tags, and BEST SCORE
 */
export async function renderTradingCardCanvas(
  opts: ShareCardOptions
): Promise<HTMLCanvasElement> {
  const { card, bestScore, stageCanvas } = opts;
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const vibeDef = VIBES[card.vibe] || VIBES.sunset;
  const pal = card.palette || vibeDef.palette;

  // 1. Background dithered dusk ramp (scaled 4x for crisp pixel blocks)
  const bgSmall = document.createElement("canvas");
  bgSmall.width = 270;
  bgSmall.height = 338;
  const bgCtx = bgSmall.getContext("2d")!;
  ditherV(bgCtx, 0, 0, 270, 338, [C.dplum, C.dnavy, pal.bg, C.dplum]);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bgSmall, 0, 0, W, H);

  // Outer card frame
  ctx.strokeStyle = vibeDef.trim;
  ctx.lineWidth = 6;
  ctx.strokeRect(36, 36, W - 72, H - 72);
  ctx.strokeStyle = "rgba(255, 241, 232, 0.16)";
  ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, W - 96, H - 96);

  // 2. Top chrome: playglow wordmark + built with gemini
  ctx.save();
  ctx.fillStyle = C.yellow;
  ctx.shadowColor = "rgba(255, 236, 39, 0.75)";
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(92, 96, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = C.cream;
  ctx.font = '800 32px "Bricolage Grotesque", system-ui, sans-serif';
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("playglow", 118, 97);

  ctx.fillStyle = "rgba(255, 241, 232, 0.56)";
  ctx.font = '500 22px "JetBrains Mono", monospace';
  ctx.textAlign = "right";
  ctx.fillText("built with gemini", W - 80, 97);

  // 3. Hero shot viewport (x: 76..1004, y: 146..966 -> 928x820)
  const vx = 76;
  const vy = 146;
  const vw = W - 152;
  const vh = 820;

  ctx.save();
  ctx.fillStyle = "#140A0C";
  ctx.fillRect(vx, vy, vw, vh);

  let drewStage = false;
  const glCanvas =
    stageCanvas ||
    (typeof document !== "undefined"
      ? (document.getElementById("gl") as HTMLCanvasElement | null)
      : null);

  if (glCanvas && glCanvas.width > 0 && glCanvas.height > 0) {
    try {
      // Sample into a half-res canvas first so it renders at crisp 2x pixel scale
      const halfW = Math.floor(vw / 2);
      const halfH = Math.floor(vh / 2);
      const snap = document.createElement("canvas");
      snap.width = halfW;
      snap.height = halfH;
      const sctx = snap.getContext("2d")!;
      sctx.imageSmoothingEnabled = false;

      const srcAspect = glCanvas.width / glCanvas.height;
      const dstAspect = halfW / halfH;
      let sx = 0;
      let sy = 0;
      let sw = glCanvas.width;
      let sh = glCanvas.height;
      if (srcAspect > dstAspect) {
        sw = Math.round(glCanvas.height * dstAspect);
        sx = Math.round((glCanvas.width - sw) / 2);
      } else {
        sh = Math.round(glCanvas.width / dstAspect);
        sy = Math.round((glCanvas.height - sh) / 2);
      }
      sctx.drawImage(glCanvas, sx, sy, sw, sh, 0, 0, halfW, halfH);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(snap, vx, vy, vw, vh);
      drewStage = true;
    } catch {
      drewStage = false;
    }
  }

  // Composite attract + marquee fallback only when the 3D stage screenshot wasn't available
  if (!drewStage) {
    const house = getHouseSkinForCard(card);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(house.attractCanvas, vx + 84, vy + 180, vw - 168, vh - 240);
    const mqW = vw - 120;
    const mqH = Math.round((mqW * 40) / 288);
    ctx.drawImage(house.marqueeCanvas, vx + 60, vy + 28, mqW, mqH);
  }

  ctx.strokeStyle = "rgba(255, 241, 232, 0.22)";
  ctx.lineWidth = 3;
  ctx.strokeRect(vx, vy, vw, vh);
  ctx.restore();

  // 4. Bottom metadata panel (y: 1000..1274)
  ctx.fillStyle = "rgba(22, 11, 13, 0.86)";
  ctx.fillRect(76, 996, vw, 276);
  ctx.strokeStyle = vibeDef.trim;
  ctx.lineWidth = 3;
  ctx.strokeRect(76, 996, vw, 276);

  // Title in Press Start 2P (pixel-crisp)
  const title = (card.title || "PLAYGLOW").toUpperCase();
  ptext(ctx, title.slice(0, 18), 116, 1036, {
    size: 32,
    align: "left",
    grad: [C.yellow, pal.accent1],
    outline: C.dbrown,
    shadow: pal.fg,
    shadowD: 4,
  });

  // Tagline & creator
  ctx.fillStyle = C.cream;
  ctx.font = '700 28px "Bricolage Grotesque", system-ui, sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(
    (card.tagline || "custom pixel-art arcade game").toLowerCase(),
    116,
    1104,
    620
  );

  const player = (card.player_name || "player 1").toLowerCase();
  ctx.fillStyle = "rgba(255, 241, 232, 0.64)";
  ctx.font = '500 22px "JetBrains Mono", monospace';
  ctx.fillText(
    `by ${player} · ${card.genre} · ${card.vibe} vibe`,
    116,
    1156
  );

  // Best score block on bottom-right
  const scoreStr = String(Math.max(0, Math.floor(bestScore || 0))).padStart(
    6,
    "0"
  );
  ctx.fillStyle = "rgba(255, 241, 232, 0.56)";
  ctx.font = '500 20px "JetBrains Mono", monospace';
  ctx.textAlign = "right";
  ctx.fillText("BEST SCORE", W - 116, 1126);

  ptext(ctx, scoreStr, W - 116, 1166, {
    size: 32,
    align: "right",
    color: C.yellow,
    outline: C.dbrown,
    shadow: pal.fg,
    shadowD: 3,
  });

  return canvas;
}

/**
 * Exports a 1080x1350 PNG trading card and shares it via `navigator.share`
 * (or triggers a PNG file download if `navigator.share` is unavailable).
 */
export async function shareTradingCard(
  opts: ShareCardOptions
): Promise<ShareCardResult> {
  const canvas = await renderTradingCardCanvas(opts);
  const dataUrl = canvas.toDataURL("image/png");
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png")
  );

  const slug =
    (opts.card.title || "playglow")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "playglow";
  const fileName = `${slug}-playglow.png`;

  if (
    blob &&
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    try {
      const file = new File([blob], fileName, { type: "image/png" });
      const shareData: ShareData = {
        title: opts.card.title,
        text: `${opts.card.title} on playglow — best score ${opts.bestScore}`,
        files: [file],
      };
      if (!navigator.canShare || navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return {
          canvas,
          dataUrl,
          blob,
          sharedViaNative: true,
          downloaded: false,
        };
      }
    } catch {
      // Fall back to download if share was rejected or unsupported
    }
  }

  // Trigger download fallback
  let downloaded = false;
  if (typeof document !== "undefined") {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 250);
    downloaded = true;
  }

  return {
    canvas,
    dataUrl,
    blob,
    sharedViaNative: false,
    downloaded,
  };
}
