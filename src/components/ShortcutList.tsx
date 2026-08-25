/** キーボードショートカットの一覧（ヘルプUI共通） */
export const SHORTCUT_ROWS: { keys: string; action: string }[] = [
  { keys: "Tab / Shift+Tab", action: "スロット間のフォーカス移動" },
  { keys: "矢印キー", action: "画像を 1px 移動（Shift+矢印で 10px）" },
  { keys: "+ / -", action: "ズーム段階変更" },
  { keys: "Ctrl+0", action: "フィット（cover）" },
  { keys: "Ctrl+1", action: "100%（元サイズ）" },
  { keys: "ドラッグ", action: "画像の位置調整" },
  { keys: "ホイール", action: "カーソル位置を基準にズーム" },
  { keys: "ダブルクリック", action: "フィット ⇔ 100% 切り替え" },
  { keys: "行間の境界線ドラッグ", action: "1行目 / 2行目の高さ変更" },
  { keys: "左右ハンドルドラッグ", action: "キャンバス幅を変更" },
];

export function ShortcutList({ dense = false }: { dense?: boolean }) {
  return (
    <ul className={dense ? "space-y-1" : "space-y-1.5"}>
      {SHORTCUT_ROWS.map((row) => (
        <li key={row.keys} className="flex items-baseline gap-2 text-xs">
          <span className="min-w-[7.5rem] shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {row.keys}
          </span>
          <span>{row.action}</span>
        </li>
      ))}
    </ul>
  );
}
