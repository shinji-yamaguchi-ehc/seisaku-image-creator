import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeLayoutConfig } from "@/lib/layout";
import type { LayoutConfig } from "@/lib/types";

interface ToolbarProps {
  config: LayoutConfig;
  onConfigChange: (config: LayoutConfig) => void;
  label: string;
}

export function Toolbar({ config, onConfigChange, label }: ToolbarProps) {
  const update = (partial: Partial<Pick<LayoutConfig, "canvasWidth" | "canvasHeight">>) => {
    onConfigChange(normalizeLayoutConfig(config, partial));
  };

  return (
    <div className="bg-card border rounded-lg p-4 space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          キャンバス全体: {config.canvasWidth} × {config.canvasHeight}px
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        デザインパターンの枠は、キャンバス全体を隙間なく埋める構成です。キャンバスの幅・高さを変更すると各枠は比率を保って追従します。
        プレビュー上でも左右のハンドルで幅・下端のハンドルで高さを変更できます。
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:max-w-sm">
        <div className="space-y-1.5">
          <Label className="text-xs">キャンバス幅 (px)</Label>
          <Input
            data-testid="canvas-width-input"
            type="number"
            min={320}
            max={4096}
            value={config.canvasWidth}
            onChange={(e) => update({ canvasWidth: Number(e.target.value) })}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">キャンバス高さ (px)</Label>
          <Input
            data-testid="canvas-height-input"
            type="number"
            min={40}
            max={4096}
            value={config.canvasHeight}
            onChange={(e) => update({ canvasHeight: Number(e.target.value) })}
            className="h-8 text-sm"
          />
        </div>
      </div>
    </div>
  );
}
