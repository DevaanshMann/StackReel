import type { RenderPlan } from "@stackreel/core";
import { describe, expect, it } from "vitest";
import { createClipSource } from "../src/clip-source";

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

  it("rejects inputs with no complete output frame or invalid metadata", () => {
    expect(() => createClipSource(uri, { ...landscapeVideo, startUs: 10_000, durationUs: 50_000 })).toThrow(
      "too short",
    );
    expect(() => createClipSource(uri, { ...landscapeVideo, height: 0 })).toThrow("invalid dimensions or timing");
  });
});
