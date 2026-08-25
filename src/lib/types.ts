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
 * レイアウト設定。
 * キャンバスの高さは row1Height + rowGap + row2Height から導出される（直接指定しない）。
 * すべての出力画像（キャンバス座標）基準の px。
 */
export interface LayoutConfig {
  canvasWidth: number;
  row1Height: number;
  row2Height: number;
  rowGap: number;
}

export interface AppState {
  images: [ImageSlot | null, ImageSlot | null, ImageSlot | null, ImageSlot | null];
  pcConfig: LayoutConfig;
  spConfig: LayoutConfig;
  pcTransforms: Transform[];
  spTransforms: Transform[];
}

