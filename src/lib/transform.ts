import type { Transform } from "./types";

/** 既定状態: 100%・中央寄せ */
export const DEFAULT_TRANSFORM: Transform = { zoom: 1, focusX: 0.5, focusY: 0.5 };

/** ホイール1ノッチ / キーボード1段あたりのズーム倍率 */
export const ZOOM_STEP = 1.05;

/**
 * ズームの下限（縮小は自由。これより小さくすると画像がほぼ見えなくなるためのみ制限）。
 * 拡大は 1.0 = 元サイズが上限。
 */
export const ZOOM_MIN = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * cover フィットのズーム率（フレームにちょうど収まる最大倍率）。
 * 「フィット」操作や警告判定に使用する。ズーム下限とは別（下限は ZOOM_MIN）。
 */
export function coverZoom(imgW: number, imgH: number, frameW: number, frameH: number): number {
  return Math.min(Math.max(frameW / imgW, frameH / imgH), 1);
}

function axisFocus(focus: number, displaySize: number, frameSize: number): number {
  const f = Number.isFinite(focus) ? focus : 0.5;
  if (displaySize >= frameSize) {
    // 表示がフレーム以上（トリミング）: 画像がフレームからはみ出す範囲で自由に移動できる
    const half = frameSize / (2 * displaySize);
    return clamp(f, half, 1 - half);
  }
  // 縮小時（余白可）: 画像の一部がフレーム内に見えている限り、
  // 意図的にはみ出させて配置することも許可する（トリミング的に不要な端を隠せる）
  const margin = frameSize / (2 * displaySize);
  return clamp(f, 0.5 - margin, 0.5 + margin);
}

/** zoom を [ZOOM_MIN, 1] に、focus を移動可能範囲に収めた正規化済み Transform を返す */
export function normalizeTransform(
  t: Transform,
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number
): Transform {
  const zoom = clamp(Number.isFinite(t.zoom) ? t.zoom : 1, ZOOM_MIN, 1);
  return {
    zoom,
    focusX: axisFocus(t.focusX, imgW * zoom, frameW),
    focusY: axisFocus(t.focusY, imgH * zoom, frameH),
  };
}

export interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** フレーム左上原点での画像表示矩形 */
export function displayRectOf(
  t: Transform,
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number
): DisplayRect {
  const n = normalizeTransform(t, imgW, imgH, frameW, frameH);
  const width = imgW * n.zoom;
  const height = imgH * n.zoom;
  return {
    left: frameW / 2 - n.focusX * width,
    top: frameH / 2 - n.focusY * height,
    width,
    height,
  };
}

/**
 * 元画像そのものがフレームより小さい（100% でも余白が出る）かどうか。
 * 意図的な縮小による余白とは区別するための判定。
 */
export function smallerThanFrame(
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number
): boolean {
  return imgW < frameW - 0.5 || imgH < frameH - 0.5;
}

/** ドラッグ/ナッジによる並行移動。px 変換量を focus へ変換する（正規化は呼び出し側で） */
export function panTransform(
  start: Transform,
  dxPx: number,
  dyPx: number,
  imgW: number,
  imgH: number
): Transform {
  return {
    zoom: start.zoom,
    focusX: start.focusX - dxPx / (imgW * start.zoom),
    focusY: start.focusY - dyPx / (imgH * start.zoom),
  };
}

/**
 * カーソル位置(px, py: フレーム左上原点) をアンカーとしたズーム。
 * カーソル直下の画像の点が動かないように focus を補償する。
 */
export function zoomAtPoint(
  t: Transform,
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number,
  px: number,
  py: number,
  factor: number
): Transform {
  const z2 = clamp(t.zoom * factor, ZOOM_MIN, 1);
  if (z2 === t.zoom || !Number.isFinite(z2)) return t;
  // 現在カーソル下にある元画像座標
  const left = frameW / 2 - t.focusX * imgW * t.zoom;
  const top = frameH / 2 - t.focusY * imgH * t.zoom;
  const ix = (px - left) / t.zoom;
  const iy = (py - top) / t.zoom;
  // 新ズームでも同じ画像座標がカーソル下に来るよう focus を再計算
  const left2 = px - ix * z2;
  const top2 = py - iy * z2;
  return {
    zoom: z2,
    focusX: (frameW / 2 - left2) / (imgW * z2),
    focusY: (frameH / 2 - top2) / (imgH * z2),
  };
}

/** フィット（cover、余白があれば中央寄せ） */
export function fitTransform(imgW: number, imgH: number, frameW: number, frameH: number): Transform {
  return { zoom: coverZoom(imgW, imgH, frameW, frameH), focusX: 0.5, focusY: 0.5 };
}
