import Dexie, { type EntityTable } from "dexie";

export interface VideoSession {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  duration: number;
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  extractionMethod: "webcodecs" | "canvas" | "ffmpeg";
  createdAt: number;
  thumbnailBlob?: Blob;
}

export interface FrameData {
  id: string;
  sessionId: string;
  frameIndex: number;
  timestamp: number; // in seconds
  width: number;
  height: number;
  blob: Blob;
}

export interface ThumbnailData {
  id: string;
  sessionId: string;
  frameIndex: number;
  timestamp: number;
  width: number;
  height: number;
  blob: Blob;
}

class FrameDatabase extends Dexie {
  sessions!: EntityTable<VideoSession, "id">;
  frames!: EntityTable<FrameData, "id">;
  thumbnails!: EntityTable<ThumbnailData, "id">;

  constructor() {
    super("VideoFrameExtractorDB");

    this.version(1).stores({
      sessions: "id, createdAt, fileName",
      frames: "id, sessionId, frameIndex, [sessionId+frameIndex]",
      thumbnails: "id, sessionId, frameIndex, [sessionId+frameIndex]",
    });
  }
}

export const frameDb = new FrameDatabase();

// Helper to generate a unique session ID
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

// Get all saved sessions
export async function getAllSessions(): Promise<VideoSession[]> {
  return frameDb.sessions.orderBy("createdAt").reverse().toArray();
}

// Get a session by ID
export async function getSession(
  id: string
): Promise<VideoSession | undefined> {
  return frameDb.sessions.get(id);
}

// Get frames for a session, paginated
export async function getFramesForSession(
  sessionId: string,
  offset: number = 0,
  limit: number = 100
): Promise<FrameData[]> {
  return frameDb.frames
    .where("sessionId")
    .equals(sessionId)
    .offset(offset)
    .limit(limit)
    .toArray();
}

// Get a single frame by index
export async function getFrame(
  sessionId: string,
  frameIndex: number
): Promise<FrameData | undefined> {
  return frameDb.frames
    .where("[sessionId+frameIndex]")
    .equals([sessionId, frameIndex])
    .first();
}

// Get thumbnails for a session
export async function getThumbnailsForSession(
  sessionId: string
): Promise<ThumbnailData[]> {
  return frameDb.thumbnails
    .where("sessionId")
    .equals(sessionId)
    .sortBy("frameIndex");
}

// Get a single thumbnail
export async function getThumbnail(
  sessionId: string,
  frameIndex: number
): Promise<ThumbnailData | undefined> {
  return frameDb.thumbnails
    .where("[sessionId+frameIndex]")
    .equals([sessionId, frameIndex])
    .first();
}

// Delete a session and all associated frames/thumbnails
export async function deleteSession(sessionId: string): Promise<void> {
  await frameDb.transaction("rw", [frameDb.sessions, frameDb.frames, frameDb.thumbnails], async () => {
    await frameDb.frames.where("sessionId").equals(sessionId).delete();
    await frameDb.thumbnails.where("sessionId").equals(sessionId).delete();
    await frameDb.sessions.delete(sessionId);
  });
}

// Store a frame blob
export async function storeFrame(
  sessionId: string,
  frameIndex: number,
  timestamp: number,
  width: number,
  height: number,
  blob: Blob
): Promise<void> {
  await frameDb.frames.put({
    id: `${sessionId}_frame_${frameIndex}`,
    sessionId,
    frameIndex,
    timestamp,
    width,
    height,
    blob,
  });
}

// Store a thumbnail blob
export async function storeThumbnail(
  sessionId: string,
  frameIndex: number,
  timestamp: number,
  width: number,
  height: number,
  blob: Blob
): Promise<void> {
  await frameDb.thumbnails.put({
    id: `${sessionId}_thumb_${frameIndex}`,
    sessionId,
    frameIndex,
    timestamp,
    width,
    height,
    blob,
  });
}

// Create a new session
export async function createSession(
  session: Omit<VideoSession, "id" | "createdAt">
): Promise<string> {
  const id = generateSessionId();
  await frameDb.sessions.put({
    ...session,
    id,
    createdAt: Date.now(),
  });
  return id;
}

// Update session metadata after extraction completes
export async function updateSession(
  id: string,
  updates: Partial<VideoSession>
): Promise<void> {
  await frameDb.sessions.update(id, updates);
}
