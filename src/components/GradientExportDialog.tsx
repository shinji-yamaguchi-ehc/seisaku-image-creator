import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ImageSlot, Transform } from "@/lib/types";
import type { GradientCanvasConfig, GradientStyle } from "@/lib/gradient";
import { renderGradientCanvas, downloadCanvas } from "@/lib/canvas-renderer";

interface GradientExportDialogProps {
  image: ImageSlot | null;
  pcTransform: Transform;
  spTransform: Transform;
  pcConfig: GradientCanvasConfig;
  spConfig: GradientCanvasConfig;
  pcStyle: GradientStyle;
  spStyle: GradientStyle;
}

export function GradientExportDialog({
  image,
  pcTransform,
  spTransform,
  pcConfig,
  spConfig,
  pcStyle,
  spStyle,
}: GradientExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [pcPreview, setPcPreview] = useState<string | null>(null);
  const [spPreview, setSpPreview] = useState<string | null>(null);

  const generatePreviews = useCallback(() => {
    const pcCanvas = renderGradientCanvas(image, pcTransform, pcConfig, pcStyle);
    const spCanvas = renderGradientCanvas(image, spTransform, spConfig, spStyle);
    setPcPreview(pcCanvas.toDataURL("image/png"));
    setSpPreview(spCanvas.toDataURL("image/png"));
  }, [image, pcTransform, spTransform, pcConfig, spConfig, pcStyle, spStyle]);

  const handleOpen = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (isOpen) generatePreviews();
    },
    [generatePreviews]
  );

  const handleDownloadPC = useCallback(() => {
    downloadCanvas(renderGradientCanvas(image, pcTransform, pcConfig, pcStyle), "gradient_pc.png");
  }, [image, pcTransform, pcConfig, pcStyle]);

  const handleDownloadSP = useCallback(() => {
    downloadCanvas(renderGradientCanvas(image, spTransform, spConfig, spStyle), "gradient_sp.png");
  }, [image, spTransform, spConfig, spStyle]);

  const handleDownloadBoth = useCallback(() => {
    handleDownloadPC();
    handleDownloadSP();
  }, [handleDownloadPC, handleDownloadSP]);

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="text-base px-8">
          エクスポート
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>プレビュー & ダウンロード</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium mb-2">PC版 ({pcConfig.canvasWidth}×{pcConfig.canvasHeight})</h3>
            {pcPreview && (
              <img src={pcPreview} alt="PC版プレビュー" className="w-full rounded border" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">SP版 ({spConfig.canvasWidth}×{spConfig.canvasHeight})</h3>
            {spPreview && (
              <img src={spPreview} alt="SP版プレビュー" className="w-full rounded border" />
            )}
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={handleDownloadPC}>
              PC版をダウンロード
            </Button>
            <Button variant="outline" onClick={handleDownloadSP}>
              SP版をダウンロード
            </Button>
            <Button onClick={handleDownloadBoth}>両方ダウンロード</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
