import type { Slot } from "@stackreel/template-schema";
import { maxTimeUs } from "./limits.js";
import type { SlotBinding } from "./project.js";
import { frameToUs, snapToFrame, usToFrame } from "./time.js";

/**
 * What to do when a clip has less footage than its slot needs:
 * - `freeze`: play the clip at the template speed, then hold its last frame
 * - `slow`: slow the clip down so it fills the slot, but never below the minimum speed (then hold the last frame)
 * - `loop`: play the clip at the template speed and start it again from the beginning each time it ends
 */
export type ShortClipPolicy = "freeze" | "slow" | "loop";

export const SHORT_CLIP_POLICIES: readonly ShortClipPolicy[] = ["freeze", "slow", "loop"];
export const DEFAULT_SHORT_CLIP_POLICY: ShortClipPolicy = "freeze";

/** The slowest a clip is slowed down to fill a slot. Matches the schema's lowest `speed`. */
export const DEFAULT_MIN_SPEED = 0.25;

/**
 * What an engine shows when a layer outlasts its source range: `hold` keeps the last frame (silence for audio),
 * `loop` starts again from `sourceStartUs`.
 */
export type AfterEnd = "hold" | "loop";

/** The part of a clip that a trim window picker chooses from. All values are on frame starts. */
export interface TrimWindowContext {
  /** Earliest source time the user allows (their trim in point). */
  windowStartUs: number;
  /** Latest source time the user allows (their trim out point, or the end of the source). Exclusive. */
  windowEndUs: number;
  /** How much source time the slot plays. Always fits in the window. */
  neededUs: number;
}

/**
 * Chooses where in the trim window a long clip starts playing and returns that source time. The result is clamped
 * into the window and snapped to a frame, so a picker can't produce an invalid range.
 */
export type TrimWindowPicker = (context: TrimWindowContext) => number;

/** The default picker: start where the user's trim starts. A "smart" picker (motion, faces) can replace it later. */
export const pickWindowStart: TrimWindowPicker = (context) => context.windowStartUs;

export interface FitRequest {
  /** How long the layer lasts on the timeline. */
  durationUs: number;
  /** The template's playback rate for the item. Defaults to 1. */
  speed?: number;
  /** The user's trim, from the slot binding. */
  trimInUs: number;
  trimOutUs: number;
  /** Length of the source file, if known. The trim is clamped to it. */
  sourceDurationUs?: number;
  /** Canvas frame rate. Every source time in the result is a frame start at this rate. */
  fps: number;
  policy?: ShortClipPolicy;
  minSpeed?: number;
  pickWindow?: TrimWindowPicker;
}

/** How a clip fills its layer: `trim` when it had enough footage, otherwise the short-clip policy that was used. */
export type ClipFitMode = "trim" | ShortClipPolicy;

export interface Fitted {
  status: "fitted";
  mode: ClipFitMode;
  /** Source range to play, `[sourceStartUs, sourceEndUs)`. */
  sourceStartUs: number;
  sourceEndUs: number;
  /** Source microseconds played per timeline microsecond. */
  rate: number;
  afterEnd: AfterEnd;
  /** Source time the layer needs at the template speed. */
  neededUs: number;
  /** Source time inside the trim window. Smaller than `neededUs` when the clip is short. */
  availableUs: number;
  /** `slow` hit the minimum speed and holds the last frame for the rest of the layer. */
  minSpeedReached: boolean;
}

/** The trim window holds no whole frame of the source, for example a trim that starts after the source ends. */
export interface EmptyWindow {
  status: "empty-window";
  windowStartUs: number;
  windowEndUs: number;
}

export type ClipFit = Fitted | EmptyWindow;

/** Works out which part of a bound clip plays in a layer. Never throws for valid template and binding values. */
export function fitClip(request: FitRequest): ClipFit {
  const { durationUs, fps } = request;
  const speed = request.speed ?? 1;
  const policy = request.policy ?? DEFAULT_SHORT_CLIP_POLICY;
  // Valid trims can be later than the frame math handles, far past the end of any real file.
  const maxUs = maxTimeUs(fps);
  const trimInUs = Math.min(request.trimInUs, maxUs);
  const trimOutUs = Math.min(request.trimOutUs, request.sourceDurationUs ?? maxUs, maxUs);

  // Shrink the window to whole frames so the result never reaches outside the user's trim.
  const windowStartUs = snapToFrame(trimInUs, fps, "ceil");
  const windowEndUs = trimOutUs > windowStartUs ? snapToFrame(trimOutUs, fps, "floor") : windowStartUs;
  if (windowEndUs <= windowStartUs) return { status: "empty-window", windowStartUs, windowEndUs };

  const neededUs = Math.round(durationUs * speed);
  const availableUs = windowEndUs - windowStartUs;
  const fitted = { status: "fitted", neededUs, availableUs, minSpeedReached: false } as const;

  if (availableUs >= neededUs) {
    const latestStartUs = snapToFrame(windowEndUs - Math.max(neededUs, 1), fps, "floor");
    const picked = (request.pickWindow ?? pickWindowStart)({ windowStartUs, windowEndUs, neededUs });
    const pickedUs = Number.isFinite(picked) ? Math.round(picked) : windowStartUs;
    const startUs = snapToFrame(Math.min(Math.max(pickedUs, windowStartUs), latestStartUs), fps);
    // At least one frame, even when the layer needs less than half a frame of source.
    const nextFrameUs = frameToUs(usToFrame(startUs, fps) + 1, fps);
    const endUs = Math.min(Math.max(snapToFrame(startUs + neededUs, fps), nextFrameUs), windowEndUs);
    return { ...fitted, mode: "trim", sourceStartUs: startUs, sourceEndUs: endUs, rate: speed, afterEnd: "hold" };
  }

  const whole = { ...fitted, sourceStartUs: windowStartUs, sourceEndUs: windowEndUs };
  if (policy === "loop") return { ...whole, mode: "loop", rate: speed, afterEnd: "loop" };
  if (policy === "freeze") return { ...whole, mode: "freeze", rate: speed, afterEnd: "hold" };
  const minSpeed = request.minSpeed ?? DEFAULT_MIN_SPEED;
  const rate = availableUs / durationUs;
  return rate >= minSpeed
    ? { ...whole, mode: "slow", rate, afterEnd: "hold" }
    : { ...whole, mode: "slow", rate: minSpeed, afterEnd: "hold", minSpeedReached: true };
}

/** An optional slot with nothing bound. Its layers are left out. */
export interface SkippedSlot {
  status: "skipped";
  slotId: string;
}

/** A required slot with nothing bound. Its layers are left out and the plan carries a warning. */
export interface MissingSlot {
  status: "missing-slot";
  slotId: string;
}

export type SlotFit = Fitted | (EmptyWindow & { slotId: string }) | SkippedSlot | MissingSlot;

/** `fitClip` for a slot: handles empty slots, then fits the bound clip. */
export function fitSlot(
  slot: Slot,
  binding: SlotBinding | undefined,
  request: Omit<FitRequest, "trimInUs" | "trimOutUs">,
): SlotFit {
  if (!binding) return { status: slot.optional === true ? "skipped" : "missing-slot", slotId: slot.id };
  const fit = fitClip({ ...request, trimInUs: binding.trimInUs, trimOutUs: binding.trimOutUs });
  return fit.status === "fitted" ? fit : { ...fit, slotId: slot.id };
}
