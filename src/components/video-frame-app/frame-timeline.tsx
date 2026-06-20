"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useVideoStore } from "@/store/video-store";
import { getThumbnail, getFrame } from "@/lib/frame-db";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SafmnEngine,
  isWebGPUSupported,
} from "@/lib/safmn-engine";
import { Sparkles, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 54;
const VISIBLE_BUFFER = 5; // Load thumbnails +/- N around selected

/** Path to the SAFMN ONNX model — served from the public directory. */
const MODEL_PATH = "/models/safmn_4x.onnx";

// ─── Shared engine singleton ──────────────────────────────────────────────────
// A single SafmnEngine instance shared across all ThumbnailItem components
// so the ONNX session is loaded once and reused for every frame.
let sharedEngine: SafmnEngine | null = null;
let engineInitPromise: Promise<SafmnEngine | null> | null = null;

async function getSharedEngine(): Promise<SafmnEngine | null> {
  if (sharedEngine?.isReady()) return sharedEngine;
  if (engineInitPromise) return engineInitPromise;

  engineInitPromise = (async () => {
    try {
      if (sharedEngine) {
        await sharedEngine.dispose();
        sharedEngine = null;
      }
      const engine = new SafmnEngine({ modelPath: MODEL_PATH });
      await engine.init();
      sharedEngine = engine;
      return engine;
    } catch (err) {
      sharedEngine = null;
      engineInitPromise = null;
      throw err;
    }
  })();

  return engineInitPromise;
}

// ─── ThumbnailItem ────────────────────────────────────────────────────────────

interface ThumbnailItemProps {
  sessionId: string;
  frameIndex: number;
  isSelected: boolean;
  onClick: () => void;
}

function ThumbnailItem({ sessionId, frameIndex, isSelected, onClick }: ThumbnailItemProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  // Upscale state from the store
  const upscaleStatus = useVideoStore((s) => s.upscaleStatusMap[frameIndex] || "idle");
  const upscalingFrameIndex = useVideoStore((s) => s.upscalingFrameIndex);
  const setSelectedFrameIndex = useVideoStore((s) => s.setSelectedFrameIndex);
  const setUpscaleStatus = useVideoStore((s) => s.setUpscaleStatus);
  const setUpscalingFrameIndex = useVideoStore((s) => s.setUpscalingFrameIndex);
  const setUpscaleProgress = useVideoStore((s) => s.setUpscaleProgress);
  const setUpscaleTileInfo = useVideoStore((s) => s.setUpscaleTileInfo);
  const setUpscaledImageUrl = useVideoStore((s) => s.setUpscaledImageUrl);
  const setUpscaledImageFrameIndex = useVideoStore((s) => s.setUpscaledImageFrameIndex);
  const setShowUpscaledOverlay = useVideoStore((s) => s.setShowUpscaledOverlay);
  const setUpscaleError = useVideoStore((s) => s.setUpscaleError);

  useEffect(() => {
    let cancelled = false;

    const loadThumb = async () => {
      try {
        const thumb = await getThumbnail(sessionId, frameIndex);
        if (thumb && !cancelled) {
          const url = URL.createObjectURL(thumb.blob);
          urlRef.current = url;
          setThumbUrl(url);
        }
      } catch {
        // Thumbnail not available yet
      }
    };

    loadThumb();

    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
    };
  }, [sessionId, frameIndex]);

  /**
   * Upscale this specific frame using the SAFMN WebGPU engine.
   * The result is stored in the shared store so the FrameViewer can
   * display it as an overlay on top of the canvas.
   */
  const handleUpscale = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();

      // Don't allow concurrent upscales
      if (upscalingFrameIndex !== null) return;

      // If already upscaled, just show the result
      if (upscaleStatus === "completed") {
        setSelectedFrameIndex(frameIndex);
        setShowUpscaledOverlay(true);
        return;
      }

      // Check WebGPU support
      if (!isWebGPUSupported()) {
        setUpscaleError(
          "WebGPU is not supported in this browser. Please use a recent version of Chrome or Edge.",
        );
        setUpscaleStatus(frameIndex, "error");
        return;
      }

      // Select this frame so the viewer shows it
      setSelectedFrameIndex(frameIndex);
      setUpscaleStatus(frameIndex, "processing");
      setUpscalingFrameIndex(frameIndex);
      setUpscaleProgress(0);
      setUpscaleTileInfo("");
      setUpscaleError(null);
      setShowUpscaledOverlay(false);

      try {
        const engine = await getSharedEngine();
        if (!engine) throw new Error("Failed to initialize SAFMN engine.");

        // Load the full-resolution frame blob
        const frame = await getFrame(sessionId, frameIndex);
        if (!frame) throw new Error("Failed to load frame from storage.");

        const bitmap = await createImageBitmap(frame.blob);
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = bitmap.width;
        sourceCanvas.height = bitmap.height;
        const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Failed to get 2D canvas context.");
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        // Run the upscale pipeline
        await engine.upscale(sourceCanvas, {
          onProgress: (tileIndex, total) => {
            setUpscaleProgress((tileIndex / total) * 100);
            setUpscaleTileInfo(`Tile ${tileIndex} of ${total}`);
          },
          onStatusChange: (status) => {
            if (status === "stitching") {
              setUpscaleStatus(frameIndex, "stitching");
              setUpscaleTileInfo("Stitching tiles...");
            }
          },
          onTileComplete: () => {},
          onError: (err) => {
            setUpscaleError(err);
            setUpscaleStatus(frameIndex, "error");
            setUpscalingFrameIndex(null);
          },
          onComplete: (outputCanvas) => {
            // Convert output canvas to data URL for display
            const dataUrl = outputCanvas.toDataURL("image/png");
            setUpscaledImageUrl(dataUrl);
            setUpscaledImageFrameIndex(frameIndex);
            setUpscaleStatus(frameIndex, "completed");
            setShowUpscaledOverlay(true);
            setUpscalingFrameIndex(null);
            setUpscaleProgress(100);
            setUpscaleTileInfo("");
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
        setUpscaleStatus(frameIndex, "error");
        setUpscalingFrameIndex(null);
      }
    },
    [
      frameIndex,
      sessionId,
      upscalingFrameIndex,
      upscaleStatus,
      setSelectedFrameIndex,
      setUpscaleStatus,
      setUpscalingFrameIndex,
      setUpscaleProgress,
      setUpscaleTileInfo,
      setUpscaledImageUrl,
      setUpscaledImageFrameIndex,
      setShowUpscaledOverlay,
      setUpscaleError,
    ],
  );

  const isThisUpscaling = upscalingFrameIndex === frameIndex;
  const isAnyUpscaling = upscalingFrameIndex !== null;

  return (
    <div
      className={cn(
        "relative shrink-0 cursor-pointer rounded-md overflow-hidden border-2 transition-all group",
        isSelected
          ? "border-primary ring-2 ring-primary/30"
          : "border-transparent hover:border-white/20",
      )}
      style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
      onClick={onClick}
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={`Frame ${frameIndex + 1}`}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <Skeleton className="w-full h-full" />
      )}

      {/* Frame index label */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] font-mono text-center py-0.5 tabular-nums">
        {frameIndex + 1}
      </div>

      {/* Completed badge */}
      {upscaleStatus === "completed" && (
        <div className="absolute top-0.5 right-0.5 z-10">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400 drop-shadow-md" />
        </div>
      )}

      {/* Error badge */}
      {upscaleStatus === "error" && (
        <div className="absolute top-0.5 right-0.5 z-10">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 drop-shadow-md" />
        </div>
      )}

      {/* Processing spinner overlay */}
      {isThisUpscaling && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
          <Loader2 className="w-4 h-4 text-green-400 animate-spin" />
        </div>
      )}

      {/* Enhance button — appears on hover, or when completed/error */}
      <button
        className={cn(
          "absolute top-0.5 left-0.5 z-10 flex items-center justify-center rounded-full transition-all",
          upscaleStatus === "completed"
            ? "bg-green-500/90 text-white opacity-100"
            : upscaleStatus === "error"
              ? "bg-red-500/90 text-white opacity-100"
              : "bg-black/70 text-white/80 opacity-0 group-hover:opacity-100",
          isThisUpscaling && "opacity-0 pointer-events-none",
          isAnyUpscaling && !isThisUpscaling && "opacity-0 pointer-events-none",
        )}
        style={{ width: 20, height: 20 }}
        onClick={handleUpscale}
        disabled={isAnyUpscaling}
        aria-label={`Enhance frame ${frameIndex + 1}`}
        title={
          upscaleStatus === "completed"
            ? "Show upscaled result"
            : upscaleStatus === "error"
              ? "Retry enhance"
              : `Enhance frame ${frameIndex + 1} (4× SAFMN)`
        }
      >
        {upscaleStatus === "completed" ? (
          <Sparkles className="w-3 h-3" />
        ) : upscaleStatus === "error" ? (
          <AlertCircle className="w-3 h-3" />
        ) : (
          <Sparkles className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}

// ─── FrameTimeline ────────────────────────────────────────────────────────────

export function FrameTimeline() {
  const {
    selectedFrameIndex,
    setSelectedFrameIndex,
    totalFrames,
    currentSession,
    extractionStatus,
  } = useVideoStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState<{
    start: number;
    end: number;
  }>({ start: 0, end: 50 });

  const sessionId = currentSession?.id || "";

  // Calculate visible range based on total frames
  const displayRange = useMemo(() => {
    const maxVisible = 200; // Max thumbnails to render in DOM at once
    const start = Math.max(0, selectedFrameIndex - VISIBLE_BUFFER);
    const end = Math.min(totalFrames, selectedFrameIndex + maxVisible - VISIBLE_BUFFER);
    return { start, end: Math.max(start, end) };
  }, [selectedFrameIndex, totalFrames]);

  // Auto-scroll to keep selected frame visible
  useEffect(() => {
    if (!containerRef.current || totalFrames === 0) return;

    const container = containerRef.current;
    const thumbWidth = THUMB_WIDTH + 6; // width + gap
    const targetScroll =
      selectedFrameIndex * thumbWidth - container.clientWidth / 2 + thumbWidth / 2;

    container.scrollTo({
      left: Math.max(0, targetScroll),
      behavior: "smooth",
    });
  }, [selectedFrameIndex, totalFrames]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const scrollLeft = container.scrollLeft;
    const thumbWidth = THUMB_WIDTH + 6;
    const startIdx = Math.max(0, Math.floor(scrollLeft / thumbWidth) - 10);
    const endIdx = startIdx + 300;
    setVisibleRange({ start: startIdx, end: Math.min(endIdx, totalFrames) });
  }, [totalFrames]);

  // Dispose shared engine on unmount to free GPU resources.
  useEffect(() => {
    return () => {
      if (sharedEngine) {
        sharedEngine.dispose().catch(() => {});
        sharedEngine = null;
        engineInitPromise = null;
      }
    };
  }, []);

  if (extractionStatus === "idle" || totalFrames === 0) {
    return null;
  }

  return (
    <div className="border-t border-border bg-card/50">
      {/* Timeline header */}
      <div className="flex items-center justify-between px-4 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Timeline</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {selectedFrameIndex + 1} / {totalFrames} frames
        </span>
      </div>

      {/* Scrollable thumbnail strip */}
      <div
        ref={containerRef}
        className="flex gap-1.5 overflow-x-auto px-4 pb-3 scroll-smooth"
        onScroll={handleScroll}
        style={{ scrollbarWidth: "thin" }}
      >
        {/* Pre-spacer for virtualization */}
        {displayRange.start > 0 && (
          <div style={{ width: displayRange.start * (THUMB_WIDTH + 6) }} className="shrink-0" />
        )}

        {Array.from(
          {
            length:
              Math.min(
                totalFrames,
                extractionStatus === "completed" ? totalFrames : displayRange.end,
              ) - displayRange.start,
          },
          (_, i) => {
            const frameIdx = displayRange.start + i;
            return (
              <ThumbnailItem
                key={frameIdx}
                sessionId={sessionId}
                frameIndex={frameIdx}
                isSelected={frameIdx === selectedFrameIndex}
                onClick={() => setSelectedFrameIndex(frameIdx)}
              />
            );
          },
        )}
      </div>
    </div>
  );
}
