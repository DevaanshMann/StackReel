import type { RenderPlan } from "@stackreel/core";
import { describe, expect, it } from "vitest";
import { defaultClipReframe } from "../src/clip-reframe";
import { createClipSource, createTrimmedClipSource, getClipFrameRange } from "../src/clip-source";
import type { SingleClipFit } from "../src/clip-source";

const uri = "file:///video%20clip.mov";
const landscapeVideo = { width: 1920, height: 1080, startUs: 0, durationUs: 2_014_000 };

function parseSource(source: string): { plan: RenderPlan; assets: Record<string, string> } {
  return JSON.parse(source);
}

describe("createClipSource", () => {
  it("fits the entire clip in a vertical canvas and maps its video and audio to the same local file", () => {
    const { plan, assets } = parseSource(createClipSource(uri, landscapeVideo));
    expect(plan.renderPlanVersion).toBe(1);
    expect(plan.canvas).toEqual({ width: 720, height: 1280, fps: 30, background: "#000000" });
    expect(plan.durationUs).toBe(2_000_000);
    expect(plan.layers).toHaveLength(1);
    expect(plan.audio).toHaveLength(1);
    const [video] = plan.layers;
    const [audio] = plan.audio;
    expect(video).toMatchObject({
      kind: "video",
      fit: "contain",
      startUs: 0,
      endUs: plan.durationUs,
      transform: [0.375, 0, 0, 0, 0.375, 437.5, 0, 0, 1],
    });
    expect(audio).toMatchObject({
      id: video?.id,
      kind: "video",
      startUs: 0,
      endUs: plan.durationUs,
      gainDb: 0,
      source: { assetUri: "clip", sourceStartUs: 0, sourceEndUs: plan.durationUs, rate: 1 },
    });
    expect(video).toMatchObject({ source: audio?.source });
    expect(assets).toEqual({ clip: uri });
  });

  it("uses a whole frame within a nonzero track start without adding a held tail", () => {
    const { plan } = parseSource(createClipSource(uri, { ...landscapeVideo, startUs: 20_000, durationUs: 55_000 }));
    expect(plan.durationUs).toBe(33_333);
    expect(plan.layers[0]).toMatchObject({
      source: { sourceStartUs: 33_333, sourceEndUs: 66_667, rate: 33_334 / 33_333, fitMode: "trim" },
    });
  });

  it("applies preview gain to the video and audio while preserving the default source", () => {
    const source = createClipSource(uri, landscapeVideo);
    expect(createClipSource(uri, landscapeVideo, undefined, undefined, 0)).toBe(source);
    for (const gainDb of [-60, -6.02, 4]) {
      const { plan } = parseSource(createClipSource(uri, landscapeVideo, undefined, undefined, gainDb));
      expect(plan.layers[0]).toMatchObject({ gainDb });
      expect(plan.audio[0]).toMatchObject({ gainDb });
    }
    expect(() => createClipSource(uri, landscapeVideo, undefined, undefined, NaN)).toThrow(RangeError);
  });

  it("can fill a preview canvas with the entire oriented source for the selected trim", () => {
    const orientedVideo = { width: 721, height: 1281, startUs: 66_667, durationUs: 1_000_000 };
    const previewCanvas = { width: 722, height: 1282, fps: 30, background: "#000000" };
    const { plan } = parseSource(createClipSource(uri, orientedVideo, previewCanvas, "fill"));
    const source = { sourceStartUs: 66_667, sourceEndUs: 1_066_667, rate: 1, fitMode: "trim" };
    expect(plan.canvas).toEqual(previewCanvas);
    expect(plan.durationUs).toBe(1_000_000);
    expect(plan.layers[0]).toMatchObject({
      fit: "fill",
      cropPx: { x: 0, y: 0, width: 721, height: 1281 },
      source,
      transform: [722 / 721, 0, 0, 0, 1282 / 1281, 0, 0, 0, 1],
    });
    expect(plan.audio[0]).toMatchObject({ source });
  });

  it("rejects inputs with no complete output frame or invalid metadata", () => {
    expect(() => createClipSource(uri, { ...landscapeVideo, startUs: 10_000, durationUs: 50_000 })).toThrow(
      "too short",
    );
    expect(() => createClipSource(uri, { ...landscapeVideo, height: 0 })).toThrow("invalid dimensions or timing");
  });
});

describe("single-clip trim", () => {
  it("defaults to Fit and center-crops landscape video with Fill without altering its trim or audio", () => {
    const selection = { startFrame: 2, endFrame: 4 };
    const fit = createTrimmedClipSource(uri, landscapeVideo, selection, "contain");
    expect(createTrimmedClipSource(uri, landscapeVideo, selection)).toBe(fit);
    const contained = parseSource(fit);
    const covered = parseSource(createTrimmedClipSource(uri, landscapeVideo, selection, "cover"));
    const scale = 1280 / landscapeVideo.height;
    const layer = {
      ...contained.plan.layers[0],
      fit: "cover",
      transform: [scale, 0, (720 - landscapeVideo.width * scale) / 2, 0, scale, 0, 0, 0, 1],
    };
    expect(covered).toEqual({ ...contained, plan: { ...contained.plan, layers: [layer] } });
  });

  it("retains the original Fit and centered Fill sources for equivalent crops", () => {
    const selection = getClipFrameRange(landscapeVideo);
    const source = (fit: SingleClipFit, reframe?: typeof defaultClipReframe) =>
      createTrimmedClipSource(uri, landscapeVideo, selection, fit, reframe);
    expect(source("contain", { zoom: 3, x: 1, y: 1 })).toBe(source("contain"));
    expect(source("cover", defaultClipReframe)).toBe(source("cover"));
    expect(source("cover", { zoom: 1, x: 0.5, y: 1 })).toBe(source("cover"));
  });

  it("changes only crop and transform for an off-center one-frame Fill edit", () => {
    const media = { width: 1440, height: 1280, startUs: 20_000, durationUs: 55_000 };
    const selection = getClipFrameRange(media);
    const original = parseSource(createTrimmedClipSource(uri, media, selection, "cover"));
    const reframed = parseSource(createTrimmedClipSource(uri, media, selection, "cover", { zoom: 2, x: 1, y: 1 }));
    expect(reframed).toEqual({
      ...original,
      plan: {
        ...original.plan,
        layers: [
          {
            ...original.plan.layers[0],
            cropPx: { x: 1080, y: 640, width: 360, height: 640 },
            transform: [2, 0, -2160, 0, 2, -1280, 0, 0, 1],
          },
        ],
      },
    });
    expect(reframed.plan.durationUs).toBe(33_333);
  });

  it("uses the same geometry for Fit and Fill with a 9:16 source", () => {
    const media = { ...landscapeVideo, width: 1080, height: 1920 };
    const selection = getClipFrameRange(media);
    const transform = [2 / 3, 0, 0, 0, 2 / 3, 0, 0, 0, 1];
    for (const fit of ["contain", "cover"] as const) {
      const { plan } = parseSource(createTrimmedClipSource(uri, media, selection, fit));
      expect(plan.layers[0]).toMatchObject({ fit, transform });
    }
  });

  it("rejects invalid framing, including stretch-to-fill", () => {
    const selection = getClipFrameRange(landscapeVideo);
    expect(() => createTrimmedClipSource(uri, landscapeVideo, selection, "fill" as SingleClipFit)).toThrow(RangeError);
  });

  it("keeps the full import and reset equivalent, including a track that starts before zero", () => {
    const media = { ...landscapeVideo, startUs: -40_000, durationUs: 149_000 };
    const bounds = getClipFrameRange(media);
    expect(bounds).toEqual({ startFrame: 0, endFrame: 3 });
    expect(createTrimmedClipSource(uri, media, bounds)).toBe(createClipSource(uri, media));
  });

  it("uses only complete frames from an offset track and accepts a one-frame selection", () => {
    const media = { ...landscapeVideo, startUs: 20_000, durationUs: 55_000 };
    const bounds = getClipFrameRange(media);
    expect(bounds).toEqual({ startFrame: 1, endFrame: 2 });
    const { plan } = parseSource(createTrimmedClipSource(uri, media, bounds));
    expect(plan.durationUs).toBe(33_333);
    expect(plan.audio[0]?.source).toMatchObject({
      sourceStartUs: 33_333,
      sourceEndUs: 66_667,
      rate: 33_334 / 33_333,
    });
    expect(plan.layers[0]).toMatchObject({ startUs: 0, endUs: plan.durationUs, source: plan.audio[0]?.source });
  });

  it("cuts both ends and rebases picture and sound to the same zero-based timeline", () => {
    const { plan, assets } = parseSource(createTrimmedClipSource(uri, landscapeVideo, { startFrame: 2, endFrame: 4 }));
    expect(assets).toEqual({ clip: uri });
    expect(plan.durationUs).toBe(66_667);
    const timing = {
      startUs: 0,
      endUs: plan.durationUs,
      source: { sourceStartUs: 66_667, sourceEndUs: 133_333, rate: 66_666 / 66_667 },
    };
    expect(plan.audio[0]).toMatchObject(timing);
    expect(plan.layers[0]).toMatchObject(timing);
  });

  it.each([
    [0, 2],
    [1, 4],
    [2, 2],
    [3, 1],
    [1.5, 3],
    [1, NaN],
  ])("rejects invalid source frame boundaries %s and %s", (startFrame, endFrame) => {
    const media = { ...landscapeVideo, startUs: 20_000, durationUs: 89_000 };
    expect(() => createTrimmedClipSource(uri, media, { startFrame, endFrame })).toThrow(RangeError);
  });
});
