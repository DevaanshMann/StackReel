import { describe, expect, it } from "vitest";
import { mobileTemplates } from "../src/template-editor";
import type { TemplateClip } from "../src/template-editor";
import { getSelectedShot, getStoryboardCueTimes, getStoryboardShots } from "../src/template-storyboard";

const slots = ["intro", "detail", "reveal"].map((id) => ({
  id,
  label: id,
  minDurationUs: 500_000,
  trimDurationUs: 2_000_000,
}));
const clip: TemplateClip = {
  uri: "file:///intro.mov",
  name: "intro.mov",
  sourceStartUs: 80_000,
  sourceEndUs: 10_080_000,
  trimInUs: 2_100_000,
  trimOutUs: 4_100_000,
  width: 1080,
  height: 1920,
};

describe("template storyboard", () => {
  it("cues the shipped shots on the first frame after their incoming transitions", () => {
    expect(mobileTemplates.map(getStoryboardCueTimes)).toEqual([
      { before: 0, after: 3_800_000 },
      { clip1: 0, clip2: 3_266_667, clip3: 5_200_000 },
      { item5: 0, item4: 5_300_000, item3: 9_800_000, item2: 14_300_000, item1: 18_766_667 },
    ]);
  });

  it("uses the earliest playable occurrence and keeps a full-length transition inside the shot", () => {
    const template = mobileTemplates[0]!;
    const cues = getStoryboardCueTimes({
      ...template,
      canvas: { ...template.canvas, fps: 24 },
      slots: [
        ...template.slots,
        { id: "unused", kind: "video", label: "Unused" },
        { id: "still", kind: "image", label: "Still" },
        { id: "short", kind: "video", label: "Short" },
      ],
      tracks: [
        {
          type: "video",
          id: "clips",
          items: [
            { slot: "after", startUs: 4_000_000, durationUs: 500_000 },
            { slot: "before", startUs: 50_000, durationUs: 500_000, transitionIn: { type: "cut", durationUs: 0 } },
            { slot: "short", startUs: 800_000, durationUs: 1 },
            {
              slot: "after",
              startUs: 1_000_000,
              durationUs: 125_000,
              transitionIn: { type: "crossfade", durationUs: 125_000 },
            },
            { slot: "still", startUs: 2_000_000, durationUs: 1_000_000 },
          ],
        },
      ],
    });
    expect(cues).toEqual({ before: 41_667, after: 1_083_333 });
  });

  it("keeps template order and excludes missing media from ready progress and thumbnail requests", () => {
    const shots = getStoryboardShots(slots, { reveal: clip, intro: clip, obsolete: clip }, ["intro"]);
    expect(
      shots.map(({ number, slot, status, thumbnailTimeUs }) => [number, slot.id, status, thumbnailTimeUs]),
    ).toEqual([
      [1, "intro", "Missing", undefined],
      [2, "detail", "Empty", undefined],
      [3, "reveal", "Ready", 3_100_000],
    ]);
    expect(getStoryboardShots(slots, {}, ["reveal"])[2]?.status).toBe("Missing");
  });

  it("samples within the current trim in absolute source time, including after a trim change", () => {
    const shifted = { ...clip, trimInUs: 5_100_000, trimOutUs: 5_133_333 };
    expect(getStoryboardShots(slots, { intro: shifted }, [])[0]?.thumbnailTimeUs).toBe(5_116_666);
  });

  it("defaults to the first empty or missing slot, or the first ready slot on a complete draft", () => {
    expect(getSelectedShot(getStoryboardShots(slots, { intro: clip }, []), undefined)?.slot.id).toBe("detail");
    expect(getSelectedShot(getStoryboardShots(slots, { intro: clip }, ["detail"]), "old-id")?.slot.id).toBe("detail");
    expect(
      getSelectedShot(getStoryboardShots(slots, { intro: clip, detail: clip, reveal: clip }, []), undefined)?.slot.id,
    ).toBe("intro");
    expect(getSelectedShot([], undefined)).toBeUndefined();
  });

  it("keeps a selected shot when media arrives, moves between slots, goes missing, or is cleared", () => {
    const changed = { ...clip, uri: "file:///replacement.mov" };
    for (const shots of [
      getStoryboardShots(slots, {}, []),
      getStoryboardShots(slots, { detail: clip }, []),
      getStoryboardShots(slots, { intro: clip, detail: changed }, []),
      getStoryboardShots(slots, {}, ["detail"]),
      getStoryboardShots(slots, { intro: clip }, []),
    ]) {
      expect(getSelectedShot(shots, "detail")?.slot.id).toBe("detail");
    }
  });
});
