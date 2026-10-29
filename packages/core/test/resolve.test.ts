import type { MediaItem, Template } from "@stackreel/template-schema";
import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  checkPlanInvariants,
  createProject,
  resolve,
  validateProject,
  type AssetInfo,
  type Layer,
  type Project,
  type RenderPlan,
  type ResolveOptions,
  type SlotBinding,
  type TextLayer,
  type VideoLayer,
} from "../src/index.js";
import { maxTimeUs } from "../src/limits.js";
import { testTemplate } from "./helpers.js";

const HD = { width: 1920, height: 1080 };
const bind = (assetUri: string, trimOutUs = 10_000_000, trimInUs = 0): SlotBinding => ({
  assetUri,
  trimInUs,
  trimOutUs,
});

/** Resolves, after checking the project is valid and before checking the plan's invariants. */
function plan(project: Project, options: ResolveOptions = {}): RenderPlan {
  const valid = validateProject(project);
  if (!valid.ok) throw new Error(JSON.stringify(valid.errors));
  const result = resolve(project, options);
  expect(checkPlanInvariants(result)).toEqual([]);
  return result;
}

const layer = <K extends Layer["kind"]>(p: RenderPlan, id: string, kind: K) => {
  const found = p.layers.find((l) => l.id === id);
  if (found?.kind !== kind) throw new Error(`no ${kind} layer ${id}`);
  return found as Extract<Layer, { kind: K }>;
};

/** A template with one video track of back-to-back clips, a music slot, and no overlays. */
function clips(items: Partial<MediaItem>[], extra: Partial<Template> = {}): Template {
  let startUs = 0;
  const mediaItems = items.map((item, i) => {
    const durationUs = item.durationUs ?? 1_000_000;
    const out = { slot: `c${i}`, startUs, durationUs, ...item };
    startUs = out.startUs + durationUs;
    return out;
  });
  return {
    schemaVersion: 1,
    id: "clips",
    name: "Clips",
    canvas: { width: 1080, height: 1920, fps: 30 },
    durationUs: Math.max(startUs, 1_000_000),
    slots: [
      ...[...new Set(mediaItems.map((m) => m.slot))].map((id) => ({ id, kind: "video" as const, label: `Clip ${id}` })),
      { id: "music", kind: "audio", label: "Music", optional: true },
      { id: "voice", kind: "audio", label: "Voice", optional: true },
    ],
    tracks: [{ id: "main", type: "video", items: mediaItems }],
    ...extra,
  };
}

function bound(template: Template, slots = template.slots.filter((s) => s.kind === "video").map((s) => s.id)) {
  const project = createProject(template);
  for (const id of slots) project.bindings[id] = bind(`${id}.mp4`);
  return project;
}

const assetsFor = (project: Project, info: AssetInfo = { ...HD, durationUs: 10_000_000 }) =>
  Object.fromEntries(Object.values(project.bindings).map((b) => [b.assetUri, info]));

describe("resolve: the test template", () => {
  const project = createProject(testTemplate());
  project.bindings["clip1"] = bind("clip1.mp4", 8_000_000, 1_000_000);
  project.bindings["photo"] = { ...bind("photo.jpg"), crop: { x: 0, y: 0, width: 1, height: 0.5 } };
  project.overrides.text["title"] = "Hello";
  project.overrides.text["captions/0"] = "Edited";
  project.overrides.style["captions/0"] = { color: "#FF0000" };
  const assets = {
    "clip1.mp4": { ...HD, durationUs: 20_000_000 },
    "photo.jpg": { width: 1080, height: 3840 },
  };
  const p = plan(project, { assets });

  it("describes the canvas with defaults applied", () => {
    expect(p.renderPlanVersion).toBe(1);
    expect(p.templateId).toBe("test");
    expect(p.canvas).toEqual({ width: 1080, height: 1920, fps: 30, background: "#000000" });
    expect(p.durationUs).toBe(6_000_000);
  });

  it("lists every visual item in time order", () => {
    expect(p.layers.map((l) => [l.id, l.kind, l.startUs, l.endUs, l.z])).toEqual([
      ["main/0", "video", 0, 3_000_000, 0],
      ["captions/0", "text", 0, 2_000_000, 1],
      ["captions/3", "sticker", 0, 1_000_000, 1],
      ["captions/1", "text", 2_000_000, 4_000_000, 1],
      ["main/1", "image", 3_000_000, 6_000_000, 0],
      ["captions/2", "text", 4_000_000, 5_000_000, 1],
    ]);
  });

  it("plays the clip from its trim", () => {
    const clip = layer(p, "main/0", "video");
    expect(clip.source).toEqual({
      assetUri: "clip1.mp4",
      sourceStartUs: 1_000_000,
      sourceEndUs: 4_000_000,
      rate: 1,
      afterEnd: "hold",
      fitMode: "trim",
    });
    expect(clip.fit).toBe("cover");
    expect(clip.gainDb).toBe(0);
    expect(clip.sourceSize).toEqual(HD);
    expect(clip.transform[0]).toBeCloseTo(16 / 9);
  });

  it("crops the image before fitting it", () => {
    const photo = layer(p, "main/1", "image");
    expect(photo.cropPx).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(photo.transform).toEqual(IDENTITY);
  });

  it("applies text overrides and style tweaks", () => {
    const edited = layer(p, "captions/0", "text");
    expect(edited.text).toBe("Edited");
    expect(edited.style).toEqual({ font: "Inter-Black", sizePx: 96, color: "#FF0000", align: "center" });
    expect(layer(p, "captions/1", "text").text).toBe("Hello");
    expect(layer(p, "captions/2", "text").text).toBe("Fixed");
  });

  it("fills in default text style, position and animation", () => {
    const fixed = layer(p, "captions/2", "text");
    expect(fixed.style).toEqual({ font: "Inter-Bold", sizePx: 64, color: "#FFFFFF", align: "center" });
    expect(fixed.placement).toEqual({ xPx: 540, yPx: 960, anchor: "center", rotationDeg: 0 });
    expect(fixed.animation).toEqual({ in: "none", out: "none", inDurationUs: 0, outDurationUs: 0 });
  });

  it("sizes stickers against the canvas width", () => {
    expect(layer(p, "captions/3", "sticker")).toMatchObject({ asset: "star", widthPx: 216 });
  });

  it("lists the clip's sound", () => {
    expect(p.audio).toEqual([
      {
        id: "main/0",
        kind: "video",
        slotId: "clip1",
        startUs: 0,
        endUs: 3_000_000,
        source: layer(p, "main/0", "video").source,
        gainDb: 0,
        fadeInUs: 0,
        fadeOutUs: 0,
      },
    ]);
    expect(p.warnings).toEqual([]);
  });

  it("doesn't share objects with the project", () => {
    const again = resolve(project, { assets });
    again.layers.forEach((l) => {
      if (l.kind === "text") l.style.color = "#000000";
    });
    expect(layer(resolve(project, { assets }), "captions/0", "text").style.color).toBe("#FF0000");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(resolve(project, { assets }))).toBe(JSON.stringify(p));
  });
});

describe("resolve: transitions", () => {
  const template = clips([
    { transitionIn: { type: "crossfade", durationUs: 300_000 } },
    { transitionIn: { type: "crossfade", durationUs: 500_000 } },
    { transitionIn: { type: "slide", durationUs: 150_000 } },
    { transitionIn: { type: "whip-pan", durationUs: 200_000, direction: "up" } },
    { transitionIn: { type: "cut", durationUs: 0 } },
    { transitionIn: { type: "zoom-punch", durationUs: 0 } },
  ]);

  it("pairs the outgoing and incoming layers and extends the outgoing one", () => {
    const project = bound(template);
    const p = plan(project, { assets: assetsFor(project) });
    expect(p.transitions).toEqual([
      {
        id: "main/0",
        trackId: "main",
        z: 0,
        type: "crossfade",
        startUs: 0,
        endUs: 300_000,
        fromLayerId: null,
        toLayerId: "main/0",
      },
      {
        id: "main/1",
        trackId: "main",
        z: 0,
        type: "crossfade",
        startUs: 1_000_000,
        endUs: 1_500_000,
        fromLayerId: "main/0",
        toLayerId: "main/1",
      },
      {
        id: "main/2",
        trackId: "main",
        z: 0,
        type: "slide",
        direction: "left",
        startUs: 2_000_000,
        endUs: 2_166_667, // 150 ms is 4.5 frames at 30 fps; it rounds to 5
        fromLayerId: "main/1",
        toLayerId: "main/2",
      },
      {
        id: "main/3",
        trackId: "main",
        z: 0,
        type: "whip-pan",
        direction: "up",
        startUs: 3_000_000,
        endUs: 3_200_000,
        fromLayerId: "main/2",
        toLayerId: "main/3",
      },
    ]);
    const first = layer(p, "main/0", "video");
    expect([first.startUs, first.endUs]).toEqual([0, 1_500_000]);
    expect([first.source.sourceStartUs, first.source.sourceEndUs]).toEqual([0, 1_500_000]);
    expect(layer(p, "main/3", "video").endUs).toBe(4_000_000);
    expect(p.audio.find((a) => a.id === "main/0")?.endUs).toBe(1_500_000);
  });

  it("transitions in from the background when the outgoing slot is empty", () => {
    const p = plan(bound(template, ["c1", "c2", "c4"]));
    expect(p.transitions.map((t) => [t.id, t.fromLayerId])).toEqual([
      ["main/1", null],
      ["main/2", "main/1"],
    ]);
    expect(p.warnings.filter((w) => w.type === "missing-slot").map((w) => w.slotId)).toEqual(["c0", "c3", "c5"]);
  });

  it("transitions in from the background after a gap", () => {
    const gap = clips([{}, { startUs: 1_500_000, transitionIn: { type: "crossfade", durationUs: 300_000 } }]);
    expect(plan(bound(gap)).transitions[0]?.fromLayerId).toBeNull();
  });

  it("drops the transition's outgoing side when that clip can't play", () => {
    const project = bound(template);
    project.bindings["c0"] = bind("bad.mp4", 2_000_000, 1_000_000);
    const assets = { ...assetsFor(project), "bad.mp4": { ...HD, durationUs: 500_000 } };
    const p = plan(project, { assets });
    expect(p.layers.some((l) => l.id === "main/0")).toBe(false);
    expect(p.transitions.find((t) => t.id === "main/1")?.fromLayerId).toBeNull();
    expect(p.transitions.some((t) => t.id === "main/0")).toBe(false);
    expect(p.warnings).toContainEqual({
      type: "empty-trim",
      slotId: "c0",
      layerId: "main/0",
      message: `The trimmed media in "Clip c0" has no frames to play`,
    });
  });

  it("works with image slots on both sides", () => {
    const t = clips([{}, { transitionIn: { type: "spin", durationUs: 400_000 } }]);
    t.slots = t.slots.map((s) => (s.id === "c0" ? { id: "c0", kind: "image", label: "Photo" } : s));
    const project = bound(t, ["c1"]);
    project.bindings["c0"] = bind("photo.jpg");
    const p = plan(project, { assets: { "photo.jpg": HD, "c1.mp4": HD } });
    expect(layer(p, "main/0", "image").endUs).toBe(1_400_000);
    expect(p.transitions[0]).toMatchObject({ fromLayerId: "main/0", toLayerId: "main/1", type: "spin" });
    expect(p.transitions[0]).not.toHaveProperty("direction");
  });
});

describe("resolve: slot fitting", () => {
  const template = clips([{ durationUs: 2_000_000 }, { durationUs: 2_000_000, speed: 2 }]);
  const project = bound(template);
  const assets = { "c0.mp4": { ...HD, durationUs: 400_000 }, "c1.mp4": { ...HD, durationUs: 30_000_000 } };

  it.each([
    ["freeze", { rate: 1, afterEnd: "hold", fitMode: "freeze" }],
    ["slow", { rate: 0.25, afterEnd: "hold", fitMode: "slow" }],
    ["loop", { rate: 1, afterEnd: "loop", fitMode: "loop" }],
  ] as const)("follows the %s policy and warns", (policy, expected) => {
    const p = plan(project, { assets, shortClipPolicy: policy });
    expect(layer(p, "main/0", "video").source).toMatchObject({ sourceStartUs: 0, sourceEndUs: 400_000, ...expected });
    expect(p.warnings[0]).toEqual({
      type: "clip-too-short",
      slotId: "c0",
      layerId: "main/0",
      neededUs: 2_000_000,
      availableUs: 400_000,
      policy,
      message: `The media in "Clip c0" is shorter than its slot (${policy})`,
    });
  });

  it("warns when slow hits the minimum speed", () => {
    const p = plan(project, { assets, shortClipPolicy: "slow" });
    expect(p.warnings.map((w) => w.type)).toEqual(["clip-too-short", "min-speed-reached"]);
    expect(plan(project, { assets, shortClipPolicy: "slow", minSpeed: 0.1 }).warnings).toHaveLength(1);
  });

  it("plays long clips at the template speed and lets a picker choose the window", () => {
    const p = plan(project, { assets, pickTrimWindow: (c) => c.windowEndUs - c.neededUs });
    expect(layer(p, "main/1", "video").source).toMatchObject({
      sourceStartUs: 6_000_000,
      sourceEndUs: 10_000_000,
      rate: 2,
      fitMode: "trim",
    });
  });

  it("plays at least one frame of source for a one-frame item below half speed", () => {
    const t = clips([{ durationUs: 33_333, speed: 0.25 }]);
    t.tracks.push({ id: "vo", type: "audio", items: [{ slot: "voice", startUs: 0, durationUs: 33_333, speed: 0.25 }] });
    const oneFrame = bound(t, ["c0", "voice"]);
    const p = plan(oneFrame, { assets: assetsFor(oneFrame, { width: 1080, height: 1920, durationUs: 10_000_000 }) });
    expect(p.audio.map((a) => a.id)).toEqual(["main/0", "vo/0"]);
    for (const source of [layer(p, "main/0", "video").source, ...p.audio.map((a) => a.source)]) {
      expect(source).toMatchObject({ sourceStartUs: 0, sourceEndUs: 33_333, rate: 0.25, fitMode: "trim" });
    }
  });

  it("keeps the transform finite for a crop smaller than a pixel", () => {
    const cropped = bound(clips([{}]));
    cropped.bindings["c0"] = { ...bind("c0.mp4"), crop: { x: 0, y: 0, width: 5e-324, height: 0.01 } };
    const clip = layer(plan(cropped, { assets: assetsFor(cropped) }), "main/0", "video");
    expect(clip.cropPx).toEqual({ x: 0, y: 0, width: 1, height: 10.8 });
    expect(clip.transform.every(Number.isFinite)).toBe(true);
  });

  it("assumes the canvas size when asset details are missing, and warns once per slot", () => {
    const t = clips([{ slot: "c0" }, { slot: "c0" }]);
    t.slots = t.slots.filter((s) => s.id !== "c1");
    const p = plan(bound(t));
    expect(p.warnings).toEqual([
      {
        type: "asset-info-missing",
        slotId: "c0",
        assetUri: "c0.mp4",
        message: `No details for the media in "Clip c0"; assuming the canvas size`,
      },
    ]);
    expect(layer(p, "main/1", "video").transform).toEqual(IDENTITY);
  });

  it("never throws on bad asset details", () => {
    const p = plan(project, {
      assets: { "c0.mp4": { width: Number.NaN, height: -1, durationUs: 1.5 }, "c1.mp4": { durationUs: -10 } },
    });
    expect(p.warnings.map((w) => [w.type, w.message])).toEqual([
      ["asset-info-missing", `No size for the media in "Clip c0"; assuming the canvas size`],
      ["asset-info-missing", `No size for the media in "Clip c1"; assuming the canvas size`],
    ]);
  });

  it.each([
    { width: 1e-310, height: 1080 },
    { width: 1e306, height: 1 },
    { width: 1, height: 1e306 },
  ])("treats a $width×$height size as missing, so the transform stays finite", (size) => {
    const t = clips([{}, {}]);
    t.slots = t.slots.map((s) => (s.id === "c1" ? { id: "c1", kind: "image", label: "Photo" } : s));
    const junk = bound(t, ["c0", "c1"]);
    const p = plan(junk, { assets: assetsFor(junk, { ...size, durationUs: 10_000_000 }) });
    expect(p.warnings.map((w) => w.message)).toEqual([
      `No size for the media in "Clip c0"; assuming the canvas size`,
      `No size for the media in "Photo"; assuming the canvas size`,
    ]);
    expect(layer(p, "main/0", "video").transform).toEqual(IDENTITY);
    expect(layer(p, "main/1", "image").transform).toEqual(IDENTITY);
  });

  it("ignores inherited keys in bindings and assets", () => {
    const p = resolve(createProject(clips([{ slot: "constructor" }])), { assets: {} });
    expect(p.layers).toEqual([]);
    expect(p.warnings.map((w) => w.type)).toEqual(["missing-slot"]);
  });
});

describe("resolve: timing", () => {
  it("snaps item times to frames", () => {
    const t = clips([{ durationUs: 1_010_000 }, { startUs: 1_010_000, durationUs: 990_000 }]);
    const p = plan(bound(t));
    expect(p.layers.map((l) => [l.startUs, l.endUs])).toEqual([
      [0, 1_000_000],
      [1_000_000, 2_000_000],
    ]);
  });

  it("drops items shorter than a frame", () => {
    const t = clips([{ durationUs: 1_000_000 }, { durationUs: 10_000 }]);
    const p = plan(bound(t));
    expect(p.layers).toHaveLength(1);
    expect(p.warnings).toContainEqual({
      type: "item-too-short",
      trackId: "main",
      itemIndex: 1,
      message: `Item 1 on track "main" is shorter than one frame`,
    });
  });

  it("snaps fades and keeps them inside the layer", () => {
    const t = clips([{ fadeInUs: 150_000, fadeOutUs: 5_000_000 }]);
    const clip = layer(plan(bound(t)), "main/0", "video");
    expect([clip.fadeInUs, clip.fadeOutUs]).toEqual([166_667, 1_000_000]);
  });

  it("clamps valid times that are later than the frame math handles", () => {
    const maxUs = maxTimeUs(240);
    const t = clips([{}], { canvas: { width: 1080, height: 1920, fps: 240 }, durationUs: 31_536_000_000_000 });
    expect(plan(createProject(t)).durationUs).toBe(maxUs);
    const project = bound(t);
    project.bindings["c0"] = bind("c0.mp4", Number.MAX_SAFE_INTEGER);
    const assets = { "c0.mp4": HD };
    const trimmed = layer(plan(project, { assets }), "main/0", "video").source;
    expect([trimmed.sourceStartUs, trimmed.sourceEndUs]).toEqual([0, 1_000_000]);
    const options = { assets, pickTrimWindow: () => Number.MAX_SAFE_INTEGER };
    const picked = layer(plan(project, options), "main/0", "video").source;
    expect([picked.sourceStartUs, picked.sourceEndUs]).toEqual([maxUs - 1_000_000, maxUs]);
  });
});

describe("resolve: overlays", () => {
  const template = (items: NonNullable<Template["tracks"][number]>["items"]): Template => ({
    ...clips([{ durationUs: 2_000_000 }]),
    tracks: [{ id: "top", type: "overlay", items } as Template["tracks"][number]],
  });

  it("resolves animation durations with defaults, inside the layer", () => {
    const p = plan(
      createProject(
        template([
          { kind: "text", startUs: 0, durationUs: 1_000_000, text: { default: "a" }, animation: { in: "pop" } },
          {
            kind: "text",
            startUs: 0,
            durationUs: 500_000,
            text: { default: "b" },
            animation: { in: "fade", out: "slide-up", inDurationUs: 400_000, outDurationUs: 400_000 },
          },
          {
            kind: "sticker",
            startUs: 0,
            durationUs: 1_000_000,
            asset: "fire",
            widthNorm: 0.5,
            position: { anchor: "top-right", x: 1, y: 0, rotationDeg: -15 },
            animation: { in: "none", out: "bounce" },
          },
        ]),
      ),
    );
    expect(layer(p, "top/0", "text").animation).toEqual({
      in: "pop",
      out: "none",
      inDurationUs: 300_000,
      outDurationUs: 0,
    });
    expect(layer(p, "top/1", "text").animation).toEqual({
      in: "fade",
      out: "slide-up",
      inDurationUs: 400_000,
      outDurationUs: 100_000,
    });
    const sticker = layer(p, "top/2", "sticker");
    expect(sticker.animation).toEqual({ in: "none", out: "bounce", inDurationUs: 0, outDurationUs: 300_000 });
    expect(sticker.placement).toEqual({ xPx: 1080, yPx: 0, anchor: "top-right", rotationDeg: -15 });
    expect(sticker.widthPx).toBe(540);
  });

  it("drops overlays shorter than a frame", () => {
    const p = resolve(createProject(template([{ kind: "text", startUs: 0, durationUs: 1, text: { default: "a" } }])));
    expect(p.layers).toEqual([]);
    expect(p.warnings.map((w) => w.type)).toContain("item-too-short");
  });

  it("only uses item-key text overrides on editable items", () => {
    const project = createProject(
      template([{ kind: "text", startUs: 0, durationUs: 1_000_000, text: { default: "a", editable: false } }]),
    );
    project.overrides.text["top/0"] = "b";
    expect((resolve(project).layers[0] as TextLayer).text).toBe("a");
  });
});

describe("resolve: audio", () => {
  const template = clips(
    [
      { durationUs: 2_000_000, gainDb: -6 },
      { durationUs: 2_000_000, gainDb: -60 },
    ],
    {
      audio: { music: { slot: "music", startUs: 500_000, gainDb: -3, fadeInUs: 1_000_000 }, duckMusicUnderVoice: true },
    },
  );
  template.tracks.push({
    id: "vo",
    type: "audio",
    items: [{ slot: "voice", startUs: 2_500_000, durationUs: 1_000_000, fadeOutUs: 200_000 }],
  });
  const project = bound(template);
  project.bindings["music"] = bind("music.m4a", 60_000_000);
  project.bindings["voice"] = bind("voice.m4a", 500_000);
  const assets = { ...assetsFor(project), "music.m4a": { durationUs: 60_000_000 }, "voice.m4a": {} };

  it("lists clip sound, audio-track items and music, with ducking under audible clips", () => {
    const p = plan(project, { assets, shortClipPolicy: "slow" });
    expect(p.audio.map((a) => [a.id, a.kind, a.startUs, a.endUs, a.gainDb])).toEqual([
      ["main/0", "video", 0, 2_000_000, -6],
      ["music", "music", 500_000, 4_000_000, -3],
      ["main/1", "video", 2_000_000, 4_000_000, -60],
      ["vo/0", "audio", 2_500_000, 3_500_000, 0],
    ]);
    const music = p.audio.find((a) => a.id === "music")!;
    expect(music.fadeInUs).toBe(1_000_000);
    expect(music.source).toMatchObject({ sourceStartUs: 0, sourceEndUs: 3_500_000, fitMode: "trim" });
    expect(music.ducking).toEqual({
      gainDb: -12,
      rampUs: 200_000,
      regions: [
        { startUs: 500_000, endUs: 2_000_000 },
        { startUs: 2_500_000, endUs: 3_500_000 },
      ],
    });
    const voice = p.audio.find((a) => a.id === "vo/0")!;
    expect(voice.fadeOutUs).toBe(200_000);
    // Audio never slows down: the short voice-over plays at full speed, then goes silent.
    expect(voice.source).toMatchObject({ rate: 1, afterEnd: "hold", fitMode: "freeze" });
  });

  it("takes ducking settings from options and skips ducking when the template doesn't ask", () => {
    const p = plan(project, { assets, duckGainDb: -20, duckRampUs: 100_000 });
    expect(p.audio.find((a) => a.id === "music")?.ducking).toMatchObject({ gainDb: -20, rampUs: 100_000 });
    const quiet = structuredClone(project);
    quiet.template.audio = { music: { slot: "music" } };
    const music = plan(quiet, { assets }).audio.find((a) => a.id === "music")!;
    expect(music).not.toHaveProperty("ducking");
    expect([music.startUs, music.gainDb, music.fadeInUs]).toEqual([0, 0, 0]);
  });

  it("takes ducking gain and ramp from the template, and lets options override each", () => {
    const tuned = structuredClone(project);
    tuned.template.audio!.music = { ...tuned.template.audio!.music!, duckGainDb: -24, duckRampUs: 50_000 };
    const ducking = (options: ResolveOptions) =>
      plan(tuned, { assets, ...options }).audio.find((a) => a.id === "music")?.ducking;
    expect(ducking({})).toMatchObject({ gainDb: -24, rampUs: 50_000 });
    expect(ducking({ duckGainDb: -6 })).toMatchObject({ gainDb: -6, rampUs: 50_000 });
    expect(ducking({ duckRampUs: 0 })).toMatchObject({ gainDb: -24, rampUs: 0 });
  });

  /** Sets `voice` on the media items with these keys. */
  const marked = (marks: Record<string, boolean>) => {
    const copy = structuredClone(project);
    for (const track of copy.template.tracks) {
      if (track.type === "overlay") continue;
      track.items.forEach((item, i) => {
        const mark = marks[`${track.id}/${i}`];
        if (mark !== undefined) item.voice = mark;
      });
    }
    return copy;
  };
  const regions = (p: Project) => plan(p, { assets }).audio.find((a) => a.id === "music")?.ducking?.regions;

  it("ducks only under clips marked as voice when the template marks any", () => {
    expect(regions(marked({ "vo/0": true }))).toEqual([{ startUs: 2_500_000, endUs: 3_500_000 }]);
    expect(regions(marked({ "main/0": true, "vo/0": false }))).toEqual([{ startUs: 500_000, endUs: 2_000_000 }]);
    // A muted voice clip doesn't duck, and neither do the unmarked clips.
    expect(regions(marked({ "main/1": true }))).toEqual([]);
    const unbound = marked({ "vo/0": true });
    delete unbound.bindings["voice"];
    expect(regions(unbound)).toEqual([]);
  });

  it("ducks under every audible clip when no clip is marked as voice", () => {
    const all = [
      { startUs: 500_000, endUs: 2_000_000 },
      { startUs: 2_500_000, endUs: 3_500_000 },
    ];
    expect(regions(project)).toEqual(all);
    expect(regions(marked({ "main/0": false, "main/1": false, "vo/0": false }))).toEqual(all);
  });

  it("leaves music out when its slot is empty or its trim has no frames", () => {
    const empty = structuredClone(project);
    delete empty.bindings["music"];
    expect(plan(empty, { assets }).audio.some((a) => a.kind === "music")).toBe(false);
    const broken = structuredClone(project);
    broken.bindings["music"] = bind("music.m4a", 70_000_000, 65_000_000);
    expect(plan(broken, { assets }).audio.some((a) => a.kind === "music")).toBe(false);
  });

  it("starts music on the last frame start when its start is inside the last frame", () => {
    const t = clips([{ durationUs: 66_667 }], {
      durationUs: 66_667,
      audio: { music: { slot: "music", startUs: 66_666 } },
    });
    const late = bound(t);
    late.bindings["music"] = bind("music.m4a");
    const music = plan(late).audio.find((a) => a.id === "music")!;
    expect([music.startUs, music.endUs, music.fadeInUs]).toEqual([33_333, 66_667, 0]);
  });

  it("leaves out audio items whose trim has no frames", () => {
    const broken = structuredClone(project);
    broken.bindings["voice"] = bind("voice.m4a", 10);
    expect(plan(broken, { assets }).audio.some((a) => a.kind === "audio")).toBe(false);
  });
});

describe("checkPlanInvariants", () => {
  const template = clips([{}, { transitionIn: { type: "crossfade", durationUs: 300_000 } }, {}]);
  const project = bound(template);
  const good = () => resolve(project, { assets: assetsFor(project) });

  it("accepts a resolved plan", () => {
    expect(checkPlanInvariants(good())).toEqual([]);
  });

  it.each<[string, (p: RenderPlan) => void, string]>([
    ["a negative length", (p) => (p.layers[0]!.endUs = -1), "length is not positive"],
    ["a layer past the end", (p) => (p.layers[2]!.endUs = 99_000_000), "outside"],
    ["an off-frame time", (p) => (p.layers[0]!.startUs = 1), "not on frame starts"],
    ["an empty source", (p) => ((p.layers[0] as VideoLayer).source.sourceEndUs = 0), "empty source range"],
    ["a zero rate", (p) => (p.audio[0]!.source.rate = 0), "rate is not positive"],
    ["a non-finite transform", (p) => ((p.layers[0] as VideoLayer).transform[0] = Number.NaN), "not finite"],
    ["unsorted layers", (p) => p.layers.reverse(), "not sorted"],
    ["unsorted transitions", (p) => p.transitions.push({ ...p.transitions[0]!, startUs: 0, id: "x" }), "not sorted"],
    ["unsorted audio", (p) => p.audio.reverse(), "not sorted"],
    ["duplicate ids", (p) => (p.layers[1]!.id = p.layers[0]!.id), "duplicate ids"],
    ["a dangling transition", (p) => (p.transitions[0]!.toLayerId = "nope"), "incoming layer"],
    ["a wrong outgoing layer", (p) => (p.transitions[0]!.fromLayerId = "main/2"), "outgoing layer"],
    ["an overlap outside a transition", (p) => (p.transitions[0]!.fromLayerId = null), "outside a transition"],
    [
      "three layers at once",
      (p) => {
        p.layers[0]!.endUs = 2_000_000;
        p.layers[2]!.startUs = 1_000_000;
      },
      "3 layers visible",
    ],
  ])("reports %s", (_name, breakIt, message) => {
    const p = good();
    breakIt(p);
    expect(checkPlanInvariants(p).join("\n")).toContain(message);
  });
});
