"use client";

/**
 * UpscalerComponent — SAFMN 4x Image Super-Resolution UI
 * ============================================================================
 *
 * Features:
 *   • Drag-and-drop / file-picker image input
 *   • WebGPU availability detection with actionable error messages
 *   • Progress bar with per-tile tracking ("Processing Tile 3 of 12")
 *   • Before/after comparison slider with smooth dragging
 *   • Async processing with requestAnimationFrame yields (no UI freeze)
 *   • Graceful error handling for Device Lost and other WebGPU failures
 *   • Download button for the upscaled result
 *
 * The ONNX engine is dynamically imported to avoid SSR issues with
 * onnxruntime-web (which depends on browser APIs).
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  type DragEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import {
  Upload,
  Loader2,
  AlertCircle,
  ZoomIn,
  ImageIcon,
  X,
  Download,
  Cpu,
  Clock,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (imported as type-only to avoid pulling onnxruntime-web into SSR)
// ---------------------------------------------------------------------------

interface SAFMNSession {
  session: unknown;
  inputName: string;
  outputName: string;
}

interface TileInfo {
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  needsPadding: boolean;
  isLeftEdge: boolean;
  isRightEdge: boolean;
  isTopEdge: boolean;
  isBottomEdge: boolean;
}

interface WebGPUAvailability {
  available: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

interface UpscalerComponentProps {
  /** Path or URL to the SAFMN .onnx model file. */
  modelPath?: string;
}

// ---------------------------------------------------------------------------
// Processing State Machine
// ---------------------------------------------------------------------------

type ProcessingState =
  | "idle"
  | "loading-model"
  | "processing"
  | "completed"
  | "error";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UpscalerComponent({
  modelPath = "/models/safmn_4x.onnx",
}: UpscalerComponentProps) {
  // --- State ---
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [upscaledUrl, setUpscaledUrl] = useState<string | null>(null);
  const [upscaledDimensions, setUpscaledDimensions] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [state, setState] = useState<ProcessingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [webgpuStatus, setWebgpuStatus] = useState<WebGPUAvailability | null>(
    null
  );
  const [sliderPos, setSliderPos] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [processingTime, setProcessingTime] = useState<number | null>(null);

  // --- Refs ---
  const sessionRef = useRef<SAFMNSession | null>(null);
  const cancelRef = useRef(false);
  const dragCounter = useRef(0);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const sliderDragging = useRef(false);

  // -------------------------------------------------------------------------
  // WebGPU availability check on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { checkWebGPUAvailability } = await import("@/lib/safmn-engine");
      const status = await checkWebGPUAvailability();
      if (!cancelled) setWebgpuStatus(status);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Cleanup on unmount
  // -------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      (async () => {
        if (sessionRef.current) {
          const { disposeSession } = await import("@/lib/safmn-engine");
          await disposeSession(sessionRef.current);
          sessionRef.current = null;
        }
      })();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      if (upscaledUrl) URL.revokeObjectURL(upscaledUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // File handling
  // -------------------------------------------------------------------------
  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Please select an image file (PNG, JPEG, WebP, etc.)");
        setState("error");
        return;
      }

      // Revoke previous URLs
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      if (upscaledUrl) URL.revokeObjectURL(upscaledUrl);

      const url = URL.createObjectURL(file);
      setImageFile(file);
      setImageUrl(url);
      setUpscaledUrl(null);
      setUpscaledDimensions(null);
      setState("idle");
      setError(null);
      setProgress(0);
      setProgressText("");
      setProcessingTime(null);

      // Load image to get dimensions
      const img = new Image();
      img.onload = () => {
        setImageDimensions({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.src = url;
    },
    [imageUrl, upscaledUrl]
  );

  // -------------------------------------------------------------------------
  // Drag and drop
  // -------------------------------------------------------------------------
  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) handleFile(files[0]);
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFile(e.target.files[0]);
      }
    },
    [handleFile]
  );

  // -------------------------------------------------------------------------
  // Process image
  // -------------------------------------------------------------------------
  const handleProcess = useCallback(async () => {
    if (!imageFile || !imageUrl) return;

    cancelRef.current = false;
    setError(null);
    setProgress(0);
    setProgressText("Loading model...");
    setProcessingTime(null);

    // Check WebGPU
    if (webgpuStatus && !webgpuStatus.available) {
      setError(webgpuStatus.reason || "WebGPU is not available");
      setState("error");
      return;
    }

    try {
      // Dynamic import to avoid SSR issues
      const { initSAFMNSession, processImage } = await import(
        "@/lib/safmn-engine"
      );

      // Load model if not already loaded
      if (!sessionRef.current) {
        setState("loading-model");
        sessionRef.current = await initSAFMNSession(modelPath);
      }

      // Load image element
      setState("processing");
      setProgressText("Preparing image...");

      const img = new Image();
      img.src = imageUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
      });

      // Process
      setProgressText("Processing tiles...");
      const startTime = performance.now();

      const resultCanvas = await processImage(img, sessionRef.current, {
        modelPath,
        onProgress: (current, total) => {
          setProgress((current / total) * 100);
          setProgressText(`Processing Tile ${current} of ${total}`);
        },
        shouldCancel: () => cancelRef.current,
      });

      const elapsed = performance.now() - startTime;
      setProcessingTime(elapsed);

      // Convert canvas to downloadable blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        resultCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Failed to create blob"))),
          "image/png"
        );
      });
      const resultUrl = URL.createObjectURL(blob);
      setUpscaledUrl(resultUrl);
      setUpscaledDimensions({
        w: resultCanvas.width,
        h: resultCanvas.height,
      });
      setState("completed");
      setProgress(100);
      setProgressText("Complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, [imageFile, imageUrl, modelPath, webgpuStatus]);

  // -------------------------------------------------------------------------
  // Cancel / Reset / Download
  // -------------------------------------------------------------------------
  const handleCancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const handleReset = useCallback(() => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (upscaledUrl) URL.revokeObjectURL(upscaledUrl);
    setImageFile(null);
    setImageUrl(null);
    setImageDimensions(null);
    setUpscaledUrl(null);
    setUpscaledDimensions(null);
    setState("idle");
    setError(null);
    setProgress(0);
    setProgressText("");
    setProcessingTime(null);
  }, [imageUrl, upscaledUrl]);

  const handleDownload = useCallback(() => {
    if (!upscaledUrl) return;
    const a = document.createElement("a");
    a.href = upscaledUrl;
    a.download = `upscaled_${imageFile?.name?.replace(/\.[^.]+$/, "") || "image"}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [upscaledUrl, imageFile]);

  // -------------------------------------------------------------------------
  // Comparison slider
  // -------------------------------------------------------------------------
  const handleSliderMove = useCallback(
    (clientX: number) => {
      if (!comparisonRef.current) return;
      const rect = comparisonRef.current.getBoundingClientRect();
      const pos = ((clientX - rect.left) / rect.width) * 100;
      setSliderPos(Math.max(0, Math.min(100, pos)));
    },
    []
  );

  const handleSliderMouseDown = useCallback(() => {
    sliderDragging.current = true;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (sliderDragging.current) handleSliderMove(e.clientX);
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (sliderDragging.current && e.touches.length > 0)
        handleSliderMove(e.touches[0].clientX);
    };
    const handleMouseUp = () => {
      sliderDragging.current = false;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchend", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [handleSliderMove]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const isBusy = state === "loading-model" || state === "processing";

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* === WebGPU Status Banner === */}
      {webgpuStatus && !webgpuStatus.available && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-destructive">
                WebGPU Not Available
              </p>
              <p className="text-muted-foreground mt-1">{webgpuStatus.reason}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Drop Zone (shown when no image loaded) === */}
      {!imageUrl && (
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`
            relative flex flex-col items-center justify-center
            min-h-[320px] rounded-xl border-2 border-dashed
            transition-colors cursor-pointer
            ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            }
          `}
          onClick={() => document.getElementById("upscaler-file-input")?.click()}
        >
          <input
            id="upscaler-file-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInput}
          />
          <div className="flex flex-col items-center gap-4 text-center px-6">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Upload className="w-7 h-7 text-primary" />
            </div>
            <div>
              <p className="text-lg font-medium">
                Drop an image here or click to browse
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                PNG, JPEG, WebP — processed entirely in your browser via WebGPU
              </p>
            </div>
          </div>
        </div>
      )}

      {/* === Image Loaded: Controls + Preview === */}
      {imageUrl && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4" />
                {imageFile?.name}
              </span>
              {imageDimensions && (
                <span className="flex items-center gap-1.5">
                  <span>•</span>
                  {imageDimensions.w} × {imageDimensions.h}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isBusy && state !== "completed" && (
                <>
                  <Button
                    onClick={handleProcess}
                    disabled={!webgpuStatus?.available}
                    className="gap-2"
                  >
                    <ZoomIn className="w-4 h-4" />
                    Upscale 4×
                  </Button>
                  <Button variant="outline" onClick={handleReset} className="gap-2">
                    <X className="w-4 h-4" />
                    Remove
                  </Button>
                </>
              )}
              {isBusy && (
                <Button variant="outline" onClick={handleCancel} className="gap-2">
                  <X className="w-4 h-4" />
                  Cancel
                </Button>
              )}
              {state === "completed" && upscaledUrl && (
                <>
                  <Button onClick={handleDownload} className="gap-2">
                    <Download className="w-4 h-4" />
                    Download
                  </Button>
                  <Button variant="outline" onClick={handleReset} className="gap-2">
                    <X className="w-4 h-4" />
                    New Image
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {isBusy && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {progressText}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {Math.round(progress)}%
                </span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {/* Error display */}
          {state === "error" && error && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="flex items-start gap-3 py-4">
                <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-destructive">
                    Processing Error
                  </p>
                  <p className="text-muted-foreground mt-1">{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      setState("idle");
                      setError(null);
                    }}
                  >
                    Try Again
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* === Comparison View === */}
          {state === "completed" && upscaledUrl && imageUrl ? (
            <ComparisonSlider
              ref={comparisonRef}
              originalSrc={imageUrl}
              upscaledSrc={upscaledUrl}
              sliderPos={sliderPos}
              onSliderMouseDown={handleSliderMouseDown}
              onSliderClick={handleSliderMove}
              originalDims={imageDimensions}
              upscaledDims={upscaledDimensions}
              processingTime={processingTime}
            />
          ) : (
            /* Single image preview (before processing) */
            imageUrl && (
              <div className="rounded-xl overflow-hidden border bg-muted/30 flex items-center justify-center min-h-[300px] max-h-[600px]">
                <img
                  src={imageUrl}
                  alt="Source"
                  className="max-w-full max-h-[600px] object-contain"
                />
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison Slider Sub-Component
// ---------------------------------------------------------------------------

interface ComparisonSliderProps {
  originalSrc: string;
  upscaledSrc: string;
  sliderPos: number;
  onSliderMouseDown: () => void;
  onSliderClick: (clientX: number) => void;
  originalDims: { w: number; h: number } | null;
  upscaledDims: { w: number; h: number } | null;
  processingTime: number | null;
}

const ComparisonSlider = React.forwardRef<
  HTMLDivElement,
  ComparisonSliderProps
>(function ComparisonSlider(
  {
    originalSrc,
    upscaledSrc,
    sliderPos,
    onSliderMouseDown,
    onSliderClick,
    originalDims,
    upscaledDims,
    processingTime,
  },
  ref
) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      onSliderClick(e.clientX);
    },
    [onSliderClick]
  );

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
        {originalDims && upscaledDims && (
          <span className="flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5" />
            {originalDims.w}×{originalDims.h} → {upscaledDims.w}×{upscaledDims.h}
          </span>
        )}
        {processingTime !== null && (
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {(processingTime / 1000).toFixed(2)}s
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5" />
          SAFMN 4× · WebGPU
        </span>
      </div>

      {/* Slider container */}
      <div
        ref={ref}
        className="relative w-full overflow-hidden rounded-xl border select-none cursor-ew-resize"
        style={{ aspectRatio: originalDims ? `${originalDims.w}/${originalDims.h}` : "16/9" }}
        onClick={handleClick}
      >
        {/* Original image (bottom layer, always full visible) */}
        <img
          src={originalSrc}
          alt="Original"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />

        {/* Upscaled image (top layer, clipped to right of slider) */}
        <img
          src={upscaledSrc}
          alt="Upscaled"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
          draggable={false}
        />

        {/* Labels */}
        <span className="absolute top-3 left-3 px-2 py-1 rounded-md bg-black/60 text-white text-xs font-medium pointer-events-none">
          Original
        </span>
        <span className="absolute top-3 right-3 px-2 py-1 rounded-md bg-black/60 text-white text-xs font-medium pointer-events-none">
          Upscaled 4×
        </span>

        {/* Slider handle */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg pointer-events-none"
          style={{ left: `${sliderPos}%` }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-gray-800"
            >
              <polyline points="15 18 9 12 15 6" />
              <polyline points="9 18 3 12 9 6" transform="translate(12, 0)" />
            </svg>
          </div>
        </div>

        {/* Interactive overlay for dragging */}
        <div
          className="absolute inset-0"
          onMouseDown={(e) => {
            e.preventDefault();
            onSliderMouseDown();
            onSliderClick(e.clientX);
          }}
          onTouchStart={(e) => {
            onSliderMouseDown();
            if (e.touches.length > 0) onSliderClick(e.touches[0].clientX);
          }}
        />
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Drag the slider to compare original vs. upscaled
      </p>
    </div>
  );
});
