// Copies onnxruntime-web's runtime assets (.wasm / .mjs) into public/ort so they
// are served same-origin instead of from a CDN. This honors the app's
// "no servers, fully private" promise and keeps a strict CSP (connect-src 'self')
// working. Runs on postinstall and before dev/build. Safe to run repeatedly.
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

function findOrtDist() {
  // Resolve onnxruntime-web's dist dir without importing the browser bundle.
  const candidates = [join(projectRoot, "node_modules", "onnxruntime-web", "dist")];
  try {
    const pkg = import.meta.resolve
      ? fileURLToPath(import.meta.resolve("onnxruntime-web/package.json"))
      : null;
    if (pkg) candidates.unshift(join(dirname(pkg), "dist"));
  } catch {
    /* resolution not available; fall back to node_modules path */
  }
  return candidates.find((c) => existsSync(c));
}

const dist = findOrtDist();
if (!dist) {
  console.warn(
    "[copy-ort-assets] onnxruntime-web not found yet; skipping (will run again on next install/build).",
  );
  process.exit(0);
}

const outDir = join(projectRoot, "public", "ort");
mkdirSync(outDir, { recursive: true });

const wanted = (name) =>
  name.endsWith(".wasm") || name.endsWith(".mjs") || name.endsWith(".js");

let copied = 0;
for (const name of readdirSync(dist)) {
  const src = join(dist, name);
  if (!statSync(src).isFile() || !wanted(name)) continue;
  copyFileSync(src, join(outDir, name));
  copied++;
}

console.log(`[copy-ort-assets] copied ${copied} file(s) to public/ort/`);
