import { describe, expect, it } from "vitest";
import type { TemplateClip } from "../src/template-editor";
import { getSelectedShot, getStoryboardShots } from "../src/template-storyboard";

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
