import { RENDER_PLAN_VERSION, cropRect, fitMatrix, frameToUs, usToFrame } from "@stackreel/core";
import type { AudioEntry, PlanCanvas, RenderPlan, SourceTiming, VideoLayer } from "@stackreel/core";

export const canvas = { width: 720, height: 1280, fps: 30, background: "#000000" } satisfies PlanCanvas;

export function createClipSource(
  uri: string,
  { width, height, startUs, durationUs }: { width: number; height: number; startUs: number; durationUs: number },
  targetCanvas: PlanCanvas = canvas,
  fit: VideoLayer["fit"] = "contain",
  gainDb = 0,
): string {
  if (!Number.isFinite(gainDb) || gainDb < -60 || gainDb > 12) {
    throw new RangeError("Clip gain must be between -60 and 12 dB.");
  }
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

  const { fps } = targetCanvas;
  const firstFrame = usToFrame(Math.max(0, startUs), fps, "ceil");
  const endFrame = usToFrame(endUs, fps, "floor");
  if (endFrame <= firstFrame) throw new Error(`This video is too short for a ${fps} fps export.`);

  const sourceStartUs = frameToUs(firstFrame, fps);
  const sourceEndUs = frameToUs(endFrame, fps);
  const timelineEndUs = frameToUs(endFrame - firstFrame, fps);
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
  const cropPx = cropRect(sourceSize);
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
