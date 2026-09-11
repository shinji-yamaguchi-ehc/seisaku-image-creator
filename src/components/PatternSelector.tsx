import { PATTERNS, geomDefFor, spPatternOf, type PatternId } from "@/lib/layout";

interface PatternSelectorProps {
  value: PatternId;
  onChange: (id: PatternId) => void;
}

export function PatternSelector({ value, onChange }: PatternSelectorProps) {
  return (
    <div className="bg-card border rounded-lg p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">デザインパターン</h3>
        <span className="text-xs text-muted-foreground">
          選択すると PC / SP のキャンバスサイズ・枠構成が適用されます（写真は保持）
        </span>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="デザインパターン選択">
        {PATTERNS.map((p) => {
          const pc = p.pc;
          const spFor = spPatternOf(p.id);
          const sp = geomDefFor(p.id, "sp");
          const active = value === p.id;
          return (
            <button
              key={p.id}
              type="button"
              data-testid={`pattern-${p.id}`}
              aria-pressed={active}
              onClick={() => onChange(p.id)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              <span className="block text-sm font-semibold leading-none">{p.id}</span>
              <span className="mt-1 block text-[10px] leading-tight">{p.desc}</span>
              <span className="mt-1 block text-[10px] leading-tight text-muted-foreground">
                PC {pc.width}×{pc.height} ／ SP {sp.width}×{sp.height}
                {p.sp === null && spFor !== p.id && `（SP=${spFor}）`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
