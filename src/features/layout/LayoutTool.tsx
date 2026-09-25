import { useState, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutCanvas } from "@/components/LayoutCanvas";
import { Toolbar } from "@/components/Toolbar";
import { PatternSelector } from "@/components/PatternSelector";
import { ExportDialog } from "@/components/ExportDialog";
import type { ImageSlot, Transform, LayoutConfig } from "@/lib/types";
import { presetConfig, spPatternOf, type PatternId } from "@/lib/layout";
import { DEFAULT_TRANSFORM } from "@/lib/transform";

const DEFAULT_PATTERN: PatternId = "D-1";

const initialTransforms = (): Transform[] => [
  { ...DEFAULT_TRANSFORM },
  { ...DEFAULT_TRANSFORM },
  { ...DEFAULT_TRANSFORM },
  { ...DEFAULT_TRANSFORM },
];

export default function LayoutTool() {
  const [mode, setMode] = useState<"pc" | "sp">("pc");
  const [pattern, setPattern] = useState<PatternId>(DEFAULT_PATTERN);
  const [images, setImages] = useState<(ImageSlot | null)[]>([null, null, null, null]);
  const [pcConfig, setPcConfig] = useState<LayoutConfig>(() => presetConfig(DEFAULT_PATTERN, "pc"));
  const [spConfigState, setSpConfigState] = useState<LayoutConfig>(() => presetConfig(DEFAULT_PATTERN, "sp"));
  const [pcTransforms, setPcTransforms] = useState<Transform[]>(initialTransforms);
  const [spTransforms, setSpTransforms] = useState<Transform[]>(initialTransforms);

  const activeConfig = mode === "pc" ? pcConfig : spConfigState;
  const activeTransforms = mode === "pc" ? pcTransforms : spTransforms;
  const setActiveConfig = mode === "pc" ? setPcConfig : setSpConfigState;
  const setActiveTransforms = mode === "pc" ? setPcTransforms : setSpTransforms;

  const resetTransformAt = useCallback((index: number) => {
    // 差し替え・削除時に前画像の状態を引き継がないよう、全モードの transform をリセット
    const resetAt = (prev: Transform[]) => {
      const next = [...prev];
      next[index] = { ...DEFAULT_TRANSFORM };
      return next;
    };
    setPcTransforms(resetAt);
    setSpTransforms(resetAt);
  }, []);

  const handleUpload = useCallback(
    (index: number, slot: ImageSlot) => {
      setImages((prev) => {
        const next = [...prev];
        const old = prev[index];
        if (old) URL.revokeObjectURL(old.objectUrl);
        next[index] = slot;
        return next;
      });
      resetTransformAt(index);
    },
    [resetTransformAt]
  );

  const handleRemove = useCallback(
    (index: number) => {
      setImages((prev) => {
        const next = [...prev];
        const old = prev[index];
        if (old) URL.revokeObjectURL(old.objectUrl);
        next[index] = null;
        return next;
      });
      resetTransformAt(index);
    },
    [resetTransformAt]
  );

  const handleTransformChange = useCallback(
    (index: number, t: Transform) => {
      setActiveTransforms((prev) => {
        const next = [...prev];
        next[index] = t;
        return next;
      });
    },
    [setActiveTransforms]
  );

  // デザインパターン選択: PC/SP のキャンバスサイズ・枠構成を既定値へ戻し、transform もリセット
  const handleSelectPattern = useCallback((id: PatternId) => {
    setPattern(id);
    setPcConfig(presetConfig(id, "pc"));
    setSpConfigState(presetConfig(id, "sp"));
    setPcTransforms(initialTransforms());
    setSpTransforms(initialTransforms());
  }, []);

  const spDesign = spPatternOf(pattern);

  return (
    <div className="bg-background">
      <div className="max-w-[1100px] mx-auto px-4 py-6 space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">制作画像クリエイター</h1>
          <p className="text-sm text-muted-foreground">
            トップ画像デザイン（A-1〜D-2）に合わせて画像を配置し、PC版・SP版の一枚画像を生成
          </p>
        </header>

        <PatternSelector value={pattern} onChange={handleSelectPattern} />

        {mode === "sp" && spDesign !== pattern && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2" data-testid="sp-fallback-note">
            {pattern} はSP版に存在しないため、SP版は {spDesign} の枠構成・サイズで出力します（PC版は {pattern} のまま）。
          </p>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <Tabs value={mode} onValueChange={(v) => setMode(v as "pc" | "sp")}>
            <TabsList>
              <TabsTrigger value="pc">PC版</TabsTrigger>
              <TabsTrigger value="sp">SP版</TabsTrigger>
            </TabsList>
          </Tabs>
          <ExportDialog
            images={images as ImageSlot[]}
            pcTransforms={pcTransforms}
            spTransforms={spTransforms}
            pcConfig={pcConfig}
            spConfig={spConfigState}
          />
        </div>

        <Toolbar
          config={activeConfig}
          onConfigChange={setActiveConfig}
          label={mode === "pc" ? "PC版キャンバス設定" : "SP版キャンバス設定"}
        />

        <LayoutCanvas
          images={images}
          transforms={activeTransforms}
          config={activeConfig}
          onTransformChange={handleTransformChange}
          onConfigChange={setActiveConfig}
          onUpload={handleUpload}
          onRemove={handleRemove}
        />
      </div>
    </div>
  );
}
