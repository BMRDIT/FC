"use client";

import React, { useCallback } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Upload, Film, AlertCircle, FileVideo } from "lucide-react";
import { useVideoStore } from "@/store/video-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatFileSize } from "@/lib/frame-extractor";

const ACCEPTED_VIDEO_TYPES = {
  "video/mp4": [".mp4", ".m4v"],
  "video/webm": [".webm"],
  "video/quicktime": [".mov"],
  "video/x-msvideo": [".avi"],
  "video/x-matroska": [".mkv"],
  "video/x-flv": [".flv"],
  "video/x-ms-wmv": [".wmv"],
  "video/mpeg": [".mpeg", ".mpg"],
  "video/ogg": [".ogv"],
  "video/3gpp": [".3gp"],
};

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

export function VideoUpload() {
  const {
    videoFile,
    setVideoFile,
    extractionStatus,
    extractionError,
    setExtractionError,
  } = useVideoStore();

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      setExtractionError(null);

      if (rejectedFiles.length > 0) {
        const error = rejectedFiles[0]?.errors?.[0];
        if (error?.code === "file-too-large") {
          setExtractionError("File is too large. Maximum size is 5GB.");
        } else if (error?.code === "file-invalid-type") {
          setExtractionError(
            "Unsupported file format. Please upload a video file (MP4, WebM, MOV, AVI, MKV).",
          );
        } else {
          setExtractionError("Invalid file. Please try a different video.");
        }
        return;
      }

      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        const objectUrl = URL.createObjectURL(file);
        setVideoFile({
          file,
          objectUrl,
          name: file.name,
          size: file.size,
          type: file.type,
        });
      }
    },
    [setVideoFile, setExtractionError],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPTED_VIDEO_TYPES,
    maxFiles: 1,
    maxSize: MAX_FILE_SIZE,
    disabled: extractionStatus === "extracting",
  });

  const isDisabled = extractionStatus === "extracting";

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className={cn(
          "relative flex flex-col items-center justify-center w-full min-h-[320px] lg:min-h-[400px] border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer group",
          isDragActive && !isDragReject && "border-primary bg-primary/5 scale-[1.01]",
          isDragReject && "border-destructive bg-destructive/5",
          !isDragActive && !isDisabled && "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50",
          isDisabled && "opacity-50 cursor-not-allowed border-muted",
          videoFile && !isDragActive && "border-primary/30 bg-primary/5",
        )}
        role="button"
        aria-label="Upload video file by clicking or dragging"
        tabIndex={0}
      >
        <input {...getInputProps()} />

        {videoFile && !isDragActive ? (
          <div className="flex flex-col items-center gap-4 p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <FileVideo className="w-8 h-8 text-primary" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-foreground truncate max-w-md">
                {videoFile.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {formatFileSize(videoFile.size)} •{" "}
                {(videoFile.type.split("/")[1] || "video").toUpperCase()}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Drop another video to replace
            </p>
          </div>
        ) : isDragActive && isDragReject ? (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
            <p className="text-lg font-medium text-destructive">
              Unsupported file format
            </p>
            <p className="text-sm text-muted-foreground">
              Please upload a video file (MP4, WebM, MOV, AVI, MKV)
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 p-6 text-center">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
              <Upload className="w-10 h-10 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-foreground">
                {isDragActive ? "Drop your video here" : "Upload a Video"}
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Drag and drop a video file here, or click to browse. Supported
                formats: MP4, WebM, MOV, AVI, MKV, and more.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Film className="w-3.5 h-3.5" />
              <span>Up to 5GB • All frames will be extracted locally</span>
            </div>
          </div>
        )}
      </div>

      {extractionError && (
        <div className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{extractionError}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              setExtractionError(null);
            }}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
