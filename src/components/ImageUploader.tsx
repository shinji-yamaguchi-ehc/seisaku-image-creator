import { useCallback } from "react";
import type { ImageSlot } from "@/lib/types";
import { fileToImageSlot, isImageFile } from "@/lib/image-loader";

interface ImageUploaderProps {
  index: number;
  onUpload: (index: number, slot: ImageSlot) => void;
}

export function ImageUploader({ index, onUpload }: ImageUploaderProps) {
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && isImageFile(file)) {
        void fileToImageSlot(file).then((slot) => onUpload(index, slot));
      }
    },
    [index, onUpload]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        void fileToImageSlot(file).then((slot) => onUpload(index, slot));
      }
      e.target.value = "";
    },
    [index, onUpload]
  );

  return (
    <div
      className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-2 text-center hover:border-primary/50 transition-colors"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <label className="cursor-pointer block">
        <span className="text-xs text-muted-foreground">
          画像 {index + 1} をドロップまたはクリック
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          data-testid={`uploader-input-${index}`}
          onChange={handleFileChange}
        />
      </label>
    </div>
  );
}
