"use client";

import React from "react";
import { VideoUpload } from "./video-upload";
import { ExtractionControls } from "./extraction-controls";
import { ExtractionProgress } from "./extraction-progress";
import { FrameViewer } from "./frame-viewer";
import { FrameTimeline } from "./frame-timeline";
import { SessionList } from "./session-list";
import { useVideoStore } from "@/store/video-store";
import { Button } from "@/components/ui/button";
import { History, Film, Keyboard, Info, ArrowLeft } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

function KeyboardShortcuts() {
  const shortcuts = [
    { keys: ["←", "→"], action: "Previous / Next frame" },
    { keys: ["Home", "End"], action: "First / Last frame" },
    { keys: ["+", "-"], action: "Zoom in / out" },
    { keys: ["0"], action: "Reset zoom" },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Keyboard Shortcuts</h3>
      <div className="space-y-2">
        {shortcuts.map(({ keys, action }) => (
          <div key={action} className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">{action}</span>
            <div className="flex items-center gap-1">
              {keys.map((key) => (
                <kbd
                  key={key}
                  className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded border border-border bg-muted text-[11px] font-mono"
                >
                  {key}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function VideoFrameApp() {
  const {
    extractionStatus,
    currentSession,
    setShowSessionList,
    savedSessions,
  } = useVideoStore();

  const showViewer = extractionStatus === "completed" || currentSession;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-4 lg:px-6 h-14">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Film className="w-4.5 h-4.5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">
                Frame Extractor
              </h1>
              <p className="text-[11px] text-muted-foreground leading-tight hidden sm:block">
                Client-side video frame extraction & viewer
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {showViewer && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8"
                    onClick={() => useVideoStore.getState().resetAll()}
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">New Video</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Upload a new video</TooltipContent>
              </Tooltip>
            )}
            {savedSessions.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8"
                    onClick={() => setShowSessionList(true)}
                  >
                    <History className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">History</span>
                    <span className="text-[10px] bg-muted rounded-full px-1.5 py-0.5 font-medium">
                      {savedSessions.length}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  View {savedSessions.length} previous session
                  {savedSessions.length > 1 ? "s" : ""}
                </TooltipContent>
              </Tooltip>
            )}

            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Keyboard shortcuts"
                >
                  <Keyboard className="w-4 h-4" />
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <Keyboard className="w-5 h-5" />
                    Controls & Help
                  </SheetTitle>
                </SheetHeader>
                <div className="mt-6 space-y-6">
                  <KeyboardShortcuts />
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">About</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Frame Extractor processes video files entirely in your
                      browser. No data is uploaded to any server. Extracted
                      frames are stored locally in IndexedDB and persist across
                      sessions.
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Info className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        All processing happens client-side. Your videos stay
                        private.
                      </span>
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        {!showViewer ? (
          <div className="flex-1 flex items-start justify-center p-4 lg:p-8">
            <div className="w-full max-w-2xl space-y-6">
              <div className="space-y-1.5">
                <h2 className="text-2xl font-bold tracking-tight">
                  Extract Frames from Video
                </h2>
                <p className="text-sm text-muted-foreground">
                  Upload a video to extract individual frames. All processing
                  happens locally in your browser — no data leaves your device.
                </p>
              </div>

              <VideoUpload />

              <ExtractionControls />

              <ExtractionProgress />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-3.5rem)]">
            <FrameViewer />
            <FrameTimeline />
          </div>
        )}
      </main>

      <footer className="mt-auto border-t bg-background">
        <div className="flex items-center justify-between px-4 lg:px-6 py-2 text-[11px] text-muted-foreground">
          <span>Frame Extractor • Client-side video processing</span>
          <div className="flex items-center gap-1">
            <span className="hidden sm:inline">Built with Next.js • WebGPU</span>
          </div>
        </div>
      </footer>

      <SessionList />
    </div>
  );
}
