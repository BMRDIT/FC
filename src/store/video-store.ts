import { create } from "zustand";
import type { VideoSession } from "@/lib/frame-db";

export type ExtractionStatus =
  | "idle"
  | "loading"
  | "extracting"
  | "completed"
  | "error"
  | "cancelled";

export interface VideoFileInfo {
  file: File;
  objectUrl: string;
  name: string;
  size: number;
  type: string;
}

export type UpscaleStatus =
  | "idle"
  | "loading-model"
  | "processing"
  | "stitching"
  | "completed"
  | "error";

export type UpscaleStatusMap = Record<number, UpscaleStatus>;

function revokeIfObjectUrl(url: string | null | undefined): void {
  if (url && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

interface VideoStore {
  videoFile: VideoFileInfo | null;
  setVideoFile: (file: VideoFileInfo | null) => void;

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
  extractionAbort: AbortController | null;
  setExtractionAbort: (controller: AbortController | null) => void;
  cancelExtraction: () => void;

  currentSession: VideoSession | null;
  setCurrentSession: (session: VideoSession | null) => void;

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

  savedSessions: VideoSession[];
  setSavedSessions: (sessions: VideoSession[]) => void;
  showSessionList: boolean;
  setShowSessionList: (show: boolean) => void;

  viewerZoom: number;
  setViewerZoom: (zoom: number) => void;
  resetViewerZoom: () => void;

  goNextFrame: () => void;
  goPrevFrame: () => void;
  goFirstFrame: () => void;
  goLastFrame: () => void;
  goToFrame: (index: number) => void;

  upscaleStatusMap: UpscaleStatusMap;
  setUpscaleStatus: (frameIndex: number, status: UpscaleStatus) => void;
  upscalingFrameIndex: number | null;
  setUpscalingFrameIndex: (index: number | null) => void;
  upscaleProgress: number;
  setUpscaleProgress: (progress: number) => void;
  upscaleTileInfo: string;
  setUpscaleTileInfo: (info: string) => void;
  upscaledImageUrl: string | null;
  setUpscaledImageUrl: (url: string | null) => void;
  upscaledImageFrameIndex: number | null;
  setUpscaledImageFrameIndex: (index: number | null) => void;
  upscaleError: string | null;
  setUpscaleError: (error: string | null) => void;
  showUpscaledOverlay: boolean;
  setShowUpscaledOverlay: (show: boolean) => void;
  upscaleAbort: AbortController | null;
  setUpscaleAbort: (controller: AbortController | null) => void;
  cancelUpscale: () => void;
  clearUpscaleForFrame: (frameIndex: number) => void;
  clearAllUpscale: () => void;

  resetAll: () => void;
}

export const useVideoStore = create<VideoStore>((set, get) => ({
  videoFile: null,
  setVideoFile: (file) => {
    const prev = get().videoFile;
    if (prev?.objectUrl && prev.objectUrl !== file?.objectUrl) {
      revokeIfObjectUrl(prev.objectUrl);
    }
    set({ videoFile: file });
  },

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
  extractionAbort: null,
  setExtractionAbort: (controller) => set({ extractionAbort: controller }),
  cancelExtraction: () => {
    get().extractionAbort?.abort();
    set({ extractionAbort: null, extractionStatus: "cancelled" });
  },

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
  setUpscaledImageUrl: (url) => {
    const prev = get().upscaledImageUrl;
    if (prev && prev !== url) revokeIfObjectUrl(prev);
    set({ upscaledImageUrl: url });
  },
  upscaledImageFrameIndex: null,
  setUpscaledImageFrameIndex: (index) => set({ upscaledImageFrameIndex: index }),
  upscaleError: null,
  setUpscaleError: (error) => set({ upscaleError: error }),
  showUpscaledOverlay: false,
  setShowUpscaledOverlay: (show) => set({ showUpscaledOverlay: show }),
  upscaleAbort: null,
  setUpscaleAbort: (controller) => set({ upscaleAbort: controller }),
  cancelUpscale: () => {
    const { upscaleAbort, upscalingFrameIndex } = get();
    upscaleAbort?.abort();
    set((state) => ({
      upscaleAbort: null,
      upscalingFrameIndex: null,
      upscaleProgress: 0,
      upscaleTileInfo: "",
      upscaleStatusMap:
        upscalingFrameIndex !== null
          ? { ...state.upscaleStatusMap, [upscalingFrameIndex]: "idle" }
          : state.upscaleStatusMap,
    }));
  },
  clearUpscaleForFrame: (frameIndex) =>
    set((state) => {
      const newMap = { ...state.upscaleStatusMap };
      delete newMap[frameIndex];
      const clearingActive = state.upscaledImageFrameIndex === frameIndex;
      if (clearingActive) revokeIfObjectUrl(state.upscaledImageUrl);
      return {
        upscaleStatusMap: newMap,
        ...(clearingActive
          ? {
              upscaledImageUrl: null,
              upscaledImageFrameIndex: null,
              showUpscaledOverlay: false,
            }
          : {}),
      };
    }),
  clearAllUpscale: () =>
    set((state) => {
      revokeIfObjectUrl(state.upscaledImageUrl);
      return {
        upscaleStatusMap: {},
        upscalingFrameIndex: null,
        upscaleProgress: 0,
        upscaleTileInfo: "",
        upscaledImageUrl: null,
        upscaledImageFrameIndex: null,
        upscaleError: null,
        showUpscaledOverlay: false,
      };
    }),

  resetAll: () =>
    set((state) => {
      revokeIfObjectUrl(state.videoFile?.objectUrl);
      revokeIfObjectUrl(state.upscaledImageUrl);
      state.extractionAbort?.abort();
      state.upscaleAbort?.abort();
      return {
        videoFile: null,
        extractionStatus: "idle",
        extractionProgress: 0,
        framesExtracted: 0,
        estimatedTotalFrames: 0,
        extractionStartTime: 0,
        extractionError: null,
        extractionMethod: null,
        extractionAbort: null,
        currentSession: null,
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
        upscaleAbort: null,
      };
    }),
}));
