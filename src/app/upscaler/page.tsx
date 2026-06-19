"use client";

import { UpscalerComponent } from "@/components/upscaler/UpscalerComponent";

export default function UpscalerPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            SAFMN Image Upscaler
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
            Client-side 4× super-resolution powered by WebGPU. Your images never
            leave your browser — all processing happens on your GPU.
          </p>
        </div>
        <UpscalerComponent modelPath="/models/safmn_4x.onnx" />
      </div>
    </div>
  );
}
