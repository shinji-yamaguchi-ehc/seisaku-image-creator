import type { ImageSlot, Transform } from "./types";
import { normalizeTransform, type DisplayRect } from "./transform";

/** グラデーションページのキャンバス設定 */
export interface GradientCanvasConfig {
  canvasWidth: number;
  canvasHeight: number;
}

export const GRADIENT_MIN_WIDTH = 320;
export const GRADIENT_MAX_WIDTH = 4096;
export const GRADIENT_MIN_HEIGHT = 40;
export const GRADIENT_MAX_HEIGHT = 4096;

/**
 * グラデーションのスタイル設定（左右フェード）。
 * - side: フェードの向き。left/right は片側、both は両側から内側へフェード
 * - startPos / endPos: 各ストップの「枠端（side 側）からの距離」%。
 *   UI 上の開始位置・終了位置は向きに依存せず共有され、描画時に side へ割り当て（反転）される
 */
export interface GradientStyle {
  side: "left" | "right" | "both";
  startPos: number;
  endPos: number;
  color: string;
  /** 開始ストップの不透明度 0–100（%）＝枠端側 */
  startAlpha: number;
  /** 終了ストップの不透明度 0–100（%）＝内側側 */
  endAlpha: number;
}

export function defaultPositionsFor(side: "left" | "right" | "both"): { startPos: number; endPos: number } {
  return side === "both" ? { startPos: 0, endPos: 70 } : { startPos: 0, endPos: 60 };
}

/** 既定スタイル: 右端 → 内側50% にかけて 白100% → 透明 */
export const DEFAULT_GRADIENT_STYLE: GradientStyle = {
  side: "right",
  ...defaultPositionsFor("right"),
  color: "#ffffff",
  startAlpha: 100,
  endAlpha: 0,
};

const toInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(typeof v === "number" ? v : Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** グラデーションページのキャンバス設定を範囲内に収める（NaN 等は現在値を維持） */
export function normalizeGradientConfig(
  prev: GradientCanvasConfig,
  partial: Partial<GradientCanvasConfig>
): GradientCanvasConfig {
  const merged = { ...prev, ...partial };
  return {
    canvasWidth: toInt(merged.canvasWidth, GRADIENT_MIN_WIDTH, GRADIENT_MAX_WIDTH, prev.canvasWidth),
    canvasHeight: toInt(merged.canvasHeight, GRADIENT_MIN_HEIGHT, GRADIENT_MAX_HEIGHT, prev.canvasHeight),
  };
}

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

/** スタイル値を範囲内に収める（不正な色は現在値を維持） */
export function normalizeGradientStyle(prev: GradientStyle, partial: Partial<GradientStyle>): GradientStyle {
  const merged = { ...prev, ...partial };
  return {
    side:
      merged.side === "left" || merged.side === "right" || merged.side === "both"
        ? merged.side
        : prev.side,
    startPos: toInt(merged.startPos, 0, 100, prev.startPos),
    endPos: toInt(merged.endPos, 0, 100, prev.endPos),
    color: typeof merged.color === "string" && HEX_RE.test(merged.color) ? merged.color : prev.color,
    startAlpha: toInt(merged.startAlpha, 0, 100, prev.startAlpha),
    endAlpha: toInt(merged.endAlpha, 0, 100, prev.endAlpha),
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** #rrggbb + 不透明度(%) → rgba() 文字列 */
export function rgbaFrom(hex: string, alphaPct: number): string {
  const [r, g, b] = hexToRgb(hex);
  const a = Math.min(1, Math.max(0, alphaPct / 100));
  return `rgba(${r},${g},${b},${a})`;
}

interface SidePaint {
  x1: number;
  x2: number;
  c1: string;
  c2: string;
}

/** side 側の枠端から内側へ向かうグラデ区間を計算する（pos は枠端からの距離 %） */
function sidePaint(style: GradientStyle, W: number, side: "left" | "right"): SidePaint {
  const d1 = (W * style.startPos) / 100;
  const d2 = (W * style.endPos) / 100;
  const x1 = side === "right" ? W - d1 : d1;
  const x2 = side === "right" ? W - d2 : d2;
  return { x1, x2, c1: rgbaFrom(style.color, style.startAlpha), c2: rgbaFrom(style.color, style.endAlpha) };
}

/**
 * 指定 side のフェード塗り。開始・終了ストップを side へ割り当てて返す
 * （side 切替はストップの割り当て反転のみで、位置・色・不透明度は共有される）
 */
export function createSideGradient(
  ctx: CanvasRenderingContext2D,
  style: GradientStyle,
  W: number,
  side: "left" | "right"
): string | CanvasGradient {
  const p = sidePaint(style, W, side);
  if (Math.abs(p.x2 - p.x1) < 0.5) {
    // 開始・終了が同一位置の場合は開始ストップで塗る（退化防止）
    return p.c1;
  }
  const grad = ctx.createLinearGradient(p.x1, 0, p.x2, 0);
  grad.addColorStop(0, p.c1);
  grad.addColorStop(1, p.c2);
  return grad;
}

/** 単一フレーム（キャンバス全体＝1スロット）としての表示矩形 */
export function gradientDisplayRectOf(
  t: Transform,
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number
): DisplayRect & { zoom: number } {
  const n = normalizeTransform(t, imgW, imgH, frameW, frameH);
  const width = imgW * n.zoom;
  const height = imgH * n.zoom;
  return {
    left: frameW / 2 - n.focusX * width,
    top: frameH / 2 - n.focusY * height,
    width,
    height,
    zoom: n.zoom,
  };
}

/** 描画時の正規化済み transform へのアクセサ（GradientCanvas でも使用） */
export function normalizedFor(img: ImageSlot, t: Transform, frameW: number, frameH: number) {
  return normalizeTransform(t, img.naturalWidth, img.naturalHeight, frameW, frameH);
}
