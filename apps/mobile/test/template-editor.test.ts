import { checkPlanInvariants } from "@stackreel/core";
import type { RenderPlan } from "@stackreel/core";
import { validate } from "@stackreel/template-schema";
import { describe, expect, it } from "vitest";
import {
  createTemplateClip,
  createTemplateSource,
  defaultTemplateReframe,
  getTemplateCrop,
  getTemplateTrimWindow,
  getVideoSlots,
  maxTemplateReframeZoom,
  mobileTemplates,
  setTemplateClipReframe,
  setTemplateClipTrim,
} from "../src/template-editor";
import type { MobileTemplate, TemplateClip } from "../src/template-editor";

const beforeAfter = mobileTemplates[0]!;
const hookAndReveal = mobileTemplates[1]!;
const videoSize = { width: 1080, height: 1920 };

function fillSlots(template: MobileTemplate): Record<string, TemplateClip> {
  return Object.fromEntries(
    getVideoSlots(template).map((slot) => [
      slot.id,
      createTemplateClip(slot, "file:///" + slot.id + "/sample%20clip.mov", "sample clip.mov", {
        ...videoSize,
        startUs: 0,
        durationUs: slot.minDurationUs,
      }),
    ]),
  );
}

function parseSource(source: string | null): { plan: RenderPlan; assets: Record<string, string> } {
  if (source === null) throw new Error("Expected a complete template");
  return JSON.parse(source);
}

describe("mobile template catalog", () => {
  it("exposes the two validated templates and includes transition tails in the video minimums", () => {
    expect(mobileTemplates.map(({ id, name, durationUs }) => ({ id, name, durationUs }))).toEqual([
      { id: "before-after", name: "Before / After", durationUs: 8_000_000 },
      { id: "hook-and-reveal", name: "Hook & Reveal", durationUs: 9_000_000 },
    ]);
    expect(mobileTemplates.every((template) => validate(template).ok)).toBe(true);
    expect(getVideoSlots(beforeAfter)).toEqual([
      { id: "before", label: "Before", minDurationUs: 3_800_000 },
      { id: "after", label: "After", minDurationUs: 4_500_000 },
    ]);
    expect(getVideoSlots(hookAndReveal)).toEqual([
      { id: "clip1", label: "Your hook shot", minDurationUs: 3_266_667 },
      { id: "clip2", label: "B-roll", minDurationUs: 2_200_000 },
      { id: "clip3", label: "The reveal", minDurationUs: 4_000_000 },
    ]);
  });
});

describe("createTemplateSource", () => {
  it.each(mobileTemplates)("waits for every required clip in $name", (template) => {
    expect(createTemplateSource(template, {})).toBeNull();
    const clips = fillSlots(template);
    delete clips[getVideoSlots(template).at(-1)!.id];
    expect(createTemplateSource(template, clips)).toBeNull();
  });

  it("resolves Before / After with its default captions and only the source audio", () => {
    const { plan, assets } = parseSource(createTemplateSource(beforeAfter, fillSlots(beforeAfter)));
    expect(plan).toMatchObject({
      renderPlanVersion: 1,
      templateId: "before-after",
      canvas: { width: 1080, height: 1920, fps: 30, background: "#000000" },
      durationUs: 8_000_000,
      warnings: [],
    });
    expect(plan.layers.map((layer) => layer.kind)).toEqual(["video", "text", "video", "text", "text"]);
    expect(plan.layers.filter((layer) => layer.kind === "text").map(({ text }) => text)).toEqual([
      "BEFORE",
      "AFTER",
      "3 months of consistency",
    ]);
    expect(plan.transitions).toMatchObject([
      { type: "crossfade", startUs: 3_500_000, endUs: 3_800_000, fromLayerId: "main/0", toLayerId: "main/1" },
    ]);
    expect(assets).toEqual({
      "slot:before": "file:///before/sample%20clip.mov",
      "slot:after": "file:///after/sample%20clip.mov",
    });
    expect(plan.audio.map(({ kind, source }) => [kind, source.assetUri])).toEqual([
      ["video", "slot:before"],
      ["video", "slot:after"],
    ]);
    expect(checkPlanInvariants(plan)).toEqual([]);
  });

  it("resolves Hook & Reveal with an iOS crossfade and leftward slide", () => {
    const { plan } = parseSource(createTemplateSource(hookAndReveal, fillSlots(hookAndReveal)));
    expect(plan).toMatchObject({ templateId: "hook-and-reveal", durationUs: 9_000_000, warnings: [] });
    expect(plan.layers.filter((layer) => layer.kind === "text")).toMatchObject([{ text: "Wait for it…" }]);
    expect(plan.transitions).toMatchObject([
      { type: "crossfade", startUs: 3_000_000, endUs: 3_266_667, fromLayerId: "main/0", toLayerId: "main/1" },
      {
        type: "slide",
        direction: "left",
        startUs: 5_000_000,
        endUs: 5_200_000,
        fromLayerId: "main/1",
        toLayerId: "main/2",
      },
    ]);
    expect(checkPlanInvariants(plan)).toEqual([]);
  });

  it.each(mobileTemplates)("uses the full video and audio edit at the minimum lengths for $name", (template) => {
    const { plan } = parseSource(createTemplateSource(template, fillSlots(template)));
    const video = plan.layers.filter((layer) => layer.kind === "video");
    const slots = getVideoSlots(template);
    expect(video.map(({ source: { sourceEndUs } }) => sourceEndUs)).toEqual(slots.map((slot) => slot.minDurationUs));
    expect(plan.audio).toHaveLength(slots.length);
    for (const layer of video) {
      expect(layer.source).toMatchObject({ sourceStartUs: 0, rate: 1, fitMode: "trim" });
      expect(plan.audio.find((audio) => audio.id === layer.id)).toMatchObject({
        startUs: layer.startUs,
        endUs: layer.endUs,
        source: layer.source,
      });
    }
  });

  it("keeps distinct per-slot assets when replacing one of two identically named clips", () => {
    const clips = fillSlots(beforeAfter);
    const previous = parseSource(createTemplateSource(beforeAfter, clips));
    const [beforeSlot] = getVideoSlots(beforeAfter);
    const before = createTemplateClip(beforeSlot!, "file:///replacement/sample%20clip.mov", "sample clip.mov", {
      width: 1920,
      height: 1080,
      startUs: 100_000,
      durationUs: 6_000_000,
    });
    const { plan, assets } = parseSource(createTemplateSource(beforeAfter, { ...clips, before }));
    expect(assets).toEqual({ ...previous.assets, "slot:before": before.uri });
    expect(plan.layers.filter((layer) => layer.id !== "main/0")).toEqual(
      previous.plan.layers.filter((layer) => layer.id !== "main/0"),
    );
    const source = { assetUri: "slot:before", sourceStartUs: 100_000, sourceEndUs: 3_900_000, fitMode: "trim" };
    expect(plan.layers[0]).toMatchObject({ id: "main/0", sourceSize: { width: 1920, height: 1080 }, source });
    expect(plan.audio[0]).toMatchObject({ id: "main/0", source });
  });

  it("changes only the reframed slot's video geometry and restores the default plan on reset", () => {
    const [slot] = getVideoSlots(beforeAfter);
    const clip = createTemplateClip(slot!, "file:///landscape.mov", "landscape.mov", {
      width: 2160,
      height: 1920,
      startUs: 50_000,
      durationUs: 6_000_000,
    });
    const before = setTemplateClipTrim(slot!, clip, 5);
    const clips = { ...fillSlots(beforeAfter), before };
    const { canvas } = beforeAfter;
    const initialSource = createTemplateSource(beforeAfter, clips);
    const initial = parseSource(initialSource);
    expect(initial.plan.layers[0]).toMatchObject({
      id: "main/0",
      cropPx: { x: 0, y: 0, width: 2160, height: 1920 },
      transform: [1, 0, -540, 0, 1, 0, 0, 0, 1],
    });

    const reframed = setTemplateClipReframe(before, canvas, { zoom: 2, x: 1, y: 1 });
    const result = parseSource(createTemplateSource(beforeAfter, { ...clips, before: reframed }));
    expect(result).toEqual({
      ...initial,
      plan: {
        ...initial.plan,
        layers: initial.plan.layers.map((layer) =>
          layer.id === "main/0"
            ? {
                ...layer,
                cropPx: { x: 1620, y: 960, width: 540, height: 960 },
                transform: [2, 0, -3240, 0, 2, -1920, 0, 0, 1],
              }
            : layer,
        ),
      },
    });
    expect(checkPlanInvariants(result.plan)).toEqual([]);

    const reset = setTemplateClipReframe(reframed, canvas, defaultTemplateReframe);
    expect(createTemplateSource(beforeAfter, { ...clips, before: reset })).toBe(initialSource);
    const storedDefault = { ...before, reframe: { zoom: 1, x: 0.5, y: 1 } };
    expect(createTemplateSource(beforeAfter, { ...clips, before: storedDefault })).toBe(initialSource);
    const invalidReframe = { ...before, reframe: { zoom: 2, x: NaN, y: 1 } };
    expect(() => createTemplateSource(beforeAfter, { ...clips, before: invalidReframe })).toThrow(RangeError);
  });
});

describe("template clip reframing", () => {
  const canvas = videoSize;
  const portrait = fillSlots(beforeAfter)["before"]!;
  const landscape = { ...portrait, width: 1920, height: 1080 };

  it("starts with centered cover for matching and mismatched aspect ratios", () => {
    expect(getTemplateCrop(portrait, canvas)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(getTemplateCrop(landscape, canvas)).toEqual({ x: 0.341796875, y: 0, width: 0.31640625, height: 1 });
    const tallPortrait = { ...portrait, width: 720 };
    expect(getTemplateCrop(tallPortrait, canvas)).toEqual({
      x: 0,
      y: expect.closeTo(1 / 6, 12),
      width: 1,
      height: 2 / 3,
    });
  });

  it("uses the available travel at both edges when panning without zoom", () => {
    expect(getTemplateCrop(landscape, canvas, { zoom: 1, x: 0, y: 1 })).toEqual({
      x: 0,
      y: 0,
      width: 0.31640625,
      height: 1,
    });
    expect(getTemplateCrop(landscape, canvas, { zoom: 1, x: 1, y: 0 })).toEqual({
      x: 0.68359375,
      y: 0,
      width: 0.31640625,
      height: 1,
    });
  });

  it("supports both pan axes at the maximum zoom", () => {
    const zoom = maxTemplateReframeZoom;
    expect(zoom).toBe(3);
    const topLeft = getTemplateCrop(portrait, canvas, { zoom, x: 0, y: 0 });
    const bottomRight = getTemplateCrop(portrait, canvas, { zoom, x: 1, y: 1 });
    expect(topLeft).toEqual({ x: 0, y: 0, width: 1 / 3, height: 1 / 3 });
    expect(bottomRight.x + bottomRight.width).toBe(1);
    expect(bottomRight.y + bottomRight.height).toBe(1);
  });

  it("canonicalizes axes without travel and keeps the same clip for an effective no-op", () => {
    expect(setTemplateClipReframe(portrait, canvas, { zoom: 1, x: 0, y: 1 })).toBe(portrait);
    expect(setTemplateClipReframe(landscape, canvas, defaultTemplateReframe)).toBe(landscape);
    const moved = setTemplateClipReframe(landscape, canvas, { zoom: 1, x: 1, y: 0 });
    expect(moved).toEqual({ ...landscape, reframe: { zoom: 1, x: 1, y: 0.5 } });
    expect(setTemplateClipReframe(moved, canvas, { zoom: 1, x: 1, y: 1 })).toBe(moved);
    const reset = setTemplateClipReframe(moved, canvas, { zoom: 1, x: 0.5, y: 0 });
    expect(reset).toStrictEqual(landscape);
    expect(reset).not.toHaveProperty("reframe");
    expect(getTemplateCrop(reset, canvas)).toEqual(getTemplateCrop(landscape, canvas));
  });

  it("uses the saved reframe by default and accepts an explicit preview setting", () => {
    const reframed = setTemplateClipReframe(portrait, canvas, { zoom: 2, x: 1, y: 0.5 });
    expect(getTemplateCrop(reframed, canvas)).toEqual({ x: 0.5, y: 0.25, width: 0.5, height: 0.5 });
    expect(getTemplateCrop(reframed, canvas, defaultTemplateReframe)).toEqual(getTemplateCrop(portrait, canvas));
  });

  it.each([{ zoom: NaN }, { zoom: 0.99 }, { zoom: 3.01 }, { x: -0.01 }, { x: 1.01 }, { y: Infinity }])(
    "rejects invalid reframe settings %o",
    (invalid) => {
      const reframe = { ...defaultTemplateReframe, ...invalid };
      expect(() => getTemplateCrop(portrait, canvas, reframe)).toThrow(RangeError);
      expect(() => setTemplateClipReframe(portrait, canvas, reframe)).toThrow(RangeError);
    },
  );

  it.each([0, -1, Infinity, NaN])("rejects a source or canvas dimension of %s", (dimension) => {
    expect(() => getTemplateCrop({ ...portrait, width: dimension }, canvas)).toThrow(RangeError);
    expect(() => getTemplateCrop(portrait, { ...canvas, height: dimension })).toThrow(RangeError);
  });
});

describe("template clip boundaries", () => {
  const hookSlot = getVideoSlots(hookAndReveal)[0]!;
  const uri = "file:///hook.mov";
  const longVideo = { ...videoSize, startUs: 50_000, durationUs: 5_994_000 };

  it("retains the probe bounds and selects the earliest whole-frame window on import", () => {
    const clip = createTemplateClip(hookSlot, uri, "hook.mov", longVideo);
    expect(clip).toEqual({
      uri,
      name: "hook.mov",
      ...videoSize,
      sourceStartUs: 50_000,
      sourceEndUs: 6_044_000,
      trimInUs: 66_667,
      trimOutUs: 3_333_333,
    });
    expect(getTemplateTrimWindow(hookSlot, clip)).toEqual({
      firstFrame: 2,
      lastStartFrame: 83,
      sourceEndFrame: 181,
      startFrame: 2,
      durationFrames: 98,
    });
    expect(setTemplateClipTrim(hookSlot, clip, 2)).toBe(clip);
  });

  it("keeps the fixed frame length when moving to the last start and back", () => {
    const clip = createTemplateClip(hookSlot, uri, "hook.mov", longVideo);
    const latest = setTemplateClipTrim(hookSlot, clip, 83);
    expect(latest).toEqual({ ...clip, trimInUs: 2_766_667, trimOutUs: 6_033_333 });
    expect(getTemplateTrimWindow(hookSlot, latest)).toEqual({
      ...getTemplateTrimWindow(hookSlot, clip),
      startFrame: 83,
    });
    expect(setTemplateClipTrim(hookSlot, latest, 2)).toEqual(clip);
    expect(clip.trimInUs).toBe(66_667);
  });

  it.each([1, 84, 2.5, NaN, Infinity])("rejects an invalid trim start of %s", (startFrame) => {
    const clip = createTemplateClip(hookSlot, uri, "hook.mov", longVideo);
    expect(() => setTemplateClipTrim(hookSlot, clip, startFrame)).toThrow(RangeError);
  });

  it("keeps a negative track start from the probe and selects from frame zero", () => {
    const clip = createTemplateClip(hookSlot, uri, "hook.mov", {
      ...videoSize,
      startUs: -50_000,
      durationUs: 3_316_667,
    });
    expect(clip).toMatchObject({ sourceStartUs: -50_000, sourceEndUs: 3_266_667, trimInUs: 0, trimOutUs: 3_266_667 });
    expect(getTemplateTrimWindow(hookSlot, clip)).toEqual({
      firstFrame: 0,
      lastStartFrame: 0,
      sourceEndFrame: 98,
      startFrame: 0,
      durationFrames: 98,
    });
    expect(setTemplateClipTrim(hookSlot, clip, 0)).toBe(clip);
    expect(() => setTemplateClipTrim(hookSlot, clip, 1)).toThrow(RangeError);
  });

  it.each([
    { startUs: 0, durationUs: 3_266_666 },
    { startUs: 50_000, durationUs: 3_266_667 },
  ])("rejects footage without enough whole frames at track start $startUs", (timing) => {
    expect(() => createTemplateClip(hookSlot, uri, "hook.mov", { ...videoSize, ...timing })).toThrow("Your hook shot");
  });

  it("fills every frame at a nonzero track start without a native hold", () => {
    const clip = createTemplateClip(hookSlot, uri, "hook.mov", {
      ...videoSize,
      startUs: 50_000,
      durationUs: 3_283_333,
    });
    const { plan } = parseSource(createTemplateSource(hookAndReveal, { ...fillSlots(hookAndReveal), clip1: clip }));
    const source = {
      assetUri: "slot:clip1",
      sourceStartUs: 66_667,
      sourceEndUs: 3_333_333,
      rate: 3_266_666 / 3_266_667,
      fitMode: "trim",
      afterEnd: "hold",
    };
    expect(plan.layers[0]).toMatchObject({ id: "main/0", startUs: 0, endUs: 3_266_667, source });
    expect(plan.audio[0]).toMatchObject({ id: "main/0", startUs: 0, endUs: 3_266_667, source });
    expect(plan.warnings).toEqual([]);
    expect(checkPlanInvariants(plan)).toEqual([]);
  });

  it("resolves the stored trim for matching video and audio while preserving the rest of the edit", () => {
    const clip = createTemplateClip(hookSlot, uri, "hook.mov", longVideo);
    const clips = { ...fillSlots(hookAndReveal), clip1: clip };
    const previous = parseSource(createTemplateSource(hookAndReveal, clips));
    const latest = setTemplateClipTrim(hookSlot, clip, 83);
    const { plan, assets } = parseSource(createTemplateSource(hookAndReveal, { ...clips, clip1: latest }));
    const source = {
      assetUri: "slot:clip1",
      sourceStartUs: 2_766_667,
      sourceEndUs: 6_033_333,
      rate: 3_266_666 / 3_266_667,
      fitMode: "trim",
      afterEnd: "hold",
    };
    expect(assets).toEqual(previous.assets);
    expect(plan).toEqual({
      ...previous.plan,
      layers: previous.plan.layers.map((layer) => (layer.id === "main/0" ? { ...layer, source } : layer)),
      audio: previous.plan.audio.map((entry) => (entry.id === "main/0" ? { ...entry, source } : entry)),
    });
    expect(checkPlanInvariants(plan)).toEqual([]);
  });

  it("uses the full selected window when playback speed magnifies microsecond rounding", () => {
    const template: MobileTemplate = {
      ...hookAndReveal,
      durationUs: 100_000,
      slots: [{ kind: "video", id: "clip", label: "Clip", shortClipPolicy: "slow", minSpeed: 4 }],
      tracks: [
        {
          type: "video",
          id: "main",
          items: [{ slot: "clip", startUs: 33_333, durationUs: 33_334, speed: 4 }],
        },
      ],
    };
    const [slot] = getVideoSlots(template);
    const clip = createTemplateClip(slot!, uri, "hook.mov", longVideo);
    const { plan } = parseSource(createTemplateSource(template, { clip }));
    const edit = {
      startUs: 33_333,
      endUs: 66_667,
      source: { sourceStartUs: 66_667, sourceEndUs: 200_000, rate: 133_333 / 33_334, fitMode: "trim" },
    };
    expect(plan.layers[0]).toMatchObject(edit);
    expect(plan.audio[0]).toMatchObject(edit);
    expect(plan.warnings).toEqual([]);
    expect(checkPlanInvariants(plan)).toEqual([]);
  });

  it("rejects invalid metadata and rechecks trims before creating a native payload", () => {
    expect(() =>
      createTemplateClip(hookSlot, uri, "hook.mov", { height: 0, width: 1080, startUs: 0, durationUs: 5_000_000 }),
    ).toThrow("invalid dimensions or timing");
    const clips = fillSlots(hookAndReveal);
    const clip1 = { ...clips["clip1"]!, trimOutUs: 3_000_000 };
    expect(() => createTemplateSource(hookAndReveal, { ...clips, clip1 })).toThrow("Your hook shot");
  });

  it.each([
    { trimInUs: 0, trimOutUs: 3_266_667 },
    { trimInUs: 2_800_000, trimOutUs: 6_066_667 },
    { trimInUs: 66_667, trimOutUs: 3_333_334 },
    { trimInUs: 66_667, trimOutUs: 3_366_667 },
  ])("rejects a stored trim outside the playable range or fixed frame window (%o)", (trim) => {
    const clip1 = { ...createTemplateClip(hookSlot, uri, "hook.mov", longVideo), ...trim };
    expect(() => createTemplateSource(hookAndReveal, { ...fillSlots(hookAndReveal), clip1 })).toThrow(
      "invalid dimensions or timing",
    );
  });
});
