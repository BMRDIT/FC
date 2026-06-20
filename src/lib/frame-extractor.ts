import {
  storeFrame,
  storeThumbnail,
  createSession,
  updateSession,
  getSession,
} from "@/lib/frame-db";
import type { VideoSession } from "@/lib/frame-db";

export interface ExtractionCallbacks {
  onProgress: (framesExtracted: number, totalFrames: number) => void;
  onStatusChange: (status: string) => void;
  onFrameExtracted: (index: number) => void;
  onSessionCreated: (session: VideoSession) => void;
  onError: (error: string) => void;
  onComplete: (sessionId: string, frameCount: number) => void;
  onWarning?: (message: string) => void;
}

const THUMBNAIL_WIDTH = 160;
const FRAME_EXTRACTION_QUALITY = 0.92;
const THUMBNAIL_QUALITY = 0.7;
const SEEK_TIMEOUT_MS = 15_000;

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export async function detectVideoMetadata(file: File): Promise<{
  duration: number;
  width: number;
  height: number;
}> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const url = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };

    video.onloadedmetadata = () => {
      video.currentTime = 0.1;
    };
    video.onseeked = () => {
      const { duration, videoWidth: width, videoHeight: height } = video;
      cleanup();
      resolve({ duration, width, height });
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Failed to load video metadata"));
    };

    video.src = url;
    video.load();
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number = FRAME_EXTRACTION_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Failed to convert canvas to blob")),
      "image/jpeg",
      quality,
    );
  });
}

function seekTo(video: HTMLVideoElement, timestamp: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out seeking to ${timestamp.toFixed(3)}s`));
    }, SEEK_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Seek failed at ${timestamp.toFixed(3)}s`));
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = timestamp;
  });
}

async function checkStorageBudget(
  estimatedBytes: number,
  onWarning?: (msg: string) => void,
): Promise<void> {
  try {
    if (!navigator.storage?.estimate) return;
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    if (quota > 0 && usage + estimatedBytes > quota * 0.9) {
      onWarning?.(
        "Estimated frames may exceed available browser storage. Extraction will " +
          "stop automatically if the storage quota is reached.",
      );
    }
  } catch {
    // estimate() unsupported — skip the preflight.
  }
}

export async function extractFramesSequential(
  file: File,
  fps: number = 30,
  callbacks: ExtractionCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;

  const url = URL.createObjectURL(file);
  let framesExtracted = 0;
  let sessionId: string | null = null;

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };

  try {
    const duration = await new Promise<number>((resolve, reject) => {
      video.onloadedmetadata = () => resolve(video.duration);
      video.onerror = () => reject(new Error("Failed to load video"));
      video.src = url;
      video.load();
    });

    throwIfAborted();

    const width = video.videoWidth;
    const height = video.videoHeight;
    const totalFrames = Math.ceil(duration * fps);
    const frameInterval = 1 / fps;

    await checkStorageBudget(totalFrames * width * height * 0.5, callbacks.onWarning);

    callbacks.onStatusChange("extracting");
    callbacks.onProgress(0, totalFrames);

    sessionId = await createSession({
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      duration,
      width,
      height,
      frameCount: totalFrames,
      fps,
      extractionMethod: "canvas",
    });

    const session = await getSession(sessionId);
    if (session) callbacks.onSessionCreated(session);

    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = width;
    frameCanvas.height = height;
    const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });

    const thumbCanvas = document.createElement("canvas");
    const thumbScale = THUMBNAIL_WIDTH / width;
    thumbCanvas.width = THUMBNAIL_WIDTH;
    thumbCanvas.height = Math.max(1, Math.round(height * thumbScale));
    const thumbCtx = thumbCanvas.getContext("2d", { willReadFrequently: true });

    if (!frameCtx || !thumbCtx) {
      throw new Error("Failed to acquire a 2D canvas context.");
    }

    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted();

      const timestamp = Math.min(i * frameInterval, Math.max(0, duration - 0.01));
      await seekTo(video, timestamp);

      frameCtx.drawImage(video, 0, 0, width, height);
      const frameBlob = await canvasToBlob(frameCanvas);

      thumbCtx.drawImage(frameCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      const thumbBlob = await canvasToBlob(thumbCanvas, THUMBNAIL_QUALITY);

      try {
        await storeFrame(sessionId, i, timestamp, width, height, frameBlob);
        await storeThumbnail(
          sessionId,
          i,
          timestamp,
          thumbCanvas.width,
          thumbCanvas.height,
          thumbBlob,
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "QuotaExceededError") {
          await updateSession(sessionId, { frameCount: framesExtracted });
          callbacks.onError(
            `Browser storage is full after ${framesExtracted} frames. ` +
              `Delete old sessions or extract at a lower frame rate.`,
          );
          return;
        }
        throw err;
      }

      framesExtracted++;
      callbacks.onProgress(framesExtracted, totalFrames);
      callbacks.onFrameExtracted(i);

      if (i % 3 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    await updateSession(sessionId, { frameCount: framesExtracted });
    callbacks.onComplete(sessionId, framesExtracted);
  } catch (err) {
    if (isAbortError(err)) {
      if (sessionId) {
        await updateSession(sessionId, { frameCount: framesExtracted }).catch(() => {});
      }
      callbacks.onStatusChange("cancelled");
      return;
    }
    callbacks.onError(err instanceof Error ? err.message : "Unknown extraction error");
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 1000);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}.${ms
    .toString()
    .padStart(3, "0")}`;
}

export function formatTimestamp(
  seconds: number,
  _fps: number,
  frameIndex: number,
): string {
  return `Frame ${frameIndex} @ ${formatDuration(seconds)}`;
}
