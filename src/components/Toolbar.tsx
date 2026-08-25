import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { computeGeom, normalizeLayoutConfig } from "@/lib/layout";
import type { LayoutConfig } from "@/lib/types";

interface ToolbarProps {
  config: LayoutConfig;
  onConfigChange: (config: LayoutConfig) => void;
  label: string;
}

export function Toolbar({ config, onConfigChange, label }: ToolbarProps) {
  const update = (partial: Partial<LayoutConfig>) => {
    onConfigChange(normalizeLayoutConfig(config, partial));
  };
  const total = computeGeom(config).H;

  return (
    <div className="bg-card border rounded-lg p-4 space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          キャンバス全体: {config.canvasWidth} × {total}px
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        行の高さは1行目・2行目それぞれ独立に設定できます（キャンバスの高さは自動で決まります）。
        プレビュー上でも、行間の境界線ドラッグで1行目の高さ・キャンバス下端のドラッグで2行目の高さ・左右のハンドルドラッグでキャンバス幅を変更できます。
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">キャンバス幅 (px)</Label>
          <Input
            type="number"
            min={320}
            max={4096}
            value={config.canvasWidth}
            onChange={(e) => update({ canvasWidth: Number(e.target.value) })}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">1行目の高さ (px)</Label>
          <Input
            data-testid="row1-height-input"
            type="number"
            min={40}
            max={4096}
            value={config.row1Height}
            onChange={(e) => update({ row1Height: Number(e.target.value) })}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">2行目の高さ (px)</Label>
          <Input
            data-testid="row2-height-input"
            type="number"
            min={40}
            max={4096}
            value={config.row2Height}
            onChange={(e) => update({ row2Height: Number(e.target.value) })}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">行間の余白 (px)</Label>
          <Input
            data-testid="row-gap-input"
            type="number"
            min={0}
            max={400}
            value={config.rowGap}
            onChange={(e) => update({ rowGap: Number(e.target.value) })}
            className="h-8 text-sm"
          />
        </div>
      </div>
    </div>
  );
}
