import type { getTemplateTrimWindow } from "./template-editor";

type TrimBounds = Pick<ReturnType<typeof getTemplateTrimWindow>, "firstFrame" | "sourceEndFrame" | "durationFrames">;

export type FilmstripIntent = "pending" | "drag" | "scroll";

export function filmstripIntent(intent: FilmstripIntent, dx: number, dy: number): FilmstripIntent {
  if (intent !== "pending" || Math.max(Math.abs(dx), Math.abs(dy)) < 6) return intent;
  return Math.abs(dx) > Math.abs(dy) ? "drag" : "scroll";
}

export function filmstripSamples(firstFrame: number, sourceEndFrame: number) {
  const frames = sourceEndFrame - firstFrame;
  const count = Math.min(8, frames);
  // Each tile represents an equal slice of the playable source. Sample inside that slice.
  return Array.from({ length: count }, (_, index) => firstFrame + Math.floor(((index + 0.5) * frames) / count));
}

export function filmstripWindow(bounds: TrimBounds, startFrame: number, width: number) {
  const frames = bounds.sourceEndFrame - bounds.firstFrame;
  return {
    left: ((startFrame - bounds.firstFrame) / frames) * width,
    right: ((startFrame + bounds.durationFrames - bounds.firstFrame) / frames) * width,
  };
}

function sourceFrameAt(bounds: TrimBounds, x: number, width: number) {
  return bounds.firstFrame + (x / width) * (bounds.sourceEndFrame - bounds.firstFrame);
}

export function filmstripGrabOffset(bounds: TrimBounds, startFrame: number, x: number, width: number) {
  const offset = sourceFrameAt(bounds, x, width) - startFrame;
  // Keep the grabbed point under the finger, or center the window on an outside tap.
  return offset >= 0 && offset <= bounds.durationFrames ? offset : bounds.durationFrames / 2;
}

export function filmstripStartFrame(bounds: TrimBounds, x: number, width: number, grabOffset: number) {
  const startFrame = Math.round(sourceFrameAt(bounds, x, width) - grabOffset);
  return Math.max(bounds.firstFrame, Math.min(bounds.sourceEndFrame - bounds.durationFrames, startFrame));
}
