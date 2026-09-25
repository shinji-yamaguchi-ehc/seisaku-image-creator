import { EXPORT_FORMATS, type ExportFormatId } from "@/lib/image-loader";

interface FormatSelectorProps {
  value: ExportFormatId;
  onChange: (id: ExportFormatId) => void;
}

/** 書き出し形式の選択（既定は JPG） */
export function FormatSelector({ value, onChange }: FormatSelectorProps) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-foreground">書き出し形式</span>
      <div className="flex gap-2" role="group" aria-label="書き出し形式を選択">
        {EXPORT_FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            data-testid={`format-${f.id}`}
            aria-pressed={value === f.id}
            onClick={() => onChange(f.id)}
            className={`rounded-md border px-3 py-1 text-xs transition-colors ${
              value === f.id
                ? "border-primary bg-primary/10 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        選択した形式でダウンロードします（JPG が既定です）
      </p>
    </div>
  );
}
