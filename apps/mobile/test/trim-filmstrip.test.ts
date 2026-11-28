import { describe, expect, it } from "vitest";
import {
  draggedTrimFrame,
  filmstripGrabOffset,
  filmstripIntent,
  filmstripSamples,
  filmstripStartFrame,
  filmstripWindow,
  trimHandleAt,
} from "../src/trim-filmstrip";

const bounds = { firstFrame: 12, sourceEndFrame: 112, durationFrames: 20 };

describe("trim filmstrip", () => {
  it("leaves taps pending through small finger movements and recognizes a horizontal drag in either direction", () => {
    expect(filmstripIntent("pending", 0, 0)).toBe("pending");
    expect(filmstripIntent("pending", -5, 5)).toBe("pending");
    expect(filmstripIntent("pending", -6, 1)).toBe("drag");
    expect(filmstripIntent("pending", 8, -4)).toBe("drag");
    expect(filmstripIntent("drag", 1, 12)).toBe("drag");
  });

  it("yields vertical or diagonal movement to scrolling, including when the finger returns to its origin", () => {
    expect(filmstripIntent("pending", 1, 6)).toBe("scroll");
    expect(filmstripIntent("pending", -6, -6)).toBe("scroll");
    expect(filmstripIntent("scroll", 20, 0)).toBe("scroll");
    expect(filmstripIntent("scroll", 0, 0)).toBe("scroll");
  });

  it("samples the middle of each equal tile across the playable source", () => {
    expect(filmstripSamples(12, 92)).toEqual([17, 27, 37, 47, 57, 67, 77, 87]);
    expect(filmstripSamples(12, 15)).toEqual([12, 13, 14]);
    expect(filmstripSamples(12, 13)).toEqual([12]);
  });

  it("places both ends of the window on the full source scale", () => {
    expect(filmstripWindow(bounds, 12, 300)).toEqual({ left: 0, right: 60 });
    expect(filmstripWindow(bounds, 52, 300)).toEqual({ left: 120, right: 180 });
    expect(filmstripWindow(bounds, 92, 300)).toEqual({ left: 240, right: 300 });
  });

  it("keeps the grabbed point steady, snaps to frames, and clamps an out-of-bounds drag", () => {
    const grab = filmstripGrabOffset(bounds, 52, 165, 300);
    expect(grab).toBe(15);
    expect(filmstripStartFrame(bounds, 165, 300, grab)).toBe(52);
    expect(filmstripStartFrame(bounds, 170, 300, grab)).toBe(54);
    expect(filmstripStartFrame(bounds, -10, 300, grab)).toBe(12);
    expect(filmstripStartFrame(bounds, 350, 300, grab)).toBe(92);
  });

  it("centers an outside tap and can select either endpoint", () => {
    const grab = filmstripGrabOffset(bounds, 12, 150, 300);
    expect(grab).toBe(10);
    expect(filmstripStartFrame(bounds, 150, 300, grab)).toBe(52);
    expect(filmstripStartFrame(bounds, 0, 300, grab)).toBe(12);
    expect(filmstripStartFrame(bounds, 300, 300, grab)).toBe(92);
  });

  it("fills an exact-fit source at its only legal start", () => {
    const exact = { ...bounds, durationFrames: 100 };
    expect(filmstripWindow(exact, 12, 300)).toEqual({ left: 0, right: 300 });
    const grab = filmstripGrabOffset(exact, 12, 120, 300);
    expect(filmstripStartFrame(exact, 300, 300, grab)).toBe(12);
  });

  it("keeps subpixel windows aligned and sample count bounded on long clips", () => {
    const long = { firstFrame: 300, sourceEndFrame: 108_300, durationFrames: 1 };
    const end = filmstripWindow(long, 108_299, 320);
    expect(end.right).toBe(320);
    expect(end.right - end.left).toBeCloseTo(320 / 108_000, 10);
    expect(filmstripStartFrame(long, 320, 320, 0.5)).toBe(108_299);
    const samples = filmstripSamples(long.firstFrame, long.sourceEndFrame);
    expect(samples).toHaveLength(8);
    expect(samples).toEqual([...new Set(samples)].sort((a, b) => a - b));
    expect(samples[7]).toBeLessThan(long.sourceEndFrame);
  });
});

describe("single-clip filmstrip handles", () => {
  const source = { startFrame: 300, endFrame: 450 };
  const cut = { startFrame: 360, endFrame: 390 };

  it("picks the nearest endpoint using the source track, with a midpoint tap favoring the start", () => {
    expect(trimHandleAt(source, cut, -10, 300)).toBe("startFrame");
    expect(trimHandleAt(source, cut, 150, 300)).toBe("startFrame");
    expect(trimHandleAt(source, cut, 151, 300)).toBe("endFrame");
    expect(trimHandleAt(source, cut, 310, 300)).toBe("endFrame");
  });

  it("starts at the original boundary and snaps deltas to whole source frames", () => {
    expect(draggedTrimFrame(source, cut, "startFrame", 0, 300)).toBe(360);
    expect(draggedTrimFrame(source, cut, "endFrame", 0.8, 300)).toBe(390);
    expect(draggedTrimFrame(source, cut, "startFrame", 3.2, 300)).toBe(362);
    expect(draggedTrimFrame(source, cut, "endFrame", -3.2, 300)).toBe(388);
    expect(draggedTrimFrame(source, cut, "endFrame", 3.2, 0)).toBe(390);
  });

  it("keeps both edges in bounds and preserves at least one frame", () => {
    expect(draggedTrimFrame(source, cut, "startFrame", -999, 300)).toBe(source.startFrame);
    expect(draggedTrimFrame(source, cut, "endFrame", 999, 300)).toBe(source.endFrame);
    expect(draggedTrimFrame(source, cut, "startFrame", 999, 300)).toBe(cut.endFrame - 1);
    expect(draggedTrimFrame(source, cut, "endFrame", -999, 300)).toBe(cut.startFrame + 1);
    const oneFrame = { startFrame: 20, endFrame: 21 };
    expect(draggedTrimFrame(oneFrame, oneFrame, "startFrame", 300, 300)).toBe(20);
    expect(draggedTrimFrame(oneFrame, oneFrame, "endFrame", -300, 300)).toBe(21);
  });

  it("can grab either side of a subpixel selection at each end of a long source", () => {
    const long = { startFrame: 900, endFrame: 108_900 };
    const first = { startFrame: 900, endFrame: 901 };
    const last = { startFrame: 108_899, endFrame: 108_900 };
    expect(trimHandleAt(long, first, 0, 320)).toBe("startFrame");
    expect(trimHandleAt(long, first, 1, 320)).toBe("endFrame");
    expect(trimHandleAt(long, last, 319, 320)).toBe("startFrame");
    expect(trimHandleAt(long, last, 320, 320)).toBe("endFrame");
    expect(draggedTrimFrame(long, last, "startFrame", -16, 320)).toBe(103_499);
  });
});
