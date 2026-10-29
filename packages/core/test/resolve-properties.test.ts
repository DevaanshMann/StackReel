import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  validate,
  type Canvas,
  type MediaItem,
  type OverlayItem,
  type Slot,
  type Template,
  type Track,
} from "@stackreel/template-schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  SHORT_CLIP_POLICIES,
  checkPlanInvariants,
  createProject,
  intersectRanges,
  itemKey,
  rangeContains,
  rangeContainsRange,
  rangesOverlap,
  resolve,
  transformPoint,
  validateProject,
  type AssetInfo,
  type ImageLayer,
  type Project,
  type RenderPlan,
  type ResolveOptions,
  type SourceTiming,
  type TimeRange,
  type VideoLayer,
} from "../src/index.js";

// Random templates and projects for resolve(). Failures print a seed and the shrunk template, project and options.

const RUNS = 300;

type ValueOf<A> = A extends fc.Arbitrary<infer T> ? T : never;
type Case = { project: Project; assets: Record<string, AssetInfo> };

const nth = <T>(list: readonly T[] | undefined, n: number): T | undefined => list?.[n % list.length];

// Values

/** Sub-frame slivers, the round lengths templates use, and anything up to a few seconds. */
const lengthUs = fc.oneof(
  fc.integer({ min: 1, max: 50_000 }),
  fc.integer({ min: 1, max: 50 }).map((n) => n * 100_000),
  fc.integer({ min: 50_000, max: 4_000_000 }),
);
const offsetUs = fc.oneof(fc.constant(0), lengthUs);
const fadeUs = fc.integer({ min: 0, max: 3_000_000 });
const normalized = fc.double({ min: 0, max: 1, noNaN: true });
const share = fc.oneof(fc.constant(1), normalized);
const color = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, "0")}`);
const gainDb = fc.oneof(fc.constantFrom(-60, 0, 12), fc.double({ min: -60, max: 12, noNaN: true }));
const speed = fc.oneof(fc.constantFrom(0.25, 0.5, 1, 2, 4), fc.double({ min: 0.25, max: 4, noNaN: true }));
const fit = fc.constantFrom("cover", "contain", "fill");

/** Every aspect ratio: common ones, extremes, and anything in between. */
const size = (min: number) =>
  fc.oneof(
    fc.constantFrom(
      { width: 1080, height: 1920 },
      { width: 1920, height: 1080 },
      { width: 1440, height: 1080 },
      { width: 1080, height: 1080 },
      { width: 2560, height: 1080 },
      { width: 100, height: 4000 },
    ),
    fc.record({ width: fc.integer({ min, max: 8192 }), height: fc.integer({ min, max: 8192 }) }),
  );

const canvas: fc.Arbitrary<Canvas> = fc
  .tuple(
    size(16),
    fc.record(
      { fps: fc.oneof(fc.constantFrom(24, 25, 30, 60), fc.integer({ min: 1, max: 240 })), background: color },
      { requiredKeys: ["fps"] },
    ),
  )
  .map(([s, rest]) => ({ ...s, ...rest }));

// Templates

const transition = fc.record(
  {
    type: fc.constantFrom("cut", "crossfade", "whip-pan", "zoom-punch", "slide", "spin"),
    share,
    direction: fc.constantFrom("left", "right", "up", "down"),
  },
  { requiredKeys: ["type", "share"] },
);

/** The transition takes `share` of its item, up to all of it. */
const toTransition = ({ share, ...rest }: ValueOf<typeof transition>, itemUs: number) => ({
  ...rest,
  durationUs: Math.floor(share * itemUs),
});

const mediaItem = fc.record(
  {
    slot: fc.nat(),
    gapUs: offsetUs,
    durationUs: lengthUs,
    order: fc.nat(),
    fit,
    speed,
    gainDb,
    fadeInUs: fadeUs,
    fadeOutUs: fadeUs,
    transitionIn: transition,
    voice: fc.boolean(),
  },
  { requiredKeys: ["slot", "gapUs", "durationUs", "order"] },
);

const animation = fc.record(
  {
    in: fc.constantFrom("none", "fade", "pop", "slide-up", "scale", "typewriter", "bounce"),
    out: fc.constantFrom("none", "fade", "slide-down", "slide-left", "slide-right", "scale"),
    inDurationUs: fadeUs,
    outDurationUs: fadeUs,
  },
  { requiredKeys: [] },
);

const position = fc.record(
  {
    anchor: fc.constantFrom(
      "top-left",
      "top",
      "top-right",
      "left",
      "center",
      "right",
      "bottom-left",
      "bottom",
      "bottom-right",
    ),
    x: normalized,
    y: normalized,
    rotationDeg: fc.double({ min: -360, max: 360, noNaN: true }),
  },
  { requiredKeys: ["anchor", "x", "y"] },
);

const px = fc.double({ min: 0, max: 50, noNaN: true });
const styleFields = {
  font: fc.constantFrom("Inter-Bold", "Inter-Black"),
  sizePx: fc.double({ min: 0, max: 400, minExcluded: true, noNaN: true }),
  color,
  align: fc.constantFrom("left", "center", "right"),
  stroke: fc.record({ color, widthPx: px }),
  shadow: fc.record({
    color,
    blurPx: px,
    offsetXPx: fc.double({ min: -50, max: 50, noNaN: true }),
    offsetYPx: fc.double({ min: -50, max: 50, noNaN: true }),
  }),
  background: fc.record({ color, paddingPx: px, cornerRadiusPx: px }),
};
const style = fc.record(styleFields, { requiredKeys: ["font", "sizePx", "color"] });

const textItem = fc.record(
  {
    kind: fc.constant("text"),
    startUs: offsetUs,
    durationUs: lengthUs,
    slot: fc.nat(),
    text: fc.record(
      { default: fc.string({ unit: "grapheme", maxLength: 12 }), editable: fc.boolean(), spareChars: fc.nat(5) },
      { requiredKeys: ["default"] },
    ),
    style,
    position,
    animation,
  },
  { requiredKeys: ["kind", "startUs", "durationUs", "text"] },
);

const sticker = fc.record(
  {
    kind: fc.constant("sticker"),
    startUs: offsetUs,
    durationUs: lengthUs,
    asset: fc.constantFrom("star", "fire", "heart"),
    widthNorm: fc.oneof(fc.constant(1), fc.double({ min: 0, max: 1, minExcluded: true, noNaN: true })),
    position,
    animation,
  },
  { requiredKeys: ["kind", "startUs", "durationUs", "asset", "widthNorm"] },
);

const videoTrack = (minLength: number) =>
  fc.record({
    type: fc.constant("video"),
    items: fc.array(mediaItem, { minLength, maxLength: 6 }),
    shuffled: fc.boolean(),
  });

const track = fc.oneof(
  videoTrack(0),
  fc.record({ type: fc.constant("audio"), items: fc.array(mediaItem, { maxLength: 3 }) }),
  fc.record({ type: fc.constant("overlay"), items: fc.array(fc.oneof(textItem, sticker), { maxLength: 4 }) }),
);

/** Music can start anywhere, including within a frame of the end. */
const musicStart = fc.oneof(
  fc.record({ share: fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }) }),
  fc.record({ beforeEndUs: fc.integer({ min: 1, max: 100_000 }) }),
);
const startAt = (start: ValueOf<typeof musicStart>, durationUs: number) =>
  "share" in start ? Math.floor(start.share * durationUs) : Math.max(durationUs - start.beforeEndUs, 0);

const timedSlot = fc.record({ optional: fc.boolean(), minDurationUs: lengthUs }, { requiredKeys: [] });

const templateRecipe = fc.record(
  {
    canvas,
    videoSlots: fc.array(timedSlot, { minLength: 1, maxLength: 4 }),
    imageSlots: fc.array(fc.record({ optional: fc.boolean() }, { requiredKeys: [] }), { maxLength: 2 }),
    audioSlots: fc.array(timedSlot, { maxLength: 3 }),
    textSlots: fc.array(
      fc.record({ optional: fc.boolean(), maxChars: fc.integer({ min: 1, max: 40 }) }, { requiredKeys: [] }),
      { maxLength: 2 },
    ),
    tracks: fc.array(track, { maxLength: 4 }),
    /** A video track with at least one item, somewhere in the stack, so no template is empty. */
    mainTrack: fc.record({ track: videoTrack(1), at: fc.nat() }),
    tailUs: offsetUs,
    music: fc.record(
      {
        slot: fc.nat(),
        start: musicStart,
        gainDb,
        fadeInUs: fadeUs,
        fadeOutUs: fadeUs,
        duckGainDb: fc.double({ min: -30, max: 0, noNaN: true }),
        duckRampUs: fadeUs,
      },
      { requiredKeys: ["slot"] },
    ),
    duckMusicUnderVoice: fc.boolean(),
  },
  { requiredKeys: ["canvas", "videoSlots", "imageSlots", "audioSlots", "textSlots", "tracks", "mainTrack", "tailUs"] },
);

/** Builds a template that is valid by construction: items fit the template and never overlap on a video track. */
function buildTemplate(r: ValueOf<typeof templateRecipe>): Template {
  const slots: Slot[] = [
    ...r.videoSlots.map((s, i) => ({ id: `video${i}`, kind: "video" as const, label: `Clip ${i}`, ...s })),
    ...r.imageSlots.map((s, i) => ({ id: `image${i}`, kind: "image" as const, label: `Photo ${i}`, ...s })),
    ...r.audioSlots.map((s, i) => ({ id: `audio${i}`, kind: "audio" as const, label: `Sound ${i}`, ...s })),
    ...r.textSlots.map((s, i) => ({ id: `text${i}`, kind: "text" as const, label: `Text ${i}`, ...s })),
  ];
  const visual = slots.filter((s) => s.kind === "video" || s.kind === "image");
  const sounds = slots.filter((s) => s.kind === "audio");
  const texts = slots.filter((s) => s.kind === "text");

  const toMedia = (
    { slot: _slot, gapUs: _gapUs, order: _order, transitionIn, voice, ...rest }: ValueOf<typeof mediaItem>,
    slot: Slot,
    startUs: number,
  ): MediaItem => ({
    slot: slot.id,
    startUs,
    ...rest,
    ...(transitionIn && { transitionIn: toTransition(transitionIn, rest.durationUs) }),
    // Images have no sound to mark as voice.
    ...(voice !== undefined && slot.kind !== "image" && { voice }),
  });

  const toOverlay = (item: ValueOf<typeof textItem> | ValueOf<typeof sticker>): OverlayItem => {
    if (item.kind === "sticker") return item;
    const {
      slot,
      text: { spareChars, ...text },
      ...rest
    } = item;
    const textSlot = slot === undefined ? undefined : nth(texts, slot);
    const maxChars = spareChars === undefined ? undefined : Math.max([...text.default].length + spareChars, 1);
    return { ...rest, ...(textSlot && { slot: textSlot.id }), text: { ...text, ...(maxChars && { maxChars }) } };
  };

  const at = r.mainTrack.at % (r.tracks.length + 1);
  const recipeTracks = [...r.tracks.slice(0, at), r.mainTrack.track, ...r.tracks.slice(at)];
  const tracks = recipeTracks.map((t, i): Track => {
    const id = `${t.type}${i}`;
    if (t.type === "overlay") return { id, type: "overlay", items: t.items.map(toOverlay) };
    if (t.type === "audio") {
      const items = t.items.flatMap((item) => {
        const slot = nth(sounds, item.slot);
        return slot ? [toMedia(item, slot, item.gapUs)] : [];
      });
      return { id, type: "audio", items };
    }
    let cursor = 0;
    const items = t.items.map((item) => {
      const startUs = cursor + item.gapUs;
      cursor = startUs + item.durationUs;
      return { order: item.order, item: toMedia(item, nth(visual, item.slot)!, startUs) };
    });
    if (t.shuffled) items.sort((a, b) => a.order - b.order);
    return { id, type: "video", items: items.map((x) => x.item) };
  });

  const endUs = Math.max(0, ...tracks.flatMap((t) => t.items.map((item) => item.startUs + item.durationUs)));
  const durationUs = Math.max(endUs + r.tailUs, 1);
  const musicSlot = r.music && nth(sounds, r.music.slot);
  let audio: Template["audio"];
  if (r.music && musicSlot) {
    const { slot: _slot, start, ...rest } = r.music;
    audio = {
      music: { slot: musicSlot.id, ...rest, ...(start && { startUs: startAt(start, durationUs) }) },
      ...(r.duckMusicUnderVoice !== undefined && { duckMusicUnderVoice: r.duckMusicUnderVoice }),
    };
  }
  return {
    schemaVersion: 1,
    id: "generated",
    name: "Generated",
    canvas: r.canvas,
    durationUs,
    ...(audio && { audio }),
    slots,
    tracks,
  };
}

const onlyValid = (templates: fc.Arbitrary<Template>) =>
  templates.map((t) => {
    const result = validate(t);
    if (!result.ok) throw new Error(`Generated an invalid template: ${JSON.stringify(result.errors)}`);
    return result.template;
  });

const generatedTemplates = onlyValid(templateRecipe.map(buildTemplate));

// Variations of the sample templates

const examplesDir = fileURLToPath(new URL("../../../templates/examples/", import.meta.url));
const samples = readdirSync(examplesDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) => {
    const result = validate(JSON.parse(readFileSync(examplesDir + file, "utf8")));
    if (!result.ok) throw new Error(`${file} is not a valid template`);
    return result.template;
  });

const variation = fc.record(
  {
    sample: fc.constantFrom(...samples),
    canvas,
    timePercent: fc.integer({ min: 5, max: 300 }),
    items: fc.array(
      fc.record(
        { drop: fc.integer({ min: 0, max: 9 }).map((n) => n === 0), speed, fit, transitionIn: transition },
        { requiredKeys: ["drop"] },
      ),
      { minLength: 1, maxLength: 8 },
    ),
    optional: fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
    musicStart,
  },
  { requiredKeys: ["sample"] },
);

/** Rescales a sample's times, swaps its canvas, and changes, drops or retimes its media items. */
function vary(r: ValueOf<typeof variation>): Template {
  const t = structuredClone(r.sample);
  const at = (us: number) => (r.timePercent === undefined ? us : Math.floor((us * r.timePercent) / 100));
  const len = (us: number) => Math.max(at(us), 1);
  const animate = <I extends OverlayItem>(item: I): I => {
    const a = item.animation;
    if (!a) return item;
    return {
      ...item,
      animation: {
        ...a,
        ...(a.inDurationUs !== undefined && { inDurationUs: at(a.inDurationUs) }),
        ...(a.outDurationUs !== undefined && { outDurationUs: at(a.outDurationUs) }),
      },
    };
  };
  if (r.canvas) t.canvas = r.canvas;
  t.durationUs = len(t.durationUs);
  t.slots = t.slots.map((s, i) => {
    const optional = nth(r.optional, i);
    return optional === undefined ? s : { ...s, optional };
  });
  let k = 0;
  for (const track of t.tracks) {
    if (track.type === "overlay") {
      track.items = track.items.map((item) =>
        animate({ ...item, startUs: at(item.startUs), durationUs: len(item.durationUs) }),
      );
      continue;
    }
    track.items = track.items.flatMap((item): MediaItem[] => {
      const { drop, transitionIn, ...tweak } = nth(r.items, k++) ?? { drop: false };
      if (drop) return [];
      const durationUs = len(item.durationUs);
      const kept = item.transitionIn && { ...item.transitionIn, durationUs: at(item.transitionIn.durationUs) };
      const next = transitionIn ? toTransition(transitionIn, durationUs) : kept;
      return [
        {
          ...item,
          ...tweak,
          startUs: at(item.startUs),
          durationUs,
          ...(item.fadeInUs !== undefined && { fadeInUs: at(item.fadeInUs) }),
          ...(item.fadeOutUs !== undefined && { fadeOutUs: at(item.fadeOutUs) }),
          ...(next && { transitionIn: next }),
        },
      ];
    });
  }
  const music = t.audio?.music;
  if (music) {
    if (music.startUs !== undefined) music.startUs = at(music.startUs);
    if (r.musicStart) music.startUs = startAt(r.musicStart, t.durationUs);
  }
  return t;
}

const sampleVariations = onlyValid(variation.map(vary));

// Projects

const cropSide = fc.oneof(
  { weight: 9, arbitrary: fc.double({ min: 0.01, max: 1, noNaN: true }) },
  { weight: 1, arbitrary: fc.double({ min: 0, max: 0.01, minExcluded: true, noNaN: true }) },
);
const crop = fc
  .record({ fx: normalized, fy: normalized, width: cropSide, height: cropSide })
  .map(({ fx, fy, width, height }) => ({ x: fx * (1 - width), y: fy * (1 - height), width, height }));

/** What the app read from the file: everything, part of it, nothing, or junk. */
const info = fc.oneof(
  { weight: 6, arbitrary: fc.constant("full") },
  { weight: 1, arbitrary: fc.constant("no-duration") },
  { weight: 1, arbitrary: fc.constant("no-size") },
  { weight: 1, arbitrary: fc.constant("none") },
  {
    weight: 1,
    arbitrary: fc.constantFrom<AssetInfo>(
      { width: 0, height: 0, durationUs: 0 },
      { width: Number.NaN, height: -1, durationUs: 1.5 },
      { width: Infinity, height: 1080, durationUs: -10 },
      { width: 1e-310, height: 1080 },
      { width: 1e306, height: 1 },
      { width: 1, height: 1e306 },
    ),
  },
);

const media = fc.record(
  {
    bindRoll: fc.integer({ min: 0, max: 9 }),
    sourceUs: fc.oneof(
      { weight: 7, arbitrary: fc.integer({ min: 1_000_000, max: 60_000_000 }) },
      { weight: 6, arbitrary: fc.integer({ min: 1, max: 1_000_000 }) },
      { weight: 1, arbitrary: fc.integer({ min: 60_000_000, max: 2 ** 36 }) },
    ),
    info,
    size: size(1),
    trimIn: fc.oneof(fc.constant(0), normalized, fc.constant(1.25)),
    trimLength: fc.oneof(
      { weight: 8, arbitrary: fc.constant("to end") },
      { weight: 8, arbitrary: lengthUs },
      { weight: 1, arbitrary: fc.integer({ min: 4_000_000, max: 2 ** 36 }) },
    ),
    crop,
  },
  { requiredKeys: ["bindRoll", "sourceUs", "info", "size", "trimIn", "trimLength"] },
);

const projectRecipe = fc.record({
  media: fc.array(media, { minLength: 1, maxLength: 8 }),
  texts: fc.array(fc.option(fc.string({ unit: "grapheme", maxLength: 50 }), { nil: undefined }), { maxLength: 4 }),
  styles: fc.array(fc.option(fc.record(styleFields, { requiredKeys: [] }), { nil: undefined }), { maxLength: 4 }),
});

function assetInfo(kind: Slot["kind"], m: ValueOf<typeof media>): AssetInfo | undefined {
  if (typeof m.info === "object") return m.info;
  const durationUs = kind === "image" ? {} : { durationUs: m.sourceUs };
  const sized = kind === "audio" ? {} : m.size;
  if (m.info === "none") return undefined;
  if (m.info === "no-size") return { durationUs: m.sourceUs };
  if (m.info === "no-duration") return { ...sized };
  return { ...sized, ...durationUs };
}

/** Binds media to most slots, with trims that may start past the end of the file, plus overrides that fit. */
function bindMedia(template: Template, r: ValueOf<typeof projectRecipe>): Case {
  const project = createProject(template);
  const assets: Record<string, AssetInfo> = {};
  template.slots.forEach((slot, i) => {
    const m = nth(r.media, i)!;
    if (slot.kind === "text" || m.bindRoll >= (slot.optional === true ? 5 : 9)) return;
    const assetUri = `fake://${slot.id}`;
    const trimInUs = Math.floor(m.trimIn * m.sourceUs);
    const trimOutUs = m.trimLength === "to end" ? Math.max(m.sourceUs, trimInUs + 1) : trimInUs + m.trimLength;
    project.bindings[slot.id] = {
      assetUri,
      trimInUs,
      trimOutUs,
      ...(m.crop && slot.kind !== "audio" && { crop: m.crop }),
    };
    const assetFacts = assetInfo(slot.kind, m);
    if (assetFacts) assets[assetUri] = assetFacts;
  });

  const textItems = template.tracks.flatMap((t) =>
    t.type === "overlay"
      ? t.items.flatMap((item, i) => (item.kind === "text" ? [{ key: itemKey(t.id, i), item }] : []))
      : [],
  );
  const textTargets = [
    ...template.slots.flatMap((s) => (s.kind === "text" ? [{ key: s.id, maxChars: s.maxChars }] : [])),
    ...textItems.flatMap(({ key, item }) =>
      item.text.editable === true ? [{ key, maxChars: item.text.maxChars }] : [],
    ),
  ];
  textTargets.forEach(({ key, maxChars }, k) => {
    const text = nth(r.texts, k);
    if (text !== undefined) project.overrides.text[key] = [...text].slice(0, maxChars).join("");
  });
  textItems.forEach(({ key }, k) => {
    const tweak = nth(r.styles, k);
    if (tweak) project.overrides.style[key] = tweak;
  });
  return { project, assets };
}

const cases = (templates: fc.Arbitrary<Template>) =>
  fc.tuple(templates, projectRecipe).map(([template, r]) => bindMedia(template, r));

// Options

const optionsRecipe = fc.record(
  {
    shortClipPolicy: fc.constantFrom(...SHORT_CLIP_POLICIES),
    minSpeed: fc.double({ min: 0.01, max: 1, noNaN: true }),
    pick: fc.oneof(
      fc.record({ share: normalized }),
      fc.record({
        returns: fc.oneof(
          { weight: 4, arbitrary: fc.integer({ min: -10_000_000, max: 100_000_000 }) },
          { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Infinity, -Infinity) },
        ),
      }),
    ),
    duckGainDb: fc.double({ min: -60, max: 0, noNaN: true }),
    duckRampUs: fc.integer({ min: 0, max: 1_000_000 }),
  },
  { requiredKeys: ["shortClipPolicy"] },
);

/** Resolves a generated case, after checking the generators made a project that validateProject() accepts. */
function resolveCase({ project, assets }: Case, { pick, ...rest }: ValueOf<typeof optionsRecipe>): RenderPlan {
  const valid = validateProject(project);
  if (!valid.ok) throw new Error(`Generated an invalid project: ${JSON.stringify(valid.errors)}`);
  const options: ResolveOptions = {
    assets,
    ...rest,
    ...(pick && {
      pickTrimWindow: (c) =>
        "share" in pick ? c.windowStartUs + pick.share * (c.windowEndUs - c.windowStartUs) : pick.returns,
    }),
  };
  return resolve(project, options);
}

// Properties. Each returns one message per broken rule, like checkPlanInvariants().

function durationProblems(plan: RenderPlan): string[] {
  const problems: string[] = [];
  const positive = (what: string, r: TimeRange) => {
    if (!(r.endUs > r.startUs)) problems.push(`${what}: length ${r.endUs - r.startUs} (${r.startUs}..${r.endUs})`);
  };
  const notNegative = (what: string, us: number) => {
    if (!(us >= 0)) problems.push(`${what}: ${us}`);
  };
  const source = (what: string, s: SourceTiming) => {
    notNegative(`${what} source start`, s.sourceStartUs);
    positive(`${what} source`, { startUs: s.sourceStartUs, endUs: s.sourceEndUs });
    if (!(s.rate > 0 && Number.isFinite(s.rate))) problems.push(`${what}: rate ${s.rate}`);
  };

  positive("plan", { startUs: 0, endUs: plan.durationUs });
  for (const layer of plan.layers) {
    positive(`layer ${layer.id}`, layer);
    if (layer.kind === "video" || layer.kind === "image") {
      notNegative(`layer ${layer.id} fade in`, layer.fadeInUs);
      notNegative(`layer ${layer.id} fade out`, layer.fadeOutUs);
    } else {
      notNegative(`layer ${layer.id} animation in`, layer.animation.inDurationUs);
      notNegative(`layer ${layer.id} animation out`, layer.animation.outDurationUs);
    }
    if (layer.kind === "video") source(`layer ${layer.id}`, layer.source);
  }
  for (const t of plan.transitions) positive(`transition ${t.id}`, t);
  for (const a of plan.audio) {
    positive(`audio ${a.id}`, a);
    source(`audio ${a.id}`, a.source);
    notNegative(`audio ${a.id} fade in`, a.fadeInUs);
    notNegative(`audio ${a.id} fade out`, a.fadeOutUs);
    a.ducking?.regions.forEach((r, i) => positive(`audio ${a.id} ducking region ${i}`, r));
  }
  return problems;
}

/** Everything stays inside the plan, its layer, the user's trim and the canvas. */
function boundsProblems(plan: RenderPlan, { project, assets }: Case): string[] {
  const problems: string[] = [];
  const { width, height } = plan.canvas;
  const tolerance = 1e-6 * Math.max(width, height);
  const inside = (what: string, r: TimeRange, outer: TimeRange) => {
    if (!rangeContainsRange(outer, r)) {
      problems.push(`${what}: ${r.startUs}..${r.endUs} outside ${outer.startUs}..${outer.endUs}`);
    }
  };
  const fits = (what: string, us: number, r: TimeRange) => {
    if (!(us <= r.endUs - r.startUs)) problems.push(`${what}: ${us} is longer than ${r.startUs}..${r.endUs}`);
  };
  const inTrim = (what: string, slotId: string, s: SourceTiming) => {
    const binding = project.bindings[slotId];
    const fileUs = assets[s.assetUri]?.durationUs;
    const known = Number.isSafeInteger(fileUs) && fileUs! > 0;
    const trim = binding && {
      startUs: binding.trimInUs,
      endUs: known ? Math.min(binding.trimOutUs, fileUs!) : binding.trimOutUs,
    };
    if (!trim || binding.assetUri !== s.assetUri) problems.push(`${what}: source isn't the slot's media`);
    else inside(`${what} source`, { startUs: s.sourceStartUs, endUs: s.sourceEndUs }, trim);
  };
  const onCanvas = (layer: VideoLayer | ImageLayer) => {
    const { cropPx: c, sourceSize: s, transform: m } = layer;
    const inSource = (at: number, length: number, side: number) =>
      at >= 0 && length > 0 && at + length <= side * (1 + 1e-9);
    if (!(inSource(c.x, c.width, s.width) && inSource(c.y, c.height, s.height))) {
      problems.push(`layer ${layer.id}: crop ${JSON.stringify(c)} outside the ${s.width}x${s.height} source`);
    }
    const [x0, y0] = transformPoint(m, c.x, c.y);
    const [x1, y1] = transformPoint(m, c.x + c.width, c.y + c.height);
    const axisAligned = m[1] === 0 && m[3] === 0 && m[6] === 0 && m[7] === 0 && m[8] === 1;
    const centered = Math.abs(x0 + x1 - width) <= tolerance && Math.abs(y0 + y1 - height) <= tolerance;
    const covers = x0 <= tolerance && y0 <= tolerance && x1 >= width - tolerance && y1 >= height - tolerance;
    const within = x0 >= -tolerance && y0 >= -tolerance && x1 <= width + tolerance && y1 <= height + tolerance;
    if (!(axisAligned && centered && (layer.fit === "contain" || covers) && (layer.fit === "cover" || within))) {
      problems.push(
        `layer ${layer.id}: ${layer.fit} puts the crop at (${x0}, ${y0})..(${x1}, ${y1}) on ${width}x${height}`,
      );
    }
  };

  const whole = { startUs: 0, endUs: plan.durationUs };
  for (const layer of plan.layers) {
    inside(`layer ${layer.id}`, layer, whole);
    if (layer.kind === "video" || layer.kind === "image") {
      fits(`layer ${layer.id} fade in`, layer.fadeInUs, layer);
      fits(`layer ${layer.id} fade out`, layer.fadeOutUs, layer);
      onCanvas(layer);
      if (layer.kind === "video") inTrim(`layer ${layer.id}`, layer.slotId, layer.source);
    } else {
      // Overlays are only checked at their anchor and sticker width; text size isn't known before layout.
      fits(`layer ${layer.id} animation`, layer.animation.inDurationUs + layer.animation.outDurationUs, layer);
      const { xPx, yPx } = layer.placement;
      if (!(xPx >= 0 && xPx <= width && yPx >= 0 && yPx <= height)) {
        problems.push(`layer ${layer.id}: anchor (${xPx}, ${yPx}) off the ${width}x${height} canvas`);
      }
      if (layer.kind === "sticker" && !(layer.widthPx > 0 && layer.widthPx <= width)) {
        problems.push(`layer ${layer.id}: sticker width ${layer.widthPx} on a ${width} px canvas`);
      }
    }
  }
  for (const t of plan.transitions) {
    inside(`transition ${t.id}`, t, whole);
    const to = plan.layers.find((l) => l.id === t.toLayerId);
    if (to) inside(`transition ${t.id}`, t, to);
  }
  for (const a of plan.audio) {
    inside(`audio ${a.id}`, a, whole);
    fits(`audio ${a.id} fade in`, a.fadeInUs, a);
    fits(`audio ${a.id} fade out`, a.fadeOutUs, a);
    inTrim(`audio ${a.id}`, a.slotId, a.source);
    a.ducking?.regions.forEach((r, i) => inside(`audio ${a.id} ducking region ${i}`, r, a));
  }
  return problems;
}

/** Checks every pair of clips on a video track, independently of checkPlanInvariants(). */
function overlapProblems(plan: RenderPlan): string[] {
  const problems: string[] = [];
  const media = plan.layers.filter((l) => l.kind === "video" || l.kind === "image");
  for (const trackId of new Set(media.map((l) => l.trackId))) {
    const clips = media.filter((l) => l.trackId === trackId);
    const windows = plan.transitions.filter((t) => t.trackId === trackId);
    for (const clip of clips) {
      const visible = clips.filter((l) => rangeContains(l, clip.startUs));
      if (visible.length > 2) {
        problems.push(`track ${trackId}: ${visible.map((l) => l.id).join(", ")} visible at ${clip.startUs}`);
      }
    }
    clips.forEach((a, i) => {
      for (const b of clips.slice(i + 1)) {
        const overlap = intersectRanges(a, b);
        if (!overlap) continue;
        const [first, second] = a.startUs <= b.startUs ? [a, b] : [b, a];
        const paired = windows.some(
          (t) => t.fromLayerId === first.id && t.toLayerId === second.id && rangeContainsRange(t, overlap),
        );
        if (!paired) problems.push(`track ${trackId}: ${first.id} and ${second.id} overlap outside a transition`);
      }
    });
    windows.forEach((t, i) => {
      const next = windows[i + 1];
      if (next && rangesOverlap(t, next)) problems.push(`track ${trackId}: transitions ${t.id} and ${next.id} overlap`);
    });
  }
  return problems;
}

describe.each([
  ["generated templates", generatedTemplates],
  ["variations of the sample templates", sampleVariations],
])("resolve on %s", (_name, templates) => {
  const check = (problems: (plan: RenderPlan, input: Case) => string[]) =>
    fc.assert(
      fc.property(cases(templates), optionsRecipe, (input, options) => {
        expect(problems(resolveCase(input, options), input)).toEqual([]);
      }),
      { numRuns: RUNS },
    );

  it("keeps every plan invariant", () => {
    check(checkPlanInvariants);
  });

  it("has no negative or zero durations", () => {
    check(durationProblems);
  });

  it("keeps layers in bounds, in time and on the canvas", () => {
    check(boundsProblems);
  });

  it("never shows more than two clips of a video track at once, and two only inside their transition", () => {
    check(overlapProblems);
  });
});

const HUGE_PLACES = [
  "template duration",
  "trim in",
  "trim out",
  "trim window picker",
  "item fades",
  "overlay animations",
  "music start",
  "music fades",
] as const;
type HugePlace = (typeof HUGE_PLACES)[number];

/** Puts `us` in each of `places`, keeping the project valid. */
function stretch({ project, assets }: Case, places: readonly HugePlace[], us: number): Case {
  const stretched = structuredClone(project);
  const { template } = stretched;
  const music = template.audio?.music;
  const at = (place: HugePlace) => places.includes(place);
  if (at("template duration") || (at("music start") && music)) template.durationUs = us;
  if (at("music start") && music) music.startUs = us - 1;
  if (at("music fades") && music) {
    music.fadeInUs = us;
    music.fadeOutUs = us;
  }
  for (const track of template.tracks) {
    if (track.type === "overlay" && at("overlay animations")) {
      for (const item of track.items) {
        item.animation = { in: "fade", out: "fade", ...item.animation, inDurationUs: us, outDurationUs: us };
      }
    }
    if (track.type !== "overlay" && at("item fades")) {
      for (const item of track.items) {
        item.fadeInUs = us;
        item.fadeOutUs = us;
      }
    }
  }
  for (const b of Object.values(stretched.bindings)) {
    // Halfway, so a huge trim out as well still leaves frames to play.
    if (at("trim in")) b.trimInUs = Math.floor(us / 2);
    if (at("trim out")) b.trimOutUs = Math.max(b.trimOutUs, us);
    b.trimOutUs = Math.max(b.trimOutUs, b.trimInUs + 1);
  }
  return { project: stretched, assets };
}

describe("resolve with valid times far longer than any real video", () => {
  const hugeUs = fc.integer({ min: 2 ** 45, max: Number.MAX_SAFE_INTEGER });
  const where = fc.constantFrom<readonly HugePlace[]>(...HUGE_PLACES.map((p) => [p]), HUGE_PLACES);

  it("never throws, and passes the invariant, duration, bounds and overlap checks", () => {
    fc.assert(
      fc.property(cases(generatedTemplates), optionsRecipe, where, hugeUs, (input, options, places, us) => {
        const stretched = stretch(input, places, us);
        const recipe = places.includes("trim window picker") ? { ...options, pick: { returns: us } } : options;
        const plan = resolveCase(stretched, recipe);
        expect([
          ...checkPlanInvariants(plan),
          ...durationProblems(plan),
          ...boundsProblems(plan, stretched),
          ...overlapProblems(plan),
        ]).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });
});
