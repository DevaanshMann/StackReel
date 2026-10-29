import { z } from "zod";
import { TEMPLATE_DEFAULTS } from "./defaults.js";

/** The `schemaVersion` this package reads and writes. */
export const CURRENT_SCHEMA_VERSION = 1;

// Primitives

/** A point in time or a length of time, in integer microseconds. */
export const Microseconds = z.int().nonnegative().meta({
  id: "Microseconds",
  description: "Time in integer microseconds (1 s = 1000000). Never a float.",
});

/** A length of time that must be longer than zero. */
const PositiveMicroseconds = z.int().positive().meta({
  description: "A non-zero length of time in integer microseconds.",
});

/** A coordinate or size relative to the canvas: 0 is the left/top edge, 1 the right/bottom edge. */
export const Normalized = z.number().min(0).max(1).meta({
  id: "Normalized",
  description: "A value relative to the canvas, from 0 to 1.",
});

export const Color = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Expected a hex color like #RRGGBB or #RRGGBBAA")
  .meta({ id: "Color", description: "Hex color, #RRGGBB or #RRGGBBAA." });

/** Ids are referenced across the document, so they stay URL- and filename-safe. */
export const Id = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Expected letters, digits, '-' or '_', starting with a letter or digit")
  .max(64)
  .meta({ id: "Id" });

/** Gain in decibels. 0 keeps the source level. */
const GainDb = z.number().min(-60).max(12).meta({ description: "Gain in dB, from -60 to +12. 0 is unchanged." });

// Canvas

export const Canvas = z
  .strictObject({
    width: z.int().min(16).max(8192).meta({ description: "Output width in pixels." }),
    height: z.int().min(16).max(8192).meta({ description: "Output height in pixels." }),
    fps: z.int().min(1).max(240).meta({ description: "Frames per second." }),
    background: Color.optional().meta({
      description: "Fill behind all tracks.",
      default: TEMPLATE_DEFAULTS.canvas.background,
    }),
  })
  .meta({ id: "Canvas" });

// Slots

const slotBase = {
  id: Id,
  label: z.string().min(1).max(80).meta({ description: "Shown to the user when they fill the slot." }),
  optional: z.boolean().optional().meta({
    description: "The template renders without this slot.",
    default: TEMPLATE_DEFAULTS.slot.optional,
  }),
};

export const VideoSlot = z
  .strictObject({
    ...slotBase,
    kind: z.literal("video"),
    minDurationUs: Microseconds.optional().meta({ description: "Shortest clip that fills the slot without padding." }),
  })
  .meta({ id: "VideoSlot" });

export const ImageSlot = z.strictObject({ ...slotBase, kind: z.literal("image") }).meta({ id: "ImageSlot" });

export const AudioSlot = z
  .strictObject({
    ...slotBase,
    kind: z.literal("audio"),
    minDurationUs: Microseconds.optional(),
  })
  .meta({ id: "AudioSlot" });

export const TextSlot = z
  .strictObject({
    ...slotBase,
    kind: z.literal("text"),
    maxChars: z.int().positive().optional(),
  })
  .meta({ id: "TextSlot" });

export const Slot = z.discriminatedUnion("kind", [VideoSlot, ImageSlot, AudioSlot, TextSlot]).meta({ id: "Slot" });

export const SlotKind = z.enum(["video", "image", "audio", "text"]).meta({ id: "SlotKind" });
export type SlotKind = z.infer<typeof SlotKind>;

// Transitions, animations, style, position

export const TransitionType = z
  .enum(["cut", "crossfade", "whip-pan", "zoom-punch", "slide", "spin"])
  .meta({ id: "TransitionType" });

export const Direction = z.enum(["left", "right", "up", "down"]).meta({ id: "Direction" });

export const Transition = z
  .strictObject({
    type: TransitionType,
    durationUs: Microseconds,
    direction: Direction.optional().meta({
      description: "For slide and whip-pan.",
      default: TEMPLATE_DEFAULTS.transition.direction,
    }),
  })
  .meta({ id: "Transition", description: "Plays across the cut at the start of the item that owns it." });

export const AnimationName = z
  .enum(["none", "fade", "pop", "slide-up", "slide-down", "slide-left", "slide-right", "scale", "typewriter", "bounce"])
  .meta({ id: "AnimationName" });

export const Animation = z
  .strictObject({
    in: AnimationName.optional(),
    out: AnimationName.optional(),
    inDurationUs: Microseconds.optional().meta({ default: TEMPLATE_DEFAULTS.animation.inDurationUs }),
    outDurationUs: Microseconds.optional().meta({ default: TEMPLATE_DEFAULTS.animation.outDurationUs }),
  })
  .meta({ id: "Animation" });

export const Anchor = z
  .enum(["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"])
  .meta({ id: "Anchor", description: "Which point of the element sits at (x, y)." });

export const Position = z
  .strictObject({
    anchor: Anchor,
    x: Normalized,
    y: Normalized,
    rotationDeg: z.number().min(-360).max(360).optional().meta({ default: TEMPLATE_DEFAULTS.position.rotationDeg }),
  })
  .meta({ id: "Position" });

export const Style = z
  .strictObject({
    font: z.string().min(1).meta({ description: "PostScript name of a bundled font, e.g. Inter-Black." }),
    sizePx: z.number().positive().meta({ description: "Font size in pixels at the canvas size." }),
    color: Color,
    align: z.enum(["left", "center", "right"]).optional().meta({ default: TEMPLATE_DEFAULTS.style.align }),
    stroke: z.strictObject({ color: Color, widthPx: z.number().nonnegative() }).optional(),
    shadow: z
      .strictObject({
        color: Color,
        blurPx: z.number().nonnegative(),
        offsetXPx: z.number(),
        offsetYPx: z.number(),
      })
      .optional(),
    background: z
      .strictObject({ color: Color, paddingPx: z.number().nonnegative(), cornerRadiusPx: z.number().nonnegative() })
      .optional(),
  })
  .meta({ id: "Style" });

// Items

const timed = {
  startUs: Microseconds.meta({ description: "When the item starts, relative to the template start." }),
  durationUs: PositiveMicroseconds,
};

export const FitMode = z
  .enum(["cover", "contain", "fill"])
  .meta({ id: "FitMode", description: "How media fills the canvas." });

export const MediaItem = z
  .strictObject({
    slot: Id.meta({ description: "Id of the slot whose media plays here." }),
    ...timed,
    fit: FitMode.optional().meta({ default: TEMPLATE_DEFAULTS.mediaItem.fit }),
    speed: z
      .number()
      .min(0.25)
      .max(4)
      .optional()
      .meta({ description: "Playback rate, 0.25 to 4.", default: TEMPLATE_DEFAULTS.mediaItem.speed }),
    gainDb: GainDb.optional().meta({ default: TEMPLATE_DEFAULTS.mediaItem.gainDb }),
    fadeInUs: Microseconds.optional(),
    fadeOutUs: Microseconds.optional(),
    transitionIn: Transition.optional(),
  })
  .meta({ id: "MediaItem" });

export const TextItem = z
  .strictObject({
    kind: z.literal("text"),
    ...timed,
    slot: Id.optional().meta({ description: "A text slot whose value replaces text.default." }),
    text: z.strictObject({
      default: z.string().meta({ description: "Text shown until the user edits it." }),
      editable: z.boolean().optional(),
      maxChars: z.int().positive().optional(),
    }),
    style: Style.optional().meta({ default: TEMPLATE_DEFAULTS.style }),
    position: Position.optional().meta({ default: TEMPLATE_DEFAULTS.position }),
    animation: Animation.optional(),
  })
  .meta({ id: "TextItem" });

export const StickerItem = z
  .strictObject({
    kind: z.literal("sticker"),
    ...timed,
    asset: z.string().min(1).meta({ description: "Id of a sticker bundled with the app or template." }),
    widthNorm: z.number().gt(0).max(1).meta({ description: "Sticker width relative to the canvas width." }),
    position: Position.optional().meta({ default: TEMPLATE_DEFAULTS.position }),
    animation: Animation.optional(),
  })
  .meta({ id: "StickerItem" });

export const OverlayItem = z.discriminatedUnion("kind", [TextItem, StickerItem]).meta({ id: "OverlayItem" });

export const Item = z.union([MediaItem, TextItem, StickerItem]);

// Tracks

const trackBase = { id: Id };

export const VideoTrack = z
  .strictObject({ ...trackBase, type: z.literal("video"), items: z.array(MediaItem) })
  .meta({ id: "VideoTrack", description: "Video and image clips, played in sequence. Items must not overlap." });

export const OverlayTrack = z
  .strictObject({ ...trackBase, type: z.literal("overlay"), items: z.array(OverlayItem) })
  .meta({ id: "OverlayTrack", description: "Text and stickers drawn over the tracks below." });

export const AudioTrack = z
  .strictObject({ ...trackBase, type: z.literal("audio"), items: z.array(MediaItem) })
  .meta({ id: "AudioTrack", description: "Audio clips such as voice-over or sound effects." });

export const Track = z
  .discriminatedUnion("type", [VideoTrack, OverlayTrack, AudioTrack])
  .meta({ id: "Track", description: "Tracks are ordered bottom to top." });

// Audio and safe zones

export const Music = z
  .strictObject({
    slot: Id.meta({ description: "Id of an audio slot." }),
    startUs: Microseconds.optional().meta({
      description: "When the music starts.",
      default: TEMPLATE_DEFAULTS.music.startUs,
    }),
    gainDb: GainDb.optional().meta({ default: TEMPLATE_DEFAULTS.music.gainDb }),
    fadeInUs: Microseconds.optional(),
    fadeOutUs: Microseconds.optional(),
  })
  .meta({ id: "Music" });

export const Audio = z
  .strictObject({
    music: Music.optional(),
    duckMusicUnderVoice: z.boolean().optional().meta({
      description: "Lower the music while a clip has speech.",
      default: TEMPLATE_DEFAULTS.audio.duckMusicUnderVoice,
    }),
  })
  .meta({ id: "Audio" });

export const SafeZonePreset = z
  .enum(["none", "tiktok-reels-shorts", "tiktok", "instagram-reels", "youtube-shorts"])
  .meta({ id: "SafeZonePreset" });

export const SafeZones = z
  .strictObject({
    preset: SafeZonePreset,
    insets: z
      .strictObject({ top: Normalized, bottom: Normalized, left: Normalized, right: Normalized })
      .optional()
      .meta({ description: "Overrides the preset. Each value is a fraction of the canvas edge." }),
  })
  .meta({ id: "SafeZones", description: "Areas covered by platform UI, where editors warn about placing text." });

// Template

const TemplateShape = z.strictObject({
  schemaVersion: z.literal(
    CURRENT_SCHEMA_VERSION,
    `Expected schemaVersion ${CURRENT_SCHEMA_VERSION}. Run migrate() on older documents.`,
  ),
  id: Id,
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  canvas: Canvas,
  durationUs: PositiveMicroseconds.meta({ description: "Total length of the template." }),
  audio: Audio.optional(),
  slots: z.array(Slot),
  tracks: z.array(Track),
  safeZones: SafeZones.optional(),
});

type TemplateShape = z.infer<typeof TemplateShape>;
type Path = (string | number)[];

/** Rules that span more than one field. JSON Schema can't express these, so engines rely on validate(). */
function checkCrossFieldRules(t: TemplateShape, ctx: z.RefinementCtx): void {
  const issue = (path: Path, message: string) => ctx.addIssue({ code: "custom", path, message });

  const slotKinds = new Map<string, SlotKind>();
  t.slots.forEach((slot, i) => {
    if (slotKinds.has(slot.id)) issue(["slots", i, "id"], `Duplicate slot id "${slot.id}"`);
    else slotKinds.set(slot.id, slot.kind);
  });

  const checkSlotRef = (path: Path, id: string, allowed: readonly SlotKind[]) => {
    const kind = slotKinds.get(id);
    if (kind === undefined) issue(path, `Unknown slot "${id}"`);
    else if (!allowed.includes(kind)) issue(path, `Slot "${id}" is ${kind}, expected ${allowed.join(" or ")}`);
  };

  const trackIds = new Set<string>();
  t.tracks.forEach((track, ti) => {
    if (trackIds.has(track.id)) issue(["tracks", ti, "id"], `Duplicate track id "${track.id}"`);
    trackIds.add(track.id);

    track.items.forEach((item, ii) => {
      const at = ["tracks", ti, "items", ii];
      const endUs = item.startUs + item.durationUs;
      if (endUs > t.durationUs) {
        issue([...at, "durationUs"], `Item ends at ${endUs}us, after the template ends at ${t.durationUs}us`);
      }
      if ("transitionIn" in item && item.transitionIn && item.transitionIn.durationUs > item.durationUs) {
        issue([...at, "transitionIn", "durationUs"], "Transition is longer than the item it belongs to");
      }
      if (!("kind" in item)) {
        checkSlotRef([...at, "slot"], item.slot, track.type === "audio" ? ["audio"] : ["video", "image"]);
      } else if (item.kind === "text") {
        if (item.slot !== undefined) checkSlotRef([...at, "slot"], item.slot, ["text"]);
        const { default: text, maxChars } = item.text;
        if (maxChars !== undefined && [...text].length > maxChars) {
          issue([...at, "text", "default"], `Default text is longer than maxChars (${maxChars})`);
        }
      }
    });

    if (track.type === "video") {
      const sorted = track.items.map((item, ii) => ({ item, ii })).sort((a, b) => a.item.startUs - b.item.startUs);
      for (let k = 1; k < sorted.length; k++) {
        const prev = sorted[k - 1]!;
        const cur = sorted[k]!;
        if (cur.item.startUs < prev.item.startUs + prev.item.durationUs) {
          issue(["tracks", ti, "items", cur.ii, "startUs"], `Item overlaps item ${prev.ii} on the same video track`);
        }
      }
    }
  });

  const music = t.audio?.music;
  if (music) {
    checkSlotRef(["audio", "music", "slot"], music.slot, ["audio"]);
    if (music.startUs !== undefined && music.startUs >= t.durationUs) {
      issue(["audio", "music", "startUs"], "Music starts after the template ends");
    }
  }
}

export const Template = TemplateShape.superRefine(checkCrossFieldRules).meta({
  id: "Template",
  title: "StackReel Template",
  description: "A StackReel template (SRT-JSON). All times are integer microseconds; positions are normalized 0-1.",
});

export type Microseconds = z.infer<typeof Microseconds>;
export type Normalized = z.infer<typeof Normalized>;
export type Color = z.infer<typeof Color>;
export type Canvas = z.infer<typeof Canvas>;
export type VideoSlot = z.infer<typeof VideoSlot>;
export type ImageSlot = z.infer<typeof ImageSlot>;
export type AudioSlot = z.infer<typeof AudioSlot>;
export type TextSlot = z.infer<typeof TextSlot>;
export type Slot = z.infer<typeof Slot>;
export type TransitionType = z.infer<typeof TransitionType>;
export type Direction = z.infer<typeof Direction>;
export type Transition = z.infer<typeof Transition>;
export type AnimationName = z.infer<typeof AnimationName>;
export type Animation = z.infer<typeof Animation>;
export type Anchor = z.infer<typeof Anchor>;
export type Position = z.infer<typeof Position>;
export type Style = z.infer<typeof Style>;
export type FitMode = z.infer<typeof FitMode>;
export type MediaItem = z.infer<typeof MediaItem>;
export type TextItem = z.infer<typeof TextItem>;
export type StickerItem = z.infer<typeof StickerItem>;
export type OverlayItem = z.infer<typeof OverlayItem>;
export type Item = z.infer<typeof Item>;
export type VideoTrack = z.infer<typeof VideoTrack>;
export type OverlayTrack = z.infer<typeof OverlayTrack>;
export type AudioTrack = z.infer<typeof AudioTrack>;
export type Track = z.infer<typeof Track>;
export type Music = z.infer<typeof Music>;
export type Audio = z.infer<typeof Audio>;
export type SafeZonePreset = z.infer<typeof SafeZonePreset>;
export type SafeZones = z.infer<typeof SafeZones>;
export type Template = z.infer<typeof Template>;
