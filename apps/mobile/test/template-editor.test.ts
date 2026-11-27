import { checkPlanInvariants } from "@stackreel/core";
import type { RenderPlan } from "@stackreel/core";
import { validate } from "@stackreel/template-schema";
import { describe, expect, it } from "vitest";
import {
  applyTemplateTextEdits,
  createTemplateClip,
  createTemplateMusic,
  createTemplateSource,
  defaultTemplateReframe,
  getTemplateCrop,
  getTemplateGainDb,
  getTemplateTextFields,
  getTemplateTrimWindow,
  getVideoSlots,
  maxTemplateReframeZoom,
  mobileTemplates,
  setTemplateClipReframe,
  setTemplateClipTrim,
  setTemplateClipVolume,
  setTemplateMusicVolume,
  setTemplateText,
  swapTemplateClips,
} from "../src/template-editor";
import type { MobileTemplate, TemplateClip, TemplateTextOverrides } from "../src/template-editor";

const beforeAfter = mobileTemplates[0]!;
const hookAndReveal = mobileTemplates[1]!;
const countdown = mobileTemplates[2]!;
const videoSize = { width: 1080, height: 1920 };

function fillSlots(template: MobileTemplate): Record<string, TemplateClip> {
  return Object.fromEntries(
    getVideoSlots(template).map((slot) => [
      slot.id,
      createTemplateClip(slot, "file:///" + slot.id + "/sample%20clip.mov", "sample clip.mov", {
        ...videoSize,
        startUs: 0,
        durationUs: slot.trimDurationUs,
      }),
    ]),
  );
}

function parseSource(source: string | null): { plan: RenderPlan; assets: Record<string, string> } {
  if (source === null) throw new Error("Expected a complete template");
  return JSON.parse(source);
}

describe("mobile template catalog", () => {
  it("exposes the validated templates and includes transition tails in the full trim windows", () => {
    expect(mobileTemplates.map(({ id, name, durationUs }) => ({ id, name, durationUs }))).toEqual([
      { id: "before-after", name: "Before / After", durationUs: 8_000_000 },
      { id: "hook-and-reveal", name: "Hook & Reveal", durationUs: 9_000_000 },
      { id: "top-5-countdown", name: "Top 5 Countdown", durationUs: 25_000_000 },
    ]);
    expect(mobileTemplates.every((template) => validate(template).ok)).toBe(true);
    expect(getVideoSlots(beforeAfter)).toEqual([
      { id: "before", label: "Before", minDurationUs: 3_500_000, trimDurationUs: 3_800_000 },
      { id: "after", label: "After", minDurationUs: 4_500_000, trimDurationUs: 4_500_000 },
    ]);
    expect(getVideoSlots(hookAndReveal)).toEqual([
      { id: "clip1", label: "Your hook shot", minDurationUs: 3_000_000, trimDurationUs: 3_266_667 },
      { id: "clip2", label: "B-roll", minDurationUs: 2_000_000, trimDurationUs: 2_200_000 },
      { id: "clip3", label: "The reveal", minDurationUs: 4_000_000, trimDurationUs: 4_000_000 },
    ]);
    expect(getVideoSlots(countdown)).toEqual([
      { id: "item5", label: "Number 5", minDurationUs: 4_000_000, trimDurationUs: 5_300_000 },
      { id: "item4", label: "Number 4", minDurationUs: 4_000_000, trimDurationUs: 4_800_000 },
      { id: "item3", label: "Number 3", minDurationUs: 4_000_000, trimDurationUs: 4_800_000 },
      { id: "item2", label: "Number 2", minDurationUs: 4_000_000, trimDurationUs: 4_766_667 },
      { id: "item1", label: "Number 1", minDurationUs: 4_000_000, trimDurationUs: 6_500_000 },
    ]);
  });
});

describe("template clip swapping", () => {
  it("resizes windows on the source frame grid and backs up only the clip that would overrun", () => {
    const [beforeSlot, afterSlot] = getVideoSlots(beforeAfter);
    const landscape = createTemplateClip(beforeSlot!, "file:///first.mov", "first.mov", {
      width: 1920,
      height: 1080,
      startUs: 33_334,
      durationUs: 5_333_334,
    });
    const portrait = createTemplateClip(afterSlot!, "file:///second.mov", "second.mov", {
      ...videoSize,
      startUs: 0,
      durationUs: 7_000_000,
    });
    const before = setTemplateClipReframe(setTemplateClipTrim(beforeSlot!, landscape, 37), beforeAfter.canvas, {
      zoom: 2,
      x: 0.7,
      y: 0.25,
    });
    const after = setTemplateClipVolume(setTemplateClipTrim(afterSlot!, portrait, 31), 25);
    const swapped = swapTemplateClips({ before, after }, beforeSlot!, afterSlot!);

    expect(swapped).toEqual({
      before: { ...after, trimInUs: after.trimInUs, trimOutUs: 4_833_333 },
      after: { ...before, trimInUs: 866_667, trimOutUs: 5_366_667 },
    });
    expect(getTemplateTrimWindow(beforeSlot!, swapped.before!)).toMatchObject({ startFrame: 31, durationFrames: 114 });
    expect(getTemplateTrimWindow(afterSlot!, swapped.after!)).toMatchObject({
      startFrame: 26,
      lastStartFrame: 26,
      durationFrames: 135,
    });

    const { assets, plan } = parseSource(createTemplateSource(beforeAfter, swapped));
    expect(assets).toEqual({ "slot:before": after.uri, "slot:after": before.uri });
    expect(checkPlanInvariants(plan)).toEqual([]);
  });

  it.each([
    [0, 1],
    [0, 2],
    [1, 2],
  ])(
    "swaps Hook & Reveal slots %i and %i while preserving both starts and the third clip",
    (firstIndex, secondIndex) => {
      const slots = getVideoSlots(hookAndReveal);
      const first = slots[firstIndex]!;
      const second = slots[secondIndex]!;
      const third = slots.find((slot) => slot !== first && slot !== second)!;
      const clips = Object.fromEntries(
        slots.map((slot, index) => {
          const clip = createTemplateClip(slot, `file:///${slot.id}.mov`, `${slot.id}.mov`, {
            ...videoSize,
            startUs: 50_000,
            durationUs: 7_000_000,
          });
          return [slot.id, setTemplateClipTrim(slot, clip, 31 + index)];
        }),
      );

      const swapped = swapTemplateClips(clips, first, second);
      expect(swapped[third.id]).toBe(clips[third.id]);
      expect(swapped[first.id]).toMatchObject({ uri: clips[second.id]!.uri, trimInUs: clips[second.id]!.trimInUs });
      expect(swapped[second.id]).toMatchObject({ uri: clips[first.id]!.uri, trimInUs: clips[first.id]!.trimInUs });
      expect(checkPlanInvariants(parseSource(createTemplateSource(hookAndReveal, swapped)).plan)).toEqual([]);
    },
  );

  it.each([
    { startUs: 0, durationUs: 3_800_000 },
    { startUs: 33_334, durationUs: 4_500_000 },
  ])("rejects an incompatible swap in either order without changing the clips (%o)", (timing) => {
    const [beforeSlot, afterSlot] = getVideoSlots(beforeAfter);
    const before = createTemplateClip(beforeSlot!, "file:///short.mov", "short.mov", { ...videoSize, ...timing });
    const after = fillSlots(beforeAfter).after!;
    const clips = Object.freeze({ before: Object.freeze(before), after: Object.freeze(after) });
    const original = createTemplateSource(beforeAfter, clips);

    expect(() => swapTemplateClips(clips, beforeSlot!, afterSlot!)).toThrow('"After" needs at least 4.50 seconds');
    expect(() => swapTemplateClips(clips, afterSlot!, beforeSlot!)).toThrow('"After" needs at least 4.50 seconds');
    expect(clips).toEqual({ before, after });
    expect(createTemplateSource(beforeAfter, clips)).toBe(original);
  });
});

describe("template clip volume", () => {
  it("retains identity on no-ops, resets to the original clip settings, and leaves replacements at full volume", () => {
    const slot = getVideoSlots(beforeAfter)[0]!;
    const original = fillSlots(beforeAfter)[slot.id]!;
    expect(setTemplateClipVolume(original, 100)).toBe(original);
    const quiet = setTemplateClipVolume(original, 37.5);
    expect(quiet).toEqual({ ...original, volumePercent: 37.5 });
    expect(setTemplateClipVolume(quiet, 37.5)).toBe(quiet);
    expect(setTemplateClipVolume(quiet, 100)).toStrictEqual(original);
    const replacement = createTemplateClip(slot, quiet.uri, quiet.name, {
      ...videoSize,
      startUs: 0,
      durationUs: slot.minDurationUs,
    });
    expect(replacement.volumePercent).toBeUndefined();
  });

  it.each([-1, 101, NaN, Infinity])("rejects invalid volume %s", (percent) => {
    expect(() => setTemplateClipVolume(fillSlots(beforeAfter).before!, percent)).toThrow(RangeError);
    expect(() => getTemplateGainDb(percent)).toThrow(RangeError);
  });

  it("scales each use of a slot from its own authored gain, retaining the native mute floor", () => {
    const template: MobileTemplate = {
      ...hookAndReveal,
      tracks: hookAndReveal.tracks.map((track) =>
        track.type !== "video"
          ? track
          : {
              ...track,
              items: track.items.map((item, index) =>
                index === 0
                  ? item
                  : {
                      ...item,
                      slot: "clip2",
                      gainDb: index === 1 ? 4 : -60,
                      fadeInUs: 200_000,
                      voice: true,
                    },
              ),
            },
      ),
    };
    const clips = fillSlots(template);
    const music = createTemplateMusic("file:///music.m4a", "Music", { startUs: 0, durationUs: template.durationUs });
    const render = (clip: TemplateClip) => createTemplateSource(template, { ...clips, clip2: clip }, {}, music);
    const clip = clips.clip2!;
    const source = render(clip);
    expect(render({ ...clip, volumePercent: 100 })).toBe(source);
    const original = parseSource(source);
    expect(original.plan.audio.find((entry) => entry.id === "main/1")).toMatchObject({ gainDb: 4 });
    expect(original.plan.audio.find((entry) => entry.kind === "music")?.ducking?.regions).toEqual([
      { startUs: 3_000_000, endUs: 5_200_000 },
    ]);

    const quiet = setTemplateClipVolume(clip, 50);
    const gain = getTemplateGainDb(50, 4);
    expect(gain).toBeCloseTo(-2.0206, 4);
    expect(getTemplateGainDb(1, -50)).toBe(-60);
    // The third item uses the same slot with an authored mute.
    const expected = parseSource(source);
    const video = expected.plan.layers.find((layer) => layer.id === "main/1");
    if (video?.kind !== "video") throw new Error("Missing second video");
    video.gainDb = gain;
    expected.plan.audio.find((entry) => entry.id === video.id)!.gainDb = gain;
    expect(parseSource(render(quiet))).toEqual(expected);

    const muted = parseSource(render(setTemplateClipVolume(quiet, 0)));
    expect(muted.plan.audio.find((entry) => entry.id === video.id)).toMatchObject({ gainDb: -60, fadeInUs: 200_000 });
    expect(muted.plan.layers.find((layer) => layer.id === video.id)).toMatchObject({ gainDb: -60 });
    expect(muted.plan.audio.find((entry) => entry.kind === "music")?.ducking?.regions).toEqual([]);
    expect(render(setTemplateClipVolume(quiet, 100))).toBe(source);
  });

  it("keeps music ducked under the audible neighbors of a muted clip, including the transition tail", () => {
    const clips = fillSlots(hookAndReveal);
    const music = createTemplateMusic("file:///music.m4a", "Music", { startUs: 0, durationUs: 9_000_000 });
    const muted = { ...clips, clip2: setTemplateClipVolume(clips.clip2!, 0) };
    const { plan } = parseSource(createTemplateSource(hookAndReveal, muted, {}, music));
    expect(plan.audio.find((entry) => entry.kind === "music")?.ducking?.regions).toEqual([
      { startUs: 0, endUs: 3_266_667 },
      { startUs: 5_000_000, endUs: 9_000_000 },
    ]);
  });
});

describe("template text editing", () => {
  it("exposes the bundled field labels, defaults, and limits at the mobile item keys", () => {
    expect(getTemplateTextFields(beforeAfter)).toEqual([
      { id: "labels/0", label: "Before label", defaultText: "BEFORE", maxChars: 12 },
      { id: "labels/1", label: "After label", defaultText: "AFTER", maxChars: 12 },
      { id: "labels/2", label: "Caption", defaultText: "3 months of consistency", maxChars: 40 },
    ]);
    expect(getTemplateTextFields(hookAndReveal)).toEqual([
      { id: "text/0", label: "Hook text", defaultText: "Wait for it…", maxChars: 40 },
    ]);
    expect(getTemplateTextFields(countdown)).toEqual([
      { id: "names/0", label: "List title", defaultText: "Top 5 places in Portugal", maxChars: 36 },
      { id: "names/1", label: "Name of number 5", defaultText: "Sintra", maxChars: 24 },
      { id: "names/2", label: "Name of number 4", defaultText: "Porto", maxChars: 24 },
      { id: "names/3", label: "Name of number 3", defaultText: "Lagos", maxChars: 24 },
      { id: "names/4", label: "Name of number 2", defaultText: "Évora", maxChars: 24 },
      { id: "names/5", label: "Name of number 1", defaultText: "Madeira", maxChars: 24 },
    ]);
  });

  it.each(mobileTemplates)("changes only the text of each targeted item in $name", (template) => {
    const clips = fillSlots(template);
    const initial = parseSource(createTemplateSource(template, clips));
    for (const field of getTemplateTextFields(template)) {
      const text = "  New 💡  ";
      const overrides = setTemplateText(field, {}, text);
      const changed = parseSource(createTemplateSource(template, clips, overrides));
      expect(changed).toEqual({
        ...initial,
        plan: {
          ...initial.plan,
          layers: initial.plan.layers.map((layer) => (layer.id === field.id ? { ...layer, text } : layer)),
        },
      });
      expect(checkPlanInvariants(changed.plan)).toEqual([]);
    }
  });

  it("preserves override identity for no-ops and removes only the field restored to its default", () => {
    const [before, after] = getTemplateTextFields(beforeAfter);
    const initial = {};
    expect(setTemplateText(before!, initial, "BEFORE")).toBe(initial);
    const edited = setTemplateText(before!, initial, "Week 1");
    expect(setTemplateText(before!, edited, "Week 1")).toBe(edited);
    const both = setTemplateText(after!, edited, "Week 12");
    const reset = setTemplateText(before!, both, "BEFORE");
    expect(reset).toEqual({ "labels/1": "Week 12" });
    expect(both).toEqual({ "labels/0": "Week 1", "labels/1": "Week 12" });
    expect(initial).toEqual({});

    const clips = fillSlots(beforeAfter);
    expect(createTemplateSource(beforeAfter, clips, setTemplateText(after!, reset, "AFTER"))).toBe(
      createTemplateSource(beforeAfter, clips),
    );
  });

  it("keeps a saved label matching the new default when editing another label and clears it on Reset", () => {
    const fields = getTemplateTextFields(beforeAfter);
    const [before, after] = fields;
    const saved = { [before!.id]: before!.defaultText };
    const values = { ...saved, [after!.id]: "Week 12" };
    expect(applyTemplateTextEdits(fields, saved, saved)).toBe(saved);
    expect(applyTemplateTextEdits(fields, saved, values)).toEqual(values);
    expect(applyTemplateTextEdits(fields, values, {})).toEqual({});
  });

  it("stores and renders blank edits as empty and keeps the same override for another blank edit", () => {
    const [field] = getTemplateTextFields(beforeAfter);
    const whitespace = " \n\t ";
    const overrides = setTemplateText(field!, {}, whitespace);
    expect(overrides).toEqual({ "labels/0": "" });
    expect(setTemplateText(field!, overrides, "")).toBe(overrides);
    expect(setTemplateText(field!, overrides, whitespace)).toBe(overrides);
    expect(() => setTemplateText(field!, overrides, " ".repeat(13))).toThrow(RangeError);

    const clips = fillSlots(beforeAfter);
    const source = createTemplateSource(beforeAfter, clips, overrides);
    expect(createTemplateSource(beforeAfter, clips, { "labels/0": whitespace })).toBe(source);
    const { plan } = parseSource(source);
    expect(plan.layers.find((layer) => layer.id === "labels/0")).toMatchObject({ kind: "text", text: "" });
    expect(checkPlanInvariants(plan)).toEqual([]);
  });

  it("counts Unicode code points and rejects oversized edits and raw overrides", () => {
    const [field] = getTemplateTextFields(beforeAfter);
    const text = "💡".repeat(12);
    expect(setTemplateText(field!, {}, text)).toEqual({ "labels/0": text });
    const clips = fillSlots(beforeAfter);
    const { plan } = parseSource(createTemplateSource(beforeAfter, clips, { "labels/0": text }));
    expect(plan.layers.find((layer) => layer.id === "labels/0")).toMatchObject({ text });
    const oversized = text + "!";
    expect(() => setTemplateText(field!, {}, oversized)).toThrow(RangeError);
    expect(() => createTemplateSource(beforeAfter, clips, { "labels/0": oversized })).toThrow(RangeError);
  });

  it("uses the narrower item or slot limit and only exposes editable items", () => {
    const template: MobileTemplate = {
      ...beforeAfter,
      slots: [...beforeAfter.slots, { id: "short-text", kind: "text", label: "Short text", maxChars: 4 }],
      tracks: [
        ...beforeAfter.tracks,
        {
          id: "additional-text",
          type: "overlay",
          items: [
            { kind: "text", startUs: 0, durationUs: 100_000, slot: "short-text", text: { default: "Old" } },
            {
              kind: "text",
              startUs: 100_000,
              durationUs: 100_000,
              slot: "short-text",
              text: { default: "Old", editable: true, maxChars: 8 },
            },
            {
              kind: "text",
              startUs: 200_000,
              durationUs: 100_000,
              slot: "short-text",
              text: { default: "Old", editable: true, maxChars: 3 },
            },
          ],
        },
      ],
    };
    expect(getTemplateTextFields(template).slice(3)).toEqual([
      { id: "additional-text/1", label: "Short text", defaultText: "Old", maxChars: 4 },
      { id: "additional-text/2", label: "Short text", defaultText: "Old", maxChars: 3 },
    ]);
    const clips = fillSlots(template);
    expect(() => createTemplateSource(template, clips, { "additional-text/0": "New" })).toThrow("editable text field");
    expect(() => createTemplateSource(template, clips, { "additional-text/1": "12345" })).toThrow(RangeError);
    expect(() => createTemplateSource(template, clips, { "additional-text/2": "1234" })).toThrow(RangeError);
  });

  it.each(["caption", "main/0", "labels/3"])("rejects raw overrides for unsupported key %s", (id) => {
    expect(() => createTemplateSource(beforeAfter, fillSlots(beforeAfter), { [id]: "New text" })).toThrow(
      `No editable text field at "${id}".`,
    );
  });

  it("rejects a non-string raw override", () => {
    const overrides = JSON.parse('{"labels/0":null}') as TemplateTextOverrides;
    expect(() => createTemplateSource(beforeAfter, fillSlots(beforeAfter), overrides)).toThrow(TypeError);
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

  it("resolves the five ranked clips, fixed numbers and four leftward slides for Top 5 Countdown", () => {
    const { plan, assets } = parseSource(createTemplateSource(countdown, fillSlots(countdown)));
    expect(plan).toMatchObject({ templateId: "top-5-countdown", durationUs: 25_000_000, warnings: [] });
    const ranks = ["5", "4", "3", "2", "1"];
    const videos = plan.layers.filter((layer) => layer.kind === "video");
    expect(videos.map(({ source }) => assets[source.assetUri])).toEqual(
      ranks.map((rank) => `file:///item${rank}/sample%20clip.mov`),
    );
    expect(
      plan.layers.flatMap((layer) => (layer.kind === "text" && layer.trackId === "numbers" ? [layer.text] : [])),
    ).toEqual(ranks);
    const overlaps = [
      [5_000_000, 5_300_000],
      [9_500_000, 9_800_000],
      [14_000_000, 14_300_000],
      [18_500_000, 18_766_667],
    ];
    expect(plan.transitions).toMatchObject(
      overlaps.map(([startUs, endUs], i) => ({
        type: "slide",
        direction: "left",
        startUs,
        endUs,
        fromLayerId: videos[i]!.id,
        toLayerId: videos[i + 1]!.id,
      })),
    );
    expect(checkPlanInvariants(plan)).toEqual([]);
  });

  it("wraps long countdown names within the frame and below the rank numerals", () => {
    const longName = "GRAND CANYON OVERLOOK";
    const overrides = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`names/${i}`, longName]));
    const { plan } = parseSource(createTemplateSource(countdown, fillSlots(countdown), overrides));
    const names = plan.layers.filter((layer) => layer.kind === "text").filter((layer) => layer.text === longName);
    expect(names).toHaveLength(5);
    for (const { style, placement } of names) {
      // At 76 px the bundled Inter ExtraBold measures this name at 1,079 px on one line.
      // The 280 px Inter Black rank centered at y=960 extends to y=1,135 including its stroke.
      const padding = style.background?.paddingPx ?? 0;
      const wrapWidth = plan.canvas.width - 2 * padding;
      const right = placement.xPx - padding;
      const stroke = style.stroke?.widthPx ?? 0;
      expect(placement.anchor).toBe("top-right");
      expect(wrapWidth).toBeLessThan(1_079);
      expect(right - wrapWidth - stroke).toBeGreaterThan(0);
      expect(right + stroke).toBeLessThan(plan.canvas.width);
      expect(placement.yPx + padding - stroke).toBeGreaterThan(1_135);
    }
  });

  it.each(mobileTemplates)(
    "accepts each authored minimum and keeps picture and sound at normal speed in $name",
    (template) => {
      const slots = getVideoSlots(template);
      const clips = Object.fromEntries(
        slots.map((slot) => {
          const clip = createTemplateClip(slot, "file:///" + slot.id + ".mov", slot.label, {
            ...videoSize,
            startUs: 0,
            durationUs: slot.minDurationUs,
          });
          expect(getTemplateTrimWindow(slot, clip)).toMatchObject({ firstFrame: 0, lastStartFrame: 0 });
          return [slot.id, clip];
        }),
      );
      const { plan } = parseSource(createTemplateSource(template, clips));
      expect(checkPlanInvariants(plan)).toEqual([]);
      for (const slot of slots) {
        const video = plan.layers.find((layer) => layer.kind === "video" && layer.slotId === slot.id)!;
        const source = {
          sourceStartUs: 0,
          sourceEndUs: slot.minDurationUs,
          rate: 1,
          fitMode: slot.minDurationUs < slot.trimDurationUs ? "freeze" : "trim",
          afterEnd: "hold",
        };
        expect(video).toMatchObject({ source });
        expect(plan.audio.find((entry) => entry.id === video.id)).toMatchObject({ source });
      }
    },
  );

  it.each(mobileTemplates)("uses the full video and audio edit at the full trim lengths for $name", (template) => {
    const { plan } = parseSource(createTemplateSource(template, fillSlots(template)));
    const video = plan.layers.filter((layer) => layer.kind === "video");
    const slots = getVideoSlots(template);
    expect(video.map(({ source: { sourceEndUs } }) => sourceEndUs)).toEqual(slots.map((slot) => slot.trimDurationUs));
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

describe("template music", () => {
  const uri = "file:///Music/Backing%20Track.m4a";
  const name = "Backing Track.m4a";

  it("changes only the music gain while keeping clip levels, looping, fades and ducking", () => {
    const music = createTemplateMusic(uri, name, { startUs: 50_000, durationUs: 2_000_000 });
    const clips = fillSlots(hookAndReveal);
    clips.clip1 = setTemplateClipVolume(clips.clip1!, 50);
    const render = (track: typeof music) => createTemplateSource(hookAndReveal, clips, {}, track);
    const originalSource = render(music);
    expect(setTemplateMusicVolume(music, 100)).toBe(music);
    expect(render({ ...music, volumePercent: 100 })).toBe(originalSource);

    const quiet = setTemplateMusicVolume(music, 50);
    expect(setTemplateMusicVolume(quiet, 50)).toBe(quiet);
    const expected = parseSource(originalSource);
    const entry = expected.plan.audio.find((entry) => entry.kind === "music")!;
    expect(entry).toMatchObject({ gainDb: -6, source: { fitMode: "loop" }, fadeOutUs: 500_000, ducking: {} });
    entry.gainDb += 20 * Math.log10(0.5);
    expect(parseSource(render(quiet))).toEqual(expected);
    entry.gainDb = -60;
    expect(parseSource(render(setTemplateMusicVolume(quiet, 0)))).toEqual(expected);
    expect(render(setTemplateMusicVolume(quiet, 100))).toBe(originalSource);
  });

  it.each([-1, 101, NaN, Infinity])("rejects invalid music volume %s before the video slots are filled", (percent) => {
    const music = createTemplateMusic(uri, name, { startUs: 0, durationUs: 2_000_000 });
    expect(() => setTemplateMusicVolume(music, percent)).toThrow(RangeError);
    expect(() => createTemplateSource(beforeAfter, {}, {}, { ...music, volumePercent: percent })).toThrow(RangeError);
  });

  it.each(mobileTemplates)("keeps the music slot optional in $name", (template) => {
    expect(template.audio?.music?.slot).toBe("music");
    const clips = fillSlots(template);
    const source = createTemplateSource(template, clips);
    expect(createTemplateSource(template, clips, undefined, null)).toBe(source);
    const { plan, assets } = parseSource(source);
    expect(plan.audio.every((entry) => entry.kind === "video")).toBe(true);
    expect(assets).not.toHaveProperty("slot:music");
    const music = createTemplateMusic(uri, name, { startUs: 0, durationUs: 1_000_000 });
    expect(createTemplateSource(template, {}, undefined, music)).toBeNull();
  });

  it.each([
    { template: beforeAfter, gainDb: -5, ducking: undefined },
    {
      template: hookAndReveal,
      gainDb: -6,
      ducking: { gainDb: -12, rampUs: 200_000, regions: [{ startUs: 0, endUs: 9_000_000 }] },
    },
  ])("trims a long track and keeps the mix for $template.name", ({ template, gainDb, ducking }) => {
    const clips = fillSlots(template);
    const original = parseSource(createTemplateSource(template, clips));
    const music = createTemplateMusic(uri, name, { startUs: 50_000, durationUs: template.durationUs + 1_000_000 });
    const { plan, assets } = parseSource(createTemplateSource(template, clips, undefined, music));
    const musicEntry = plan.audio.find((entry) => entry.kind === "music");
    expect(musicEntry).toEqual({
      id: "music",
      kind: "music",
      slotId: "music",
      startUs: 0,
      endUs: template.durationUs,
      source: {
        assetUri: "slot:music",
        sourceStartUs: 66_667,
        sourceEndUs: 66_667 + template.durationUs,
        rate: 1,
        afterEnd: "hold",
        fitMode: "trim",
      },
      gainDb,
      fadeInUs: 0,
      fadeOutUs: 500_000,
      ...(ducking && { ducking }),
    });
    expect(assets).toEqual({ ...original.assets, "slot:music": uri });
    expect({ ...plan, audio: plan.audio.filter((entry) => entry.kind !== "music") }).toEqual(original.plan);
    expect(checkPlanInvariants(plan)).toEqual([]);
  });

  it.each(mobileTemplates)("loops only the whole frames of a short, offset track in $name", (template) => {
    const music = createTemplateMusic(uri, name, { startUs: 50_000, durationUs: 1_991_000 });
    expect(music).toEqual({ uri, name, sourceStartUs: 50_000, sourceEndUs: 2_041_000 });
    const { plan } = parseSource(createTemplateSource(template, fillSlots(template), undefined, music));
    expect(plan.audio.find((entry) => entry.kind === "music")).toMatchObject({
      startUs: 0,
      endUs: template.durationUs,
      source: {
        sourceStartUs: 66_667,
        sourceEndUs: 2_033_333,
        rate: 1,
        afterEnd: "loop",
        fitMode: "loop",
      },
    });
    expect(plan.warnings).toEqual([]);
    expect(checkPlanInvariants(plan)).toEqual([]);
  });

  it("resolves music placement and fades while preserving the trimmed and reframed video and its sound", () => {
    const template: MobileTemplate = {
      ...hookAndReveal,
      audio: { ...hookAndReveal.audio, music: { ...hookAndReveal.audio!.music!, startUs: 526_000, fadeInUs: 300_000 } },
    };
    const [slot] = getVideoSlots(template);
    const clip = createTemplateClip(slot!, "file:///landscape.mov", "landscape.mov", {
      width: 1920,
      height: 1080,
      startUs: 50_000,
      durationUs: 6_000_000,
    });
    const trimmed = setTemplateClipTrim(slot!, clip, 83);
    const reframed = setTemplateClipReframe(trimmed, template.canvas, { zoom: 2, x: 1, y: 0.5 });
    const clips = { ...fillSlots(template), [slot!.id]: reframed };
    const overrides = { "text/0": "New hook" };
    const original = parseSource(createTemplateSource(template, clips, overrides));
    const music = createTemplateMusic(uri, name, { startUs: 50_000, durationUs: 15_000_000 });
    const { plan } = parseSource(createTemplateSource(template, clips, overrides, music));
    expect(plan.audio.find((entry) => entry.kind === "music")).toMatchObject({
      startUs: 533_333,
      endUs: 9_000_000,
      fadeInUs: 300_000,
      fadeOutUs: 500_000,
      ducking: { regions: [{ startUs: 533_333, endUs: 9_000_000 }] },
      source: { sourceStartUs: 66_667, sourceEndUs: 8_533_333, rate: 1, fitMode: "trim" },
    });
    expect(original.plan.audio[0]?.source.rate).toBe(3_266_666 / 3_266_667);
    expect({ ...plan, audio: plan.audio.filter((entry) => entry.kind !== "music") }).toEqual(original.plan);
    expect(checkPlanInvariants(plan)).toEqual([]);
  });

  it("clips a negative track start at zero while keeping the original end", () => {
    const music = createTemplateMusic(uri, name, { startUs: -50_000, durationUs: 1_050_000 });
    expect(music).toEqual({ uri, name, sourceStartUs: 0, sourceEndUs: 1_000_000 });
    const { plan } = parseSource(createTemplateSource(beforeAfter, fillSlots(beforeAfter), undefined, music));
    expect(plan.audio.find((entry) => entry.kind === "music")?.source).toMatchObject({
      sourceStartUs: 0,
      sourceEndUs: 1_000_000,
      fitMode: "loop",
    });
  });

  it.each([
    { startUs: Infinity, durationUs: 100_000 },
    { startUs: 0.5, durationUs: 100_000 },
    { startUs: 0, durationUs: NaN },
    { startUs: 0, durationUs: 100_000.5 },
    { startUs: 0, durationUs: 0 },
    { startUs: 0, durationUs: -1 },
    { startUs: 99_000, durationUs: Number.MAX_SAFE_INTEGER },
    { startUs: -50_000, durationUs: 50_000 },
    { startUs: 50_000, durationUs: 33_333 },
  ])("rejects invalid or unplayable probe timing %o", (metadata) => {
    expect(() => createTemplateMusic(uri, name, metadata)).toThrow("invalid timing or no playable frames");
  });

  it("validates a stored selection before the videos are complete", () => {
    const music = createTemplateMusic(uri, name, { startUs: 50_000, durationUs: 1_000_000 });
    expect(() => createTemplateSource(beforeAfter, {}, undefined, { ...music, sourceEndUs: 83_333 })).toThrow(
      "invalid timing or no playable frames",
    );
    expect(() => createTemplateSource(beforeAfter, {}, undefined, { ...music, uri: "" })).toThrow(
      "invalid timing or no playable frames",
    );
  });

  it("reports a short audio item even when it uses the music slot", () => {
    const template: MobileTemplate = {
      ...beforeAfter,
      tracks: [
        ...beforeAfter.tracks,
        { id: "audio", type: "audio", items: [{ slot: "music", startUs: 0, durationUs: 2_000_000 }] },
      ],
    };
    const music = createTemplateMusic(uri, name, { startUs: 0, durationUs: 1_000_000 });
    expect(() => createTemplateSource(template, fillSlots(template), undefined, music)).toThrow(
      "shorter than its slot",
    );
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

  it("keeps a full 143-frame trim or holds the last available frame through the slide into Number 1", () => {
    const slot = getVideoSlots(countdown).find(({ id }) => id === "item2")!;
    const importClip = (durationUs: number) =>
      createTemplateClip(slot, uri, "runner-up.mov", { ...videoSize, startUs: 50_000, durationUs });
    // The leading half frame is unplayable. The last required frame ends at 4,833,333 µs.
    const short = importClip(4_783_332);
    const shortPlan = parseSource(createTemplateSource(countdown, { ...fillSlots(countdown), item2: short })).plan;
    const held = {
      startUs: 14_000_000,
      endUs: 18_766_667,
      source: { sourceStartUs: 66_667, sourceEndUs: 4_800_000, rate: 1, fitMode: "freeze", afterEnd: "hold" },
    };
    expect(shortPlan.layers.find((layer) => layer.id === "main/3")).toMatchObject(held);
    expect(shortPlan.audio.find((entry) => entry.id === "main/3")).toMatchObject(held);
    const item2 = importClip(4_783_333);
    const { plan } = parseSource(createTemplateSource(countdown, { ...fillSlots(countdown), item2 }));
    const edit = {
      startUs: 14_000_000,
      endUs: 18_766_667,
      source: { sourceStartUs: 66_667, sourceEndUs: 4_833_333, rate: 4_766_666 / 4_766_667, fitMode: "trim" },
    };
    expect(plan.layers.find((layer) => layer.id === "main/3")).toMatchObject(edit);
    expect(plan.audio.find((entry) => entry.id === "main/3")).toMatchObject(edit);
  });

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
    { startUs: 0, durationUs: 2_999_999 },
    { startUs: 50_000, durationUs: 3_000_000 },
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
    const clip1 = { ...clips["clip1"]!, trimOutUs: 2_966_667 };
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
