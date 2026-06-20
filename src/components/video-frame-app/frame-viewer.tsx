"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useVideoStore } from "@/store/video-store";
import { getFrame } from "@/lib/frame-db";
import { formatTimestamp } from "@/lib/frame-extractor";
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
    goNextFrame,
    goPrevFrame,
    goFirstFrame,
    goLastFrame,
    upscalingFrameIndex,
    upscaleProgress,
    upscaleTileInfo,
    upscaledImageUrl,
    upscaledImageFrameIndex,
    upscaleError,
    showUpscaledOverlay,
    setShowUpscaledOverlay,
    setUpscaleError,
    cancelUpscale,
    clearAllUpscale,
  } = useVideoStore();

  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const cacheRef = useRef<Map<number, string>>(new Map());
  const prevSessionRef = useRef<string>(currentSession?.id || "");
  const PRELOAD_AHEAD = 3;
  const KEEP_RANGE = 10;

  const sessionId = currentSession?.id || "";

  const hasUpscaledForCurrentFrame = !!(
    upscaledImageUrl && upscaledImageFrameIndex === selectedFrameIndex
  );
  const isCurrentFrameUpscaling = upscalingFrameIndex === selectedFrameIndex;

  const [prevSession, setPrevSession] = useState(sessionId);
  if (sessionId !== prevSession) {
    setPrevSession(sessionId);
    setFrameUrl(null);
  }

  const flushCache = useCallback(() => {
    for (const url of cacheRef.current.values()) URL.revokeObjectURL(url);
    cacheRef.current.clear();
  }, []);

  useEffect(() => {
    if (
      upscaledImageFrameIndex !== null &&
      upscaledImageFrameIndex !== selectedFrameIndex
    ) {
      setShowUpscaledOverlay(false);
    }
  }, [selectedFrameIndex, upscaledImageFrameIndex, setShowUpscaledOverlay]);

  useEffect(() => {
    if (
      !sessionId ||
      extractionStatus === "idle" ||
      extractionStatus === "extracting"
    ) {
      return;
    }

    let cancelled = false;
    const cache = cacheRef.current;

    if (prevSessionRef.current !== sessionId) {
      flushCache();
      prevSessionRef.current = sessionId;
    }

    const urlFor = async (index: number): Promise<string | null> => {
      const cached = cache.get(index);
      if (cached) return cached;
      const frame = await getFrame(sessionId, index);
      if (!frame) return null;
      const url = URL.createObjectURL(frame.blob);
      cache.set(index, url);
      return url;
    };

    const run = async () => {
      setIsLoading(true);
      try {
        const url = await urlFor(selectedFrameIndex);
        if (cancelled) return;
        setFrameUrl(url);

        for (let offset = 1; offset <= PRELOAD_AHEAD; offset++) {
          const idx = selectedFrameIndex + offset;
          if (idx < totalFrames && !cache.has(idx)) {
            try {
              await urlFor(idx);
            } catch {
              /* ignore prefetch errors */
            }
          }
        }

        for (const idx of Array.from(cache.keys())) {
          if (Math.abs(idx - selectedFrameIndex) > KEEP_RANGE) {
            const old = cache.get(idx);
            if (old) URL.revokeObjectURL(old);
            cache.delete(idx);
          }
        }
      } catch {
        if (!cancelled) setFrameUrl(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [sessionId, selectedFrameIndex, extractionStatus, totalFrames, flushCache]);

  useEffect(() => {
    return () => {
      flushCache();
      clearAllUpscale();
    };
  }, [flushCache, clearAllUpscale]);

  useEffect(() => {
    if (extractionStatus !== "completed") return;

    const handleKeyDown = (e: KeyboardEvent) => {
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
          setViewerZoom(useVideoStore.getState().viewerZoom + 0.25);
          break;
        case "-":
        case "_":
          e.preventDefault();
          setViewerZoom(useVideoStore.getState().viewerZoom - 0.25);
          break;
        case "0":
          e.preventDefault();
          resetViewerZoom();
          break;
        case "Escape":
          if (useVideoStore.getState().showUpscaledOverlay) {
            e.preventDefault();
            setShowUpscaledOverlay(false);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    extractionStatus,
    goNextFrame,
    goPrevFrame,
    goFirstFrame,
    goLastFrame,
    setViewerZoom,
    resetViewerZoom,
    setShowUpscaledOverlay,
  ]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const handleDownloadUpscaled = useCallback(() => {
    if (!upscaledImageUrl) return;
    const link = document.createElement("a");
    link.download = `upscaled_frame_${(upscaledImageFrameIndex ?? 0) + 1}.png`;
    link.href = upscaledImageUrl;
    link.click();
  }, [upscaledImageUrl, upscaledImageFrameIndex]);

  const handleCloseUpscaled = useCallback(() => {
    setShowUpscaledOverlay(false);
  }, [setShowUpscaledOverlay]);

  const handleShowUpscaled = useCallback(() => {
    if (hasUpscaledForCurrentFrame) {
      setShowUpscaledOverlay(true);
    }
  }, [hasUpscaledForCurrentFrame, setShowUpscaledOverlay]);

  const timestamp = currentSession
    ? formatTimestamp(
        selectedFrameIndex / (currentSession.fps || 30),
        currentSession.fps || 30,
        selectedFrameIndex,
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
        isFullscreen && "bg-black",
      )}
      role="region"
      aria-label="Frame viewer"
    >
      <div className="flex items-center justify-between px-3 py-1.5 bg-black/80 border-b border-white/10 text-white/80">
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="text-white/60">{timestamp}</span>
          {videoWidth > 0 && videoHeight > 0 && (
            <span className="text-white/40">
              {videoWidth}×{videoHeight}
            </span>
          )}
          {viewerZoom !== 1 && (
            <span className="text-white/40">{Math.round(viewerZoom * 100)}%</span>
          )}
          {showUpscaledOverlay && hasUpscaledForCurrentFrame && (
            <span className="text-green-400 font-semibold">↑ UPSCALED 4×</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasUpscaledForCurrentFrame && !showUpscaledOverlay && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1.5 font-medium text-green-400 hover:text-green-300 hover:bg-green-500/10"
              onClick={handleShowUpscaled}
              aria-label="Show upscaled result"
              title="Show upscaled 4× result"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Show 4×</span>
            </Button>
          )}
          {isCurrentFrameUpscaling && (
            <span className="flex items-center gap-1.5 text-xs text-green-400 px-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="hidden sm:inline">{upscaleTileInfo || "Upscaling..."}</span>
            </span>
          )}
          {hasUpscaledForCurrentFrame && (showUpscaledOverlay || isCurrentFrameUpscaling) && (
            <div className="w-px h-4 bg-white/20 mx-1" />
          )}
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

        {showUpscaledOverlay && hasUpscaledForCurrentFrame && upscaledImageUrl && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/90 backdrop-blur-sm">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 z-30 h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
              onClick={handleCloseUpscaled}
              aria-label="Close upscaled view"
            >
              <X className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 left-2 z-30 h-8 gap-1.5 text-white/70 hover:text-white hover:bg-white/10"
              onClick={handleDownloadUpscaled}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="text-xs">Download</span>
            </Button>

            <img
              src={upscaledImageUrl}
              alt={`Upscaled frame ${selectedFrameIndex + 1}`}
              className="max-w-full max-h-full object-contain select-none"
              draggable={false}
              style={{
                imageRendering: viewerZoom > 2 ? "pixelated" : "auto",
              }}
            />

            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-green-500/20 px-3 py-1 text-xs font-medium text-green-400 backdrop-blur-sm">
              4× Super-Resolution • SAFMN • WebGPU • Frame {selectedFrameIndex + 1}
            </div>
          </div>
        )}

        {isCurrentFrameUpscaling && (
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
            <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-400 rounded-full transition-all duration-200 ease-out"
                style={{ width: `${upscaleProgress}%` }}
              />
            </div>
            <p className="text-xs text-white/40 font-mono">
              {upscaleProgress.toFixed(1)}%
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-white/70 hover:text-white hover:bg-white/10"
              onClick={cancelUpscale}
              aria-label="Cancel upscale"
            >
              <X className="w-3.5 h-3.5" />
              <span className="text-xs">Cancel</span>
            </Button>
          </div>
        )}

        {upscaleError && !isCurrentFrameUpscaling && (
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
