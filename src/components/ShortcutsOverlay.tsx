import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ShortcutList } from "@/components/ShortcutList";

const STORAGE_KEY = "seisaku-shortcuts-seen-v1";

/** 初回アクセス時のみ表示されるキーボードショートカット概要（localStorage で表示済み管理） */
export function ShortcutsOverlay() {
  const [open, setOpen] = useState(() => {
    try {
      return !window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
  });

  if (!open) return null;

  const close = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // localStorage 利用不可の環境では表示済みにせず閉じるだけ
    }
    setOpen(false);
  };

  return (
    <div
      data-testid="shortcuts-overlay"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-lg bg-card p-6 text-card-foreground shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="操作ガイド"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">操作ガイド</h2>
          <p className="text-xs text-muted-foreground">
            各スロット内で画像をドラッグ・ホイール・キーボードで調整できます。
            行間の境界線・キャンバス下端・左右のハンドルでレイアウトも変更できます。
          </p>
        </div>
        <ShortcutList />
        <div className="flex justify-end">
          <Button data-testid="shortcuts-close" size="sm" onClick={close}>
            開始する
          </Button>
        </div>
      </div>
    </div>
  );
}
