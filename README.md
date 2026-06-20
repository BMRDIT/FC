# Frame Extractor

A 100% client-side tool to extract individual frames from video files (HTML5 video +
canvas) and optionally upscale them **4×** with the **SAFMN** super-resolution model
running in the browser via **ONNX Runtime Web (WebGPU)**. No uploads, no servers — every
byte stays on the device. Frames persist locally in IndexedDB.

## Requirements

- Node.js 20+
- A WebGPU-capable browser (recent Chrome/Edge) for the 4× upscaling feature
- The SAFMN ONNX model (see below) — required only for upscaling

## Setup

```bash
npm install        # also self-hosts ONNX Runtime assets into public/ort (postinstall)
npm run dev        # http://localhost:3000
```

### The SAFMN model (required for upscaling)

The model weights are **not** committed to the repo (large binary; distribute out of band).
Frame extraction works without it; the **Enhance / 4×** feature needs it.

1. Obtain a SAFMN ×4 model exported to ONNX with a static `[1, 3, 1024, 1024]` input
   (see the SAFMN project: https://github.com/sunny2109/SAFMN).
2. Place it at:

   ```
   public/models/safmn_4x.onnx
   ```

3. (Optional) Serve it from a different path/origin by setting an env var:

   ```bash
   # .env.local
   NEXT_PUBLIC_SAFMN_MODEL_PATH="/models/safmn_4x.onnx"
   ```

   If you host the model on another origin, also add that origin to `connect-src`
   in the CSP (`src/proxy.ts`).

If the model is missing, the app shows a clear "model not found" message instead of
failing opaquely.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SAFMN_MODEL_PATH` | `/models/safmn_4x.onnx` | Where the ONNX model is served from |
| `NEXT_PUBLIC_SAFMN_MAX_SOURCE_PIXELS` | `2500000` | Max source pixels per upscale (memory guard) |

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the dev server on port 3000 |
| `npm run build` | Production build (Next.js standalone output) |
| `npm run start` | Run the standalone production server with Node |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run copy-ort-assets` | Re-copy ONNX Runtime wasm/worker assets into `public/ort` |

## Architecture

- `src/lib/frame-extractor.ts` — video → canvas → JPEG-blob extraction (cancellable,
  with storage-quota handling).
- `src/lib/frame-db.ts` — Dexie/IndexedDB persistence (sessions, frames, thumbnails).
- `src/lib/safmn-engine.ts` — tiled SAFMN inference on WebGPU with feathered blending.
- `src/store/video-store.ts` — Zustand app state (owns object-URL lifecycles).
- `src/components/video-frame-app/*` — UI (upload, controls, viewer, timeline, sessions).

## Security

- Per-request **Content-Security-Policy** with a nonce is set in `src/proxy.ts`;
  other security headers are in `next.config.ts`.
- ONNX Runtime's WASM/worker assets are self-hosted (`public/ort`) so nothing loads
  from a CDN.

## Notes / limitations

- Extraction is **time-based seeking**, so captured frames land on the nearest decodable
  frame to each timestamp rather than guaranteed exact source frames. The "extraction
  rate" is independent of the source video's true fps.
- Upscaling is memory-intensive; very large frames are rejected by the
  `NEXT_PUBLIC_SAFMN_MAX_SOURCE_PIXELS` guard.
