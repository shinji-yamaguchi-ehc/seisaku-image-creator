import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ShortcutList } from "@/components/ShortcutList";
import {
  computeGeom,
  rectsFromGeom,
  normalizeLayoutConfig,
} from "@/lib/layout";
import {
  ZOOM_MIN,
  ZOOM_STEP,
  displayRectOf,
  fitTransform,
  smallerThanFrame,
  normalizeTransform,
  panTransform,
  zoomAtPoint,
} from "@/lib/transform";
import { renderPreview } from "@/lib/canvas-renderer";
import { fileToImageSlot, isImageFile } from "@/lib/image-loader";
import type { ImageSlot, LayoutConfig, Transform } from "@/lib/types";

interface LayoutCanvasProps {
  images: (ImageSlot | null)[];
  transforms: Transform[];
  config: LayoutConfig;
  onTransformChange: (index: number, t: Transform) => void;
  onConfigChange: (config: LayoutConfig) => void;
  onUpload: (index: number, slot: ImageSlot) => void;
  onRemove: (index: number) => void;
}

type DragState =
  | { kind: "pan"; index: number; pointerId: number; baseRect: DOMRect; startX: number; startY: number; start: Transform }
  | {
      kind: "rowHeight";
      target: "row1" | "row2";
      pointerId: number;
      baseRect: DOMRect;
      startY: number;
      startCfg: LayoutConfig;
    }
  | {
      kind: "width";
      edge: "w" | "e";
      pointerId: number;
      baseRect: DOMRect;
      startX: number;
      startCfg: LayoutConfig;
    };

/** 左右エッジハンドル（ドラッグでキャンバス幅のみを変更） */
const EDGES: { edge: "w" | "e"; style: React.CSSProperties; label: string }[] = [
  { edge: "w", style: { left: -7, top: 0, bottom: 0 }, label: "左端" },
  { edge: "e", style: { right: -7, top: 0, bottom: 0 }, label: "右端" },
];

export function LayoutCanvas({
  images,
  transforms,
  config,
  onTransformChange,
  onConfigChange,
  onUpload,
  onRemove,
}: LayoutCanvasProps) {
  // プレビューはキャンバス（出力）と 1:1 サイズで表示するため、幾何はそのまま画面サイズになる
  const geom = useMemo(() => computeGeom(config), [config]);
  const rects = useMemo(() => rectsFromGeom(geom), [geom]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<number | null>(null);
  const [helpIndex, setHelpIndex] = useState<number | null>(null);

  /** 常にクランプ済みの実効 transform */
  const eff = useMemo(
    () =>
      rects.map((r, i) => {
        const img = images[i];
        if (!img) return null;
        return normalizeTransform(transforms[i], img.naturalWidth, img.naturalHeight, r.width, r.height);
      }),
    [rects, images, transforms]
  );

  const toLocal = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = wrapperRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  /** ドラッグ開始時に保存した rect 基準のローカル座標（中央寄せによる再センタリングやスクロールの影響を受けない） */
  const toLocalOf = useCallback(
    (rect: DOMRect, e: { clientX: number; clientY: number }) => ({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }),
    []
  );

  /** 正規化してから上位へ通知 */
  const commit = useCallback(
    (index: number, t: Transform) => {
      const img = images[index];
      if (!img) return;
      const r = rects[index];
      onTransformChange(index, normalizeTransform(t, img.naturalWidth, img.naturalHeight, r.width, r.height));
    },
    [images, rects, onTransformChange]
  );

  // ドラッグ中も最新の props/state を参照するための ref
  const ctxRef = useRef({ images, eff, rects, commit, onConfigChange });
  useEffect(() => {
    ctxRef.current = { images, eff, rects, commit, onConfigChange };
  });

  // ---- スロット直接アップロード（クリック／ドロップ共通の共有ファイル入力） ----
  const openFilePicker = useCallback((index: number) => {
    pendingSlotRef.current = index;
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const index = pendingSlotRef.current;
      pendingSlotRef.current = null;
      const file = e.target.files?.[0];
      e.target.value = "";
      if (index === null || !file) return;
      void fileToImageSlot(file).then((slot) => onUpload(index, slot));
    },
    [onUpload]
  );

  const handleSlotDrop = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file || !isImageFile(file)) return;
      void fileToImageSlot(file).then((slot) => onUpload(index, slot));
    },
    [onUpload]
  );

  // ---- ウィンドウ単位のドラッグ追従（pan / 行境界 / 左右エッジ共通） ----
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      // プレビューはキャンバスと 1:1 のため、px 移動量をそのまま設定値に反映できる
      const { images: imgs, commit: c, onConfigChange: occ } = ctxRef.current;
      const p = toLocalOf(d.baseRect, e);

      if (d.kind === "pan") {
        const img = imgs[d.index];
        if (!img) return;
        // 必ず「ドラッグ開始時」の transform を基準にする（中間イベントでの累積を防ぐ）
        const start = d.start;
        c(
          d.index,
          panTransform(start, p.x - d.startX, p.y - d.startY, img.naturalWidth, img.naturalHeight)
        );
      } else if (d.kind === "rowHeight") {
        // ドラッグした側の行の高さのみを変更する（もう片方の行・行間余白は不変、キャンバス高さは自動導出）
        // 必ず「ドラッグ開始時」の config を基準にする（中間イベントでの累積を防ぐ）
        const base = d.startCfg;
        const delta = Math.round(p.y - d.startY);
        const partial =
          d.target === "row1"
            ? { row1Height: base.row1Height + delta }
            : { row2Height: base.row2Height + delta };
        const next = normalizeLayoutConfig(base, partial);
        if (next.row1Height !== base.row1Height || next.row2Height !== base.row2Height) occ(next);
      } else {
        // 左右エッジハンドル: キャンバス幅のみを変更（行の高さ・余白は不変）
        // 必ず「ドラッグ開始時」の config を基準にする（中間イベントでの累積を防ぐ）
        const base = d.startCfg;
        // 外側へドラッグで拡大: 右端は +dx、左端は -dx
        const delta = Math.round(p.x - d.startX) * (d.edge === "e" ? 1 : -1);
        const next = normalizeLayoutConfig(base, { canvasWidth: base.canvasWidth + delta });
        if (next.canvasWidth !== base.canvasWidth) occ(next);
      }
    };
    const up = (e: PointerEvent) => {
      if (dragRef.current && e.pointerId === dragRef.current.pointerId) dragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [toLocalOf]);

  // ---- ホイールズーム（カーソル位置アンカー）。React の passive リスナー回避のためネイティブ登録 ----
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-controls]")) return; // 入力欄上ではホイールを横取りしない
      const slotEl = target?.closest<HTMLElement>("[data-slot]");
      if (!slotEl) return;
      const index = Number(slotEl.dataset.slot);
      const cur = ctxRef.current;
      const img = cur.images[index];
      const t = cur.eff[index];
      if (!img || !t) return;
      e.preventDefault();
      const p = toLocal(e);
      const r = cur.rects[index];
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      cur.commit(
        index,
        zoomAtPoint(t, img.naturalWidth, img.naturalHeight, r.width, r.height, p.x - r.x, p.y - r.y, factor)
      );
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [toLocal]);

  // ---- プレビュー描画（エクスポート用 drawLayout を流用し WYSIWYG を保証） ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderPreview(canvas, images, transforms, config, geom.W);
  }, [images, transforms, config, geom.W]);

  // ---- スロット操作 ----
  const zoomByStep = useCallback(
    (index: number, dir: 1 | -1, anchor?: { x: number; y: number }) => {
      const img = images[index];
      const t = eff[index];
      const r = rects[index];
      if (!img || !t) return;
      const factor = dir === 1 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const next = anchor
        ? zoomAtPoint(t, img.naturalWidth, img.naturalHeight, r.width, r.height, anchor.x, anchor.y, factor)
        : { ...t, zoom: t.zoom * factor };
      commit(index, next);
    },
    [images, eff, rects, commit]
  );

  const toggleFitFull = useCallback(
    (index: number) => {
      const img = images[index];
      const t = eff[index];
      const r = rects[index];
      if (!img || !t) return;
      if (Math.abs(t.zoom - 1) > 1e-4) {
        commit(index, { zoom: 1, focusX: t.focusX, focusY: t.focusY });
      } else {
        commit(index, fitTransform(img.naturalWidth, img.naturalHeight, r.width, r.height));
      }
    },
    [images, eff, rects, commit]
  );

  const startPan = useCallback(
    (e: React.PointerEvent, index: number) => {
      const img = images[index];
      const t = eff[index];
      if (!img || !t || e.button !== 0) return;
      if ((e.target as HTMLElement).closest("[data-controls]")) return;
      (e.currentTarget as HTMLElement).focus();
      const baseRect = wrapperRef.current!.getBoundingClientRect();
      const p = toLocalOf(baseRect, e);
      dragRef.current = {
        kind: "pan",
        index,
        pointerId: e.pointerId,
        baseRect,
        startX: p.x,
        startY: p.y,
        start: t,
      };
    },
    [images, eff, toLocalOf]
  );

  const startRowHeightDrag = useCallback(
    (e: React.PointerEvent, target: "row1" | "row2") => {
      if (e.button !== 0) return;
      e.preventDefault();
      const p = toLocal(e);
      dragRef.current = {
        kind: "rowHeight",
        target,
        pointerId: e.pointerId,
        baseRect: wrapperRef.current!.getBoundingClientRect(),
        startY: p.y,
        startCfg: { ...config },
      };
    },
    [toLocal, config]
  );

  const startWidthDrag = useCallback(
    (e: React.PointerEvent, edge: "w" | "e") => {
      if (e.button !== 0) return;
      e.preventDefault();
      const p = toLocal(e);
      dragRef.current = {
        kind: "width",
        edge,
        pointerId: e.pointerId,
        baseRect: wrapperRef.current!.getBoundingClientRect(),
        startX: p.x,
        startCfg: { ...config },
      };
    },
    [toLocal, config]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "0" || e.key === "1")) {
        e.preventDefault();
        const img = images[index];
        const t = eff[index];
        const r = rects[index];
        if (!img || !t) return;
        commit(
          index,
          e.key === "0"
            ? fitTransform(img.naturalWidth, img.naturalHeight, r.width, r.height)
            : { zoom: 1, focusX: t.focusX, focusY: t.focusY }
        );
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const img = images[index];
      const t = eff[index];
      if (!img || !t) return;
      // ナッジ量は px（プレビュー＝出力の 1:1 表示）
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          commit(index, panTransform(t, -step, 0, img.naturalWidth, img.naturalHeight));
          break;
        case "ArrowRight":
          e.preventDefault();
          commit(index, panTransform(t, step, 0, img.naturalWidth, img.naturalHeight));
          break;
        case "ArrowUp":
          e.preventDefault();
          commit(index, panTransform(t, 0, -step, img.naturalWidth, img.naturalHeight));
          break;
        case "ArrowDown":
          e.preventDefault();
          commit(index, panTransform(t, 0, step, img.naturalWidth, img.naturalHeight));
          break;
        case "+":
        case "=":
          e.preventDefault();
          zoomByStep(index, 1);
          break;
        case "-":
        case "_":
          e.preventDefault();
          zoomByStep(index, -1);
          break;
      }
    },
    [images, eff, rects, commit, zoomByStep]
  );

  const setFromNumericInput = useCallback(
    (index: number, part: "zoom" | "left" | "top", value: number) => {
      const img = images[index];
      const t = eff[index];
      const r = rects[index];
      if (!img || !t || !Number.isFinite(value)) return;
      if (part === "zoom") {
        commit(index, { ...t, zoom: value / 100 });
      } else if (part === "left") {
        commit(index, { zoom: t.zoom, focusX: (r.width / 2 - value) / (img.naturalWidth * t.zoom), focusY: t.focusY });
      } else {
        commit(index, { zoom: t.zoom, focusX: t.focusX, focusY: (r.height / 2 - value) / (img.naturalHeight * t.zoom) });
      }
    },
    [images, eff, rects, commit]
  );

  return (
    <div className="mx-auto w-fit">
      <div className="rounded-lg border bg-card shadow-sm">
        <div
          ref={wrapperRef}
          className="relative select-none rounded-lg bg-white"
          style={{ width: geom.W, height: geom.H, touchAction: "none" }}
          onPointerDownCapture={(e) => {
            // パネル等以外の場所をクリックしたらヘルプパネルを閉じる
            if (!(e.target as HTMLElement).closest("[data-controls]")) setHelpIndex(null);
          }}
        >
          <canvas
            ref={canvasRef}
            data-testid="layout-preview"
            className="absolute left-0 top-0 block rounded-lg"
          />

          {/* グリッドガイド */}
          <svg
            className="pointer-events-none absolute inset-0 z-10"
            width={geom.W}
            height={geom.H}
            aria-hidden="true"
          >
            <line x1={0} y1={geom.r1} x2={geom.W} y2={geom.r1} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
            {geom.gap > 0.5 && (
              <line
                x1={0}
                y1={geom.r1 + geom.gap}
                x2={geom.W}
                y2={geom.r1 + geom.gap}
                stroke="rgba(0,0,0,0.18)"
                strokeWidth={1}
              />
            )}
            <line x1={geom.col} y1={geom.r1} x2={geom.col} y2={geom.H} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
            <line x1={geom.col} y1={geom.r1} x2={geom.col} y2={geom.H} stroke="rgba(0,0,0,0.12)" strokeWidth={1} />
            <line x1={geom.col * 2} y1={geom.r1} x2={geom.col * 2} y2={geom.H} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
            <line x1={geom.col * 2} y1={geom.r1} x2={geom.col * 2} y2={geom.H} stroke="rgba(0,0,0,0.12)" strokeWidth={1} />
          </svg>

          {/* スロットレイヤー（パン操作・キーボード・コントロール） */}
          {rects.map((r, i) => {
            const img = images[i];
            const t = eff[i];
            const cr = rects[i];
            // 余白判定・表示矩形はキャンバス座標（出力）基準
            const gap = img ? smallerThanFrame(img.naturalWidth, img.naturalHeight, cr.width, cr.height) : false;
            const disp = img && t ? displayRectOf(t, img.naturalWidth, img.naturalHeight, cr.width, cr.height) : null;

            return (
              <div
                key={i}
                data-slot={i}
                data-testid={`slot-overlay-${i}`}
                role="group"
                aria-label={`スロット${i + 1}`}
                tabIndex={img ? 0 : -1}
                data-zoom={t ? String(t.zoom) : ""}
                data-min-zoom={img ? String(ZOOM_MIN) : ""}
                data-left={disp ? String(Math.round(disp.left)) : ""}
                data-top={disp ? String(Math.round(disp.top)) : ""}
                data-gap={gap ? "1" : "0"}
                onKeyDown={(e) => handleKeyDown(e, i)}
                onPointerDown={(e) => startPan(e, i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleSlotDrop(e, i)}
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-controls]")) return;
                  toggleFitFull(i);
                }}
                className="group absolute z-20 outline-none focus:ring-2 focus:ring-primary/70 active:cursor-grabbing"
                style={{
                  left: r.x,
                  top: r.y,
                  width: r.width,
                  height: r.height,
                  touchAction: "none",
                  cursor: img ? "grab" : undefined,
                }}
              >
                {!img && (
                  <div
                    data-testid={`slot-empty-${i}`}
                    onClick={() => openFilePicker(i)}
                    className="flex h-full w-full cursor-pointer items-center justify-center border border-dashed border-muted-foreground/25 bg-muted/30 p-2 text-center text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5"
                  >
                    スロット{i + 1}：クリックまたはドロップで画像を追加
                  </div>
                )}

                {img && (
                  <div
                    data-controls
                    data-testid={`slot-actions-${i}`}
                    className="absolute right-1.5 top-1.5 z-20 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                  >
                    <button
                      type="button"
                      data-testid={`slot-replace-${i}`}
                      aria-label={`スロット${i + 1}の画像を変更`}
                      tabIndex={-1}
                      onClick={() => openFilePicker(i)}
                      className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-black/80"
                    >
                      変更
                    </button>
                    <button
                      type="button"
                      data-testid={`slot-remove-${i}`}
                      aria-label={`スロット${i + 1}の画像を削除`}
                      tabIndex={-1}
                      onClick={() => onRemove(i)}
                      className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-black/80"
                    >
                      削除
                    </button>
                  </div>
                )}

                {img && t && disp && (
                  <>
                    {gap && (
                      <div
                        data-testid={`slot-gap-warning-${i}`}
                        className="absolute bottom-1.5 left-1.5 z-20 flex items-center gap-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white"
                      >
                        ⚠ 元画像が枠より小さく余白があります
                      </div>
                    )}

                    <button
                      type="button"
                      data-controls
                      data-testid={`slot-zoom-badge-${i}`}
                      aria-label={`スロット${i + 1}の調整パネルを開く`}
                      tabIndex={-1}
                      onClick={() => setHelpIndex((prev) => (prev === i ? null : i))}
                      className="absolute bottom-1.5 right-1.5 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white hover:bg-black/80"
                    >
                      {Math.round(t.zoom * 100)}% ＋
                    </button>

                    {helpIndex === i && (
                      <div
                        data-controls
                        data-testid={`slot-panel-${i}`}
                        className="absolute bottom-8 right-1.5 z-40 w-64 space-y-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-baseline justify-between">
                            <span className="text-xs font-medium">数値入力</span>
                            <span className="text-[10px] text-muted-foreground">
                              元画像 {img.naturalWidth}×{img.naturalHeight}px
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            オフセットは出力画像（{config.canvasWidth}px幅）基準のpxです
                          </p>
                          <label className="flex items-center justify-between gap-2 text-xs">
                            ズーム
                            <span className="flex items-center gap-1">
                              <Input
                                data-testid={`slot-input-zoom-${i}`}
                                type="number"
                                min={Math.round(ZOOM_MIN * 100)}
                                max={100}
                                step={1}
                                value={Math.round(t.zoom * 100)}
                                onChange={(e) =>
                                  setFromNumericInput(i, "zoom", Number(e.target.value))
                                }
                                className="h-7 w-20 text-right text-xs"
                              />
                              %
                            </span>
                          </label>
                          <label className="flex items-center justify-between gap-2 text-xs">
                            横オフセット
                            <span className="flex items-center gap-1">
                              <Input
                                data-testid={`slot-input-left-${i}`}
                                type="number"
                                step={1}
                                value={Math.round(disp.left)}
                                onChange={(e) => setFromNumericInput(i, "left", Number(e.target.value))}
                                className="h-7 w-20 text-right text-xs"
                              />
                              px
                            </span>
                          </label>
                          <label className="flex items-center justify-between gap-2 text-xs">
                            縦オフセット
                            <span className="flex items-center gap-1">
                              <Input
                                data-testid={`slot-input-top-${i}`}
                                type="number"
                                step={1}
                                value={Math.round(disp.top)}
                                onChange={(e) => setFromNumericInput(i, "top", Number(e.target.value))}
                                className="h-7 w-20 text-right text-xs"
                              />
                              px
                            </span>
                          </label>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-full text-xs"
                            onClick={() =>
                              commit(
                                i,
                                fitTransform(img.naturalWidth, img.naturalHeight, cr.width, cr.height)
                              )
                            }
                          >
                            フィットにリセット
                          </Button>
                        </div>
                        <div className="space-y-1.5 border-t pt-2">
                          <span className="text-xs font-medium">ショートカット</span>
                          <ShortcutList dense />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* 1行目の下端（ドラッグで1行目の高さのみを変更） */}
          <div
            data-testid="row-divider"
            role="separator"
            aria-label="1行目の下端（ドラッグで1行目の高さを変更）"
            title="ドラッグで1行目の高さを変更（2行目は変わらないまま）"
            onPointerDown={(e) => startRowHeightDrag(e, "row1")}
            className="group absolute left-0 z-30 flex w-full cursor-row-resize items-center"
            style={{ top: geom.r1 - 8, height: 16, touchAction: "none" }}
          >
            <div className="mx-auto h-[3px] w-full rounded-full bg-primary/25 transition-colors group-hover:bg-primary/70" />
          </div>

          {/* 2行目の下端＝キャンバス下端（ドラッグで2行目の高さのみを変更） */}
          <div
            data-testid="row2-divider"
            role="separator"
            aria-label="2行目の下端（ドラッグで2行目の高さを変更）"
            title="ドラッグで2行目の高さを変更（1行目は変わらないまま）"
            onPointerDown={(e) => startRowHeightDrag(e, "row2")}
            className="group absolute left-0 z-30 flex w-full cursor-row-resize items-center"
            style={{ top: geom.H - 8, height: 16, touchAction: "none" }}
          >
            <div className="h-[3px] w-full rounded-full bg-primary/25 transition-colors group-hover:bg-primary/70" />
          </div>

          {/* 左右エッジハンドル（ドラッグでキャンバス幅のみを変更） */}
          {EDGES.map(({ edge, style, label }) => (
            <div
              key={edge}
              data-testid={`edge-handle-${edge}`}
              role="separator"
              aria-label={`キャンバス幅を変更（${label}）`}
              title="左右にドラッグでキャンバス幅のみを変更"
              onPointerDown={(e) => startWidthDrag(e, edge)}
              className="group absolute z-30 w-3.5 cursor-ew-resize"
              style={{ ...style, touchAction: "none" }}
            >
              <div className="mx-auto h-full w-[3px] rounded-full bg-primary/25 transition-colors group-hover:bg-primary/70" />
            </div>
          ))}

          {/* スロット直接アップロード用の共有ファイル入力 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="slot-file-input"
            onChange={handleFileInputChange}
          />
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        空きスロットはクリック／ドロップで画像を追加。スロット内：ドラッグ＝位置調整／ホイール＝ズーム／ダブルクリック＝フィット⇔100%。
        行間の線で1行目、下端の線で2行目の高さを独立に変更。左右のハンドルでキャンバス幅を変更。
      </p>
    </div>
  );
}
