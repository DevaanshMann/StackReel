import { describe, expect, it } from "vitest";
import {
  Animation,
  Audio,
  Canvas,
  MediaItem,
  Music,
  Position,
  Style,
  TEMPLATE_DEFAULTS as d,
  templateJsonSchema,
  Transition,
  VideoSlot,
} from "../src/index.js";

type Defs = Record<string, { properties?: Record<string, { default?: unknown }> }>;

/** Every `default` keyword on a `$defs` property, keyed `<def>.<property>`. */
function jsonSchemaDefaults(): Record<string, unknown> {
  const found: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(templateJsonSchema()["$defs"] as Defs)) {
    for (const [prop, schema] of Object.entries(def.properties ?? {})) {
      if ("default" in schema) found[`${name}.${prop}`] = schema.default;
    }
  }
  return found;
}

describe("TEMPLATE_DEFAULTS", () => {
  // Strict objects, so a default for a renamed or removed field fails too.
  it("is valid for the fields it fills in", () => {
    expect(Canvas.parse({ width: 1080, height: 1920, fps: 30, ...d.canvas })).toBeTruthy();
    expect(VideoSlot.parse({ id: "clip", kind: "video", label: "Clip", ...d.slot })).toBeTruthy();
    expect(MediaItem.parse({ slot: "clip", startUs: 0, durationUs: 1, ...d.mediaItem })).toBeTruthy();
    expect(Transition.parse({ type: "slide", durationUs: 1, ...d.transition })).toBeTruthy();
    expect(Style.parse(d.style)).toEqual(d.style);
    expect(Position.parse(d.position)).toEqual(d.position);
    expect(Animation.parse({ in: "fade", out: "fade", ...d.animation })).toBeTruthy();
    expect(Music.parse({ slot: "song", ...d.music })).toBeTruthy();
    expect(Audio.parse(d.audio)).toEqual(d.audio);
  });

  it("is in the JSON Schema as default keywords, and is the only default there", () => {
    expect(jsonSchemaDefaults()).toEqual({
      "Canvas.background": d.canvas.background,
      "VideoSlot.optional": d.slot.optional,
      "ImageSlot.optional": d.slot.optional,
      "AudioSlot.optional": d.slot.optional,
      "TextSlot.optional": d.slot.optional,
      "MediaItem.fit": d.mediaItem.fit,
      "MediaItem.speed": d.mediaItem.speed,
      "MediaItem.gainDb": d.mediaItem.gainDb,
      "Transition.direction": d.transition.direction,
      "TextItem.style": d.style,
      "Style.align": d.style.align,
      "TextItem.position": d.position,
      "StickerItem.position": d.position,
      "Position.rotationDeg": d.position.rotationDeg,
      "Animation.inDurationUs": d.animation.inDurationUs,
      "Animation.outDurationUs": d.animation.outDurationUs,
      "Music.startUs": d.music.startUs,
      "Music.gainDb": d.music.gainDb,
      "Music.duckGainDb": d.music.duckGainDb,
      "Music.duckRampUs": d.music.duckRampUs,
      "Audio.duckMusicUnderVoice": d.audio.duckMusicUnderVoice,
    });
  });
});
