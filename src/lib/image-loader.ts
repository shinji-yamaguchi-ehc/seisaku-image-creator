import type { ImageSlot } from "@/lib/types";

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

/** File が画像かどうかを判定する */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}
