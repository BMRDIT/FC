"use client";

import React, { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, ImageIcon, AlertCircle, FileImage } from "lucide-react";
import { useUpscalerStore } from "@/store/upscaler-store";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/frame-extractor";

const ACCEPTED_IMAGE_TYPES = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/avif": [".avif"],
  "image/bmp": [".bmp"],
  "image/gif": [".gif"],
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export function ImageDropzone() {
  const {
    imageFile,
    setImageFile,
    status,
    error,
    setError,
  } = useUpscalerStore();

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: any[]) => {
      setError(null);

      if (rejectedFiles.length > 0) {
        const rejectionError = rejectedFiles[0]?.errors?.[0];
        if (rejectionError?.code === "file-too-large") {
          setError("File is too large. Maximum size is 100MB.");
        } else if (rejectionError?.code === "file-invalid-type") {
          setError(
            "Unsupported file format. Please upload an image file (PNG, JPEG, WebP, AVIF, BMP, GIF).",
          );
        } else {
          setError("Invalid file. Please try a different image.");
        }
        return;
      }

      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        const objectUrl = URL.createObjectURL(file);

        // Load image to get dimensions.
        const img = new Image();
        img.onload = () => {
          setImageFile({
            file,
            objectUrl,
            name: file.name,
            size: file.size,
            type: file.type,
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
        };
        img.onerror = () => {
          setError("Failed to load image. The file may be corrupted.");
          URL.revokeObjectURL(objectUrl);
        };
        img.src = objectUrl;
      }
    },
    [setImageFile, setError],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      onDrop,
      accept: ACCEPTED_IMAGE_TYPES,
      maxFiles: 1,
      maxSize: MAX_FILE_SIZE,
      disabled: status === "processing" || status === "loading-model",
    });

  const isDisabled = status === "processing" || status === "loading-model";

  return (
    <div
      {...getRootProps()}
      className={cn(
        "relative flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors",
        isDragActive && !isDragReject
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/50",
        isDragReject && "border-destructive bg-destructive/5",
        isDisabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input {...getInputProps()} />

      {imageFile && !isDragActive ? (
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
            <FileImage className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-foreground">{imageFile.name}</p>
            <p className="text-sm text-muted-foreground">
              {formatFileSize(imageFile.size)} • {imageFile.width}×{imageFile.height}px • {" "}
              {imageFile.type.split("/")[1].toUpperCase()}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Drop another image to replace
          </p>
        </div>
      ) : isDragActive && isDragReject ? (
        <div className="flex flex-col items-center gap-3">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div>
            <p className="font-medium text-destructive">Unsupported file format</p>
            <p className="text-sm text-muted-foreground">
              Please upload an image file (PNG, JPEG, WebP, AVIF, BMP, GIF)
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            {isDragActive ? (
              <Upload className="h-8 w-8 text-primary" />
            ) : (
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <div>
            <p className="font-medium text-foreground">
              {isDragActive ? "Drop your image here" : "Upload an Image"}
            </p>
            <p className="text-sm text-muted-foreground">
              Drag and drop an image file here, or click to browse. Supported
              formats: PNG, JPEG, WebP, AVIF, BMP, GIF.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Up to 100MB • 4× super-resolution runs entirely in your browser via WebGPU
          </p>
        </div>
      )}

      {error && (
        <div
          className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive"
          onClick={(e) => e.stopPropagation()}
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <button
            className="ml-2 text-xs underline hover:no-underline"
            onClick={(e) => {
              e.stopPropagation();
              setError(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
