import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ImageSlot, Transform, LayoutConfig } from "@/lib/types";
import { computeGeom } from "@/lib/layout";
import { renderCanvas, downloadCanvas } from "@/lib/canvas-renderer";

interface ExportDialogProps {
  images: (ImageSlot | null)[];
  pcTransforms: Transform[];
  spTransforms: Transform[];
  pcConfig: LayoutConfig;
  spConfig: LayoutConfig;
}

export function ExportDialog({
  images,
  pcTransforms,
  spTransforms,
  pcConfig,
  spConfig,
}: ExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [pcPreview, setPcPreview] = useState<string | null>(null);
  const [spPreview, setSpPreview] = useState<string | null>(null);

  const pcDim = computeGeom(pcConfig);
  const spDim = computeGeom(spConfig);

  const generatePreviews = useCallback(async () => {
    const pcCanvas = await renderCanvas(images, pcTransforms, pcConfig);
    const spCanvas = await renderCanvas(images, spTransforms, spConfig);
    setPcPreview(pcCanvas.toDataURL("image/png"));
    setSpPreview(spCanvas.toDataURL("image/png"));
    return { pcCanvas, spCanvas };
  }, [images, pcTransforms, spTransforms, pcConfig, spConfig]);

  const handleOpen = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (isOpen) {
        generatePreviews();
      }
    },
    [generatePreviews]
  );

  const handleDownloadPC = useCallback(async () => {
    const pcCanvas = await renderCanvas(images, pcTransforms, pcConfig);
    downloadCanvas(pcCanvas, "output_pc.png");
  }, [images, pcTransforms, pcConfig]);

  const handleDownloadSP = useCallback(async () => {
    const spCanvas = await renderCanvas(images, spTransforms, spConfig);
    downloadCanvas(spCanvas, "output_sp.png");
  }, [images, spTransforms, spConfig]);

  const handleDownloadBoth = useCallback(async () => {
    const pcCanvas = await renderCanvas(images, pcTransforms, pcConfig);
    const spCanvas = await renderCanvas(images, spTransforms, spConfig);
    downloadCanvas(pcCanvas, "output_pc.png");
    downloadCanvas(spCanvas, "output_sp.png");
  }, [images, pcTransforms, spConfig, spTransforms, pcConfig]);

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
            <h3 className="text-sm font-medium mb-2">PC版 ({pcDim.W}×{pcDim.H})</h3>
            {pcPreview && (
              <img src={pcPreview} alt="PC版プレビュー" className="w-full rounded border" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">SP版 ({spDim.W}×{spDim.H})</h3>
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
            <Button onClick={handleDownloadBoth}>
              両方ダウンロード
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

