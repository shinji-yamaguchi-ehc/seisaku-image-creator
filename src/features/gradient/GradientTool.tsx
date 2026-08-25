import { useState, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GradientCanvas } from "@/components/GradientCanvas";
import { GradientControls } from "@/components/GradientControls";
import { GradientExportDialog } from "@/components/GradientExportDialog";
import {
  DEFAULT_GRADIENT_STYLE,
  normalizeGradientConfig,
  type GradientCanvasConfig,
  type GradientStyle,
} from "@/lib/gradient";
import { DEFAULT_TRANSFORM } from "@/lib/transform";
import type { ImageSlot, Transform } from "@/lib/types";

const pcConfig: GradientCanvasConfig = { canvasWidth: 960, canvasHeight: 345 };
const spConfig: GradientCanvasConfig = { canvasWidth: 960, canvasHeight: 345 };

const initialTransform = (): Transform => ({ ...DEFAULT_TRANSFORM });

export default function GradientTool() {
  const [mode, setMode] = useState<"pc" | "sp">("pc");
  const [image, setImage] = useState<ImageSlot | null>(null);
  const [pcConfigState, setPcConfigState] = useState<GradientCanvasConfig>(pcConfig);
  const [spConfigState, setSpConfigState] = useState<GradientCanvasConfig>(spConfig);
  const [pcTransform, setPcTransform] = useState<Transform>(initialTransform);
  const [spTransform, setSpTransform] = useState<Transform>(initialTransform);
  const [pcStyle, setPcStyle] = useState<GradientStyle>({ ...DEFAULT_GRADIENT_STYLE });
  const [spStyle, setSpStyle] = useState<GradientStyle>({ ...DEFAULT_GRADIENT_STYLE });

  const activeConfig = mode === "pc" ? pcConfigState : spConfigState;
  const activeTransform = mode === "pc" ? pcTransform : spTransform;
  const activeStyle = mode === "pc" ? pcStyle : spStyle;
  const setActiveConfig = mode === "pc" ? setPcConfigState : setSpConfigState;
  const setActiveTransform = mode === "pc" ? setPcTransform : setSpTransform;
  const setActiveStyle = mode === "pc" ? setPcStyle : setSpStyle;

  const handleUpload = useCallback(
    (slot: ImageSlot) => {
      setImage((prev) => {
        if (prev) URL.revokeObjectURL(prev.objectUrl);
        return slot;
      });
      // 差し替え時に前画像の状態を引き継がないよう、両モードの transform をリセット
      setPcTransform(initialTransform());
      setSpTransform(initialTransform());
    },
    []
  );

  return (
    <div className="bg-background">
      <div className="max-w-[1100px] mx-auto px-4 py-6 space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">グラデーション作成</h1>
          <p className="text-sm text-muted-foreground">
            1枚の画像にグラデーションを重ねて、PC版・SP版の一枚画像を生成
          </p>
        </header>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <Tabs value={mode} onValueChange={(v) => setMode(v as "pc" | "sp")}>
            <TabsList>
              <TabsTrigger value="pc">PC版</TabsTrigger>
              <TabsTrigger value="sp">SP版</TabsTrigger>
            </TabsList>
          </Tabs>
          <GradientExportDialog
            image={image}
            pcTransform={pcTransform}
            spTransform={spTransform}
            pcConfig={pcConfigState}
            spConfig={spConfigState}
            pcStyle={pcStyle}
            spStyle={spStyle}
          />
        </div>

        <div className="bg-card border rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-medium text-foreground">
            {mode === "pc" ? "PC版キャンバス設定" : "SP版キャンバス設定"}
          </h3>
          <div className="grid grid-cols-2 gap-4 md:max-w-sm">
            <div className="space-y-1.5">
              <Label className="text-xs">キャンバス幅 (px)</Label>
              <Input
                data-testid="gradient-cfg-width"
                type="number"
                min={320}
                max={4096}
                value={activeConfig.canvasWidth}
                onChange={(e) =>
                  setActiveConfig(normalizeGradientConfig(activeConfig, { canvasWidth: Number(e.target.value) }))
                }
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">キャンバス高さ (px)</Label>
              <Input
                data-testid="gradient-cfg-height"
                type="number"
                min={40}
                max={4096}
                value={activeConfig.canvasHeight}
                onChange={(e) =>
                  setActiveConfig(normalizeGradientConfig(activeConfig, { canvasHeight: Number(e.target.value) }))
                }
                className="h-8 text-sm"
              />
            </div>
          </div>
        </div>

        <GradientCanvas
          image={image}
          transform={activeTransform}
          config={activeConfig}
          style={activeStyle}
          onTransformChange={setActiveTransform}
          onConfigChange={setActiveConfig}
          onUpload={handleUpload}
        />

        <GradientControls style={activeStyle} onChange={setActiveStyle} />
      </div>
    </div>
  );
}
