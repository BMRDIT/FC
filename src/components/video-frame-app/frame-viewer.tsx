"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useVideoStore } from "@/store/video-store";
import { getFrame } from "@/lib/frame-db";
import { formatTimestamp } from "@/lib/frame-extractor";
import {
  SafmnEngine,
  isWebGPUSupported,
  computeTileGrid,
} from "@/lib/safmn-engine";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Loader2,
  ImageOff,
  Maximize2,
  Minimize2,
  Sparkles,
  X,
  Download,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Path to the SAFMN ONNX model — served from the public directory. */
const MODEL_PATH = "/models/safmn_4x.onnx";

export function FrameViewer() {
  const {
    selectedFrameIndex,
    totalFrames,
    currentSession,
    extractionStatus,
    viewerZoom,
    setViewerZoom,
    resetViewerZoom,
    videoWidth,
    videoHeight,
    videoDuration,
    videoFps,
    goNextFrame,
    goPrevFrame,
    goFirstFrame,
    goLastFrame,
  } = useVideoStore();

  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const urlRef = useRef<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ─── Upscale state ──────────────────────────────────────────────────────
  const [upscaledUrl, setUpscaledUrl] = useState<string | null>(null);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaleProgress, setUpscaleProgress] = useState(0);
  const [upscaleTileInfo, setUpscaleTileInfo] = useState<string>("");
  const [upscaleError, setUpscaleError] = useState<string | null>(null);
  const [showUpscaled, setShowUpscaled] = useState(false);

  const engineRef = useRef<SafmnEngine | null>(null);
  const upscaledUrlRef = useRef<string | null>(null);

  // Preload adjacent frames
  const preloadRef = useRef<Map<number, string>>(new Map());

  const sessionId = currentSession?.id || "";

  // Cleanup function for URLs
  const cleanupUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  // Cleanup upscaled URL
  const cleanupUpscaledUrl = useCallback(() => {
    if (upscaledUrlRef.current) {
      URL.revokeObjectURL(upscaledUrlRef.current);
      upscaledUrlRef.current = null;
    }
  }, []);

  // Clear upscale state when frame changes
  useEffect(() => {
    cleanupUpscaledUrl();
    setUpscaledUrl(null);
    setShowUpscaled(false);
    setUpscaleError(null);
    setUpscaleProgress(0);
    setUpscaleTileInfo("");
  }, [selectedFrameIndex, cleanupUpscaledUrl]);

  // Load frame when selection changes
  useEffect(() => {
    if (!sessionId || extractionStatus === "idle" || extractionStatus === "extracting") {
      return;
    }

    let cancelled = false;
    // Defer to avoid calling setState synchronously in effect body
    const startLoading = () => setIsLoading(true);
    startLoading();

    // Check preload cache first
    const cachedUrl = preloadRef.current.get(selectedFrameIndex);

    const loadFrame = async () => {
      try {
        const frame = await getFrame(sessionId, selectedFrameIndex);
        if (frame && !cancelled) {
          cleanupUrl();
          const url = cachedUrl || URL.createObjectURL(frame.blob);
          urlRef.current = url;
          setFrameUrl(url);

          // Cache this URL
          if (!cachedUrl) {
            preloadRef.current.set(selectedFrameIndex, url);
          }

          // Preload next 2 frames
          const preloadNext = async () => {
            for (let offset = 1; offset <= 3; offset++) {
              const preloadIdx = selectedFrameIndex + offset;
              if (preloadIdx < totalFrames && !preloadRef.current.has(preloadIdx)) {
                try {
                  const nextFrame = await getFrame(sessionId, preloadIdx);
                  if (nextFrame) {
                    const nextUrl = URL.createObjectURL(nextFrame.blob);
                    preloadRef.current.set(preloadIdx, nextUrl);
                  }
                } catch {
                  // Ignore preload errors
                }
              }
            }
          };
          preloadNext();

          // Cleanup old preload cache (keep only nearby frames)
          const keepRange = 10;
          for (const [idx] of preloadRef.current) {
            if (Math.abs(idx - selectedFrameIndex) > keepRange) {
              const oldUrl = preloadRef.current.get(idx);
              if (oldUrl && idx !== selectedFrameIndex) {
                URL.revokeObjectURL(oldUrl);
              }
              preloadRef.current.delete(idx);
            }
          }
        }
      } catch {
        if (!cancelled) {
          setFrameUrl(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadFrame();

    return () => {
      cancelled = true;
    };
  }, [sessionId, selectedFrameIndex, extractionStatus, totalFrames, cleanupUrl]);

  // Global cleanup
  useEffect(() => {
    return () => {
      cleanupUrl();
      cleanupUpscaledUrl();
      for (const [, url] of preloadRef.current) {
        URL.revokeObjectURL(url);
      }
      preloadRef.current.clear();
      if (engineRef.current) {
        engineRef.current.dispose().catch(() => {});
        engineRef.current = null;
      }
    };
  }, [cleanupUrl, cleanupUpscaledUrl]);

  // Keyboard navigation
  useEffect(() => {
    if (extractionStatus !== "completed") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
        case "a":
        case "A":
          e.preventDefault();
          goPrevFrame();
          break;
        case "ArrowRight":
        case "d":
        case "D":
          e.preventDefault();
          goNextFrame();
          break;
        case "Home":
          e.preventDefault();
          goFirstFrame();
          break;
        case "End":
          e.preventDefault();
          goLastFrame();
          break;
        case "+":
        case "=":
          e.preventDefault();
          setViewerZoom(viewerZoom + 0.25);
          break;
        case "-":
        case "_":
          e.preventDefault();
          setViewerZoom(viewerZoom - 0.25);
          break;
        case "0":
          e.preventDefault();
          resetViewerZoom();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [extractionStatus, goNextFrame, goPrevFrame, goFirstFrame, goLastFrame, viewerZoom, setViewerZoom, resetViewerZoom]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ─── Upscale handler ────────────────────────────────────────────────────

  /**
   * Upscale the currently selected frame using the SAFMN WebGPU engine.
   *
   * Flow:
   *   1. Check WebGPU support.
   *   2. Initialize engine (lazy — only on first call).
   *   3. Load the frame blob into an offscreen canvas at native resolution.
   *   4. Run engine.upscale() with progress callbacks.
   *   5. Convert the output canvas to a blob URL and display it as an overlay.
   */
  const handleUpscaleFrame = useCallback(async () => {
    if (!sessionId || isUpscaling) return;

    // Clear previous upscale results for this frame
    cleanupUpscaledUrl();
    setUpscaledUrl(null);
    setShowUpscaled(false);
    setUpscaleError(null);
    setUpscaleProgress(0);
    setUpscaleTileInfo("");

    // Check WebGPU support
    if (!isWebGPUSupported()) {
      setUpscaleError(
        "WebGPU is not supported in this browser. Please use a recent version of Chrome or Edge.",
      );
      return;
    }

    setIsUpscaling(true);

    try {
      // Initialize engine (lazy — reuse if already loaded)
      if (!engineRef.current?.isReady()) {
        if (engineRef.current) {
          await engineRef.current.dispose();
          engineRef.current = null;
        }
        const engine = new SafmnEngine({ modelPath: MODEL_PATH });
        await engine.init();
        engineRef.current = engine;
      }

      // Load the current frame blob into an offscreen canvas
      const frame = await getFrame(sessionId, selectedFrameIndex);
      if (!frame) {
        throw new Error("Failed to load frame from storage.");
      }

      const bitmap = await createImageBitmap(frame.blob);
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = bitmap.width;
      sourceCanvas.height = bitmap.height;
      const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Failed to get 2D canvas context.");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      // Pre-compute tile grid for progress display
      const tiles = computeTileGrid(sourceCanvas.width, sourceCanvas.height);

      // Run the upscale pipeline
      await engineRef.current.upscale(sourceCanvas, {
        onProgress: (tileIndex, total) => {
          setUpscaleProgress((tileIndex / total) * 100);
          setUpscaleTileInfo(`Tile ${tileIndex} of ${total}`);
        },
        onStatusChange: (status) => {
          if (status === "stitching") {
            setUpscaleTileInfo("Stitching tiles...");
          }
        },
        onTileComplete: () => {},
        onError: (err) => {
          setUpscaleError(err);
          setIsUpscaling(false);
        },
        onComplete: (outputCanvas) => {
          // Convert output canvas to blob URL for display
          outputCanvas.toBlob((blob) => {
            if (blob) {
              cleanupUpscaledUrl();
              const url = URL.createObjectURL(blob);
              upscaledUrlRef.current = url;
              setUpscaledUrl(url);
              setShowUpscaled(true);
            }
            setIsUpscaling(false);
            setUpscaleProgress(100);
            setUpscaleTileInfo("");
          }, "image/png");
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("Device Lost") ||
        msg.includes("device was lost") ||
        msg.includes("GPU")
      ) {
        setUpscaleError(
          `WebGPU device error (${msg}). Your GPU may have run out of memory or the browser lost the device.`,
        );
      } else {
        setUpscaleError(`Upscale failed: ${msg}`);
      }
      setIsUpscaling(false);
    }
  }, [sessionId, selectedFrameIndex, isUpscaling, cleanupUpscaledUrl]);

  // Download upscaled image
  const handleDownloadUpscaled = useCallback(() => {
    if (!upscaledUrl) return;
    const link = document.createElement("a");
    link.download = `upscaled_frame_${selectedFrameIndex + 1}.png`;
    link.href = upscaledUrl;
    link.click();
  }, [upscaledUrl, selectedFrameIndex]);

  // Close upscaled overlay
  const handleCloseUpscaled = useCallback(() => {
    setShowUpscaled(false);
  }, []);

  const timestamp = currentSession
    ? formatTimestamp(
        selectedFrameIndex / (currentSession.fps || 30),
        currentSession.fps || 30,
        selectedFrameIndex
      )
    : "";

  if (extractionStatus === "idle") {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[300px] lg:min-h-[400px]">
        <div className="text-center text-muted-foreground space-y-2">
          <ImageOff className="w-12 h-12 mx-auto opacity-30" />
          <p className="text-sm">Upload a video to begin frame extraction</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex flex-col flex-1 bg-black/95 min-h-[300px] lg:min-h-[400px]",
        isFullscreen && "bg-black"
      )}
      role="region"
      aria-label="Frame viewer"
    >
      {/* Frame info bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-black/80 border-b border-white/10 text-white/80">
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="text-white/60">{timestamp}</span>
          {videoWidth > 0 && videoHeight > 0 && (
            <span className="text-white/40">
              {videoWidth}×{videoHeight}
            </span>
          )}
          {viewerZoom !== 1 && (
            <span className="text-white/40">
              {Math.round(viewerZoom * 100)}%
            </span>
          )}
          {showUpscaled && upscaledUrl && (
            <span className="text-green-400 font-semibold">
              ↑ UPSCALED 4×
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Upscale button */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2 text-xs gap-1.5 font-medium",
              showUpscaled
                ? "text-green-400 hover:text-green-300 hover:bg-green-500/10"
                : "text-white/60 hover:text-white hover:bg-white/10",
            )}
            onClick={handleUpscaleFrame}
            disabled={isUpscaling || !frameUrl}
            aria-label="Upscale current frame 4× with SAFMN"
            title="Upscale current frame 4× with SAFMN (WebGPU)"
          >
            {isUpscaling ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="hidden sm:inline">
                  {upscaleTileInfo || "Upscaling..."}
                </span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Upscale 4×</span>
              </>
            )}
          </Button>
          <div className="w-px h-4 bg-white/20 mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/60 hover:text-white hover:bg-white/10"
            onClick={() => setViewerZoom(viewerZoom - 0.25)}
            aria-label="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/60 hover:text-white hover:bg-white/10"
            onClick={resetViewerZoom}
            aria-label="Reset zoom"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/60 hover:text-white hover:bg-white/10"
            onClick={() => setViewerZoom(viewerZoom + 0.25)}
            aria-label="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
          <div className="w-px h-4 bg-white/20 mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/60 hover:text-white hover:bg-white/10"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Main frame display area */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-2 relative">
        {isLoading && !frameUrl ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-white/40 animate-spin" />
            <span className="text-xs text-white/40">Loading frame...</span>
          </div>
        ) : frameUrl ? (
          <div
            className="relative overflow-hidden flex items-center justify-center"
            style={{
              transform: `scale(${viewerZoom})`,
              transformOrigin: "center center",
              transition: "transform 0.15s ease-out",
            }}
          >
            <img
              ref={imgRef}
              src={frameUrl}
              alt={`Frame ${selectedFrameIndex + 1}`}
              className="max-w-full max-h-full object-contain select-none"
              draggable={false}
              style={{
                imageRendering: viewerZoom > 2 ? "pixelated" : "auto",
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <ImageOff className="w-8 h-8 text-white/30" />
            <span className="text-xs text-white/40">Frame not available</span>
          </div>
        )}

        {/* ─── Upscaled image overlay ─────────────────────────────────────── */}
        {showUpscaled && upscaledUrl && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/90 backdrop-blur-sm">
            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 z-30 h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
              onClick={handleCloseUpscaled}
              aria-label="Close upscaled view"
            >
              <X className="w-4 h-4" />
            </Button>

            {/* Download button */}
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 left-2 z-30 h-8 gap-1.5 text-white/70 hover:text-white hover:bg-white/10"
              onClick={handleDownloadUpscaled}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="text-xs">Download</span>
            </Button>

            {/* Upscaled image — displayed on top of the canvas */}
            <img
              src={upscaledUrl}
              alt={`Upscaled frame ${selectedFrameIndex + 1}`}
              className="max-w-full max-h-full object-contain select-none"
              draggable={false}
              style={{
                imageRendering: viewerZoom > 2 ? "pixelated" : "auto",
              }}
            />

            {/* Info badge */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-green-500/20 px-3 py-1 text-xs font-medium text-green-400 backdrop-blur-sm">
              4× Super-Resolution • SAFMN • WebGPU
            </div>
          </div>
        )}

        {/* ─── Upscaling progress overlay ────────────────────────────────── */}
        {isUpscaling && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/85 backdrop-blur-sm">
            <Loader2 className="w-10 h-10 text-green-400 animate-spin" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-white">
                Upscaling frame {selectedFrameIndex + 1}
              </p>
              <p className="text-xs text-white/50">
                {upscaleTileInfo || "Initializing..."}
              </p>
            </div>
            {/* Progress bar */}
            <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-400 rounded-full transition-all duration-200 ease-out"
                style={{ width: `${upscaleProgress}%` }}
              />
            </div>
            <p className="text-xs text-white/40 font-mono">
              {upscaleProgress.toFixed(1)}%
            </p>
          </div>
        )}

        {/* ─── Upscale error overlay ─────────────────────────────────────── */}
        {upscaleError && !isUpscaling && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 max-w-md">
            <div className="flex items-center gap-2 rounded-lg bg-red-500/15 px-4 py-2 text-sm text-red-400 backdrop-blur-sm border border-red-500/20">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="flex-1">{upscaleError}</span>
              <button
                className="text-xs text-red-400/70 underline hover:no-underline"
                onClick={() => setUpscaleError(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation controls */}
      <div className="flex items-center justify-center gap-2 px-4 py-2 bg-black/80 border-t border-white/10">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
          onClick={goFirstFrame}
          disabled={selectedFrameIndex === 0}
          aria-label="First frame"
          title="First frame (Home)"
        >
          <ChevronsLeft className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
          onClick={goPrevFrame}
          disabled={selectedFrameIndex === 0}
          aria-label="Previous frame"
          title="Previous frame (←)"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center justify-center min-w-[140px] px-3 py-1 rounded-md bg-white/5 text-white/80 text-sm font-mono tabular-nums">
          {selectedFrameIndex + 1} / {totalFrames}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
          onClick={goNextFrame}
          disabled={selectedFrameIndex >= totalFrames - 1}
          aria-label="Next frame"
          title="Next frame (→)"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
          onClick={goLastFrame}
          disabled={selectedFrameIndex >= totalFrames - 1}
          aria-label="Last frame"
          title="Last frame (End)"
        >
          <ChevronsRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Frame scrubber / progress bar */}
      <div className="px-4 pb-2 bg-black/80">
        <input
          type="range"
          min={0}
          max={Math.max(0, totalFrames - 1)}
          value={selectedFrameIndex}
          onChange={(e) => {
            const idx = parseInt(e.target.value, 10);
            useVideoStore.getState().goToFrame(idx);
          }}
          className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
          aria-label={`Scrub to frame. Currently at frame ${selectedFrameIndex + 1} of ${totalFrames}`}
        />
      </div>
    </div>
  );
}
