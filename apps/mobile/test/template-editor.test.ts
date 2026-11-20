import { checkPlanInvariants } from "@stackreel/core";
import type { RenderPlan } from "@stackreel/core";
import { validate } from "@stackreel/template-schema";
import { describe, expect, it } from "vitest";
import { createTemplateClip, createTemplateSource, getVideoSlots, mobileTemplates } from "../src/template-editor";
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
});

describe("template clip boundaries", () => {
  const hookSlot = getVideoSlots(hookAndReveal)[0]!;
  const uri = "file:///hook.mov";

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

  it("rejects invalid metadata and rechecks trims before creating a native payload", () => {
    expect(() =>
      createTemplateClip(hookSlot, uri, "hook.mov", { height: 0, width: 1080, startUs: 0, durationUs: 5_000_000 }),
    ).toThrow("invalid dimensions or timing");
    const clips = fillSlots(hookAndReveal);
    const clip1 = { ...clips["clip1"]!, trimOutUs: 3_000_000 };
    expect(() => createTemplateSource(hookAndReveal, { ...clips, clip1 })).toThrow("Your hook shot");
  });
});
