import {
  storeFrame,
  storeThumbnail,
  createSession,
  updateSession,
} from "@/lib/frame-db";
import type { VideoSession } from "@/lib/frame-db";

export interface ExtractionCallbacks {
  onProgress: (framesExtracted: number, totalFrames: number) => void;
  onStatusChange: (status: string) => void;
  onFrameExtracted: (index: number) => void;
  onSessionCreated: (session: VideoSession) => void;
  onError: (error: string) => void;
  onComplete: (sessionId: string, frameCount: number) => void;
}

const THUMBNAIL_WIDTH = 160;
const THUMBNAIL_HEIGHT = 90;
const FRAME_EXTRACTION_QUALITY = 0.92; // JPEG quality for frame storage

/**
 * Detect video metadata from a File object using HTML5 Video element
 */
export async function detectVideoMetadata(file: File): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
}> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      video.currentTime = 0.1; // Seek slightly to get real dimensions
    };

    video.onseeked = () => {
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;
      URL.revokeObjectURL(url);
      resolve({ duration, width, height, fps: 30 }); // Default 30fps
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video metadata"));
    };

    video.src = url;
    video.load();
  });
}

/**
 * Check if WebCodecs API is available
 */
export function isWebCodecsSupported(): boolean {
  return (
    typeof VideoDecoder !== "undefined" &&
    typeof EncodedVideoChunk !== "undefined"
  );
}

/**
 * Create a canvas from a video at a specific time
 */
function createVideoAtTime(
  file: File,
  time: number,
  width: number,
  height: number
): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);

    video.onloadeddata = () => {
      video.currentTime = time;
    };

    video.onseeked = () => {
      resolve(video);
      // Don't revoke here - caller handles it
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to seek video to time ${time}s`));
    };

    video.src = url;
    video.load();
  });
}

/**
 * Draw video frame to canvas and convert to blob
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number = FRAME_EXTRACTION_QUALITY
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to convert canvas to blob"));
        }
      },
      "image/jpeg",
      quality
    );
  });
}

/**
 * Main frame extraction using HTML5 Video + Canvas seeking
 * This is the primary method that works across all browsers
 */
export async function extractFramesWithCanvas(
  file: File,
  fps: number = 30,
  callbacks: ExtractionCallbacks
): Promise<void> {
  const { duration, width, height } = await detectVideoMetadata(file);

  // Calculate total frames
  const totalFrames = Math.ceil(duration * fps);
  const frameInterval = 1 / fps;

  callbacks.onStatusChange("extracting");
  callbacks.onProgress(0, totalFrames);

  // Create session in IndexedDB
  const sessionId = await createSession({
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

  const session = await (await import("@/lib/frame-db")).getSession(sessionId);
  if (session) {
    callbacks.onSessionCreated(session);
  }

  // Create reusable canvases
  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = width;
  frameCanvas.height = height;
  const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true })!;

  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = THUMBNAIL_WIDTH;
  thumbCanvas.height = THUMBNAIL_HEIGHT;
  const thumbCtx = thumbCanvas.getContext("2d", { willReadFrequently: true })!;

  // Process frames in batches to avoid blocking UI
  const BATCH_SIZE = 5;
  let framesExtracted = 0;

  try {
    for (let i = 0; i < totalFrames; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, totalFrames);

      for (let j = i; j < batchEnd; j++) {
        const timestamp = j * frameInterval;
        const clampedTimestamp = Math.min(timestamp, duration - 0.01);

        try {
          // Create video element for this frame
          const video = await createVideoAtTime(
            file,
            clampedTimestamp,
            width,
            height
          );

          // Draw frame to canvas
          frameCtx.drawImage(video, 0, 0, width, height);
          video.src = "";
          video.load();
          URL.revokeObjectURL(video.src);

          // Convert to blob
          const frameBlob = await canvasToBlob(frameCanvas);

          // Generate thumbnail
          thumbCtx.drawImage(frameCanvas, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
          const thumbBlob = await canvasToBlob(thumbCanvas, 0.7);

          // Store in IndexedDB
          await storeFrame(sessionId, j, clampedTimestamp, width, height, frameBlob);
          await storeThumbnail(sessionId, j, clampedTimestamp, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, thumbBlob);

          framesExtracted++;
          callbacks.onProgress(framesExtracted, totalFrames);
          callbacks.onFrameExtracted(j);
        } catch (frameError) {
          console.warn(`Failed to extract frame ${j}:`, frameError);
          // Continue with next frame
        }
      }

      // Yield to event loop every batch
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Update session with actual count
    await updateSession(sessionId, { frameCount: framesExtracted });
    callbacks.onComplete(sessionId, framesExtracted);
  } catch (error) {
    callbacks.onError(
      error instanceof Error ? error.message : "Unknown extraction error"
    );
  }
}

/**
 * Simplified extraction using a single video element with sequential seeking
 * More efficient than creating new video elements per frame
 */
export async function extractFramesSequential(
  file: File,
  fps: number = 30,
  callbacks: ExtractionCallbacks
): Promise<void> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;

  const url = URL.createObjectURL(file);

  // Wait for metadata
  const duration = await new Promise<number>((resolve, reject) => {
    video.onloadedmetadata = () => resolve(video.duration);
    video.onerror = () => reject(new Error("Failed to load video"));
    video.src = url;
    video.load();
  });

  const width = video.videoWidth;
  const height = video.videoHeight;

  // Estimate frame count
  const totalFrames = Math.ceil(duration * fps);
  const frameInterval = 1 / fps;

  callbacks.onStatusChange("extracting");
  callbacks.onProgress(0, totalFrames);

  // Create session
  const sessionId = await createSession({
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

  const session = await (await import("@/lib/frame-db")).getSession(sessionId);
  if (session) {
    callbacks.onSessionCreated(session);
  }

  // Create canvases
  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = width;
  frameCanvas.height = height;
  const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true })!;

  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = THUMBNAIL_WIDTH;
  const thumbScale = THUMBNAIL_WIDTH / width;
  thumbCanvas.height = Math.round(height * thumbScale);
  const thumbCtx = thumbCanvas.getContext("2d", { willReadFrequently: true })!;

  let framesExtracted = 0;

  // Seek to first frame
  for (let i = 0; i < totalFrames; i++) {
    const timestamp = Math.min(i * frameInterval, duration - 0.01);

    // Seek video
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error(`Seek failed at frame ${i}`));
      video.currentTime = timestamp;
    });

    // Draw frame
    frameCtx.drawImage(video, 0, 0, width, height);

    // Create blobs
    const frameBlob = await canvasToBlob(frameCanvas);
    thumbCtx.drawImage(frameCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbBlob = await canvasToBlob(thumbCanvas, 0.7);

    // Store
    await storeFrame(sessionId, i, timestamp, width, height, frameBlob);
    await storeThumbnail(
      sessionId,
      i,
      timestamp,
      thumbCanvas.width,
      thumbCanvas.height,
      thumbBlob
    );

    framesExtracted++;
    callbacks.onProgress(framesExtracted, totalFrames);
    callbacks.onFrameExtracted(i);

    // Yield every 3 frames
    if (i % 3 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  URL.revokeObjectURL(url);

  // Update session
  await updateSession(sessionId, { frameCount: framesExtracted });
  callbacks.onComplete(sessionId, framesExtracted);
}

/**
 * Detect best available method for frame extraction
 */
export function detectBestMethod(): "webcodecs" | "canvas" {
  if (isWebCodecsSupported()) {
    return "webcodecs";
  }
  return "canvas";
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Format duration for display
 */
export function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

/**
 * Format time for frame timestamp display
 */
export function formatTimestamp(seconds: number, fps: number, frameIndex: number): string {
  const timeStr = formatDuration(seconds);
  return `Frame ${frameIndex} @ ${timeStr}`;
}
