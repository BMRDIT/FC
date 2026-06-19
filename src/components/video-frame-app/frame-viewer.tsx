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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
      for (const [, url] of preloadRef.current) {
        URL.revokeObjectURL(url);
      }
      preloadRef.current.clear();
    };
  }, [cleanupUrl]);

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
        </div>
        <div className="flex items-center gap-1">
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
      <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
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
