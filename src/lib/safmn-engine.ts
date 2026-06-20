/**
 * SAFMN Engine — Client-side 4× image super-resolution via ONNX Runtime Web (WebGPU)
 *
 * Architecture:
 *   1. Static Tiling Engine — 1024×1024 patches with 64px overlap, mirror-padded to exact [1,3,1024,1024]
 *   2. Tensor Format Conversion — interleaved RGBA ↔ planar normalized Float32
 *   3. ONNX Runtime WebGPU Session — tensors kept in gpu-internal (VRAM) as long as possible
 *   4. Feathered Blending / Stitching — cosine-window blending to eliminate grid lines
 *
 * Target: modern desktop browsers with WebGPU, high-tier discrete GPUs (RTX 4060+, RX 7800 XT+)
 */

import ort from "onnxruntime-web";

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── WebGPU Detection ──────────────────────────────────────────────────────────

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

// ─── Tile Grid Computation ────────────────────────────────────────────────────

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

  // Number of tiles needed per axis (ceil division by stride).
  const cols = Math.max(1, Math.ceil(srcWidth / STRIDE));
  const rows = Math.max(1, Math.ceil(srcHeight / STRIDE));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Ideal origin
      let srcX = col * STRIDE;
      let srcY = row * STRIDE;

      // Clamp the last tile so it doesn't exceed the image bounds.
      // This shifts the final tile backwards to fit within the image.
      if (srcX + TILE_SIZE > srcWidth) {
        srcX = Math.max(0, srcWidth - TILE_SIZE);
      }
      if (srcY + TILE_SIZE > srcHeight) {
        srcY = Math.max(0, srcHeight - TILE_SIZE);
      }

      // Actual valid content dimensions (may be < TILE_SIZE at edges).
      const srcW = Math.min(TILE_SIZE, srcWidth - srcX);
      const srcH = Math.min(TILE_SIZE, srcHeight - srcY);

      // Output coordinates — scale by UPSCALE_FACTOR.
      const outX = srcX * UPSCALE_FACTOR;
      const outY = srcY * UPSCALE_FACTOR;
      const outW = srcW * UPSCALE_FACTOR;
      const outH = srcH * UPSCALE_FACTOR;

      tiles.push({ col, row, srcX, srcY, srcW, srcH, outX, outY, outW, outH });
    }
  }

  return tiles;
}

// ─── Mirror Padding ───────────────────────────────────────────────────────────

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
 * @param srcW       Valid width of source data in this tile.
 * @param srcH       Valid height of source data in this tile.
 * @returns Uint8ClampedArray of length TILE_SIZE*TILE_SIZE*4 (RGBA), mirror-padded.
 */
function extractMirrorPaddedTile(
  srcData: ImageData,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number,
): Uint8ClampedArray {
  const { data: src, width: srcImgW } = srcData;
  const padded = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);

  for (let y = 0; y < TILE_SIZE; y++) {
    // Map padded y → source y with mirroring for out-of-bounds.
    let sy = srcY + y;
    if (sy < 0) sy = -sy;                         // mirror top
    if (sy >= srcData.height) {
      sy = 2 * srcData.height - sy - 2;           // mirror bottom
    }
    // Clamp as a safety net (mirror math can still overshoot by 1 on odd dims).
    sy = Math.max(0, Math.min(srcData.height - 1, sy));

    for (let x = 0; x < TILE_SIZE; x++) {
      let sx = srcX + x;
      if (sx < 0) sx = -sx;                       // mirror left
      if (sx >= srcImgW) {
        sx = 2 * srcImgW - sx - 2;                // mirror right
      }
      sx = Math.max(0, Math.min(srcImgW - 1, sx));

      const srcIdx = (sy * srcImgW + sx) * 4;
      const dstIdx = (y * TILE_SIZE + x) * 4;

      padded[dstIdx]     = src[srcIdx];     // R
      padded[dstIdx + 1] = src[srcIdx + 1]; // G
      padded[dstIdx + 2] = src[srcIdx + 2]; // B
      padded[dstIdx + 3] = 255;             // A (opaque)
    }
  }

  return padded;
}

// ─── Tensor Format Conversion ─────────────────────────────────────────────────

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

  // Channel offsets for planar layout: R at [0, pc), G at [pc, 2*pc), B at [2*pc, 3*pc).
  const rOffset = 0;
  const gOffset = pixelCount;
  const bOffset = 2 * pixelCount;

  for (let i = 0; i < pixelCount; i++) {
    const rgbaIdx = i * 4;
    planar[rOffset + i] = rgba[rgbaIdx]     / 255.0;
    planar[gOffset + i] = rgba[rgbaIdx + 1] / 255.0;
    planar[bOffset + i] = rgba[rgbaIdx + 2] / 255.0;
    // Alpha is dropped — SAFMN operates on RGB only.
  }

  return planar;
}

/**
 * Convert a planar normalized Float32 tensor [1, 3, H, W] back to interleaved
 * RGBA Uint8ClampedArray with alpha = 255.
 *
 * Values are clamped to [0, 255] after denormalization.
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

    // Denormalize and clamp to valid byte range.
    rgba[rgbaIdx]     = Math.max(0, Math.min(255, Math.round(planar[rOffset + i] * 255.0)));
    rgba[rgbaIdx + 1] = Math.max(0, Math.min(255, Math.round(planar[gOffset + i] * 255.0)));
    rgba[rgbaIdx + 2] = Math.max(0, Math.min(255, Math.round(planar[bOffset + i] * 255.0)));
    rgba[rgbaIdx + 3] = 255; // Fully opaque output.
  }

  return rgba;
}

// ─── Blending Weights (Cosine Window) ─────────────────────────────────────────

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

  // The overlap region in output space, clamped to half the valid dimension
  // so small tiles don't have overlapping taper zones that zero out all weights.
  const ovX = Math.min(OUTPUT_OVERLAP, Math.floor(validW / 2));
  const ovY = Math.min(OUTPUT_OVERLAP, Math.floor(validH / 2));

  for (let y = 0; y < validH; y++) {
    // Distance from nearest top/bottom edge of the valid region.
    let dy = 0;
    if (y < ovY) {
      dy = (ovY - y) / ovY;           // taper from top
    } else if (y >= validH - ovY) {
      dy = (y - (validH - ovY - 1)) / ovY; // taper from bottom
    }
    // Raised-cosine: 0.5 * (1 + cos(pi * d))  → 1.0 at center, 0.0 at edge.
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

// ─── SAFMN Engine ─────────────────────────────────────────────────────────────

/**
 * Main SAFMN super-resolution engine.
 *
 * Manages the ONNX Runtime Web session, processes tiles, and stitches results.
 * Tensors are kept in gpu-internal (VRAM) between operations to avoid
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
   *   - preferredOutputLocation: 'gpu-internal' (keep tensors in VRAM)
   *   - optimize_for_webgpu: "1"
   *   - enable_graph_capture: "1"
   *
   * @throws Error if WebGPU is unavailable or the model fails to load.
   */
  async init(): Promise<void> {
    if (!isWebGPUSupported()) {
      throw new Error(
        "WebGPU is not supported in this browser. Please use a recent version of Chrome, Edge, or another WebGPU-enabled browser.",
      );
    }

    // Verify a GPU adapter is actually available.
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) {
      throw new Error(
        "No WebGPU adapter found. Your GPU or browser may not support WebGPU. Check your browser configuration or hardware drivers.",
      );
    }

    try {
      this.session = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ["webgpu"],
        preferredOutputLocation: "gpu-internal" as any,
        config: {
          optimize_for_webgpu: "1",
          enable_graph_capture: "1",
        },
      } as any);
    } catch (err) {
      // Distinguish "Device Lost" / GPU handshake failures from generic errors.
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
   * The input tensor is created with location 'gpu-internal' so it stays in VRAM.
   * The output tensor is also read from gpu-internal, then downloaded to CPU
   * only when we need to stitch it into the canvas.
   *
   * @param tileRGBA  Mirror-padded RGBA tile data (TILE_SIZE×TILE_SIZE×4).
   * @returns Float32Array containing the upscaled planar output.
   */
  private async runTileInference(tileRGBA: Uint8ClampedArray): Promise<Float32Array> {
    if (!this.session) {
      throw new Error("SAFMN engine not initialized. Call init() first.");
    }

    // Convert RGBA → planar Float32 [1, 3, 1024, 1024].
    const inputData = rgbaToPlanarFloat32(tileRGBA, TILE_SIZE, TILE_SIZE);

    // Create input tensor — gpu-internal keeps it in VRAM.
    const inputTensor = new ort.Tensor(
      "float32",
      inputData,
      [1, 3, TILE_SIZE, TILE_SIZE],
    );

    // Run inference. The session's preferredOutputLocation keeps the result in VRAM.
    const inputName = this.session.inputNames[0];
    const feeds: Record<string, ort.Tensor> = {};
    feeds[inputName] = inputTensor;

    const results = await this.session.run(feeds);
    const outputName = this.session.outputNames[0];
    const outputTensor = results[outputName];

    // Download from gpu-internal to CPU for stitching.
    // The tensor data is a Float32Array in planar [1, 3, H_out, W_out] layout.
    return outputTensor.data as Float32Array;
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
   */
  async upscale(
    sourceCanvas: HTMLCanvasElement,
    callbacks: UpscaleCallbacks,
  ): Promise<void> {
    const { onProgress, onStatusChange, onTileComplete, onError, onComplete } = callbacks;

    if (!this.session) {
      onError("SAFMN engine not initialized. Call init() first.");
      return;
    }

    const srcWidth = sourceCanvas.width;
    const srcHeight = sourceCanvas.height;

    // Extract full source ImageData once.
    const srcCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!srcCtx) {
      onError("Failed to get 2D context from source canvas.");
      return;
    }
    const srcImageData = srcCtx.getImageData(0, 0, srcWidth, srcHeight);

    // Compute tile grid.
    const tiles = computeTileGrid(srcWidth, srcHeight);
    const totalTiles = tiles.length;

    onStatusChange("processing");
    onProgress(0, totalTiles);

    // Create output canvas at 4× resolution.
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

    // We accumulate weighted color and weights separately, then normalize.
    // This handles overlapping tiles correctly.
    const colorAccum = new Float32Array(outWidth * outHeight * 3); // RGB accum
    const weightAccum = new Float32Array(outWidth * outHeight);

    // Process tiles in chunks, yielding to the event loop between chunks.
    for (let i = 0; i < totalTiles; i += this.tilesPerChunk) {
      const chunkEnd = Math.min(i + this.tilesPerChunk, totalTiles);

      for (let j = i; j < chunkEnd; j++) {
        const tile = tiles[j];

        try {
          // 1. Extract + mirror-pad tile to [1024, 1024, 4].
          const tileRGBA = extractMirrorPaddedTile(
            srcImageData,
            tile.srcX,
            tile.srcY,
            tile.srcW,
            tile.srcH,
          );

          // 2. Run SAFMN inference → upscaled planar Float32 [1, 3, 4096, 4096].
          const outputPlanar = await this.runTileInference(tileRGBA);

          // 3. Convert output planar → RGBA.
          const outputRGBA = planarFloat32ToRGBA(
            outputPlanar,
            OUTPUT_TILE_SIZE,
            OUTPUT_TILE_SIZE,
          );

          // 4. Blend valid region into accumulation buffers.
          const blendWeights = computeBlendWeights(tile.outW, tile.outH);

          for (let py = 0; py < tile.outH; py++) {
            for (let px = 0; px < tile.outW; px++) {
              const outGlobalX = tile.outX + px;
              const outGlobalY = tile.outY + py;
              const globalIdx = outGlobalY * outWidth + outGlobalX;

              // Source pixel in the output tile (skip padding region).
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
          // Check for device-lost errors during inference.
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

      // Update progress after the chunk.
      onProgress(chunkEnd, totalTiles);

      // Yield to the event loop so the UI can paint and stay responsive.
      // Using setTimeout(0) is more reliable than requestAnimationFrame for
      // long-running compute because it doesn't get throttled in background tabs.
      if (chunkEnd < totalTiles) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    // 5. Normalize accumulated colors and write to output canvas.
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
        // Fallback for any pixel not covered by a tile (shouldn't happen with correct grid).
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
