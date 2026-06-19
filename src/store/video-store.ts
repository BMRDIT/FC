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
    }),
}));
