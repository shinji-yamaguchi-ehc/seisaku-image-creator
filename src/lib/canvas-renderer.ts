import type { ImageSlot, Transform, LayoutConfig } from "./types";
import { computeGeom, getSlotDefs } from "./layout";
import { normalizeTransform } from "./transform";
import type { GradientCanvasConfig, GradientStyle } from "./gradient";
import { createSideGradient, normalizedFor } from "./gradient";

/**
 * レイアウトを ctx へ描画する唯一の実装。
 * ctx は「キャンバス座標（config.canvasWidth × config.canvasHeight）」で描くこと。
 * プレビュー / エクスポートともにこの関数を流用し WYSIWYG を保証する。
 */
export function drawLayout(
  ctx: CanvasRenderingContext2D,
  images: (ImageSlot | null)[],
  transforms: Transform[],
  config: LayoutConfig
): void {
  const dim = computeGeom(config);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, dim.W, dim.H);

  const slotDefs = getSlotDefs(config);
  images.forEach((img, i) => {
    if (!img) return;
    const slot = slotDefs[i];
    const raw = transforms[i];
    if (!slot || !raw) return;

    const t = normalizeTransform(raw, img.naturalWidth, img.naturalHeight, slot.width, slot.height);
    const w = img.naturalWidth * t.zoom;
    const h = img.naturalHeight * t.zoom;

    ctx.save();
    ctx.beginPath();
    ctx.rect(slot.x, slot.y, slot.width, slot.height);
    ctx.clip();
    ctx.drawImage(
      img.element,
      slot.x + slot.width / 2 - t.focusX * w,
      slot.y + slot.height / 2 - t.focusY * h,
      w,
      h
    );
    ctx.restore();
  });
}

/** エクスポート用: 実寸キャンバスを生成 */
export function renderCanvas(
  images: (ImageSlot | null)[],
  transforms: Transform[],
  config: LayoutConfig
): HTMLCanvasElement {
  const dim = computeGeom(config);
  const canvas = document.createElement("canvas");
  canvas.width = dim.W;
  canvas.height = dim.H;
  const ctx = canvas.getContext("2d")!;
  drawLayout(ctx, images, transforms, config);
  return canvas;
}

/** プレビュー用: 既存 canvas 要素に devicePixelRatio 対応で描画 */
export function renderPreview(
  canvas: HTMLCanvasElement,
  images: (ImageSlot | null)[],
  transforms: Transform[],
  config: LayoutConfig,
  cssWidth: number
): void {
  const g = computeGeom(config);
  const cssHeight = cssWidth * (g.H / g.W);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const backingW = Math.max(1, Math.round(cssWidth * dpr));
  const backingH = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== backingW) canvas.width = backingW;
  if (canvas.height !== backingH) canvas.height = backingH;

  const ctx = canvas.getContext("2d")!;
  const scale = backingW / config.canvasWidth;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawLayout(ctx, images, transforms, config);
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, "image/png");
}

/**
 * グラデーションページのレイアウトを ctx へ描画する唯一の実装。
 * 白背景 → 画像（キャンバス全体＝1フレームの正規化ロジック）→ 全面グラデーションオーバーレイ。
 * プレビュー / エクスポートともにこの関数を流用し WYSIWYG を保証する。
 */
export function drawGradientLayout(
  ctx: CanvasRenderingContext2D,
  img: ImageSlot | null,
  raw: Transform,
  config: GradientCanvasConfig,
  style: GradientStyle
): void {
  const { canvasWidth: W, canvasHeight: H } = config;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  if (img) {
    const t = normalizedFor(img, raw, W, H);
    const w = img.naturalWidth * t.zoom;
    const h = img.naturalHeight * t.zoom;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    ctx.drawImage(img.element, W / 2 - t.focusX * w, H / 2 - t.focusY * h, w, h);
    ctx.restore();
  }

  // オーバーレイは余白部分にもかかる（キャンバス全面・左右フェード）
  // both の場合は右フェードと左フェードを順に重ねて合成する
  const fillSide = (side: "left" | "right") => {
    ctx.fillStyle = createSideGradient(ctx, style, W, side);
    ctx.fillRect(0, 0, W, H);
  };
  if (style.side === "both") {
    fillSide("right");
    fillSide("left");
  } else {
    fillSide(style.side);
  }
}

/** グラデーションページ エクスポート用: 実寸キャンバスを生成 */
export function renderGradientCanvas(
  img: ImageSlot | null,
  transform: Transform,
  config: GradientCanvasConfig,
  style: GradientStyle
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = config.canvasWidth;
  canvas.height = config.canvasHeight;
  const ctx = canvas.getContext("2d")!;
  drawGradientLayout(ctx, img, transform, config, style);
  return canvas;
}

/** グラデーションページ プレビュー用: 既存 canvas 要素に devicePixelRatio 対応で描画 */
export function renderGradientPreview(
  canvas: HTMLCanvasElement,
  img: ImageSlot | null,
  transform: Transform,
  config: GradientCanvasConfig,
  style: GradientStyle
): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${config.canvasWidth}px`;
  canvas.style.height = `${config.canvasHeight}px`;
  const backingW = Math.max(1, Math.round(config.canvasWidth * dpr));
  const backingH = Math.max(1, Math.round(config.canvasHeight * dpr));
  if (canvas.width !== backingW) canvas.width = backingW;
  if (canvas.height !== backingH) canvas.height = backingH;

  const ctx = canvas.getContext("2d")!;
  const scale = backingW / config.canvasWidth;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawGradientLayout(ctx, img, transform, config, style);
}
