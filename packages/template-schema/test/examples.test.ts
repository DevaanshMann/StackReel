import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Anchor,
  AnimationName,
  Direction,
  FitMode,
  OverlayItem,
  SafeZonePreset,
  SlotKind,
  Style,
  Track,
  TransitionType,
  validate,
  type MediaItem,
  type Template,
  type TextItem,
} from "../src/index.js";
import { examplesDir, jsonFiles, readJson } from "./helpers.js";

// The sample templates are the built-in library and the shared fixtures for engine tests, so together they must
// exercise every value the schema allows. Expected values come from the Zod schema, so a new enum value fails here
// until an example uses it.

const files = jsonFiles(examplesDir);

function load(file: string): Template {
  const result = validate(readJson(join(examplesDir, file)));
  if (!result.ok) throw new Error(`${file} is invalid: ${JSON.stringify(result.errors, null, 2)}`);
  return result.template;
}

const examples = files.map((file) => ({ file, template: load(file) }));
const templates = examples.map((e) => e.template);
const tracks = templates.flatMap((t) => t.tracks);
const mediaItems = templates.flatMap(mediaOf);
const overlayItems = templates.flatMap(overlayOf);
const textItems = templates.flatMap(textOf);

const expected = {
  "slot kinds": SlotKind.options,
  "track types": Track.options.map((t) => t.shape.type.value),
  // Media items have no discriminator; overlay items are told apart by `kind`.
  "item kinds": ["media", ...OverlayItem.options.map((o) => o.shape.kind.value)],
  "transition types": TransitionType.options,
  "transition directions": Direction.options,
  "text animations": AnimationName.options,
  "fit modes": FitMode.options,
  anchors: Anchor.options,
  "text alignments": Style.shape.align.unwrap().options,
  "safe-zone presets": SafeZonePreset.options,
};

const used: Record<keyof typeof expected, (string | undefined)[]> = {
  "slot kinds": templates.flatMap((t) => t.slots.map((s) => s.kind)),
  "track types": tracks.map((t) => t.type),
  "item kinds": [...mediaItems.map(() => "media"), ...overlayItems.map((i) => i.kind)],
  "transition types": mediaItems.map((i) => i.transitionIn?.type),
  "transition directions": mediaItems.map((i) => i.transitionIn?.direction),
  "text animations": overlayItems.flatMap((i) => [i.animation?.in, i.animation?.out]),
  // Only video tracks fit media to the canvas.
  "fit modes": tracks.flatMap((t) => (t.type === "video" ? t.items.map((i) => i.fit) : [])),
  anchors: overlayItems.map((i) => i.position?.anchor),
  "text alignments": textItems.map((i) => i.style?.align),
  "safe-zone presets": templates.map((t) => t.safeZones?.preset),
};

const features: Record<string, (t: Template) => boolean> = {
  "an image slot on a video track": (t) =>
    t.tracks.some(
      (tr) => tr.type === "video" && tr.items.some((i) => t.slots.find((s) => s.id === i.slot)?.kind === "image"),
    ),
  "an optional slot": (t) => t.slots.some((s) => s.optional === true),
  "a slot with minDurationUs": (t) => t.slots.some((s) => "minDurationUs" in s && s.minDurationUs !== undefined),
  "a text slot with maxChars": (t) => t.slots.some((s) => s.kind === "text" && s.maxChars !== undefined),
  "more than one video track": (t) => t.tracks.filter((tr) => tr.type === "video").length > 1,
  "a slow-motion clip (speed < 1)": (t) => mediaOf(t).some((i) => i.speed !== undefined && i.speed < 1),
  "a sped-up clip (speed > 1)": (t) => mediaOf(t).some((i) => i.speed !== undefined && i.speed > 1),
  "clip gain": (t) => mediaOf(t).some((i) => i.gainDb !== undefined),
  "clip fade-in": (t) => mediaOf(t).some((i) => i.fadeInUs !== undefined),
  "clip fade-out": (t) => mediaOf(t).some((i) => i.fadeOutUs !== undefined),
  "music with gain and fades": (t) =>
    t.audio?.music?.gainDb !== undefined &&
    t.audio.music.fadeInUs !== undefined &&
    t.audio.music.fadeOutUs !== undefined,
  "music ducked under voice": (t) => t.audio?.music !== undefined && t.audio.duckMusicUnderVoice === true,
  "a text item bound to a text slot": (t) => textOf(t).some((i) => i.slot !== undefined),
  "a non-editable text item": (t) => textOf(t).some((i) => i.text.editable === false),
  "text with a stroke": (t) => textOf(t).some((i) => i.style?.stroke !== undefined),
  "text with a shadow": (t) => textOf(t).some((i) => i.style?.shadow !== undefined),
  "text with a background": (t) => textOf(t).some((i) => i.style?.background !== undefined),
  "custom animation durations": (t) =>
    overlayOf(t).some((i) => i.animation?.inDurationUs !== undefined && i.animation.outDurationUs !== undefined),
  "a rotated overlay": (t) => overlayOf(t).some((i) => i.position?.rotationDeg !== undefined),
  "custom safe-zone insets": (t) => t.safeZones?.insets !== undefined,
  "a non-black canvas background": (t) => t.canvas.background !== undefined && t.canvas.background !== "#000000",
};

function mediaOf(t: Template): MediaItem[] {
  return t.tracks.flatMap((tr) => (tr.type === "overlay" ? [] : tr.items));
}
function overlayOf(t: Template): OverlayItem[] {
  return t.tracks.flatMap((tr) => (tr.type === "overlay" ? tr.items : []));
}
function textOf(t: Template): TextItem[] {
  return overlayOf(t).filter((i): i is TextItem => i.kind === "text");
}

describe("example templates", () => {
  it("there are ten of them", () => {
    expect(files).toHaveLength(10);
  });

  it.each(examples)("$file is 1080x1920 and its id matches its file name", ({ file, template }) => {
    expect(template.id).toBe(file.replace(/\.json$/, ""));
    expect(template.canvas).toMatchObject({ width: 1080, height: 1920 });
  });

  it.each(Object.keys(expected) as (keyof typeof expected)[])("together use every %s", (name) => {
    const seen = new Set(used[name]);
    expect(expected[name].filter((value) => !seen.has(value))).toEqual([]);
  });

  it.each(Object.keys(features))("together show %s", (name) => {
    expect(templates.some(features[name]!)).toBe(true);
  });
});
