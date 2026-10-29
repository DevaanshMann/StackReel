import type { Anchor, Color, Direction, FitMode, Microseconds, Normalized } from "./schema.js";

/**
 * What every engine uses where a template leaves an optional field out. validate() never fills these in; the JSON
 * Schema carries them as `default` keywords.
 */
export const TEMPLATE_DEFAULTS = {
  canvas: { background: "#000000" },
  slot: { optional: false },
  mediaItem: { fit: "cover", speed: 1, gainDb: 0 },
  transition: { direction: "left" },
  style: { font: "Inter-Bold", sizePx: 64, color: "#FFFFFF", align: "center" },
  position: { anchor: "center", x: 0.5, y: 0.5, rotationDeg: 0 },
  /** Only for an `in` or `out` animation other than `none`, which always lasts 0. */
  animation: { inDurationUs: 300_000, outDurationUs: 300_000 },
  music: { startUs: 0, gainDb: 0, duckGainDb: -12, duckRampUs: 200_000 },
  audio: { duckMusicUnderVoice: false },
} as const satisfies {
  // Leaf types only: the object schemas read these values, so `Style`, `Position`, … would be circular here.
  canvas: { background: Color };
  slot: { optional: boolean };
  mediaItem: { fit: FitMode; speed: number; gainDb: number };
  transition: { direction: Direction };
  style: { font: string; sizePx: number; color: Color; align: "left" | "center" | "right" };
  position: { anchor: Anchor; x: Normalized; y: Normalized; rotationDeg: number };
  animation: { inDurationUs: Microseconds; outDurationUs: Microseconds };
  music: { startUs: Microseconds; gainDb: number; duckGainDb: number; duckRampUs: Microseconds };
  audio: { duckMusicUnderVoice: boolean };
};
