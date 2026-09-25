import type { LayoutConfig } from "./types";

export const CANVAS_MIN_WIDTH = 320;
export const CANVAS_MAX_WIDTH = 4096;

export const CANVAS_MIN_HEIGHT = 40;
export const CANVAS_MAX_HEIGHT = 4096;

/** 出力モード */
export type CanvasMode = "pc" | "sp";

/** トップ画像のデザインパターン */
export type PatternId = "A-1" | "B-1" | "B-2" | "C-1" | "C-2" | "D-1" | "D-2";

export interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 円弧の境界線（縦方向に伸びる）。C-1 の「大画像と左サブ画像の境界」で使用。
 * x は境界の基準位置（正規化・キャンバス幅比）、bulge は左方向への膨らみ（同）。
 */
export interface CurveSpec {
  x: number;
  bulge: number;
}

export interface GeomDef {
  /** このモードでのキャンバス初期サイズ */
  width: number;
  height: number;
  /** 各枠の矩形（0..1 正規化座標 [x0, y0, x1, y1]）。並びは見本の ①②③… の順 */
  frames: [number, number, number, number][];
  /** 省略時は直線分割。指定時は縦方向の円弧境界を持つ */
  curve?: CurveSpec;
}

export interface PatternPreset {
  id: PatternId;
  /** 簡潔な説明（UI チップ表示用） */
  desc: string;
  /** 最大枠数 */
  frameCount: number;
  pc: GeomDef;
  /** SP 版の枠構成。B-2/D-2 は存在しないため別パターン（B-1/D-1）を流用する */
  sp: GeomDef | null;
}

/**
 * デザインパターンの枠構成定義。
 * 数値は依頼元の Photoshop フォーマット（PC 960×600 / SP 640×380・640×540）の実測値から設定。
 */
export const PATTERNS: PatternPreset[] = [
  {
    id: "A-1",
    desc: "全面1枚",
    frameCount: 1,
    pc: { width: 960, height: 600, frames: [[0, 0, 1, 1]] },
    sp: { width: 640, height: 380, frames: [[0, 0, 1, 1]] },
  },
  {
    id: "B-1",
    desc: "縦2分割",
    frameCount: 2,
    pc: {
      width: 960,
      height: 600,
      frames: [
        [0, 0, 0.5, 1],
        [0.5, 0, 1, 1],
      ],
    },
    sp: {
      width: 640,
      height: 380,
      frames: [
        [0, 0, 0.5, 1],
        [0.5, 0, 1, 1],
      ],
    },
  },
  {
    id: "B-2",
    desc: "縦2分割（大＋小）",
    frameCount: 2,
    pc: {
      width: 960,
      height: 600,
      frames: [
        [0, 0, 2 / 3, 1],
        [2 / 3, 0, 1, 1],
      ],
    },
    sp: null, // SP 版は存在しない → B-1 を流用
  },
  {
    id: "C-1",
    desc: "大＋縦2分割（曲線）",
    frameCount: 3,
    // 見本どおり「右に大きいメイン画像／左に上下2枚」で、境界は大きな円弧（左へ膨らむ）
    pc: {
      width: 960,
      height: 600,
      curve: { x: 1 / 3, bulge: 0.07 },
      // ① 左上 320×300 ／ ② 右 大 640×600 ／ ③ 左下 320×300
      frames: [
        [0, 0, 1 / 3, 0.5],
        [1 / 3, 0, 1, 1],
        [0, 0.5, 1 / 3, 1],
      ],
    },
    sp: {
      width: 640,
      height: 380,
      curve: { x: 214 / 640, bulge: 0.07 },
      // ① 左上 214×190 ／ ② 右 大 426×380 ／ ③ 左下 214×190
      frames: [
        [0, 0, 214 / 640, 0.5],
        [214 / 640, 0, 1, 1],
        [0, 0.5, 214 / 640, 1],
      ],
    },
  },
  {
    id: "C-2",
    desc: "縦3分割",
    frameCount: 3,
    pc: {
      width: 960,
      height: 600,
      frames: [
        [0, 0, 1 / 3, 1],
        [1 / 3, 0, 2 / 3, 1],
        [2 / 3, 0, 1, 1],
      ],
    },
    sp: {
      width: 640,
      height: 380,
      // ① 213・② 214・③ 213（端数は中央に寄せる）
      frames: [
        [0, 0, 213 / 640, 1],
        [213 / 640, 0, 427 / 640, 1],
        [427 / 640, 0, 1, 1],
      ],
    },
  },
  {
    id: "D-1",
    desc: "大1枚＋下3分割",
    frameCount: 4,
    pc: {
      width: 960,
      height: 600,
      frames: [
        [0, 0, 1, 2 / 3],
        [0, 2 / 3, 1 / 3, 1],
        [1 / 3, 2 / 3, 2 / 3, 1],
        [2 / 3, 2 / 3, 1, 1],
      ],
    },
    sp: {
      width: 640,
      height: 540,
      frames: [
        [0, 0, 1, 380 / 540],
        [0, 380 / 540, 213 / 640, 1],
        [213 / 640, 380 / 540, 427 / 640, 1],
        [427 / 640, 380 / 540, 1, 1],
      ],
    },
  },
  {
    id: "D-2",
    desc: "大＋右縦3分割",
    frameCount: 4,
    pc: {
      width: 960,
      height: 600,
      frames: [
        [0, 0, 2 / 3, 1],
        [2 / 3, 0, 1, 1 / 3],
        [2 / 3, 1 / 3, 1, 2 / 3],
        [2 / 3, 2 / 3, 1, 1],
      ],
    },
    sp: null, // SP 版は存在しない → D-1 を流用
  },
];

export function getPatterns(): PatternPreset[] {
  return PATTERNS;
}

export function getPattern(id: PatternId): PatternPreset {
  const p = PATTERNS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown pattern: ${id}`);
  return p;
}

/** PC のデザイン → SP のデザイン（B-2→B-1 / D-2→D-1、それ以外は同 ID） */
export function spPatternOf(id: PatternId): PatternId {
  return id === "B-2" ? "B-1" : id === "D-2" ? "D-1" : id;
}

/** mode に応じたパターン ID（SP では B-2/D-2 をそれぞれ B-1/D-1 に読み替える） */
export function effectivePattern(id: PatternId, mode: CanvasMode): PatternId {
  return mode === "sp" ? spPatternOf(id) : id;
}

export interface PatternSize {
  width: number;
  height: number;
}

/** 選択パターンから該当モードの GeomDef を取得（B-2/D-2 の SP は流用先パターン） */
export function geomDefFor(id: PatternId, mode: CanvasMode): GeomDef {
  const eff = effectivePattern(id, mode);
  const def = mode === "pc" ? getPattern(eff).pc : getPattern(eff).sp;
  if (!def) throw new Error(`no SP geometry for ${id}`);
  return def;
}

/** パターン選択時の初期 LayoutConfig を生成 */
export function presetConfig(id: PatternId, mode: CanvasMode): LayoutConfig {
  const def = geomDefFor(id, mode);
  return { canvasWidth: def.width, canvasHeight: def.height, frames: def.frames, curve: def.curve };
}

const uniq = (arr: number[]): number[] => [...new Set(arr)].sort((a, b) => a - b);

/**
 * LayoutConfig の正規化枠矩形（整数 px）を計算する。
 * 隣接する枠が重なり・隙間なく埋まるよう、全枠に共通の境界座標を丸めてから差分を取る。
 */
export function frameRects(config: LayoutConfig): SlotRect[] {
  const bxs = uniq(config.frames.flatMap((f) => [f[0], f[2]]));
  const bys = uniq(config.frames.flatMap((f) => [f[1], f[3]]));
  const px = new Map(bxs.map((b) => [b, Math.round(b * config.canvasWidth)]) as [number, number][]);
  const py = new Map(bys.map((b) => [b, Math.round(b * config.canvasHeight)]) as [number, number][]);
  return config.frames.map(([x0, y0, x1, y1]) => ({
    x: px.get(x0)!,
    y: py.get(y0)!,
    width: px.get(x1)! - px.get(x0)!,
    height: py.get(y1)! - py.get(y0)!,
  }));
}

const toInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(typeof v === "number" ? v : Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** LayoutConfig を範囲内に収める（NaN 等は現在値を維持。frames / curve は不変） */
export function normalizeLayoutConfig(
  prev: LayoutConfig,
  partial: Partial<Pick<LayoutConfig, "canvasWidth" | "canvasHeight">>
): LayoutConfig {
  return {
    canvasWidth: toInt(partial.canvasWidth ?? prev.canvasWidth, CANVAS_MIN_WIDTH, CANVAS_MAX_WIDTH, prev.canvasWidth),
    canvasHeight: toInt(
      partial.canvasHeight ?? prev.canvasHeight,
      CANVAS_MIN_HEIGHT,
      CANVAS_MAX_HEIGHT,
      prev.canvasHeight
    ),
    frames: prev.frames,
    curve: prev.curve,
  };
}

/**
 * 円弧境界の各ピクセル座標を返す（境界線上の点を t=0..1 でサンプリング）。
 * 二次ベジェ（始点 (xd,0) → 制御 (xd-2s, H/2) → 終点 (xd,H)）で、中央が左へ s 膨らむ。
 */
export function curvePoint(config: LayoutConfig, t: number): { x: number; y: number } | null {
  const c = config.curve;
  if (!c) return null;
  const W = config.canvasWidth;
  const H = config.canvasHeight;
  const xd = c.x * W;
  const ctrl = xd - 2 * c.bulge * W;
  const y = t * H;
  const x = (1 - t) * (1 - t) * xd + 2 * (1 - t) * t * ctrl + t * t * xd;
  return { x, y };
}

/** 円弧境界を Canvas のクリップ用パスとして返す（side 側の領域） */
export function curveClipPath(config: LayoutConfig, side: "left" | "right"): Path2D | null {
  const c = config.curve;
  if (!c) return null;
  const W = config.canvasWidth;
  const H = config.canvasHeight;
  const xd = c.x * W;
  const ctrl = xd - 2 * c.bulge * W;
  const p = new Path2D();
  if (side === "right") {
    p.moveTo(xd, 0);
    p.quadraticCurveTo(ctrl, H / 2, xd, H);
    p.lineTo(W, H);
    p.lineTo(W, 0);
    p.closePath();
  } else {
    p.moveTo(xd, 0);
    p.lineTo(0, 0);
    p.lineTo(0, H);
    p.lineTo(xd, H);
    p.quadraticCurveTo(ctrl, H / 2, xd, 0);
    p.closePath();
  }
  return p;
}

/** 円弧境界の SVG path 文字列（プレビューのガイド表示用） */
export function curveGuideD(config: LayoutConfig): string | null {
  const c = config.curve;
  if (!c) return null;
  const W = config.canvasWidth;
  const H = config.canvasHeight;
  const xd = c.x * W;
  const ctrl = xd - 2 * c.bulge * W;
  return `M ${xd} 0 Q ${ctrl} ${H / 2} ${xd} ${H}`;
}
