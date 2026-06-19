/**
 * SAFMN Client-Side WebGPU Image Super-Resolution Engine
 * ============================================================================
 *
 * Implements a 4x image upscaler using the SAFMN (Spatially-Adaptive
 * Feature Modulation Network) architecture via ONNX Runtime Web with
 * a native WebGPU backend.
 *
 * Architecture:
 *   1. Static Tiling Engine  – 1024×1024 patches, 64px overlap, mirror pad
 *   2. Tensor Conversion     – RGBA interleaved ↔ planar Float32 RGB [0,1]
 *   3. ONNX WebGPU Session   – gpu-internal tensors, graph capture, optimized
 *   4. Seamless Stitching    – smoothstep feathered alpha blending
 *   5. Async Chunking        – requestAnimationFrame yields between tiles
 *
 * Target: modern desktop browsers with WebGPU (Chrome 113+, Edge 113+).
 * Optimized for high-tier discrete GPUs (RTX 4060+, RX 7800 XT+).
 */

import * as ort from "onnxruntime-web";

// ============================================================================
// Constants
// ============================================================================

/** Tile dimension in pixels (static for GPU kernel optimization). */
export const TILE_SIZE = 1024;

/** Overlap between adjacent tiles in pixels (eliminates edge artifacts). */
export const OVERLAP = 64;

/** Stride between tile origins. */
const STRIDE = TILE_SIZE - OVERLAP; // 960

/** Upscaling factor. */
export const SCALE_FACTOR = 4;

/** Number of color channels (RGB – alpha is dropped). */
const CHANNELS = 3;

/** Output tile dimension after 4x upscale. */
const OUTPUT_TILE_SIZE = TILE_SIZE * SCALE_FACTOR; // 4096

/** Scaled overlap for blending in output space. */
const OVERLAP_SCALED = OVERLAP * SCALE_FACTOR; // 256

// ============================================================================
// ONNX Runtime Web Environment Configuration
// ============================================================================

/**
 * Configure ort environment once on module load (client-side only).
 * WebGPU backend does not require WASM files, but we set paths as a
 * fallback in case the runtime probes for them during initialization.
 */
if (typeof window !== "undefined") {
  ort.env.wasm.wasmPaths =
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.wasm.proxy = false;
}

// ============================================================================
// Types
// ============================================================================

/** Metadata for a single tile within the tiling grid. */
export interface TileInfo {
  index: number;
  row: number;
  col: number;
  /** Top-left X in the source image. */
  x: number;
  /** Top-left Y in the source image. */
  y: number;
  /** Valid (non-padded) width in source pixels. */
  width: number;
  /** Valid (non-padded) height in source pixels. */
  height: number;
  /** Whether mirror padding is needed to reach TILE_SIZE. */
  needsPadding: boolean;
  isLeftEdge: boolean;
  isRightEdge: boolean;
  isTopEdge: boolean;
  isBottomEdge: boolean;
}

/** Wrapper around the ONNX inference session with resolved I/O names. */
export interface SAFMNSession {
  session: ort.InferenceSession;
  inputName: string;
  outputName: string;
}

/** Options passed to {@link processImage}. */
export interface ProcessingOptions {
  modelPath: string;
  onProgress?: (current: number, total: number, tile: TileInfo) => void;
  shouldCancel?: () => boolean;
  /** Whether to yield to the UI thread between tiles (default: true). */
  yieldBetweenTiles?: boolean;
}

/** Result of probing WebGPU support. */
export interface WebGPUAvailability {
  available: boolean;
  reason?: string;
}

// ============================================================================
// WebGPU Availability Check
// ============================================================================

/**
 * Probe whether the current browser environment supports WebGPU.
 * Returns a descriptive reason string when unavailable.
 */
export async function checkWebGPUAvailability(): Promise<WebGPUAvailability> {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    return {
      available: false,
      reason:
        "WebGPU is not supported in this browser. Please use Chrome 113+, Edge 113+, or another browser with WebGPU enabled.",
    };
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });

    if (!adapter) {
      return {
        available: false,
        reason:
          "No GPU adapter found. Ensure your GPU drivers are up to date and WebGPU is enabled in browser settings (chrome://flags/#enable-unsafe-webgpu).",
      };
    }

    return { available: true };
  } catch (error) {
    return {
      available: false,
      reason: `WebGPU initialization failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Session Initialization
// ============================================================================

/**
 * Initialize the SAFMN ONNX inference session with WebGPU acceleration.
 *
 * Configuration flags:
 *   - executionProviders: ['webgpu']          → native WebGPU backend
 *   - preferredOutputLocation: 'gpu-internal' → keep output tensors in VRAM
 *   - optimize_for_webgpu: "1"                → WebGPU-specific graph opts
 *   - enable_graph_capture: "1"               → capture GPU command buffers
 *
 * @param modelPath URL or path to the SAFMN .onnx model file
 */
export async function initSAFMNSession(
  modelPath: string
): Promise<SAFMNSession> {
  const availability = await checkWebGPUAvailability();
  if (!availability.available) {
    throw new Error(availability.reason);
  }

  try {
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ["webgpu"],
      preferredOutputLocation: "gpu-internal" as any,
      graphOptimizationLevel: "all",
      enableMemPattern: true,
      config: {
        optimize_for_webgpu: "1",
        enable_graph_capture: "1",
      },
    } as ort.InferenceSession.SessionOptions);

    return {
      session,
      inputName: session.inputNames[0],
      outputName: session.outputNames[0],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    if (/device\s*lost/i.test(msg)) {
      throw new Error(
        "GPU device was lost during model initialization. This may indicate a driver crash or insufficient GPU memory. Please update your GPU drivers and try again."
      );
    }

    if (/webgpu/i.test(msg)) {
      throw new Error(
        `Failed to initialize WebGPU inference session: ${msg}. Please check your browser's WebGPU configuration.`
      );
    }

    throw new Error(`Failed to load SAFMN model: ${msg}`);
  }
}

// ============================================================================
// Tiling Algorithm
// ============================================================================

/**
 * Calculate the full set of tiles needed to cover an image of the given
 * dimensions. Tiles are 1024×1024 with 64px overlap. The last tile along
 * each axis is shifted inward so its right/bottom edge aligns with the
 * image boundary, ensuring full coverage without gaps.
 *
 * Edge tiles smaller than 1024×1024 are flagged for mirror padding.
 */
export function calculateTiles(
  imageWidth: number,
  imageHeight: number
): TileInfo[] {
  const xPositions = calculateAxisPositions(imageWidth);
  const yPositions = calculateAxisPositions(imageHeight);

  const tiles: TileInfo[] = [];
  let index = 0;

  for (let row = 0; row < yPositions.length; row++) {
    for (let col = 0; col < xPositions.length; col++) {
      const x = xPositions[col];
      const y = yPositions[row];
      const width = Math.min(TILE_SIZE, imageWidth - x);
      const height = Math.min(TILE_SIZE, imageHeight - y);

      tiles.push({
        index,
        row,
        col,
        x,
        y,
        width,
        height,
        needsPadding: width < TILE_SIZE || height < TILE_SIZE,
        isLeftEdge: col === 0,
        isRightEdge: col === xPositions.length - 1,
        isTopEdge: row === 0,
        isBottomEdge: row === yPositions.length - 1,
      });
      index++;
    }
  }

  return tiles;
}

/**
 * Compute tile start positions along a single axis.
 *
 * For length ≤ TILE_SIZE: a single tile at position 0.
 * Otherwise: tiles at 0, STRIDE, 2*STRIDE, … with the final tile
 * shifted to (length − TILE_SIZE) so the right edge is fully covered.
 */
function calculateAxisPositions(length: number): number[] {
  if (length <= TILE_SIZE) {
    return [0];
  }

  const positions: number[] = [];
  let pos = 0;

  while (pos + TILE_SIZE < length) {
    positions.push(pos);
    pos += STRIDE;
  }

  // Final tile: shift inward to cover the trailing edge
  const lastPos = length - TILE_SIZE;
  if (positions[positions.length - 1] !== lastPos) {
    positions.push(lastPos);
  }

  return positions;
}

// ============================================================================
// Tensor Format Conversion
// ============================================================================

/**
 * Convert ImageData (interleaved RGBA, Uint8) to a planar Float32 RGB
 * tensor normalized to [0.0, 1.0]. The alpha channel is dropped.
 *
 * Output layout: NCHW → [R-plane, G-plane, B-plane] concatenated,
 * shape [1, 3, height, width].
 *
 * This is the format expected by the SAFMN ONNX model.
 */
export function imageDataToTensor(
  imageData: ImageData,
  width: number,
  height: number
): Float32Array {
  const tensor = new Float32Array(CHANNELS * width * height);
  const planeSize = width * height;
  const src = imageData.data;

  // Single-pass deinterleave: read RGBA, write planar RGB
  for (let i = 0; i < planeSize; i++) {
    const srcIdx = i << 2; // i * 4
    tensor[i] = src[srcIdx] * (1 / 255);               // R plane
    tensor[planeSize + i] = src[srcIdx + 1] * (1 / 255); // G plane
    tensor[(planeSize << 1) + i] = src[srcIdx + 2] * (1 / 255); // B plane
  }

  return tensor;
}

/**
 * Convert a planar Float32 RGB tensor (normalized [0, 1]) back to
 * interleaved RGBA ImageData suitable for canvas rendering.
 *
 * Input layout: NCHW → [R-plane, G-plane, B-plane], shape [1, 3, H, W].
 * Alpha is set to 255 (fully opaque).
 */
export function tensorToImageData(
  tensor: Float32Array,
  width: number,
  height: number
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  const planeSize = width * height;

  for (let i = 0; i < planeSize; i++) {
    const dstIdx = i << 2; // i * 4
    data[dstIdx] = tensor[i] * 255;                        // R
    data[dstIdx + 1] = tensor[planeSize + i] * 255;        // G
    data[dstIdx + 2] = tensor[(planeSize << 1) + i] * 255; // B
    data[dstIdx + 3] = 255;                                // A
  }

  return new ImageData(data, width, height);
}

// ============================================================================
// Mirror Padding
// ============================================================================

/**
 * Mirror-pad (reflect) an ImageData to the target dimensions.
 *
 * Pixels beyond the source boundary are filled by reflecting across
 * the edge, producing seamless padding that minimizes boundary
 * artifacts in the super-resolution output.
 *
 *   coordinate mapping:  src = 2*dim - dst - 2  (for dst ≥ dim)
 *
 * This forces every tile to exactly [TILE_SIZE × TILE_SIZE], keeping
 * tensor shapes completely static for GPU execution optimization.
 */
export function mirrorPadImageData(
  src: ImageData,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number
): ImageData {
  if (srcWidth === targetWidth && srcHeight === targetHeight) {
    return src;
  }

  const padded = new ImageData(targetWidth, targetHeight);
  const srcData = src.data;
  const dstData = padded.data;

  for (let y = 0; y < targetHeight; y++) {
    // Reflect y across the bottom edge
    let sy = y < srcHeight ? y : (srcHeight << 1) - y - 2;
    if (sy < 0) sy = 0;
    else if (sy >= srcHeight) sy = srcHeight - 1;

    const srcRowOffset = sy * srcWidth;
    const dstRowOffset = y * targetWidth;

    for (let x = 0; x < targetWidth; x++) {
      // Reflect x across the right edge
      let sx = x < srcWidth ? x : (srcWidth << 1) - x - 2;
      if (sx < 0) sx = 0;
      else if (sx >= srcWidth) sx = srcWidth - 1;

      const srcIdx = (srcRowOffset + sx) << 2;
      const dstIdx = (dstRowOffset + x) << 2;

      dstData[dstIdx] = srcData[srcIdx];
      dstData[dstIdx + 1] = srcData[srcIdx + 1];
      dstData[dstIdx + 2] = srcData[srcIdx + 2];
      dstData[dstIdx + 3] = srcData[srcIdx + 3];
    }
  }

  return padded;
}

// ============================================================================
// Tile Extraction
// ============================================================================

/**
 * Extract a single tile from the source canvas context.
 *
 * If the tile extends beyond the image boundary (needsPadding), the
 * extracted ImageData is mirror-padded to exactly [TILE_SIZE × TILE_SIZE].
 */
function extractTile(
  sourceCtx: CanvasRenderingContext2D,
  tile: TileInfo
): ImageData {
  const raw = sourceCtx.getImageData(tile.x, tile.y, tile.width, tile.height);

  if (tile.needsPadding) {
    return mirrorPadImageData(raw, tile.width, tile.height, TILE_SIZE, TILE_SIZE);
  }

  return raw;
}

// ============================================================================
// Blending / Stitching
// ============================================================================

/**
 * Hermite smoothstep for feathered alpha transitions.
 * Produces C¹-continuous (tangent-matched) ramps, eliminating visible seams.
 *
 *   smoothstep(t) = t² × (3 − 2t),  t ∈ [0, 1]
 */
function smoothStep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Apply feathered alpha to a tile's ImageData for seamless blending.
 *
 * Only the **left** and **top** edges are feathered — tiles are drawn
 * left-to-right, top-to-bottom, so those edges overlap with previously
 * drawn tiles. The right and bottom edges are left at full opacity
 * because they will be overlapped by future tiles or are at the image
 * boundary.
 *
 * The feathering uses a smoothstep ramp over OVERLAP_SCALED pixels
 * (256px in 4x output space) for artifact-free transitions.
 *
 * Optimization: only the overlap strips are iterated, not the full tile.
 */
function applyFeatheredAlpha(
  imageData: ImageData,
  tile: TileInfo,
  validWidth: number,
  validHeight: number
): void {
  const data = imageData.data;
  const width = imageData.width;

  // --- Feather left edge (overlap with tile to the left) ---
  if (!tile.isLeftEdge) {
    const stripWidth = Math.min(OVERLAP_SCALED, validWidth);
    for (let x = 0; x < stripWidth; x++) {
      const alpha = Math.round(255 * smoothStep(x / OVERLAP_SCALED));
      for (let y = 0; y < validHeight; y++) {
        const idx = (y * width + x) * 4 + 3;
        if (data[idx] > alpha) data[idx] = alpha;
      }
    }
  }

  // --- Feather top edge (overlap with tile above) ---
  if (!tile.isTopEdge) {
    const stripHeight = Math.min(OVERLAP_SCALED, validHeight);
    for (let y = 0; y < stripHeight; y++) {
      const alpha = Math.round(255 * smoothStep(y / OVERLAP_SCALED));
      for (let x = 0; x < validWidth; x++) {
        const idx = (y * width + x) * 4 + 3;
        if (data[idx] > alpha) data[idx] = alpha;
      }
    }
  }
}

/**
 * Blend a processed tile onto the output canvas at the given position.
 *
 * 1. Applies feathered alpha to the left/top overlap strips
 * 2. Renders the tile to a temporary canvas
 * 3. Draws the valid (non-padded) region onto the output canvas
 *    using source-over compositing for smooth transitions
 */
function blendTile(
  outputCtx: CanvasRenderingContext2D,
  tileImageData: ImageData,
  outX: number,
  outY: number,
  tile: TileInfo,
  validWidth: number,
  validHeight: number
): void {
  // Apply feathered alpha for seamless stitching
  applyFeatheredAlpha(tileImageData, tile, validWidth, validHeight);

  // Render tile to a temporary canvas
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = tileImageData.width;
  tempCanvas.height = tileImageData.height;
  const tempCtx = tempCanvas.getContext("2d")!;
  tempCtx.putImageData(tileImageData, 0, 0);

  // Draw the valid region onto the output canvas
  outputCtx.drawImage(
    tempCanvas,
    0,
    0,
    validWidth,
    validHeight,
    outX,
    outY,
    validWidth,
    validHeight
  );
}

// ============================================================================
// Main Processing Pipeline
// ============================================================================

/**
 * Process an image through the SAFMN 4x super-resolution pipeline.
 *
 * Pipeline steps per tile:
 *   1. Extract 1024×1024 tile from source (mirror-pad if needed)
 *   2. Convert to planar Float32 RGB tensor [1, 3, 1024, 1024]
 *   3. Run ONNX inference on WebGPU (output stays in gpu-internal)
 *   4. Download output tensor and convert to ImageData [4096×4096]
 *   5. Blend tile onto output canvas with feathered alpha
 *   6. Yield to UI thread via requestAnimationFrame
 *
 * @param source     Input image element or canvas
 * @param session    Initialized SAFMN session (see {@link initSAFMNSession})
 * @param options    Processing options (progress callback, cancellation, etc.)
 * @returns          Canvas containing the 4x upscaled image
 */
export async function processImage(
  source: HTMLImageElement | HTMLCanvasElement,
  safmnSession: SAFMNSession,
  options: ProcessingOptions
): Promise<HTMLCanvasElement> {
  const { onProgress, shouldCancel, yieldBetweenTiles = true } = options;

  const imageWidth = source.width;
  const imageHeight = source.height;

  // --- Prepare source canvas for pixel access ---
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = imageWidth;
  sourceCanvas.height = imageHeight;
  const sourceCtx = sourceCanvas.getContext("2d", {
    willReadFrequently: true,
  })!;
  sourceCtx.drawImage(source, 0, 0);

  // --- Calculate tile grid ---
  const tiles = calculateTiles(imageWidth, imageHeight);
  const totalTiles = tiles.length;

  // --- Create output canvas at 4x resolution ---
  const outputWidth = imageWidth * SCALE_FACTOR;
  const outputHeight = imageHeight * SCALE_FACTOR;
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const outputCtx = outputCanvas.getContext("2d")!;

  // Fill with black to avoid transparent artifacts in overlap corners
  outputCtx.fillStyle = "#000000";
  outputCtx.fillRect(0, 0, outputWidth, outputHeight);

  // --- Process each tile ---
  for (let i = 0; i < totalTiles; i++) {
    // Check for user cancellation
    if (shouldCancel?.()) {
      throw new Error("Processing cancelled by user");
    }

    const tile = tiles[i];

    // Step 1: Extract tile from source (with mirror padding if needed)
    const tileImageData = extractTile(sourceCtx, tile);

    // Step 2: Convert to planar Float32 tensor [1, 3, 1024, 1024]
    const inputData = imageDataToTensor(tileImageData, TILE_SIZE, TILE_SIZE);

    // Step 3: Create ONNX tensor and run inference
    //   Input goes CPU → GPU; output stays in gpu-internal (VRAM)
    const inputTensor = new ort.Tensor("float32", inputData, [
      1,
      CHANNELS,
      TILE_SIZE,
      TILE_SIZE,
    ]);

    let outputTensor: ort.Tensor;
    try {
      const feeds: Record<string, ort.Tensor> = {};
      feeds[safmnSession.inputName] = inputTensor;
      const results = await safmnSession.session.run(feeds);
      outputTensor = results[safmnSession.outputName];
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/device\s*lost/i.test(msg)) {
        throw new Error(
          "GPU device was lost during inference. This may indicate insufficient VRAM or a driver issue. Try using a smaller image or updating your GPU drivers."
        );
      }
      throw new Error(
        `Inference failed on tile ${i + 1}/${totalTiles}: ${msg}`
      );
    }

    // Step 4: Download output from gpu-internal and convert to ImageData
    //   The data property triggers a GPU → CPU readback for WebGPU tensors.
    const outputData = outputTensor.data as Float32Array;
    const outputImageData = tensorToImageData(
      outputData,
      OUTPUT_TILE_SIZE,
      OUTPUT_TILE_SIZE
    );

    // Step 5: Calculate valid (non-padded) region in output space
    const validWidth = tile.width * SCALE_FACTOR;
    const validHeight = tile.height * SCALE_FACTOR;
    const outX = tile.x * SCALE_FACTOR;
    const outY = tile.y * SCALE_FACTOR;

    // Step 6: Blend tile onto output canvas with feathered edges
    blendTile(outputCtx, outputImageData, outX, outY, tile, validWidth, validHeight);

    // Report progress
    onProgress?.(i + 1, totalTiles, tile);

    // Yield to UI thread to prevent "Page Unresponsive" warnings
    if (yieldBetweenTiles && i < totalTiles - 1) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
    }
  }

  return outputCanvas;
}

// ============================================================================
// Session Disposal
// ============================================================================

/**
 * Release the ONNX inference session and free GPU resources.
 * Safe to call multiple times.
 */
export async function disposeSession(
  safmnSession: SAFMNSession
): Promise<void> {
  try {
    await safmnSession.session.release();
  } catch {
    // Session may already be released — ignore
  }
}
