"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useUpscalerStore } from "@/store/upscaler-store";
import { MoveHorizontal } from "lucide-react";

/**
 * Before/after comparison slider.
 *
 * Displays the original image on the left and the upscaled image on the right,
 * with a draggable divider. The slider position is stored in the Zustand store
 * so it persists across re-renders.
 */
export function UpscalerComparison() {
  const {
    imageFile,
    outputDataUrl,
    outputWidth,
    outputHeight,
    sliderPosition,
    setSliderPosition,
  } = useUpscalerStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerMove = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const pct = (x / rect.width) * 100;
      setSliderPosition(pct);
    },
    [setSliderPosition],
  );

  // Global pointer handlers for smooth dragging even outside the container.
  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: PointerEvent) => {
      handlePointerMove(e.clientX);
    };
    const onUp = () => setIsDragging(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDragging, handlePointerMove]);

  if (!imageFile || !outputDataUrl) return null;

  // The upscaled image is 4× the original. We display both at the same
  // visual size so the comparison is meaningful (pixel-for-pixel quality).
  // The container width is driven by the panel; both images scale to fit.
  const aspectRatio = outputWidth / outputHeight;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Comparison</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-muted-foreground" />
            Original
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Upscaled 4×
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full select-none overflow-hidden rounded-xl border border-border bg-muted/30"
        style={{ aspectRatio: String(aspectRatio) }}
        onPointerDown={(e) => {
          setIsDragging(true);
          handlePointerMove(e.clientX);
        }}
      >
        {/* Upscaled image (full, as background layer) */}
        <img
          src={outputDataUrl}
          alt="Upscaled"
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />

        {/* Original image (clipped to left of slider) */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${sliderPosition}%` }}
        >
          <img
            src={imageFile.objectUrl}
            alt="Original"
            className="absolute inset-0 h-full w-full object-contain"
            style={{ width: `${(100 / Math.max(0.1, sliderPosition)) * 100}%` }}
            draggable={false}
          />
        </div>

        {/* Slider divider line + handle */}
        <div
          className="absolute top-0 bottom-0 z-10 w-0.5 bg-foreground/80"
          style={{ left: `${sliderPosition}%`, transform: "translateX(-50%)" }}
        >
          <div className="absolute top-1/2 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-foreground bg-background shadow-md">
            <MoveHorizontal className="h-4 w-4 text-foreground" />
          </div>
        </div>

        {/* Labels */}
        <div className="pointer-events-none absolute top-2 left-2 rounded bg-background/80 px-2 py-1 text-xs font-medium text-foreground backdrop-blur-sm">
          Original {imageFile.width}×{imageFile.height}
        </div>
        <div className="pointer-events-none absolute top-2 right-2 rounded bg-background/80 px-2 py-1 text-xs font-medium text-foreground backdrop-blur-sm">
          Upscaled {outputWidth}×{outputHeight}
        </div>
      </div>

      {/* Slider control below the image */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">Original</span>
        <input
          type="range"
          min={0}
          max={100}
          value={sliderPosition}
          onChange={(e) => setSliderPosition(Number(e.target.value))}
          className="flex-1 cursor-pointer accent-primary"
        />
        <span className="text-xs text-muted-foreground">Upscaled</span>
      </div>
    </div>
  );
}
