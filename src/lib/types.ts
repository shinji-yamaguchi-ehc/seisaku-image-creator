export interface ImageSlot {
  file: File;
  objectUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  element: HTMLImageElement;
}

/**
 * 画像の切り取り状態（正規化座標モデル）
 * - zoom: 元画像に対する等倍率。1.0 = 元サイズ（上限・拡大禁止）。下限は ZOOM_MIN（縮小は自由、余白可）
 * - focusX / focusY: 元画像のどの点（0..1）をフレーム中心に置くか
 */
export interface Transform {
  zoom: number;
  focusX: number;
  focusY: number;
}

/**
 * レイアウト設定（デザインパターンの枠構成ベース）。
 * - canvasWidth / canvasHeight: キャンバス（出力）サイズ px
 * - frames: 各枠の矩形（0..1 正規化座標 [x0, y0, x1, y1]）。キャンバスを隙間なく埋める。
 *   幅・高さを変更すると各枠は比率を保って追従する。
 * - curve: 縦方向の円弧境界（C-1）。省略時は直線分割。
 */
export interface LayoutConfig {
  canvasWidth: number;
  canvasHeight: number;
  frames: [number, number, number, number][];
  curve?: { x: number; bulge: number };
}

export interface AppState {
  images: [ImageSlot | null, ImageSlot | null, ImageSlot | null, ImageSlot | null];
  pcConfig: LayoutConfig;
  spConfig: LayoutConfig;
  pcTransforms: Transform[];
  spTransforms: Transform[];
}

