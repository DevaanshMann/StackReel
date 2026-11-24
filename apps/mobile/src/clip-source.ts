import { RENDER_PLAN_VERSION, cropRect, fitMatrix, frameToUs, usToFrame } from "@stackreel/core";
import type { AudioEntry, Crop, PlanCanvas, RenderPlan, SourceTiming, VideoLayer } from "@stackreel/core";
import { getClipCrop, sameCrop } from "./clip-reframe";
import type { ClipReframe } from "./clip-reframe";

export const canvas = { width: 720, height: 1280, fps: 30, background: "#000000" } satisfies PlanCanvas;

export type ClipMetadata = { width: number; height: number; startUs: number; durationUs: number };
export type SingleClipFit = "contain" | "cover";

export function isSingleClipFit(value: unknown): value is SingleClipFit {
  return value === "contain" || value === "cover";
}

/** Absolute source frames at the output rate. The end frame is exclusive. */
export type ClipFrameRange = { startFrame: number; endFrame: number };

export function getClipFrameRange(
  { width, height, startUs, durationUs }: ClipMetadata,
  fps = canvas.fps,
): ClipFrameRange {
  const endUs = startUs + durationUs;
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    !Number.isSafeInteger(startUs) ||
    !Number.isSafeInteger(durationUs) ||
    durationUs <= 0 ||
    !Number.isSafeInteger(endUs) ||
    endUs <= 0
  ) {
    throw new Error("This video has invalid dimensions or timing.");
  }

  const firstFrame = usToFrame(Math.max(0, startUs), fps, "ceil");
  const endFrame = usToFrame(endUs, fps, "floor");
  if (endFrame <= firstFrame) throw new Error(`This video is too short for a ${fps} fps export.`);
  return { startFrame: firstFrame, endFrame };
}

export function createClipSource(
  uri: string,
  media: ClipMetadata,
  targetCanvas: PlanCanvas = canvas,
  fit: VideoLayer["fit"] = "contain",
  gainDb = 0,
): string {
  const range = getClipFrameRange(media, targetCanvas.fps);
  return buildClipSource(uri, media, range, targetCanvas, fit, gainDb);
}

export function createTrimmedClipSource(
  uri: string,
  media: ClipMetadata,
  selection: ClipFrameRange,
  fit: SingleClipFit = "contain",
  reframe?: ClipReframe,
  gainDb = 0,
): string {
  if (!isSingleClipFit(fit)) throw new RangeError("Invalid single-clip fit.");
  const bounds = getClipFrameRange(media);
  const { startFrame, endFrame } = selection;
  if (
    !Number.isSafeInteger(startFrame) ||
    !Number.isSafeInteger(endFrame) ||
    startFrame < bounds.startFrame ||
    endFrame > bounds.endFrame ||
    endFrame <= startFrame
  ) {
    throw new RangeError("Select at least one whole frame within the video.");
  }
  const crop = reframe === undefined ? undefined : getClipCrop(media, canvas, reframe);
  // Centered cover already has its historical full-source rectangle and transform.
  const customCrop = fit === "cover" && crop && !sameCrop(crop, getClipCrop(media, canvas)) ? crop : undefined;
  return buildClipSource(uri, media, selection, canvas, fit, gainDb, customCrop);
}

function buildClipSource(
  uri: string,
  { width, height }: ClipMetadata,
  { startFrame, endFrame }: ClipFrameRange,
  targetCanvas: PlanCanvas,
  fit: VideoLayer["fit"],
  gainDb: number,
  crop?: Crop,
): string {
  if (!Number.isFinite(gainDb) || gainDb < -60 || gainDb > 12) {
    throw new RangeError("Clip gain must be between -60 and 12 dB.");
  }
  const { fps } = targetCanvas;
  const sourceStartUs = frameToUs(startFrame, fps);
  const sourceEndUs = frameToUs(endFrame, fps);
  const timelineEndUs = frameToUs(endFrame - startFrame, fps);
  const assetId = "clip";
  const source: SourceTiming = {
    assetUri: assetId,
    sourceStartUs,
    sourceEndUs,
    // A nonzero start can shift rounding by one microsecond at 30 fps.
    rate: (sourceEndUs - sourceStartUs) / timelineEndUs,
    afterEnd: "hold",
    fitMode: "trim",
  };
  const sourceSize = { width, height };
  const cropPx = cropRect(sourceSize, crop);
  const clip = {
    id: "video/0",
    kind: "video",
    slotId: assetId,
    startUs: 0,
    endUs: timelineEndUs,
    source,
    gainDb,
    fadeInUs: 0,
    fadeOutUs: 0,
  } as const satisfies AudioEntry;
  const layer: VideoLayer = {
    ...clip,
    trackId: "video",
    itemIndex: 0,
    z: 0,
    opacity: 1,
    fit,
    sourceSize,
    cropPx,
    transform: fitMatrix(sourceSize, targetCanvas, fit, cropPx),
  };
  const plan: RenderPlan = {
    renderPlanVersion: RENDER_PLAN_VERSION,
    templateId: "single-clip",
    canvas: targetCanvas,
    durationUs: timelineEndUs,
    layers: [layer],
    transitions: [],
    audio: [clip],
    warnings: [],
  };
  return JSON.stringify({ plan, assets: { [assetId]: uri } });
}
