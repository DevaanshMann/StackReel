import type {
  Anchor,
  AnimationName,
  Color,
  Direction,
  FitMode,
  Style,
  TransitionType,
} from "@stackreel/template-schema";
import type { AfterEnd, ClipFitMode, ShortClipPolicy } from "./fit.js";
import type { TimeRange } from "./time.js";
import type { Matrix3, Placement, Rect, Size } from "./transform.js";

/** The RenderPlan format version. Engines reject plans with a version they don't know. */
export const RENDER_PLAN_VERSION = 1;

/**
 * Everything an engine needs to draw and mix one video, with every default applied and every time absolute and on a
 * frame start. See `packages/core/README.md` for the full contract.
 */
export interface RenderPlan {
  renderPlanVersion: typeof RENDER_PLAN_VERSION;
  templateId: string;
  canvas: PlanCanvas;
  /** Length of the video. Every layer and audio entry lies in `[0, durationUs)`. */
  durationUs: number;
  /** Visual layers, sorted by `startUs`, then `z`, then `itemIndex`. */
  layers: Layer[];
  /** Transitions between layers of one video track, sorted by `startUs`, then `z`. */
  transitions: TransitionPlan[];
  /** Sounds to mix, sorted by `startUs`, then `id`. */
  audio: AudioEntry[];
  /** Problems found while resolving: missing slots first, then by track (bottom to top), then music. */
  warnings: PlanWarning[];
}

export interface PlanCanvas {
  width: number;
  height: number;
  fps: number;
  background: Color;
}

/** Which part of a source file plays, and how. */
export interface SourceTiming {
  assetUri: string;
  /** Source range, `[sourceStartUs, sourceEndUs)`, on canvas frame starts. */
  sourceStartUs: number;
  sourceEndUs: number;
  /**
   * Source microseconds per timeline microsecond. At timeline time `t` the source time is
   * `sourceStartUs + (t - startUs) * rate`, until it reaches `sourceEndUs`; then `afterEnd` applies.
   */
  rate: number;
  afterEnd: AfterEnd;
  /** How slot fitting filled the layer: `trim`, or the short-clip policy it used. */
  fitMode: ClipFitMode;
}

interface LayerBase {
  /** Stable id: the item key `"<trackId>/<itemIndex>"`. */
  id: string;
  trackId: string;
  itemIndex: number;
  /** Index of the track, bottom (0) to top. Higher `z` draws on top. */
  z: number;
  startUs: number;
  /** Exclusive. Always greater than `startUs`. */
  endUs: number;
  /** Base opacity, 0 to 1, before fades, animations and transitions. */
  opacity: number;
}

/** Media drawn through `transform`: only the `cropPx` rectangle of the source, clipped to the canvas. */
interface MediaLayerBase extends LayerBase {
  slotId: string;
  fit: FitMode;
  /** Source size in pixels, as displayed (after the file's rotation metadata). */
  sourceSize: Size;
  cropPx: Rect;
  /** Source pixels → canvas pixels. */
  transform: Matrix3;
  /** Opacity ramps from 0 over the first `fadeInUs` and to 0 over the last `fadeOutUs`. */
  fadeInUs: number;
  fadeOutUs: number;
}

export interface VideoLayer extends MediaLayerBase {
  kind: "video";
  source: SourceTiming;
  /** Clip gain. The same sound is listed in `audio` with id equal to this layer's id. */
  gainDb: number;
}

export interface ImageLayer extends MediaLayerBase {
  kind: "image";
  assetUri: string;
}

export interface ResolvedAnimation {
  in: AnimationName;
  out: AnimationName;
  /** 0 when the animation is `none`. `inDurationUs + outDurationUs` never exceeds the layer. */
  inDurationUs: number;
  outDurationUs: number;
}

/** A style with every optional field that has a default filled in. */
export type ResolvedStyle = Style & { align: NonNullable<Style["align"]> };

export interface TextLayer extends LayerBase {
  kind: "text";
  /** Final text: a project override, or the template's default. */
  text: string;
  style: ResolvedStyle;
  placement: Placement;
  animation: ResolvedAnimation;
}

export interface StickerLayer extends LayerBase {
  kind: "sticker";
  asset: string;
  /** Drawn width; the height follows the sticker's aspect ratio. */
  widthPx: number;
  placement: Placement;
  animation: ResolvedAnimation;
}

export type Layer = VideoLayer | ImageLayer | TextLayer | StickerLayer;

/**
 * A transition across a cut on one video track. The outgoing layer is extended to `endUs` so both play during the
 * window; the incoming layer starts at `startUs`. Windows on one track never overlap, so at most two clips of a
 * track are ever visible at once.
 */
export interface TransitionPlan {
  /** The incoming layer's id. */
  id: string;
  trackId: string;
  z: number;
  type: Exclude<TransitionType, "cut">;
  /** Only for `slide` and `whip-pan`. */
  direction?: Direction;
  startUs: number;
  endUs: number;
  /** The layer that plays out, or `null` when the incoming layer transitions in from the background. */
  fromLayerId: string | null;
  toLayerId: string;
}

export interface DuckingPlan {
  /** Gain added to the music inside each region. */
  gainDb: number;
  /** Ramp into and out of each region, centered on its edges. */
  rampUs: number;
  regions: TimeRange[];
}

/**
 * One sound to mix. `kind` says where it came from: the sound of a video layer (same id as the layer), an item on
 * an audio track, or the template's music.
 */
export interface AudioEntry {
  id: string;
  kind: "video" | "audio" | "music";
  slotId: string;
  startUs: number;
  endUs: number;
  source: SourceTiming;
  gainDb: number;
  /** Gain ramps from silence over the first `fadeInUs` and to silence over the last `fadeOutUs`. */
  fadeInUs: number;
  fadeOutUs: number;
  /** Music only, when the template ducks music under voice. */
  ducking?: DuckingPlan;
}

/** Warnings never stop resolving. Each carries a `message` a UI can show as is. */
export type PlanWarning =
  | { type: "missing-slot"; slotId: string; message: string }
  | { type: "asset-info-missing"; slotId: string; assetUri: string; message: string }
  | { type: "empty-trim"; slotId: string; layerId: string; message: string }
  | {
      type: "clip-too-short";
      slotId: string;
      layerId: string;
      neededUs: number;
      availableUs: number;
      policy: ShortClipPolicy;
      message: string;
    }
  | { type: "min-speed-reached"; slotId: string; layerId: string; minSpeed: number; message: string }
  | { type: "item-too-short"; trackId: string; itemIndex: number; message: string };

export type PlanWarningType = PlanWarning["type"];

/** Fallbacks the resolver uses where the template leaves a field out and the schema defines no default. */
export const PLAN_DEFAULTS = {
  background: "#000000",
  fit: "cover",
  speed: 1,
  gainDb: 0,
  direction: "left",
  musicStartUs: 0,
  style: { font: "Inter-Bold", sizePx: 64, color: "#FFFFFF", align: "center" },
  position: { anchor: "center", x: 0.5, y: 0.5, rotationDeg: 0 },
  animationDurationUs: 300_000,
  duckGainDb: -12,
  duckRampUs: 200_000,
} as const satisfies {
  background: Color;
  fit: FitMode;
  speed: number;
  gainDb: number;
  direction: Direction;
  musicStartUs: number;
  style: ResolvedStyle;
  position: { anchor: Anchor; x: number; y: number; rotationDeg: number };
  animationDurationUs: number;
  duckGainDb: number;
  duckRampUs: number;
};
