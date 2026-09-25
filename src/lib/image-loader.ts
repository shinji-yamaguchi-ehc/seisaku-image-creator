import type { ImageSlot } from "@/lib/types";

/** 選択可能な書き出し形式（デフォルトは jpg） */
export const EXPORT_FORMATS = [
  { id: "jpg", label: "JPG", mime: "image/jpeg" },
  { id: "png", label: "PNG", mime: "image/png" },
  { id: "webp", label: "WebP", mime: "image/webp" },
] as const;

export type ExportFormatId = (typeof EXPORT_FORMATS)[number]["id"];

export const DEFAULT_EXPORT_FORMAT: ExportFormatId = "jpg";

export function exportMime(format: ExportFormatId): string {
  return EXPORT_FORMATS.find((f) => f.id === format)?.mime ?? "image/jpeg";
}

const EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

/** ファイル名の拡張子を小文字で返す（拡張子なしは空文字） */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** 画像ファイルをデコードして ImageSlot を生成する（全アップロード経路の共通処理） */
export function fileToImageSlot(file: File): Promise<ImageSlot> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        file,
        objectUrl: url,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        element: img,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした"));
    };
    img.src = url;
  });
}

/** File が選択可能な画像（jpg / png / webp）かどうかを判定する */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || EXTENSIONS.has(fileExtension(file.name));
}
