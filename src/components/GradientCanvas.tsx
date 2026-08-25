import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  normalizeGradientConfig,
  normalizedFor,
} from "@/lib/gradient";
import {
  ZOOM_MIN,
  ZOOM_STEP,
  displayRectOf,
  fitTransform,
  smallerThanFrame,
  panTransform,
  zoomAtPoint,
} from "@/lib/transform";
import { renderGradientPreview } from "@/lib/canvas-renderer";
import { fileToImageSlot, isImageFile } from "@/lib/image-loader";
import type { ImageSlot, Transform } from "@/lib/types";
import type { GradientCanvasConfig, GradientStyle } from "@/lib/gradient";

interface GradientCanvasProps {
  image: ImageSlot | null;
  transform: Transform;
  config: GradientCanvasConfig;
  style: GradientStyle;
  onTransformChange: (t: Transform) => void;
  onConfigChange: (config: GradientCanvasConfig) => void;
  onUpload: (slot: ImageSlot) => void;
}

type DragState =
  | { kind: "pan"; pointerId: number; baseRect: DOMRect; startX: number; startY: number; start: Transform }
  | { kind: "height"; pointerId: number; baseRect: DOMRect; startY: number; startCfg: GradientCanvasConfig }
  | { kind: "width"; edge: "w" | "e"; pointerId: number; baseRect: DOMRect; startX: number; startCfg: GradientCanvasConfig };

const EDGES: { edge: "w" | "e"; style: React.CSSProperties; label: string }[] = [
  { edge: "w", style: { left: -7, top: 0, bottom: 0 }, label: "左端" },
  { edge: "e", style: { right: -7, top: 0, bottom: 0 }, label: "右端" },
];

export function GradientCanvas({
  image,
  transform,
  config,
  style,
  onTransformChange,
  onConfigChange,
  onUpload,
}: GradientCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  /** 常にクランプ済みの実効 transform */
  const eff = useMemo(() => {
    if (!image) return null;
    return normalizedFor(image, transform, config.canvasWidth, config.canvasHeight);
  }, [image, transform, config]);

  const disp = useMemo(() => {
    if (!image || !eff) return null;
    return displayRectOf(eff, image.naturalWidth, image.naturalHeight, config.canvasWidth, config.canvasHeight);
  }, [image, eff, config]);

  const gap = image ? smallerThanFrame(image.naturalWidth, image.naturalHeight, config.canvasWidth, config.canvasHeight) : false;

  const toLocalOf = useCallback(
    (rect: DOMRect, e: { clientX: number; clientY: number }) => ({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }),
    []
  );

  const commit = useCallback(
    (t: Transform) => {
      if (!image) return;
      onTransformChange(normalizedFor(image, t, config.canvasWidth, config.canvasHeight));
    },
    [image, config, onTransformChange]
  );

  // ドラッグ中も最新の state を参照するための ref
  const ctxRef = useRef({ image, eff, commit, onConfigChange });
  useEffect(() => {
    ctxRef.current = { image, eff, commit, onConfigChange };
  });

  // ---- ウィンドウ単位のドラッグ追従 ----
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      // プレビューはキャンバスと 1:1 のため、px 移動量をそのまま設定値に反映できる
      const { image: img, commit: c, onConfigChange: occ } = ctxRef.current;
      const p = toLocalOf(d.baseRect, e);

      if (d.kind === "pan") {
        if (!img) return;
        // 必ず「ドラッグ開始時」の transform を基準にする（中間イベントでの累積を防ぐ）
        const start = d.start;
        c(panTransform(start, p.x - d.startX, p.y - d.startY, img.naturalWidth, img.naturalHeight));
      } else if (d.kind === "height") {
        // 下端ハンドル: キャンバス高さのみを変更。必ずドラッグ開始時の config を基準にする
        const base = d.startCfg;
        const next = normalizeGradientConfig(base, { canvasHeight: base.canvasHeight + Math.round(p.y - d.startY) });
        if (next.canvasHeight !== base.canvasHeight) occ(next);
      } else {
        // 左右エッジハンドル: キャンバス幅のみを変更。外側へドラッグで拡大（右端 +dx / 左端 -dx）
        const base = d.startCfg;
        const delta = Math.round(p.x - d.startX) * (d.edge === "e" ? 1 : -1);
        const next = normalizeGradientConfig(base, { canvasWidth: base.canvasWidth + delta });
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
      if ((e.target as HTMLElement | null)?.closest("[data-controls]")) return;
      const cur = ctxRef.current;
      if (!cur.image || !cur.eff) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      cur.commit(
        zoomAtPoint(cur.eff, cur.image.naturalWidth, cur.image.naturalHeight, config.canvasWidth, config.canvasHeight, px, py, factor)
      );
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [config]);

  // ---- プレビュー描画（エクスポート用 drawGradientLayout を流用し WYSIWYG を保証） ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderGradientPreview(canvas, image, transform, config, style);
  }, [image, transform, config, style]);

  const zoomByStep = useCallback(
    (dir: 1 | -1, anchor?: { x: number; y: number }) => {
      if (!image || !eff) return;
      const factor = dir === 1 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const next = anchor
        ? zoomAtPoint(eff, image.naturalWidth, image.naturalHeight, config.canvasWidth, config.canvasHeight, anchor.x, anchor.y, factor)
        : { ...eff, zoom: eff.zoom * factor };
      commit(next);
    },
    [image, eff, config, commit]
  );

  const toggleFitFull = useCallback(() => {
    if (!image || !eff) return;
    if (Math.abs(eff.zoom - 1) > 1e-4) {
      commit({ zoom: 1, focusX: eff.focusX, focusY: eff.focusY });
    } else {
      commit(fitTransform(image.naturalWidth, image.naturalHeight, config.canvasWidth, config.canvasHeight));
    }
  }, [image, eff, config, commit]);

  const startPan = useCallback(
    (e: React.PointerEvent) => {
      if (!image || !eff || e.button !== 0) return;
      if ((e.target as HTMLElement).closest("[data-controls]")) return;
      (e.currentTarget as HTMLElement).focus();
      const baseRect = wrapperRef.current!.getBoundingClientRect();
      const p = toLocalOf(baseRect, e);
      dragRef.current = {
        kind: "pan",
        pointerId: e.pointerId,
        baseRect,
        startX: p.x,
        startY: p.y,
        start: eff,
      };
    },
    [image, eff, toLocalOf]
  );

  const startHandleDrag = useCallback(
    (e: React.PointerEvent, target: "height" | "w" | "e") => {
      if (e.button !== 0) return;
      e.preventDefault();
      const baseRect = wrapperRef.current!.getBoundingClientRect();
      const p = toLocalOf(baseRect, e);
      dragRef.current =
        target === "height"
          ? { kind: "height", pointerId: e.pointerId, baseRect, startY: p.y, startCfg: { ...config } }
          : { kind: "width", edge: target as "w" | "e", pointerId: e.pointerId, baseRect, startX: p.x, startCfg: { ...config } };
    },
    [toLocalOf, config]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file || !isImageFile(file)) return;
      void fileToImageSlot(file).then(onUpload);
    },
    [onUpload]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!image || !eff) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "0" || e.key === "1")) {
        e.preventDefault();
        commit(
          e.key === "0"
            ? fitTransform(image.naturalWidth, image.naturalHeight, config.canvasWidth, config.canvasHeight)
            : { zoom: 1, focusX: eff.focusX, focusY: eff.focusY }
        );
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          commit(panTransform(eff, -step, 0, image.naturalWidth, image.naturalHeight));
          break;
        case "ArrowRight":
          e.preventDefault();
          commit(panTransform(eff, step, 0, image.naturalWidth, image.naturalHeight));
          break;
        case "ArrowUp":
          e.preventDefault();
          commit(panTransform(eff, 0, -step, image.naturalWidth, image.naturalHeight));
          break;
        case "ArrowDown":
          e.preventDefault();
          commit(panTransform(eff, 0, step, image.naturalWidth, image.naturalHeight));
          break;
        case "+":
        case "=":
          e.preventDefault();
          zoomByStep(1);
          break;
        case "-":
        case "_":
          e.preventDefault();
          zoomByStep(-1);
          break;
      }
    },
    [image, eff, config, commit, zoomByStep]
  );

  const setFromNumericInput = useCallback(
    (part: "zoom" | "left" | "top", value: number) => {
      if (!image || !eff || !Number.isFinite(value)) return;
      if (part === "zoom") {
        commit({ ...eff, zoom: value / 100 });
      } else if (part === "left") {
        commit({ zoom: eff.zoom, focusX: (config.canvasWidth / 2 - value) / (image.naturalWidth * eff.zoom), focusY: eff.focusY });
      } else {
        commit({ zoom: eff.zoom, focusX: eff.focusX, focusY: (config.canvasHeight / 2 - value) / (image.naturalHeight * eff.zoom) });
      }
    },
    [image, eff, config, commit]
  );

  return (
    <div className="mx-auto w-fit">
      <div className="rounded-lg border bg-card shadow-sm">
        <div
          ref={wrapperRef}
          className="group relative select-none rounded-lg bg-white"
          style={{ width: config.canvasWidth, height: config.canvasHeight, touchAction: "none" }}
          onPointerDownCapture={(e) => {
            if (!(e.target as HTMLElement).closest("[data-controls]")) setHelpOpen(false);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <canvas ref={canvasRef} data-testid="gradient-preview" className="absolute left-0 top-0 block rounded-lg" />

          {/* 単一スロットの操作レイヤー */}
          <div
            data-slot="gradient"
            data-testid="gradient-slot"
            role="group"
            aria-label="グラデーション画像"
            tabIndex={image ? 0 : -1}
            data-zoom={eff ? String(eff.zoom) : ""}
            data-min-zoom={image ? String(ZOOM_MIN) : ""}
            data-left={disp ? String(Math.round(disp.left)) : ""}
            data-top={disp ? String(Math.round(disp.top)) : ""}
            data-gap={gap ? "1" : "0"}
            onKeyDown={handleKeyDown}
            onPointerDown={startPan}
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement).closest("[data-controls]")) return;
              toggleFitFull();
            }}
            className="absolute inset-0 z-20 outline-none focus:ring-2 focus:ring-primary/70 active:cursor-grabbing"
            style={{ touchAction: "none", cursor: image ? "grab" : undefined }}
          >
            {!image && (
              <div
                data-testid="gradient-empty"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-full w-full cursor-pointer items-center justify-center border border-dashed border-muted-foreground/25 bg-muted/30 p-4 text-center text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                クリックまたはドロップで画像を追加
              </div>
            )}

            {gap && (
              <div
                data-testid="gradient-gap-warning"
                className="absolute bottom-1.5 left-1.5 z-20 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white"
              >
                ⚠ 元画像が枠より小さく余白があります
              </div>
            )}

            {image && eff && (
              <>
                <div
                  data-controls
                  data-testid="gradient-actions"
                  className="absolute right-1.5 top-1.5 z-20 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                >
                  <button
                    type="button"
                    data-testid="gradient-replace"
                    aria-label="画像を変更"
                    tabIndex={-1}
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-black/80"
                  >
                    変更
                  </button>
                </div>

                <button
                  type="button"
                  data-controls
                  data-testid="gradient-zoom-badge"
                  aria-label="調整パネルを開く"
                  tabIndex={-1}
                  onClick={() => setHelpOpen((prev) => !prev)}
                  className="absolute bottom-1.5 right-1.5 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white hover:bg-black/80"
                >
                  {Math.round(eff.zoom * 100)}% ＋
                </button>

                {helpOpen && (
                  <div
                    data-controls
                    data-testid="gradient-panel"
                    className="absolute bottom-8 right-1.5 z-40 w-64 space-y-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-medium">数値入力</span>
                        <span className="text-[10px] text-muted-foreground">
                          元画像 {image.naturalWidth}×{image.naturalHeight}px
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        オフセットは出力画像（{config.canvasWidth}×{config.canvasHeight}）基準のpxです
                      </p>
                      <label className="flex items-center justify-between gap-2 text-xs">
                        ズーム
                        <span className="flex items-center gap-1">
                          <Input
                            data-testid="gradient-input-zoom"
                            type="number"
                            min={Math.round(ZOOM_MIN * 100)}
                            max={100}
                            step={1}
                            value={Math.round(eff.zoom * 100)}
                            onChange={(e) => setFromNumericInput("zoom", Number(e.target.value))}
                            className="h-7 w-20 text-right text-xs"
                          />
                          %
                        </span>
                      </label>
                      <label className="flex items-center justify-between gap-2 text-xs">
                        横オフセット
                        <span className="flex items-center gap-1">
                          <Input
                            data-testid="gradient-input-left"
                            type="number"
                            step={1}
                            value={Math.round(disp!.left)}
                            onChange={(e) => setFromNumericInput("left", Number(e.target.value))}
                            className="h-7 w-20 text-right text-xs"
                          />
                          px
                        </span>
                      </label>
                      <label className="flex items-center justify-between gap-2 text-xs">
                        縦オフセット
                        <span className="flex items-center gap-1">
                          <Input
                            data-testid="gradient-input-top"
                            type="number"
                            step={1}
                            value={Math.round(disp!.top)}
                            onChange={(e) => setFromNumericInput("top", Number(e.target.value))}
                            className="h-7 w-20 text-right text-xs"
                          />
                          px
                        </span>
                      </label>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-full text-xs"
                        onClick={() => commit(fitTransform(image.naturalWidth, image.naturalHeight, config.canvasWidth, config.canvasHeight))}
                      >
                        フィットにリセット
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 下端ハンドル（ドラッグでキャンバス高さのみを変更） */}
          <div
            data-testid="gradient-height-handle"
            role="separator"
            aria-label="キャンバス高さを変更（下端）"
            title="上下にドラッグでキャンバス高さのみを変更"
            onPointerDown={(e) => startHandleDrag(e, "height")}
            className="group absolute left-0 z-30 flex w-full cursor-row-resize items-center"
            style={{ top: config.canvasHeight - 8, height: 16, touchAction: "none" }}
          >
            <div className="h-[3px] w-full rounded-full bg-primary/25 transition-colors group-hover:bg-primary/70" />
          </div>

          {/* 左右エッジハンドル（ドラッグでキャンバス幅のみを変更） */}
          {EDGES.map(({ edge, style: edgeStyle, label }) => (
            <div
              key={edge}
              data-testid={`gradient-edge-handle-${edge}`}
              role="separator"
              aria-label={`キャンバス幅を変更（${label}）`}
              title="左右にドラッグでキャンバス幅のみを変更"
              onPointerDown={(e) => startHandleDrag(e, edge)}
              className="group absolute z-30 w-3.5 cursor-ew-resize"
              style={{ ...edgeStyle, touchAction: "none" }}
            >
              <div className="mx-auto h-full w-[3px] rounded-full bg-primary/25 transition-colors group-hover:bg-primary/70" />
            </div>
          ))}

          {/* スロット直接アップロード用のファイル入力 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="gradient-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void fileToImageSlot(file).then(onUpload);
            }}
          />
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        ドラッグ＝位置調整／ホイール＝ズーム／ダブルクリック＝フィット⇔100%。下端の線で高さ、左右のハンドルで幅を変更。
      </p>
    </div>
  );
}
