import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  normalizeGradientStyle,
  type GradientStyle,
} from "@/lib/gradient";

interface GradientControlsProps {
  style: GradientStyle;
  onChange: (style: GradientStyle) => void;
}

const SIDES: { side: "left" | "right" | "both"; label: string; testid: string }[] = [
  { side: "left", label: "左フェード", testid: "gradient-side-left" },
  { side: "right", label: "右フェード", testid: "gradient-side-right" },
  { side: "both", label: "左右フェード", testid: "gradient-side-both" },
];

export function GradientControls({ style, onChange }: GradientControlsProps) {
  const update = (partial: Partial<GradientStyle>) => {
    onChange(normalizeGradientStyle(style, partial));
  };

  return (
    <div className="bg-card border rounded-lg p-4 space-y-4">
      <h3 className="text-sm font-medium text-foreground">グラデーション設定</h3>

      {/* 向き（左のみ／右のみ／左右） */}
      <div className="space-y-1.5">
        <Label className="text-xs">向き</Label>
        <div className="flex gap-2">
          {SIDES.map(({ side, label, testid }) => (
            <button
              key={side}
              type="button"
              data-testid={testid}
              aria-pressed={style.side === side}
              onClick={() => update({ side })}
              className={`rounded-md border px-3 py-1 text-xs transition-colors ${
                style.side === side
                  ? "border-primary bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {style.side === "both"
            ? "左右の両端から内側へフェードします。"
            : style.side === "right"
              ? "右端側から内側へ減衰します。"
              : "左端側から内側へ減衰します。"}
          向きを切り替えても位置・色・不透明度はそのまま引き継がれます。
        </p>
      </div>

      {/* 開始位置 */}
      <PositionRow
        label="開始位置"
        sliderTestid="gradient-start-pos-slider"
        inputTestid="gradient-start-pos-input"
        value={style.startPos}
        onChange={(v) => update({ startPos: v })}
      />

      {/* 終了位置 */}
      <PositionRow
        label="終了位置"
        sliderTestid="gradient-end-pos-slider"
        inputTestid="gradient-end-pos-input"
        value={style.endPos}
        onChange={(v) => update({ endPos: v })}
      />

      {/* 色 */}
      <div className="flex items-center justify-between gap-2 rounded-md border p-3">
        <Label className="text-xs">フェード色</Label>
        <span className="flex items-center gap-2">
          <ColorHexInput color={style.color} onChange={(hex) => update({ color: hex })} />
          <input
            type="color"
            data-testid="gradient-color"
            value={style.color}
            onChange={(e) => update({ color: e.target.value })}
            className="h-7 w-10 cursor-pointer rounded border"
            aria-label="フェード色を選択"
          />
        </span>
      </div>

      {/* 開始透明度 */}
      <AlphaRow
        label="開始の不透明度"
        sliderTestid="gradient-start-alpha"
        valueTestid="gradient-start-alpha-value"
        alpha={style.startAlpha}
        onAlpha={(v) => update({ startAlpha: v })}
      />

      {/* 終了透明度 */}
      <AlphaRow
        label="終了の不透明度"
        sliderTestid="gradient-end-alpha"
        valueTestid="gradient-end-alpha-value"
        alpha={style.endAlpha}
        onAlpha={(v) => update({ endAlpha: v })}
      />
    </div>
  );
}

interface PositionRowProps {
  label: string;
  sliderTestid: string;
  inputTestid: string;
  value: number;
  onChange: (v: number) => void;
}

function PositionRow({ label, sliderTestid, inputTestid, value, onChange }: PositionRowProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="flex items-center gap-1">
          <Input
            data-testid={inputTestid}
            type="number"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-7 w-20 text-right text-xs"
          />
          %
        </span>
      </div>
      <Slider
        data-testid={sliderTestid}
        min={0}
        max={100}
        step={1}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
      />
      <p className="text-[10px] text-muted-foreground">左端 0% ～ 右端 100%</p>
    </div>
  );
}

interface AlphaRowProps {
  label: string;
  sliderTestid: string;
  valueTestid: string;
  alpha: number;
  onAlpha: (v: number) => void;
}

function AlphaRow({ label, sliderTestid, valueTestid, alpha, onAlpha }: AlphaRowProps) {
  return (
    <div className="flex items-center gap-3">
      <Label className="w-24 shrink-0 text-xs text-muted-foreground">{label}</Label>
      <Slider
        data-testid={sliderTestid}
        min={0}
        max={100}
        step={1}
        value={[alpha]}
        onValueChange={([v]) => onAlpha(v)}
        className="flex-1"
      />
      <span data-testid={valueTestid} className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {alpha}%
      </span>
    </div>
  );
}

/** hex 直入力欄（Enter/フォーカスアウトで確定。不正値は現在色を維持） */
function ColorHexInput({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      onChange(draft);
      setDraft(null);
    }
  };
  return (
    <Input
      data-testid="gradient-color-hex"
      type="text"
      spellCheck={false}
      aria-label="フェード色を hex で入力"
      value={draft ?? color}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="h-7 w-24 font-mono text-xs"
    />
  );
}
