"use client";

import React, { useState } from "react";
import { useVideoStore, type ExtractionStatus } from "@/store/video-store";
import {
  extractFramesSequential,
  detectVideoMetadata,
  formatDuration,
  formatFileSize,
} from "@/lib/frame-extractor";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Loader2,
  Info,
  Cpu,
  Clock,
  Film,
  HardDrive,
  X,
  AlertTriangle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const FPS_OPTIONS = [
  { value: "1", label: "1 FPS (1 frame/sec)" },
  { value: "5", label: "5 FPS" },
  { value: "10", label: "10 FPS" },
  { value: "15", label: "15 FPS" },
  { value: "24", label: "24 FPS (Cinema)" },
  { value: "30", label: "30 FPS (Standard)" },
  { value: "60", label: "60 FPS (High)" },
];

export function ExtractionControls() {
  const {
    videoFile,
    extractionStatus,
    setExtractionStatus,
    setExtractionProgress,
    setFramesExtracted,
    setEstimatedTotalFrames,
    setExtractionStartTime,
    setExtractionError,
    setExtractionMethod,
    setExtractionAbort,
    cancelExtraction,
    setCurrentSession,
    setTotalFrames,
    setVideoDuration,
    setVideoWidth,
    setVideoHeight,
    videoFps,
    setVideoFps,
  } = useVideoStore();

  const [metadata, setMetadata] = useState<{
    duration: number;
    width: number;
    height: number;
  } | null>(null);
  const [metaError, setMetaError] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  // Clear stale metadata when the selected file changes (adjust-state-during-render).
  const [prevFile, setPrevFile] = useState(videoFile);
  if (videoFile !== prevFile) {
    setPrevFile(videoFile);
    setMetadata(null);
    setMetaError(false);
  }

  // Detect metadata when a video is set. All state updates happen in async callbacks.
  React.useEffect(() => {
    if (!videoFile) return;
    let cancelled = false;
    detectVideoMetadata(videoFile.file)
      .then((meta) => {
        if (!cancelled) setMetadata(meta);
      })
      .catch((err) => {
        console.error("Metadata detection failed:", err);
        if (!cancelled) setMetaError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [videoFile]);

  const loadingMeta = !!videoFile && !metadata && !metaError;
  const estimatedFrames = metadata ? Math.ceil(metadata.duration * videoFps) : 0;

  const handleStartExtraction = async () => {
    if (!videoFile) return;

    const controller = new AbortController();
    setExtractionAbort(controller);
    setWarning(null);
    setExtractionStatus("extracting");
    setExtractionProgress(0);
    setFramesExtracted(0);
    setExtractionStartTime(Date.now());
    setExtractionError(null);
    setExtractionMethod("canvas");

    try {
      await extractFramesSequential(
        videoFile.file,
        videoFps,
        {
          onProgress: (extracted, total) => {
            setFramesExtracted(extracted);
            setEstimatedTotalFrames(total);
            setExtractionProgress(total > 0 ? (extracted / total) * 100 : 0);
          },
          onStatusChange: (status) => {
            setExtractionStatus(status as ExtractionStatus);
          },
          onFrameExtracted: (index) => {
            setFramesExtracted(index + 1);
          },
          onSessionCreated: (session) => {
            setCurrentSession(session);
            setTotalFrames(session.frameCount);
            setVideoDuration(session.duration);
            setVideoWidth(session.width);
            setVideoHeight(session.height);
            setVideoFps(session.fps);
          },
          onError: (error) => {
            setExtractionError(error);
            setExtractionStatus("error");
          },
          onComplete: (_sessionId, frameCount) => {
            setExtractionStatus("completed");
            setTotalFrames(frameCount);
          },
          onWarning: (message) => setWarning(message),
        },
        controller.signal,
      );
    } catch (error) {
      setExtractionError(error instanceof Error ? error.message : "Extraction failed");
      setExtractionStatus("error");
    } finally {
      setExtractionAbort(null);
    }
  };

  if (!videoFile) return null;

  const isExtracting = extractionStatus === "extracting";
  const canStart =
    !!videoFile &&
    !!metadata &&
    (extractionStatus === "idle" ||
      extractionStatus === "error" ||
      extractionStatus === "cancelled");

  return (
    <div className="space-y-4">
      {metadata && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-muted/50 rounded-lg border border-border">
          <Badge variant="secondary" className="gap-1.5 font-normal">
            <Film className="w-3 h-3" />
            {metadata.width}×{metadata.height}
          </Badge>
          <Badge variant="secondary" className="gap-1.5 font-normal">
            <Clock className="w-3 h-3" />
            {formatDuration(metadata.duration)}
          </Badge>
          <Badge variant="secondary" className="gap-1.5 font-normal">
            <HardDrive className="w-3 h-3" />
            {formatFileSize(videoFile.size)}
          </Badge>
          {loadingMeta && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      )}

      {warning && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
        <div className="flex flex-col gap-1.5 flex-1 w-full sm:w-auto">
          <Label className="text-sm font-medium flex items-center gap-1.5">
            Extraction Rate
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-xs">
                  Frames are sampled at this rate (independent of the source video&apos;s
                  true frame rate). Higher rates capture more frames but take longer and
                  use more storage.
                </p>
              </TooltipContent>
            </Tooltip>
          </Label>
          <Select
            value={String(videoFps)}
            onValueChange={(val) => setVideoFps(Number(val))}
            disabled={isExtracting}
          >
            <SelectTrigger className="w-full sm:w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FPS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex items-center gap-2">
                    {opt.label}
                    {metadata && (
                      <span className="text-muted-foreground">
                        (~{Math.ceil(metadata.duration * Number(opt.value)).toLocaleString()} frames)
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isExtracting ? (
          <Button
            onClick={cancelExtraction}
            variant="destructive"
            className="w-full sm:w-auto gap-2"
            size="lg"
          >
            <X className="w-4 h-4" />
            Cancel
          </Button>
        ) : (
          <Button
            onClick={handleStartExtraction}
            disabled={!canStart}
            className="w-full sm:w-auto gap-2"
            size="lg"
          >
            <Play className="w-4 h-4" />
            {metadata ? `Extract ~${estimatedFrames.toLocaleString()} Frames` : "Start Extraction"}
          </Button>
        )}
      </div>

      {metadata && extractionStatus === "idle" && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            Using Canvas API (browser-native)
          </span>
          <span>•</span>
          <span>~{estimatedFrames.toLocaleString()} frames will be stored in IndexedDB</span>
        </div>
      )}
    </div>
  );
}
