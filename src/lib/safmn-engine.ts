/// <reference types="@webgpu/types" />
/**
 * SAFMN Engine — Client-side 4× image super-resolution via ONNX Runtime Web (WebGPU)
 *
 * Architecture:
 *   1. Static Tiling Engine — 1024×1024 patches with 64px overlap, mirror-padded to exact [1,3,1024,1024]
 *   2. Tensor Format Conversion — interleaved RGBA ↔ planar normalized Float32
 *   3. ONNX Runtime WebGPU Session — tensors kept in GPU buffers (VRAM) as long as possible
 *   4. Feathered Blending / Stitching — cosine-window blending to eliminate grid lines
 *
 * Target: modern desktop browsers with WebGPU, high-tier discrete GPUs (RTX 4060+, RX 7800 XT+)
 */

import ort from "onnxruntime-web";

// ─── Runtime configuration ───────────────────────────────────────────────

/** Default model path. Override at build time via NEXT_PUBLIC_SAFMN_MODEL_PATH. */
export const DEFAULT_MODEL_PATH =
  process.env.NEXT_PUBLIC_SAFMN_MODEL_PATH ?? "/models/safmn_4x.onnx";

/**
 * Hard cap on source pixels, to keep CPU memory bounded. The stitch step allocates
 * ~`src * 320` bytes of Float32 accumulators (the output covers 16× the source area),
 * so a 1080p frame already needs ~0.65 GB. Larger inputs risk crashing the tab, so we
 * refuse them with a clear error instead of OOM-ing. Override via
 * NEXT_PUBLIC_SAFMN_MAX_SOURCE_PIXELS.
 */
export const MAX_SOURCE_PIXELS = Number(
  process.env.NEXT_PUBLIC_SAFMN_MAX_SOURCE_PIXELS ?? 2_500_000,
);

// Serve onnxruntime-web's wasm/worker assets from our own origin instead of a CDN
// (see scripts/copy-ort-assets.mjs). Keeps the app self-contained and CSP-compatible.
if (typeof window !== "undefined") {
  ort.env.wasm.wasmPaths = "/ort/";
}

// ─── Constants ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Tile size the SAFMN model accepts (static shape requirement). */
export const TILE_SIZE = 1024;

/** Overlap between adjacent tiles in pixels — eliminates edge artifacts. */
export const OVERLAP = 64;

/** Effective stride between tile origins. */
const STRIDE = TILE_SIZE - OVERLAP; // 960

/** Upscale factor — SAFMN outputs 4× the input resolution. */
export const UPSCALE_FACTOR = 4;

/** Output tile size after upscaling. */
const OUTPUT_TILE_SIZE = TILE_SIZE * UPSCALE_FACTOR; // 4096

/** Output overlap after upscaling. */
const OUTPUT_OVERLAP = OVERLAP * UPSCALE_FACTOR; // 256

// ─── Types ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TileInfo {
  /** 0-based column index in the tile grid. */
  col: number;
  /** 0-based row index in the tile grid. */
  row: number;
  /** X offset in the *source* image where this tile starts. */
  srcX: number;
  /** Y offset in the *source* image where this tile starts. */
  srcY: number;
  /** Actual pixel width of source data in this tile (≤ TILE_SIZE). */
  srcW: number;
  /** Actual pixel height of source data in this tile (≤ TILE_SIZE). */
  srcH: number;
  /** X offset in the *output* canvas where the upscaled tile content begins. */
  outX: number;
  /** Y offset in the *output* canvas where the upscaled tile content begins. */
  outY: number;
  /** Width of valid (non-padding) content in the output tile. */
  outW: number;
  /** Height of valid (non-padding) content in the output tile. */
  outH: number;
}

export interface SafmnConfig {
  /** Path or URL to the .onnx model file. */
  modelPath: string;
  /** Number of tiles to process before yielding to the event loop. */
  tilesPerChunk?: number;
}

export interface UpscaleCallbacks {
  onProgress: (tileIndex: number, totalTiles: number) => void;
  onStatusChange: (status: string) => void;
  onTileComplete: (tile: TileInfo) => void;
  onError: (error: string) => void;
  onComplete: (outputCanvas: HTMLCanvasElement) => void;
}

// ─── WebGPU Detection ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Check whether the current browser supports WebGPU.
 * Returns false on any failure — the caller should show a graceful error.
 */
export function isWebGPUSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "gpu" in navigator &&
    typeof navigator.gpu !== "undefined" &&
    typeof navigator.gpu.requestAdapter === "function"
  );
}

// ─── Tile Grid Computation ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Compute the grid of tiles needed to cover an image of the given dimensions.
 *
 * Tiles are laid out on a grid with stride STRIDE (= TILE_SIZE - OVERLAP).
 * The last tile in each dimension is shifted backwards so it always starts
 * at least STRIDE pixels before the edge, ensuring full coverage without
 * producing tiles smaller than TILE_SIZE (those are mirror-padded instead).
 *
 * @param srcWidth  Source image width in pixels.
 * @param srcHeight Source image height in pixels.
 * @returns Array of TileInfo describing every tile to process.
 */
export function computeTileGrid(srcWidth: number, srcHeight: number): TileInfo[] {
  const tiles: TileInfo[] = [];

  const cols = Math.max(1, Math.ceil(srcWidth / STRIDE));
  const rows = Math.max(1, Math.ceil(srcHeight / STRIDE));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let srcX = col * STRIDE;
      let srcY = row * STRIDE;

      if (srcX + TILE_SIZE > srcWidth) {
        srcX = Math.max(0, srcWidth - TILE_SIZE);
      }
      if (srcY + TILE_SIZE > srcHeight) {
        srcY = Math.max(0, srcHeight - TILE_SIZE);
      }

      const srcW = Math.min(TILE_SIZE, srcWidth - srcX);
      const srcH = Math.min(TILE_SIZE, srcHeight - srcY);

      const outX = srcX * UPSCALE_FACTOR;
      const outY = srcY * UPSCALE_FACTOR;
      const outW = srcW * UPSCALE_FACTOR;
      const outH = srcH * UPSCALE_FACTOR;

      tiles.push({ col, row, srcX, srcY, srcW, srcH, outX, outY, outW, outH });
    }
  }

  return tiles;
}

// ─── Mirror Padding ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Extract a tile from source ImageData and mirror-pad it to exactly TILE_SIZE×TILE_SIZE.
 *
 * If the tile extends beyond the source image (edge tiles), the missing pixels
 * are filled by mirroring the nearest valid pixels. This produces a static
 * [1, 3, 1024, 1024] tensor shape required for optimal GPU execution.
 *
 * @param srcData    Source ImageData (full image).
 * @param srcX       X offset in source where tile starts.
 * @param srcY       Y offset in source where tile starts.
 * @returns Uint8ClampedArray of length TILE_SIZE*TILE_SIZE*4 (RGBA), mirror-padded.
 */
function extractMirrorPaddedTile(
  srcData: ImageData,
  srcX: number,
  srcY: number,
): Uint8ClampedArray {
  const { data: src, width: srcImgW } = srcData;
  const padded = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);

  for (let y = 0; y < TILE_SIZE; y++) {
    let sy = srcY + y;
    if (sy < 0) sy = -sy;
    if (sy >= srcData.height) {
      sy = 2 * srcData.height - sy - 2;
    }
    sy = Math.max(0, Math.min(srcData.height - 1, sy));

    for (let x = 0; x < TILE_SIZE; x++) {
      let sx = srcX + x;
      if (sx < 0) sx = -sx;
      if (sx >= srcImgW) {
        sx = 2 * srcImgW - sx - 2;
      }
      sx = Math.max(0, Math.min(srcImgW - 1, sx));

      const srcIdx = (sy * srcImgW + sx) * 4;
      const dstIdx = (y * TILE_SIZE + x) * 4;

      padded[dstIdx]     = src[srcIdx];
      padded[dstIdx + 1] = src[srcIdx + 1];
      padded[dstIdx + 2] = src[srcIdx + 2];
      padded[dstIdx + 3] = 255;
    }
  }

  return padded;
}

// ─── Tensor Format Conversion ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Convert RGBA pixel data (interleaved [R,G,B,A,R,G,B,A,...]) to planar
 * normalized Float32Array [R-plane, G-plane, B-plane] with values in [0, 1].
 *
 * Output layout: [1, 3, H, W] — channel-first, alpha dropped.
 *
 * @param rgba     Interleaved RGBA pixel data (length = H*W*4).
 * @param height   Pixel height.
 * @param width    Pixel width.
 * @returns Float32Array of length 3*H*W, planar RGB, normalized to [0,1].
 */
export function rgbaToPlanarFloat32(
  rgba: Uint8ClampedArray | Uint8Array,
  height: number,
  width: number,
): Float32Array {
  const pixelCount = height * width;
  const planar = new Float32Array(3 * pixelCount);

  const rOffset = 0;
  const gOffset = pixelCount;
  const bOffset = 2 * pixelCount;

  for (let i = 0; i < pixelCount; i++) {
    const rgbaIdx = i * 4;
    planar[rOffset + i] = rgba[rgbaIdx]     / 255.0;
    planar[gOffset + i] = rgba[rgbaIdx + 1] / 255.0;
    planar[bOffset + i] = rgba[rgbaIdx + 2] / 255.0;
  }

  return planar;
}

/**
 * Convert planar normalized Float32Array [R-plane, G-plane, B-plane] back to
 * interleaved RGBA Uint8ClampedArray.
 *
 * @param planar   Float32Array of length 3*H*W, planar RGB, values in [0,1].
 * @param height   Pixel height.
 * @param width    Pixel width.
 * @returns Uint8ClampedArray of length H*W*4 (RGBA, alpha=255).
 */
export function planarFloat32ToRGBA(
  planar: Float32Array,
  height: number,
  width: number,
): Uint8ClampedArray {
  const pixelCount = height * width;
  const rgba = new Uint8ClampedArray(pixelCount * 4);

  const rOffset = 0;
  const gOffset = pixelCount;
  const bOffset = 2 * pixelCount;

  for (let i = 0; i < pixelCount; i++) {
    const rgbaIdx = i * 4;

    rgba[rgbaIdx]     = Math.max(0, Math.min(255, Math.round(planar[rOffset + i] * 255.0)));
    rgba[rgbaIdx + 1] = Math.max(0, Math.min(255, Math.round(planar[gOffset + i] * 255.0)));
    rgba[rgbaIdx + 2] = Math.max(0, Math.min(255, Math.round(planar[bOffset + i] * 255.0)));
    rgba[rgbaIdx + 3] = 255;
  }

  return rgba;
}

// ─── Blending Weights (Cosine Window) ─────────────────────────────────────────────────────────────────────────────────

/**
 * Precompute a 2D blending weight matrix for a single output tile.
 *
 * The weight is 1.0 in the tile center and tapers to ~0 at the edges using
 * a raised-cosine (Hann) window. When tiles overlap, the sum of weights from
 * all contributing tiles equals 1.0 at every pixel, producing seamless stitching.
 *
 * @param validW  Width of valid (non-padding) content in the output tile.
 * @param validH  Height of valid (non-padding) content in the output tile.
 * @returns Float32Array of length validW*validH containing blend weights.
 */
function computeBlendWeights(validW: number, validH: number): Float32Array {
  const weights = new Float32Array(validW * validH);

  const ovX = Math.min(OUTPUT_OVERLAP, Math.floor(validW / 2));
  const ovY = Math.min(OUTPUT_OVERLAP, Math.floor(validH / 2));

  for (let y = 0; y < validH; y++) {
    let dy = 0;
    if (y < ovY) {
      dy = (ovY - y) / ovY;
    } else if (y >= validH - ovY) {
      dy = (y - (validH - ovY - 1)) / ovY;
    }
    const wy = 0.5 * (1 + Math.cos(Math.PI * Math.min(1, dy)));

    for (let x = 0; x < validW; x++) {
      let dx = 0;
      if (x < ovX) {
        dx = (ovX - x) / ovX;
      } else if (x >= validW - ovX) {
        dx = (x - (validW - ovX - 1)) / ovX;
      }
      const wx = 0.5 * (1 + Math.cos(Math.PI * Math.min(1, dx)));

      weights[y * validW + x] = wx * wy;
    }
  }

  return weights;
}

// ─── SAFMN Engine ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Main SAFMN super-resolution engine.
 *
 * Manages the ONNX Runtime Web session, processes tiles, and stitches results.
 * Tensors are kept in GPU buffers (VRAM) between operations to avoid
 * CPU↔GPU memory transfer bottlenecks.
 */
export class SafmnEngine {
  private session: ort.InferenceSession | null = null;
  private modelPath: string;
  private tilesPerChunk: number;

  constructor(config: SafmnConfig) {
    this.modelPath = config.modelPath;
    this.tilesPerChunk = config.tilesPerChunk ?? 1;
  }

  /**
   * Initialize the ONNX Runtime WebGPU inference session.
   *
   * Configures hardware-acceleration flags:
   *   - executionProviders: ['webgpu']
   *   - preferredOutputLocation: 'gpu-buffer' (keep tensors in VRAM)
   *
   * @throws Error if WebGPU is unavailable or the model fails to load.
   */
  async init(): Promise<void> {
    if (!isWebGPUSupported()) {
      throw new Error(
        "WebGPU is not supported in this browser. Please use a recent version of Chrome, Edge, or another WebGPU-enabled browser.",
      );
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) {
      throw new Error(
        "No WebGPU adapter found. Your GPU or browser may not support WebGPU. Check your browser configuration or hardware drivers.",
      );
    }

    // Preflight: verify the model is actually served so a missing file yields an
    // actionable message instead of an opaque ONNX parse error.
    try {
      const head = await fetch(this.modelPath, { method: "HEAD" });
      if (!head.ok) {
        throw new Error(
          `SAFMN model not found at "${this.modelPath}" (HTTP ${head.status}). ` +
            `Place safmn_4x.onnx in public/models/ (see README) or set NEXT_PUBLIC_SAFMN_MODEL_PATH.`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("SAFMN model not found")) {
        throw err;
      }
      // HEAD unsupported or transient network issue: fall through and let ORT load it.
    }

    try {
      const sessionOptions: ort.InferenceSession.SessionOptions = {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
        preferredOutputLocation: "gpu-buffer",
      };
      this.session = await ort.InferenceSession.create(
        this.modelPath,
        sessionOptions,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Device Lost") || msg.includes("device lost") || msg.includes("GPU")) {
        throw new Error(
          `WebGPU device initialization failed (${msg}). Please check your browser configuration or GPU drivers.`,
        );
      }
      throw new Error(`Failed to load SAFMN model: ${msg}`);
    }
  }

  /** Whether the engine's ONNX session is ready for inference. */
  isReady(): boolean {
    return this.session !== null;
  }

  /** Tear down the ONNX session and free GPU resources. */
  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
  }

  /**
   * Run inference on a single mirror-padded tile.
   *
   * The input tensor is created on CPU; ORT uploads it to the GPU for the WebGPU EP.
   * The output stays in a GPU buffer (preferredOutputLocation) and is downloaded to the
   * CPU per tile via getData(true), which also releases that GPU buffer.
   *
   * @param tileRGBA  Mirror-padded RGBA tile data (TILE_SIZE×TILE_SIZE×4).
   * @returns Float32Array containing the upscaled planar output.
   */
  private async runTileInference(tileRGBA: Uint8ClampedArray): Promise<Float32Array> {
    if (!this.session) {
      throw new Error("SAFMN engine not initialized. Call init() first.");
    }

    const inputData = rgbaToPlanarFloat32(tileRGBA, TILE_SIZE, TILE_SIZE);

    const inputTensor = new ort.Tensor(
      "float32",
      inputData,
      [1, 3, TILE_SIZE, TILE_SIZE],
    );

    const inputName = this.session.inputNames[0];
    const feeds: Record<string, ort.Tensor> = {};
    feeds[inputName] = inputTensor;

    let outputTensor: ort.Tensor | undefined;
    try {
      const results = await this.session.run(feeds);
      const outputName = this.session.outputNames[0];
      outputTensor = results[outputName];

      const downloaded = (await outputTensor.getData(true)) as Float32Array;
      return new Float32Array(downloaded);
    } finally {
      inputTensor.dispose();
      outputTensor?.dispose();
    }
  }

  /**
   * Upscale an image by processing it tile-by-tile with async chunking.
   *
   * Processing loop:
   *   1. Compute tile grid from source dimensions.
   *   2. For each tile: extract + mirror-pad → convert to planar Float32 → run inference.
   *   3. Convert output tensor back to RGBA.
   *   4. Blend the valid region into the output canvas using cosine weights.
   *   5. Yield to the event loop every `tilesPerChunk` tiles to keep UI responsive.
   *
   * @param sourceCanvas  Canvas containing the original image.
   * @param callbacks     Progress and lifecycle callbacks.
   * @param signal        Optional AbortSignal to cancel processing.
   */
  async upscale(
    sourceCanvas: HTMLCanvasElement,
    callbacks: UpscaleCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    const { onProgress, onStatusChange, onTileComplete, onError, onComplete } = callbacks;

    if (!this.session) {
      onError("SAFMN engine not initialized. Call init() first.");
      return;
    }

    const srcWidth = sourceCanvas.width;
    const srcHeight = sourceCanvas.height;

    if (srcWidth * srcHeight > MAX_SOURCE_PIXELS) {
      onError(
        `Image too large to upscale safely (${(
          (srcWidth * srcHeight) /
          1e6
        ).toFixed(1)} MP; limit ${(MAX_SOURCE_PIXELS / 1e6).toFixed(
          1,
        )} MP). Try a smaller frame or lower the source resolution.`,
      );
      return;
    }

    if (signal?.aborted) {
      onStatusChange("cancelled");
      return;
    }

    const srcCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!srcCtx) {
      onError("Failed to get 2D context from source canvas.");
      return;
    }
    const srcImageData = srcCtx.getImageData(0, 0, srcWidth, srcHeight);

    const tiles = computeTileGrid(srcWidth, srcHeight);
    const totalTiles = tiles.length;

    onStatusChange("processing");
    onProgress(0, totalTiles);

    const outWidth = srcWidth * UPSCALE_FACTOR;
    const outHeight = srcHeight * UPSCALE_FACTOR;
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = outWidth;
    outputCanvas.height = outHeight;
    const outCtx = outputCanvas.getContext("2d", { willReadFrequently: true });
    if (!outCtx) {
      onError("Failed to get 2D context for output canvas.");
      return;
    }

    const colorAccum = new Float32Array(outWidth * outHeight * 3);
    const weightAccum = new Float32Array(outWidth * outHeight);

    for (let i = 0; i < totalTiles; i += this.tilesPerChunk) {
      const chunkEnd = Math.min(i + this.tilesPerChunk, totalTiles);

      for (let j = i; j < chunkEnd; j++) {
        const tile = tiles[j];

        if (signal?.aborted) {
          onStatusChange("cancelled");
          return;
        }

        try {
          const tileRGBA = extractMirrorPaddedTile(
            srcImageData,
            tile.srcX,
            tile.srcY,
          );

          const outputPlanar = await this.runTileInference(tileRGBA);

          const outputRGBA = planarFloat32ToRGBA(
            outputPlanar,
            OUTPUT_TILE_SIZE,
            OUTPUT_TILE_SIZE,
          );

          const blendWeights = computeBlendWeights(tile.outW, tile.outH);

          for (let py = 0; py < tile.outH; py++) {
            for (let px = 0; px < tile.outW; px++) {
              const outGlobalX = tile.outX + px;
              const outGlobalY = tile.outY + py;
              const globalIdx = outGlobalY * outWidth + outGlobalX;

              const localTileX = px;
              const localTileY = py;
              const tilePixelIdx = (localTileY * OUTPUT_TILE_SIZE + localTileX) * 4;

              const w = blendWeights[py * tile.outW + px];

              colorAccum[globalIdx * 3]     += outputRGBA[tilePixelIdx]     * w;
              colorAccum[globalIdx * 3 + 1] += outputRGBA[tilePixelIdx + 1] * w;
              colorAccum[globalIdx * 3 + 2] += outputRGBA[tilePixelIdx + 2] * w;
              weightAccum[globalIdx]        += w;
            }
          }

          onTileComplete(tile);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Device Lost") || msg.includes("device was lost") || msg.includes("GPU")) {
            onError(
              `WebGPU device error during tile processing (${msg}). Your GPU may have run out of memory. Try a smaller image or check your browser configuration.`,
            );
            return;
          }
          onError(`Error processing tile ${j + 1}: ${msg}`);
          return;
        }
      }

      onProgress(chunkEnd, totalTiles);

      if (chunkEnd < totalTiles) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    onStatusChange("stitching");
    const outImageData = outCtx.createImageData(outWidth, outHeight);
    const outData = outImageData.data;

    for (let i = 0; i < outWidth * outHeight; i++) {
      const w = weightAccum[i];
      if (w > 0) {
        outData[i * 4]     = Math.max(0, Math.min(255, Math.round(colorAccum[i * 3]     / w)));
        outData[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(colorAccum[i * 3 + 1] / w)));
        outData[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(colorAccum[i * 3 + 2] / w)));
        outData[i * 4 + 3] = 255;
      } else {
        outData[i * 4]     = 0;
        outData[i * 4 + 1] = 0;
        outData[i * 4 + 2] = 0;
        outData[i * 4 + 3] = 255;
      }
    }

    outCtx.putImageData(outImageData, 0, 0);

    onStatusChange("completed");
    onComplete(outputCanvas);
  }
}
