"use client";

import React, { useCallback, useRef, useEffect } from "react";
import { ImageDropzone } from "./image-dropzone";
import { UpscalerComparison } from "./upscaler-comparison";
import { useUpscalerStore } from "@/store/upscaler-store";
import {
  SafmnEngine,
  isWebGPUSupported,
  computeTileGrid,
  TILE_SIZE,
  OVERLAP,
  UPSCALE_FACTOR,
} from "@/lib/safmn-engine";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Zap,
  AlertTriangle,
  Cpu,
  Download,
  RotateCcw,
  Sparkles,
  Gauge,
} from "lucide-react";

/** Path to the SAFMN ONNX model — served from the public directory. */
const MODEL_PATH = "/models/safmn_4x.onnx";

export function ImageUpscalerApp() {
  const {
    imageFile,
    status,
    statusMessage,
    currentTile,
    totalTiles,
    progress,
    error,
    outputDataUrl,
    outputWidth,
    outputHeight,
    setError,
    setStatus,
    setStatusMessage,
    setCurrentTile,
    setTotalTiles,
    setProgress,
    setOutputDataUrl,
    setOutputWidth,
    setOutputHeight,
    resetAll,
  } = useUpscalerStore();

  const engineRef = useRef<SafmnEngine | null>(null);

  // Clean up engine and object URLs on unmount.
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.dispose().catch(() => {});
        engineRef.current = null;
      }
    };
  }, []);

  const webgpuSupported = isWebGPUSupported();

  /**
   * Initialize the SAFMN engine and load the ONNX model into a WebGPU session.
   * Catches WebGPU handshake failures and shows a graceful error.
   */
  const initEngine = useCallback(async (): Promise<SafmnEngine | null> => {
    if (engineRef.current?.isReady()) return engineRef.current;

    try {
      setStatus("loading-model");
      setStatusMessage("Loading SAFMN model into WebGPU...");
      setProgress(0);

      const engine = new SafmnEngine({ modelPath: MODEL_PATH });
      await engine.init();
      engineRef.current = engine;

      setStatus("model-ready");
      setStatusMessage("Model loaded. Ready to upscale.");
      return engine;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
      setStatusMessage("");
      return null;
    }
  }, [setStatus, setStatusMessage, setProgress, setError]);

  /**
   * Load the uploaded image into an offscreen canvas at native resolution.
   * This canvas serves as the source for tile extraction.
   */
  const loadImageToCanvas = useCallback(
    (img: HTMLImageElement): HTMLCanvasElement => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Failed to get 2D canvas context.");
      ctx.drawImage(img, 0, 0);
      return canvas;
    },
    [],
  );

  /**
   * Run the full upscale pipeline:
   *   1. Initialize engine (if not already loaded).
   *   2. Load image into source canvas.
   *   3. Compute tile grid and update store with total tile count.
   *   4. Run engine.upscale() with callbacks that update the store.
   *   5. Convert output canvas to data URL for display.
   */
  const handleUpscale = useCallback(async () => {
    if (!imageFile) return;

    // Reset previous results.
    setOutputDataUrl(null);
    setError(null);
    setProgress(0);

    // Initialize engine.
    const engine = await initEngine();
    if (!engine) return; // Error already set by initEngine.

    try {
      // Load image into canvas.
      const img = new Image();
      img.crossOrigin = "anonymous";

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image for processing."));
        img.src = imageFile.objectUrl;
      });

      const sourceCanvas = loadImageToCanvas(img);

      // Pre-compute tile grid to show total count immediately.
      const tiles = computeTileGrid(sourceCanvas.width, sourceCanvas.height);
      setTotalTiles(tiles.length);
      setCurrentTile(0);

      // Run the engine.
      await engine.upscale(sourceCanvas, {
        onProgress: (tileIndex, total) => {
          setCurrentTile(tileIndex);
          setProgress((tileIndex / total) * 100);
          setStatusMessage(`Processing tile ${tileIndex} of ${total}`);
        },
        onStatusChange: (newStatus) => {
          setStatus(newStatus as any);
          if (newStatus === "stitching") {
            setStatusMessage("Stitching tiles and finalizing output...");
          }
        },
        onTileComplete: () => {},
        onError: (err) => {
          setError(err);
          setStatus("error");
          setStatusMessage("");
        },
        onComplete: (outputCanvas) => {
          // Convert output canvas to data URL for the comparison component.
          const dataUrl = outputCanvas.toDataURL("image/png");
          setOutputDataUrl(dataUrl);
          setOutputWidth(outputCanvas.width);
          setOutputHeight(outputCanvas.height);
          setStatus("completed");
          setStatusMessage(
            `Upscaled to ${outputCanvas.width}×${outputCanvas.height} in ${tiles.length} tiles.`,
          );
          setProgress(100);
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Check for WebGPU device-lost errors.
      if (
        msg.includes("Device Lost") ||
        msg.includes("device was lost") ||
        msg.includes("GPU")
      ) {
        setError(
          `WebGPU device error (${msg}). Your GPU may have run out of memory or the browser lost the device. Try a smaller image or check your browser configuration.`,
        );
      } else {
        setError(`Upscaling failed: ${msg}`);
      }
      setStatus("error");
      setStatusMessage("");
    }
  }, [
    imageFile,
    initEngine,
    loadImageToCanvas,
    setError,
    setStatus,
    setStatusMessage,
    setProgress,
    setCurrentTile,
    setTotalTiles,
    setOutputDataUrl,
    setOutputWidth,
    setOutputHeight,
  ]);

  const handleDownload = useCallback(() => {
    if (!outputDataUrl) return;
    const link = document.createElement("a");
    link.download = `upscaled_${imageFile?.name ?? "image.png"}`;
    link.href = outputDataUrl;
    link.click();
  }, [outputDataUrl, imageFile]);

  const handleReset = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.dispose().catch(() => {});
      engineRef.current = null;
    }
    // Revoke the object URL to prevent memory leaks.
    const { imageFile: currentFile } = useUpscalerStore.getState();
    if (currentFile?.objectUrl) {
      URL.revokeObjectURL(currentFile.objectUrl);
    }
    resetAll();
  }, [resetAll]);

  const isProcessing =
    status === "processing" ||
    status === "loading-model" ||
    status === "stitching";
  const showComparison = status === "completed" && outputDataUrl;

  // Tile grid info for display.
  const tileInfo = imageFile
    ? {
        cols: Math.max(1, Math.ceil(imageFile.width / (TILE_SIZE - OVERLAP))),
        rows: Math.max(1, Math.ceil(imageFile.height / (TILE_SIZE - OVERLAP))),
        total: Math.max(
          1,
          Math.ceil(imageFile.width / (TILE_SIZE - OVERLAP)) *
            Math.ceil(imageFile.height / (TILE_SIZE - OVERLAP)),
        ),
      }
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                SAFMN Image Upscaler
              </h1>
              <p className="text-xs text-muted-foreground">
                4× super-resolution • WebGPU • Client-side
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {webgpuSupported ? (
              <span className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-600 dark:text-green-400">
                <Cpu className="h-3.5 w-3.5" />
                WebGPU Available
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                No WebGPU
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {!webgpuSupported && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>WebGPU Not Available</AlertTitle>
            <AlertDescription>
              Your browser or GPU does not support WebGPU, which is required for
              this upscaler. Please use a recent version of Chrome (113+), Edge
              (113+), or another WebGPU-enabled browser. Check your browser
              configuration or hardware drivers.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Processing Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left column: Upload + Controls */}
          <div className="flex flex-col gap-4">
            <ImageDropzone />

            {imageFile && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Gauge className="h-4 w-4 text-muted-foreground" />
                    Processing Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Image info */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Input:</span>
                      <span className="ml-2 font-medium text-foreground">
                        {imageFile.width}×{imageFile.height}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Output:</span>
                      <span className="ml-2 font-medium text-foreground">
                        {imageFile.width * UPSCALE_FACTOR}×
                        {imageFile.height * UPSCALE_FACTOR}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Tile size:</span>
                      <span className="ml-2 font-medium text-foreground">
                        {TILE_SIZE}×{TILE_SIZE}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Overlap:</span>
                      <span className="ml-2 font-medium text-foreground">
                        {OVERLAP}px
                      </span>
                    </div>
                    {tileInfo && (
                      <>
                        <div>
                          <span className="text-muted-foreground">Grid:</span>
                          <span className="ml-2 font-medium text-foreground">
                            {tileInfo.cols}×{tileInfo.rows}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Tiles:</span>
                          <span className="ml-2 font-medium text-foreground">
                            {tileInfo.total}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  <Separator />

                  {/* Action buttons */}
                  <div className="flex gap-3">
                    <Button
                      onClick={handleUpscale}
                      disabled={isProcessing || !webgpuSupported}
                      className="flex-1"
                    >
                      <Zap className="mr-2 h-4 w-4" />
                      {status === "loading-model"
                        ? "Loading Model..."
                        : isProcessing
                          ? "Processing..."
                          : "Upscale 4×"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleReset}
                      disabled={isProcessing}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Reset
                    </Button>
                  </div>

                  {/* Progress bar */}
                  {(isProcessing || status === "completed") && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          {statusMessage || "Processing..."}
                        </span>
                        {totalTiles > 0 && isProcessing && (
                          <span className="font-medium text-foreground">
                            Tile {currentTile} of {totalTiles}
                          </span>
                        )}
                      </div>
                      <Progress value={progress} className="h-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{progress.toFixed(1)}%</span>
                        {status === "completed" && outputDataUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleDownload}
                            className="h-6 px-2 text-xs"
                          >
                            <Download className="mr-1 h-3 w-3" />
                            Download
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right column: Comparison / Placeholder */}
          <div className="flex flex-col gap-4">
            {showComparison ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Result</CardTitle>
                </CardHeader>
                <CardContent>
                  <UpscalerComparison />
                </CardContent>
              </Card>
            ) : (
              <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-muted-foreground/20 bg-muted/20 p-8 text-center">
                <Sparkles className="mb-3 h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">
                  Upscaled image will appear here
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Upload an image and click "Upscale 4×" to begin
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/30">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <p className="text-center text-xs text-muted-foreground">
            SAFMN (Spatially-Adaptive Feature Modulation Network) • ONNX Runtime
            Web • WebGPU backend • All processing runs locally in your browser
          </p>
        </div>
      </footer>
    </div>
  );
}
