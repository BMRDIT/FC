"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useVideoStore } from "@/store/video-store";
import { getThumbnail, getThumbnailsForSession } from "@/lib/frame-db";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 54;
const VISIBLE_BUFFER = 5; // Load thumbnails +/- N around selected

interface ThumbnailItemProps {
  sessionId: string;
  frameIndex: number;
  isSelected: boolean;
  onClick: () => void;
}

function ThumbnailItem({ sessionId, frameIndex, isSelected, onClick }: ThumbnailItemProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

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

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative shrink-0 rounded-md overflow-hidden border-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isSelected
          ? "border-primary shadow-lg shadow-primary/20 scale-105"
          : "border-transparent hover:border-muted-foreground/40 hover:scale-102"
      )}
      style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
      aria-label={`Frame ${frameIndex + 1}`}
      aria-pressed={isSelected}
      title={`Frame ${frameIndex + 1}`}
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={`Frame ${frameIndex + 1}`}
          className="w-full h-full object-cover"
          loading="lazy"
          draggable={false}
        />
      ) : (
        <Skeleton className="w-full h-full" />
      )}
      {isSelected && (
        <div className="absolute inset-0 ring-1 ring-primary/30 pointer-events-none" />
      )}
    </button>
  );
}

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

  if (extractionStatus === "idle" || totalFrames === 0) {
    return null;
  }

  return (
    <div className="w-full" role="region" aria-label="Frame timeline">
      {/* Timeline header */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground">
          Timeline
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {selectedFrameIndex + 1} / {totalFrames} frames
        </span>
      </div>

      {/* Scrollable thumbnail strip */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex items-center gap-1.5 px-4 py-3 overflow-x-auto overflow-y-hidden bg-background scrollbar-thin"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "var(--muted-foreground/30) transparent",
        }}
        role="listbox"
        aria-label="Video frames"
      >
        {/* Pre-spacer for virtualization */}
        {displayRange.start > 0 && (
          <div
            className="shrink-0"
            style={{ width: displayRange.start * (THUMB_WIDTH + 6) }}
            aria-hidden
          />
        )}

        {Array.from(
          { length: Math.min(totalFrames, extractionStatus === "completed" ? totalFrames : displayRange.end) - displayRange.start },
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
          }
        )}
      </div>
    </div>
  );
}
