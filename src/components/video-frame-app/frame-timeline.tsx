"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useVideoStore } from "@/store/video-store";
import { getThumbnail, getFrame } from "@/lib/frame-db";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { SafmnEngine, isWebGPUSupported, DEFAULT_MODEL_PATH } from "@/lib/safmn-engine";
import { Sparkles, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 54;
const GAP = 6;
const ITEM = THUMB_WIDTH + GAP;
const OVERSCAN = 6;

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
      const engine = new SafmnEngine({ modelPath: DEFAULT_MODEL_PATH });
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

interface ThumbnailItemProps {
  sessionId: string;
  frameIndex: number;
  isSelected: boolean;
  onClick: () => void;
}

function ThumbnailItem({ sessionId, frameIndex, isSelected, onClick }: ThumbnailItemProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

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
  const setUpscaleAbort = useVideoStore((s) => s.setUpscaleAbort);

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
        urlRef.current = null;
      }
    };
  }, [sessionId, frameIndex]);

  const handleUpscale = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();

      if (upscalingFrameIndex !== null) return;

      if (upscaleStatus === "completed") {
        setSelectedFrameIndex(frameIndex);
        setShowUpscaledOverlay(true);
        return;
      }

      if (!isWebGPUSupported()) {
        setUpscaleError(
          "WebGPU is not supported in this browser. Please use a recent version of Chrome or Edge.",
        );
        setUpscaleStatus(frameIndex, "error");
        return;
      }

      setSelectedFrameIndex(frameIndex);
      setUpscaleStatus(frameIndex, "processing");
      setUpscalingFrameIndex(frameIndex);
      setUpscaleProgress(0);
      setUpscaleTileInfo("");
      setUpscaleError(null);
      setShowUpscaledOverlay(false);

      const controller = new AbortController();
      setUpscaleAbort(controller);

      const finishTransient = () => {
        setUpscalingFrameIndex(null);
        setUpscaleAbort(null);
      };

      try {
        const engine = await getSharedEngine();
        if (!engine) throw new Error("Failed to initialize SAFMN engine.");
        if (controller.signal.aborted) {
          finishTransient();
          return;
        }

        const frame = await getFrame(sessionId, frameIndex);
        if (!frame) throw new Error("Failed to load frame from storage.");

        const bitmap = await createImageBitmap(frame.blob);
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = bitmap.width;
        sourceCanvas.height = bitmap.height;
        const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          bitmap.close();
          throw new Error("Failed to get 2D canvas context.");
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        await engine.upscale(
          sourceCanvas,
          {
            onProgress: (tileIndex, total) => {
              setUpscaleProgress((tileIndex / total) * 100);
              setUpscaleTileInfo(`Tile ${tileIndex} of ${total}`);
            },
            onStatusChange: (status) => {
              if (status === "stitching") {
                setUpscaleStatus(frameIndex, "stitching");
                setUpscaleTileInfo("Stitching tiles...");
              } else if (status === "cancelled") {
                setUpscaleStatus(frameIndex, "idle");
                finishTransient();
              }
            },
            onTileComplete: () => {},
            onError: (err) => {
              setUpscaleError(err);
              setUpscaleStatus(frameIndex, "error");
              finishTransient();
            },
            onComplete: (outputCanvas) => {
              outputCanvas.toBlob((blob) => {
                if (!blob) {
                  setUpscaleError("Failed to encode the upscaled image.");
                  setUpscaleStatus(frameIndex, "error");
                  finishTransient();
                  return;
                }
                const objectUrl = URL.createObjectURL(blob);
                setUpscaledImageUrl(objectUrl);
                setUpscaledImageFrameIndex(frameIndex);
                setUpscaleStatus(frameIndex, "completed");
                setShowUpscaledOverlay(true);
                setUpscaleProgress(100);
                setUpscaleTileInfo("");
                finishTransient();
              }, "image/png");
            },
          },
          controller.signal,
        );
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
        finishTransient();
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
      setUpscaleAbort,
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
      style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT, marginRight: GAP }}
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

      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] font-mono text-center py-0.5 tabular-nums">
        {frameIndex + 1}
      </div>

      {upscaleStatus === "completed" && (
        <div className="absolute top-0.5 right-0.5 z-10">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400 drop-shadow-md" />
        </div>
      )}

      {upscaleStatus === "error" && (
        <div className="absolute top-0.5 right-0.5 z-10">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 drop-shadow-md" />
        </div>
      )}

      {isThisUpscaling && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
          <Loader2 className="w-4 h-4 text-green-400 animate-spin" />
        </div>
      )}

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
        {upscaleStatus === "error" ? (
          <AlertCircle className="w-3 h-3" />
        ) : (
          <Sparkles className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}

export function FrameTimeline() {
  const { selectedFrameIndex, setSelectedFrameIndex, totalFrames, currentSession, extractionStatus } =
    useVideoStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [containerWidth, setContainerWidth] = useState(800);

  const sessionId = currentSession?.id || "";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { start, end } = useMemo(() => {
    const visibleCount = Math.ceil(containerWidth / ITEM) + OVERSCAN * 2;
    const s = Math.max(0, Math.floor(scrollLeft / ITEM) - OVERSCAN);
    const e = Math.min(totalFrames, s + visibleCount);
    return { start: s, end: Math.max(s, e) };
  }, [scrollLeft, containerWidth, totalFrames]);

  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (containerRef.current) setScrollLeft(containerRef.current.scrollLeft);
    });
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || totalFrames === 0) return;
    const targetScroll = selectedFrameIndex * ITEM - container.clientWidth / 2 + THUMB_WIDTH / 2;
    container.scrollTo({ left: Math.max(0, targetScroll), behavior: "smooth" });
  }, [selectedFrameIndex, totalFrames]);

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

  const leftSpacer = start * ITEM;
  const rightSpacer = Math.max(0, (totalFrames - end) * ITEM);

  return (
    <div className="border-t border-border bg-card/50">
      <div className="flex items-center justify-between px-4 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Timeline</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {selectedFrameIndex + 1} / {totalFrames} frames
        </span>
      </div>

      <div
        ref={containerRef}
        className="flex overflow-x-auto px-4 pb-3 scroll-smooth"
        onScroll={handleScroll}
        style={{ scrollbarWidth: "thin" }}
      >
        {leftSpacer > 0 && <div style={{ width: leftSpacer }} className="shrink-0" />}

        {Array.from({ length: end - start }, (_, i) => {
          const frameIdx = start + i;
          return (
            <ThumbnailItem
              key={frameIdx}
              sessionId={sessionId}
              frameIndex={frameIdx}
              isSelected={frameIdx === selectedFrameIndex}
              onClick={() => setSelectedFrameIndex(frameIdx)}
            />
          );
        })}

        {rightSpacer > 0 && <div style={{ width: rightSpacer }} className="shrink-0" />}
      </div>
    </div>
  );
}
