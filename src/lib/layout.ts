import type { LayoutConfig } from "./types";

export const CANVAS_MIN_WIDTH = 320;
export const CANVAS_MAX_WIDTH = 4096;

export const ROW_HEIGHT_MIN = 40;
export const ROW_HEIGHT_MAX = 4096;

export const ROW_GAP_MIN = 0;
export const ROW_GAP_MAX = 400;

/** 幾何情報（スロット矩形の計算に使う）。プレビューはキャンバスと 1:1 サイズで表示するため共用 */
export interface Geom {
  W: number;
  H: number;
  r1: number;
  r2: number;
  col: number;
  gap: number;
}

/** キャンバス幾何。W = canvasWidth、H = row1Height + rowGap + row2Height */
export function computeGeom(config: LayoutConfig): Geom {
  const W = config.canvasWidth;
  const r1 = config.row1Height;
  const gap = config.rowGap;
  const r2 = config.row2Height;
  return { W, H: r1 + gap + r2, r1, r2, col: W / 3, gap };
}

export interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 幾何情報の唯一の情報源。1行目が横いっぱい、2行目は3均等分割、行間に gap の余白 */
export function rectsFromGeom(g: Geom): SlotRect[] {
  return [
    { x: 0, y: 0, width: g.W, height: g.r1 },
    { x: 0, y: g.r1 + g.gap, width: g.col, height: g.r2 },
    { x: g.col, y: g.r1 + g.gap, width: g.col, height: g.r2 },
    { x: g.col * 2, y: g.r1 + g.gap, width: g.col, height: g.r2 },
  ];
}

export function getSlotDefs(config: LayoutConfig): SlotRect[] {
  return rectsFromGeom(computeGeom(config));
}

const toInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(typeof v === "number" ? v : Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** LayoutConfig を範囲内に収める（NaN 等は現在値を維持） */
export function normalizeLayoutConfig(
  prev: LayoutConfig,
  partial: Partial<LayoutConfig>
): LayoutConfig {
  const merged = { ...prev, ...partial };
  return {
    canvasWidth: toInt(merged.canvasWidth, CANVAS_MIN_WIDTH, CANVAS_MAX_WIDTH, prev.canvasWidth),
    row1Height: toInt(merged.row1Height, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX, prev.row1Height),
    row2Height: toInt(merged.row2Height, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX, prev.row2Height),
    rowGap: toInt(merged.rowGap, ROW_GAP_MIN, ROW_GAP_MAX, prev.rowGap),
  };
}
