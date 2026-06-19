import { create } from "zustand";
import type { VideoSession } from "@/lib/frame-db";

export type ExtractionStatus =
  | "idle"
  | "loading"
  | "extracting"
  | "paused"
  | "completed"
  | "error";

export interface VideoFileInfo {
  file: File;
  objectUrl: string;
  name: string;
  size: number;
  type: string;
}

// ─── Upscale state types ─────────────────────────────────────────────────────

/** Per-frame upscale status tracked in the store so timeline and viewer stay in sync. */
export type UpscaleStatus = "idle" | "loading-model" | "processing" | "stitching" | "completed" | "error";

/** Map of frameIndex → upscale status, so each thumbnail can show its own state. */
export type UpscaleStatusMap = Record<number, UpscaleStatus>;

interface VideoStore {
  // Upload state
  videoFile: VideoFileInfo | null;
  setVideoFile: (file: VideoFileInfo | null) => void;

  // Extraction state
  extractionStatus: ExtractionStatus;
  setExtractionStatus: (status: ExtractionStatus) => void;
  extractionProgress: number;
  setExtractionProgress: (progress: number) => void;
  framesExtracted: number;
  setFramesExtracted: (count: number) => void;
  estimatedTotalFrames: number;
  setEstimatedTotalFrames: (count: number) => void;
  extractionStartTime: number;
  setExtractionStartTime: (time: number) => void;
  extractionError: string | null;
  setExtractionError: (error: string | null) => void;
  extractionMethod: "webcodecs" | "canvas" | "ffmpeg" | null;
  setExtractionMethod: (method: "webcodecs" | "canvas" | "ffmpeg" | null) => void;

  // Current session
  currentSession: VideoSession | null;
  setCurrentSession: (session: VideoSession | null) => void;

  // Frame navigation
  selectedFrameIndex: number;
  setSelectedFrameIndex: (index: number) => void;
  totalFrames: number;
  setTotalFrames: (count: number) => void;
  videoDuration: number;
  setVideoDuration: (duration: number) => void;
  videoWidth: number;
  setVideoWidth: (width: number) => void;
  videoHeight: number;
  setVideoHeight: (height: number) => void;
  videoFps: number;
  setVideoFps: (fps: number) => void;

  // Session history
  savedSessions: VideoSession[];
  setSavedSessions: (sessions: VideoSession[]) => void;
  showSessionList: boolean;
  setShowSessionList: (show: boolean) => void;

  // Viewer zoom
  viewerZoom: number;
  setViewerZoom: (zoom: number) => void;
  resetViewerZoom: () => void;

  // Navigation helpers
  goNextFrame: () => void;
  goPrevFrame: () => void;
  goFirstFrame: () => void;
  goLastFrame: () => void;
  goToFrame: (index: number) => void;

  // ─── Upscale state (shared between timeline & viewer) ────────────────────
  /** Status per frame index — "idle" means not upscaled. */
  upscaleStatusMap: UpscaleStatusMap;
  /** Set the upscale status for a specific frame. */
  setUpscaleStatus: (frameIndex: number, status: UpscaleStatus) => void;
  /** The frame index currently being upscaled (null if none). */
  upscalingFrameIndex: number | null;
  setUpscalingFrameIndex: (index: number | null) => void;
  /** Progress percentage for the current upscale operation. */
  upscaleProgress: number;
  setUpscaleProgress: (progress: number) => void;
  /** Human-readable tile info string for the current upscale. */
  upscaleTileInfo: string;
  setUpscaleTileInfo: (info: string) => void;
  /** The upscaled image data URL for the currently selected frame (null if none). */
  upscaledImageUrl: string | null;
  setUpscaledImageUrl: (url: string | null) => void;
  /** The frame index that the current upscaledImageUrl belongs to. */
  upscaledImageFrameIndex: number | null;
  setUpscaledImageFrameIndex: (index: number | null) => void;
  /** Error message from the last upscale attempt. */
  upscaleError: string | null;
  setUpscaleError: (error: string | null) => void;
  /** Whether the upscaled overlay is visible in the viewer. */
  showUpscaledOverlay: boolean;
  setShowUpscaledOverlay: (show: boolean) => void;
  /** Clear all upscale state for a specific frame. */
  clearUpscaleForFrame: (frameIndex: number) => void;
  /** Clear all upscale state entirely. */
  clearAllUpscale: () => void;

  // Reset
  resetAll: () => void;
}

export const useVideoStore = create<VideoStore>((set, get) => ({
  videoFile: null,
  setVideoFile: (file) => set({ videoFile: file }),

  extractionStatus: "idle",
  setExtractionStatus: (status) => set({ extractionStatus: status }),
  extractionProgress: 0,
  setExtractionProgress: (progress) => set({ extractionProgress: progress }),
  framesExtracted: 0,
  setFramesExtracted: (count) => set({ framesExtracted: count }),
  estimatedTotalFrames: 0,
  setEstimatedTotalFrames: (count) => set({ estimatedTotalFrames: count }),
  extractionStartTime: 0,
  setExtractionStartTime: (time) => set({ extractionStartTime: time }),
  extractionError: null,
  setExtractionError: (error) => set({ extractionError: error }),
  extractionMethod: null,
  setExtractionMethod: (method) => set({ extractionMethod: method }),

  currentSession: null,
  setCurrentSession: (session) => set({ currentSession: session }),

  selectedFrameIndex: 0,
  setSelectedFrameIndex: (index) => set({ selectedFrameIndex: index }),
  totalFrames: 0,
  setTotalFrames: (count) => set({ totalFrames: count }),
  videoDuration: 0,
  setVideoDuration: (duration) => set({ videoDuration: duration }),
  videoWidth: 0,
  setVideoWidth: (width) => set({ videoWidth: width }),
  videoHeight: 0,
  setVideoHeight: (height) => set({ videoHeight: height }),
  videoFps: 30,
  setVideoFps: (fps) => set({ videoFps: fps }),

  savedSessions: [],
  setSavedSessions: (sessions) => set({ savedSessions: sessions }),
  showSessionList: false,
  setShowSessionList: (show) => set({ showSessionList: show }),

  viewerZoom: 1,
  setViewerZoom: (zoom) => set({ viewerZoom: Math.max(0.1, Math.min(5, zoom)) }),
  resetViewerZoom: () => set({ viewerZoom: 1 }),

  goNextFrame: () => {
    const { selectedFrameIndex, totalFrames } = get();
    if (selectedFrameIndex < totalFrames - 1) {
      set({ selectedFrameIndex: selectedFrameIndex + 1 });
    }
  },
  goPrevFrame: () => {
    const { selectedFrameIndex } = get();
    if (selectedFrameIndex > 0) {
      set({ selectedFrameIndex: selectedFrameIndex - 1 });
    }
  },
  goFirstFrame: () => set({ selectedFrameIndex: 0 }),
  goLastFrame: () => {
    const { totalFrames } = get();
    set({ selectedFrameIndex: Math.max(0, totalFrames - 1) });
  },
  goToFrame: (index) => {
    const { totalFrames } = get();
    set({ selectedFrameIndex: Math.max(0, Math.min(index, totalFrames - 1)) });
  },

  // ─── Upscale state ────────────────────────────────────────────────────────
  upscaleStatusMap: {},
  setUpscaleStatus: (frameIndex, status) =>
    set((state) => ({
      upscaleStatusMap: { ...state.upscaleStatusMap, [frameIndex]: status },
    })),
  upscalingFrameIndex: null,
  setUpscalingFrameIndex: (index) => set({ upscalingFrameIndex: index }),
  upscaleProgress: 0,
  setUpscaleProgress: (progress) => set({ upscaleProgress: progress }),
  upscaleTileInfo: "",
  setUpscaleTileInfo: (info) => set({ upscaleTileInfo: info }),
  upscaledImageUrl: null,
  setUpscaledImageUrl: (url) => set({ upscaledImageUrl: url }),
  upscaledImageFrameIndex: null,
  setUpscaledImageFrameIndex: (index) => set({ upscaledImageFrameIndex: index }),
  upscaleError: null,
  setUpscaleError: (error) => set({ upscaleError: error }),
  showUpscaledOverlay: false,
  setShowUpscaledOverlay: (show) => set({ showUpscaledOverlay: show }),
  clearUpscaleForFrame: (frameIndex) =>
    set((state) => {
      const newMap = { ...state.upscaleStatusMap };
      delete newMap[frameIndex];
      return {
        upscaleStatusMap: newMap,
        ...(state.upscaledImageFrameIndex === frameIndex
          ? {
              upscaledImageUrl: null,
              upscaledImageFrameIndex: null,
              showUpscaledOverlay: false,
            }
          : {}),
      };
    }),
  clearAllUpscale: () =>
    set({
      upscaleStatusMap: {},
      upscalingFrameIndex: null,
      upscaleProgress: 0,
      upscaleTileInfo: "",
      upscaledImageUrl: null,
      upscaledImageFrameIndex: null,
      upscaleError: null,
      showUpscaledOverlay: false,
    }),

  resetAll: () =>
    set({
      videoFile: null,
      extractionStatus: "idle",
      extractionProgress: 0,
      framesExtracted: 0,
      estimatedTotalFrames: 0,
      extractionStartTime: 0,
      extractionError: null,
      extractionMethod: null,
      selectedFrameIndex: 0,
      totalFrames: 0,
      videoDuration: 0,
      videoWidth: 0,
      videoHeight: 0,
      viewerZoom: 1,
      upscaleStatusMap: {},
      upscalingFrameIndex: null,
      upscaleProgress: 0,
      upscaleTileInfo: "",
      upscaledImageUrl: null,
      upscaledImageFrameIndex: null,
      upscaleError: null,
      showUpscaledOverlay: false,
    }),
}));
