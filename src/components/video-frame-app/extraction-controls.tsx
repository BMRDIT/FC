"use client";

import React, { useState } from "react";
import { useVideoStore } from "@/store/video-store";
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
  const [loadingMeta, setLoadingMeta] = useState(false);

  // Detect metadata when video is set
  React.useEffect(() => {
    if (!videoFile) {
      // Defer to avoid calling setState synchronously in effect body
      const clear = () => setMetadata(null);
      clear();
      return;
    }

    let cancelled = false;
    const setMeta = () => setLoadingMeta(true);
    setMeta();
    detectVideoMetadata(videoFile.file)
      .then((meta) => {
        if (!cancelled) setMetadata(meta);
      })
      .catch((err) => {
        console.error("Metadata detection failed:", err);
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false);
      });

    return () => {
      cancelled = true;
    };
  }, [videoFile]);

  const estimatedFrames = metadata
    ? Math.ceil(metadata.duration * videoFps)
    : 0;

  const handleStartExtraction = async () => {
    if (!videoFile) return;

    setExtractionStatus("extracting");
    setExtractionProgress(0);
    setFramesExtracted(0);
    setExtractionStartTime(Date.now());
    setExtractionError(null);
    setExtractionMethod("canvas");

    try {
      await extractFramesSequential(videoFile.file, videoFps, {
        onProgress: (extracted, total) => {
          setFramesExtracted(extracted);
          setEstimatedTotalFrames(total);
          setExtractionProgress((extracted / total) * 100);
        },
        onStatusChange: (status) => {
          setExtractionStatus(status as any);
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
      });
    } catch (error) {
      setExtractionError(
        error instanceof Error ? error.message : "Extraction failed"
      );
      setExtractionStatus("error");
    }
  };

  if (!videoFile) return null;

  const canStart =
    videoFile &&
    metadata &&
    (extractionStatus === "idle" || extractionStatus === "error");

  return (
    <div className="space-y-4">
      {/* Video metadata display */}
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

      {/* FPS selector & extraction settings */}
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
                  Higher FPS captures more frames per second but takes longer
                  to process. Choose based on your needs.
                </p>
              </TooltipContent>
            </Tooltip>
          </Label>
          <Select
            value={String(videoFps)}
            onValueChange={(val) => setVideoFps(Number(val))}
            disabled={extractionStatus === "extracting"}
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

        <Button
          onClick={handleStartExtraction}
          disabled={!canStart}
          className="w-full sm:w-auto gap-2"
          size="lg"
        >
          {extractionStatus === "extracting" ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Extracting...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              {metadata
                ? `Extract ~${estimatedFrames.toLocaleString()} Frames`
                : "Start Extraction"}
            </>
          )}
        </Button>
      </div>

      {/* Estimated info */}
      {metadata && extractionStatus === "idle" && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            Using Canvas API (browser-native)
          </span>
          <span>•</span>
          <span>
            ~{estimatedFrames.toLocaleString()} frames will be stored in
            IndexedDB
          </span>
        </div>
      )}
    </div>
  );
}
