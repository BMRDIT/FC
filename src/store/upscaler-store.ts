import { create } from "zustand";

export type UpscalerStatus =
  | "idle"
  | "loading-model"
  | "model-ready"
  | "processing"
  | "stitching"
  | "completed"
  | "error";

export interface ImageFileInfo {
  file: File;
  objectUrl: string;
  name: string;
  size: number;
  type: string;
  width: number;
  height: number;
}

interface UpscalerStore {
  // Upload state
  imageFile: ImageFileInfo | null;
  setImageFile: (file: ImageFileInfo | null) => void;

  // Processing state
  status: UpscalerStatus;
  setStatus: (status: UpscalerStatus) => void;
  statusMessage: string;
  setStatusMessage: (message: string) => void;
  currentTile: number;
  setCurrentTile: (tile: number) => void;
  totalTiles: number;
  setTotalTiles: (count: number) => void;
  progress: number;
  setProgress: (progress: number) => void;
  error: string | null;
  setError: (error: string | null) => void;

  // Output
  outputDataUrl: string | null;
  setOutputDataUrl: (url: string | null) => void;
  outputWidth: number;
  setOutputWidth: (width: number) => void;
  outputHeight: number;
  setOutputHeight: (height: number) => void;

  // Comparison slider
  sliderPosition: number;
  setSliderPosition: (position: number) => void;

  // Reset
  resetAll: () => void;
}

export const useUpscalerStore = create<UpscalerStore>((set) => ({
  imageFile: null,
  setImageFile: (file) => set({ imageFile: file }),

  status: "idle",
  setStatus: (status) => set({ status }),
  statusMessage: "",
  setStatusMessage: (message) => set({ statusMessage: message }),
  currentTile: 0,
  setCurrentTile: (tile) => set({ currentTile: tile }),
  totalTiles: 0,
  setTotalTiles: (count) => set({ totalTiles: count }),
  progress: 0,
  setProgress: (progress) => set({ progress }),
  error: null,
  setError: (error) => set({ error }),

  outputDataUrl: null,
  setOutputDataUrl: (url) => set({ outputDataUrl: url }),
  outputWidth: 0,
  setOutputWidth: (width) => set({ outputWidth: width }),
  outputHeight: 0,
  setOutputHeight: (height) => set({ outputHeight: height }),

  sliderPosition: 50,
  setSliderPosition: (position) =>
    set({ sliderPosition: Math.max(0, Math.min(100, position)) }),

  resetAll: () =>
    set({
      imageFile: null,
      status: "idle",
      statusMessage: "",
      currentTile: 0,
      totalTiles: 0,
      progress: 0,
      error: null,
      outputDataUrl: null,
      outputWidth: 0,
      outputHeight: 0,
      sliderPosition: 50,
    }),
}));
