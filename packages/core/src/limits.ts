import { US_PER_SECOND, frameToUs } from "./time.js";

/**
 * The latest frame start the frame helpers are guaranteed to handle at `fps` (about 217 days at 240 fps). Every
 * earlier time works too.
 */
export function maxTimeUs(fps: number): number {
  return frameToUs(Math.floor((Number.MAX_SAFE_INTEGER - fps) / (2 * US_PER_SECOND)) - 1, fps);
}
