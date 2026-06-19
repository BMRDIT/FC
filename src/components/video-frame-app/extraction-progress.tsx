"use client";

import React from "react";
import { useVideoStore } from "@/store/video-store";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, XCircle, Cpu, Timer } from "lucide-react";
import { formatDuration } from "@/lib/frame-extractor";
import { Button } from "@/components/ui/button";

export function ExtractionProgress() {
  const {
    extractionStatus,
    extractionProgress,
    framesExtracted,
    estimatedTotalFrames,
    extractionStartTime,
    extractionError,
    extractionMethod,
    setExtractionStatus,
  } = useVideoStore();

  if (extractionStatus === "idle" || extractionStatus === "loading") {
    return null;
  }

  const elapsed = extractionStartTime
    ? (Date.now() - extractionStartTime) / 1000
    : 0;
  const fps = framesExtracted > 0 ? framesExtracted / elapsed : 0;
  const estimatedRemaining =
    fps > 0 ? (estimatedTotalFrames - framesExtracted) / fps : 0;

  return (
    <div className="w-full" role="status" aria-live="polite">
      {extractionStatus === "extracting" && (
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm font-medium">Extracting Frames...</span>
            </div>
            <div className="flex items-center gap-1.5">
              {extractionMethod && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-xs text-muted-foreground">
                  <Cpu className="w-3 h-3" />
                  {extractionMethod.toUpperCase()}
                </span>
              )}
            </div>
          </div>

          <Progress value={extractionProgress} className="h-2" />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">
              {framesExtracted.toLocaleString()} / {estimatedTotalFrames.toLocaleString()} frames
            </span>
            <span className="tabular-nums">{extractionProgress.toFixed(1)}%</span>
          </div>

          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="space-y-1">
              <div className="text-lg font-semibold tabular-nums">
                {framesExtracted.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">Frames</div>
            </div>
            <div className="space-y-1">
              <div className="text-lg font-semibold tabular-nums">
                {fps > 0 ? fps.toFixed(1) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">Frames/sec</div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-center gap-1">
                <Timer className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-lg font-semibold tabular-nums">
                  {estimatedRemaining > 0
                    ? formatDuration(estimatedRemaining)
                    : "—"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">Remaining</div>
            </div>
          </div>
        </div>
      )}

      {extractionStatus === "completed" && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800/50">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
              Extraction Complete
            </p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
              {framesExtracted.toLocaleString()} frames extracted in{" "}
              {formatDuration(elapsed)}
            </p>
          </div>
        </div>
      )}

      {extractionStatus === "error" && (
        <div className="flex items-start gap-3 p-4 bg-destructive/5 rounded-lg border border-destructive/20">
          <XCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 space-y-2">
            <div>
              <p className="text-sm font-medium text-destructive">
                Extraction Failed
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {extractionError || "An unknown error occurred"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setExtractionStatus("idle")}
            >
              Try Again
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
