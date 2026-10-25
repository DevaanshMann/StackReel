/** Microseconds in one second. Every time value in StackReel is an integer number of microseconds. */
export const US_PER_SECOND = 1_000_000;

/** The frame rates templates are designed for. Any integer fps from 1 to 240 works with these helpers. */
export const COMMON_FPS = [24, 25, 30, 60] as const;

/**
 * How `usToFrame` picks a frame for a time between two frame starts:
 * - `floor`: the frame showing at that time (the last frame that starts at or before it)
 * - `ceil`: the first frame that starts at or after it
 * - `round`: the frame whose start is nearest; an exact tie goes to the later frame
 */
export type FrameRounding = "floor" | "ceil" | "round";

/** A half-open span of time, `[startUs, endUs)`. `startUs === endUs` is an empty range. */
export interface TimeRange {
  startUs: number;
  endUs: number;
}

function assertTime(us: number, name = "us"): void {
  if (!Number.isSafeInteger(us) || us < 0) {
    throw new RangeError(`${name} must be a non-negative integer number of microseconds, got ${us}`);
  }
}

function assertFps(fps: number): void {
  if (!Number.isInteger(fps) || fps < 1 || fps > 240) {
    throw new RangeError(`fps must be an integer from 1 to 240, got ${fps}`);
  }
}

/** Floor division for non-negative safe integers, exact even where the float quotient isn't. */
function divFloor(a: number, b: number): number {
  let q = Math.floor(a / b);
  if (q * b > a) q--;
  else if ((q + 1) * b <= a) q++;
  return q;
}

/**
 * The start time of `frame`, rounded to the nearest microsecond (ties round up).
 *
 * At 25 fps every frame starts on a whole microsecond (40000 us apart). At 24, 30 and 60 fps the exact start is a
 * multiple of 1/3 us, so it is rounded: at 30 fps frames start at 0, 33333, 66667, 100000, ... and are 33333 or
 * 33334 us long. Rounding each start from the frame number, never adding up frame lengths, keeps the error under
 * 1 us however long the video is.
 */
export function frameToUs(frame: number, fps: number): number {
  assertFps(fps);
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new RangeError(`frame must be a non-negative integer, got ${frame}`);
  }
  // round(frame * 1e6 / fps) === floor((2 * frame * 1e6 + fps) / (2 * fps))
  const twice = 2 * frame * US_PER_SECOND;
  if (!Number.isSafeInteger(twice + fps)) throw new RangeError(`frame ${frame} is too large`);
  return divFloor(twice + fps, 2 * fps);
}

/**
 * The frame at time `us`. Frame boundaries are the rounded starts from `frameToUs`, so
 * `usToFrame(frameToUs(n, fps), fps, rounding) === n` for every `n` and every rounding.
 */
export function usToFrame(us: number, fps: number, rounding: FrameRounding = "floor"): number {
  assertTime(us);
  assertFps(fps);
  if (!Number.isSafeInteger(us * fps)) throw new RangeError(`us ${us} is too large`);
  // Exact frame starts are within 0.5 us of the rounded ones, so the true frame is this one or the next.
  let frame = divFloor(us * fps, US_PER_SECOND);
  if (frameToUs(frame + 1, fps) <= us) frame++;

  const startUs = frameToUs(frame, fps);
  if (startUs === us || rounding === "floor") return frame;
  if (rounding === "ceil") return frame + 1;
  const nextUs = frameToUs(frame + 1, fps);
  return us - startUs < nextUs - us ? frame : frame + 1;
}

/** Moves `us` onto a frame start. Defaults to the nearest one. */
export function snapToFrame(us: number, fps: number, rounding: FrameRounding = "round"): number {
  return frameToUs(usToFrame(us, fps, rounding), fps);
}

/** A frame start that these helpers handle at `fps`, as they do every earlier time (about 217 days at 240 fps). */
export function maxTimeUs(fps: number): number {
  assertFps(fps);
  return frameToUs(divFloor(Number.MAX_SAFE_INTEGER - fps, 2 * US_PER_SECOND) - 1, fps);
}

/** True if `us` is exactly a frame start at `fps`. */
export function isOnFrame(us: number, fps: number): boolean {
  return snapToFrame(us, fps) === us;
}

/** Builds a range, checking that both ends are valid times and that `startUs <= endUs`. */
export function timeRange(startUs: number, endUs: number): TimeRange {
  assertTime(startUs, "startUs");
  assertTime(endUs, "endUs");
  if (endUs < startUs) throw new RangeError(`endUs (${endUs}) is before startUs (${startUs})`);
  return { startUs, endUs };
}

/** Builds the range that starts at `startUs` and lasts `durationUs`. */
export function rangeFromDuration(startUs: number, durationUs: number): TimeRange {
  assertTime(durationUs, "durationUs");
  return timeRange(startUs, startUs + durationUs);
}

export function rangeDuration(range: TimeRange): number {
  return range.endUs - range.startUs;
}

export function isEmptyRange(range: TimeRange): boolean {
  return range.endUs <= range.startUs;
}

/**
 * True if the ranges share some time. Ranges that only touch (`a.endUs === b.startUs`) don't overlap, and an empty
 * range overlaps nothing.
 */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return Math.max(a.startUs, b.startUs) < Math.min(a.endUs, b.endUs);
}

/** The time both ranges cover, or `null` if they don't overlap. */
export function intersectRanges(a: TimeRange, b: TimeRange): TimeRange | null {
  if (!rangesOverlap(a, b)) return null;
  return { startUs: Math.max(a.startUs, b.startUs), endUs: Math.min(a.endUs, b.endUs) };
}

/** True if `us` is inside the range. The end is excluded, so an empty range contains nothing. */
export function rangeContains(range: TimeRange, us: number): boolean {
  return range.startUs <= us && us < range.endUs;
}

/** True if `inner` lies entirely within `outer`. An empty `inner` counts if its position is within `outer`. */
export function rangeContainsRange(outer: TimeRange, inner: TimeRange): boolean {
  return outer.startUs <= inner.startUs && inner.endUs <= outer.endUs;
}

/** Moves `us` into `[startUs, endUs]`. The end is included so a playhead can sit at the very end. */
export function clampToRange(us: number, range: TimeRange): number {
  return Math.min(Math.max(us, range.startUs), range.endUs);
}

/** Moves both ends of a range to their nearest frame starts. The result can be empty for very short ranges. */
export function snapRangeToFrames(range: TimeRange, fps: number): TimeRange {
  return { startUs: snapToFrame(range.startUs, fps), endUs: snapToFrame(range.endUs, fps) };
}
