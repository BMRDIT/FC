"use client";

import React, { useCallback } from "react";
import { useVideoStore } from "@/store/video-store";
import { getAllSessions, deleteSession } from "@/lib/frame-db";
import { formatFileSize, formatDuration } from "@/lib/frame-extractor";
import {
  History,
  Trash2,
  Play,
  Clock,
  Film,
  Layers,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { VideoSession } from "@/lib/frame-db";

export function SessionList() {
  const {
    savedSessions,
    setSavedSessions,
    showSessionList,
    setShowSessionList,
    setCurrentSession,
    setTotalFrames,
    setSelectedFrameIndex,
    setVideoDuration,
    setVideoWidth,
    setVideoHeight,
    setVideoFps,
    setExtractionStatus,
  } = useVideoStore();

  const loadSessions = useCallback(async () => {
    try {
      const sessions = await getAllSessions();
      setSavedSessions(sessions);
    } catch (error) {
      console.error("Failed to load sessions:", error);
    }
  }, [setSavedSessions]);

  React.useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleLoadSession = async (session: VideoSession) => {
    setCurrentSession(session);
    setTotalFrames(session.frameCount);
    setSelectedFrameIndex(0);
    setVideoDuration(session.duration);
    setVideoWidth(session.width);
    setVideoHeight(session.height);
    setVideoFps(session.fps);
    setExtractionStatus("completed");
    setShowSessionList(false);
  };

  const handleDeleteSession = async (sessionId: string) => {
    await deleteSession(sessionId);
    await loadSessions();
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (!showSessionList) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 pb-16 px-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setShowSessionList(false)}
        aria-hidden
      />

      <div className="relative w-full max-w-lg bg-background rounded-xl border shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Previous Sessions</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowSessionList(false)}
            aria-label="Close session list"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <ScrollArea className="max-h-[60vh]">
          {savedSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Film className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                No previous sessions found
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Extracted video sessions will appear here
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {savedSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Layers className="w-5 h-5 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium truncate">
                      {session.fileName}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Film className="w-3 h-3" />
                        {session.frameCount.toLocaleString()} frames
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDuration(session.duration)}
                      </span>
                      <span>{formatFileSize(session.fileSize)}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {session.extractionMethod.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground/60">
                      {formatDate(session.createdAt)} • {session.width}×
                      {session.height}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => handleLoadSession(session)}
                    >
                      <Play className="w-3.5 h-3.5" />
                      Load
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          aria-label={`Delete session ${session.fileName}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Session</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete &quot;{session.fileName}&quot;?
                            This will remove all {session.frameCount.toLocaleString()} extracted
                            frames from storage. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => handleDeleteSession(session.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
