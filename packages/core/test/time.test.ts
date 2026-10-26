import { describe, expect, it } from "vitest";
import {
  COMMON_FPS,
  clampToRange,
  frameToUs,
  intersectRanges,
  isEmptyRange,
  isOnFrame,
  rangeContains,
  rangeContainsRange,
  rangeDuration,
  rangeFromDuration,
  rangesOverlap,
  snapRangeToFrames,
  snapToFrame,
  timeRange,
  usToFrame,
} from "../src/index.js";
import { maxTimeUs } from "../src/limits.js";

describe("frameToUs", () => {
  it.each([
    [24, [0, 41667, 83333, 125000, 166667, 208333, 250000]],
    [25, [0, 40000, 80000, 120000, 160000, 200000, 240000]],
    [30, [0, 33333, 66667, 100000, 133333, 166667, 200000]],
    [60, [0, 16667, 33333, 50000, 66667, 83333, 100000]],
  ])("rounds each frame start to the nearest microsecond at %i fps", (fps, starts) => {
    expect(starts.map((_, frame) => frameToUs(frame, fps))).toEqual(starts);
  });

  it.each(COMMON_FPS)("puts frame %i (one second) at exactly 1000000 us", (fps) => {
    expect(frameToUs(fps, fps)).toBe(1_000_000);
    expect(frameToUs(fps * 3600, fps)).toBe(3_600_000_000);
  });

  it("does not drift over long durations", () => {
    // 10 hours at 30 fps: exact value is 1_080_000 * 1e6 / 30
    expect(frameToUs(1_080_001, 30)).toBe(36_000_033_333);
  });

  it("rounds an exact half up", () => {
    // 1e6 / 128 = 7812.5
    expect(frameToUs(1, 128)).toBe(7813);
    expect(frameToUs(3, 128)).toBe(23438); // 23437.5
  });

  it("rejects bad frames and frame rates", () => {
    expect(() => frameToUs(-1, 30)).toThrow(RangeError);
    expect(() => frameToUs(1.5, 30)).toThrow(RangeError);
    expect(() => frameToUs(1, 0)).toThrow(RangeError);
    expect(() => frameToUs(1, 29.97)).toThrow(RangeError);
    expect(() => frameToUs(1, 241)).toThrow(RangeError);
    expect(() => frameToUs(Number.MAX_SAFE_INTEGER, 30)).toThrow(/too large/);
  });
});

describe("usToFrame", () => {
  it.each(COMMON_FPS)("inverts frameToUs for every rounding at %i fps", (fps) => {
    for (let frame = 0; frame < fps * 3; frame++) {
      const us = frameToUs(frame, fps);
      expect(usToFrame(us, fps, "floor")).toBe(frame);
      expect(usToFrame(us, fps, "ceil")).toBe(frame);
      expect(usToFrame(us, fps, "round")).toBe(frame);
    }
  });

  it.each(COMMON_FPS)("puts each time inside the frame it returns at %i fps", (fps) => {
    for (let us = 0; us < 200_000; us += 997) {
      const frame = usToFrame(us, fps);
      expect(frameToUs(frame, fps)).toBeLessThanOrEqual(us);
      expect(frameToUs(frame + 1, fps)).toBeGreaterThan(us);
    }
  });

  it("returns frame 0 at time 0", () => {
    for (const fps of COMMON_FPS) {
      expect(usToFrame(0, fps)).toBe(0);
      expect(usToFrame(0, fps, "ceil")).toBe(0);
    }
  });

  it("uses the rounded frame boundaries, not the exact ones", () => {
    // Frame 2 at 30 fps starts at 66667 (exactly 66666.67), so 66666 is still frame 1.
    expect(usToFrame(66_666, 30)).toBe(1);
    expect(usToFrame(66_667, 30)).toBe(2);
    // Frame 2 at 24 fps starts at 83333 (exactly 83333.33), so 83333 is already frame 2.
    expect(usToFrame(83_332, 24)).toBe(1);
    expect(usToFrame(83_333, 24)).toBe(2);
  });

  it("applies floor, ceil and round between frame starts", () => {
    // 25 fps: frames start at 0, 40000, 80000
    expect(usToFrame(1, 25, "floor")).toBe(0);
    expect(usToFrame(1, 25, "ceil")).toBe(1);
    expect(usToFrame(19_999, 25, "round")).toBe(0);
    expect(usToFrame(20_000, 25, "round")).toBe(1); // tie goes to the later frame
    expect(usToFrame(39_999, 25, "floor")).toBe(0);
    expect(usToFrame(40_001, 25, "round")).toBe(1);
    // 60 fps: frames 1 and 2 start at 16667 and 33333
    expect(usToFrame(25_000, 60, "round")).toBe(2); // 8333 after frame 1, 8333 before frame 2: tie, later frame
    expect(usToFrame(24_999, 60, "round")).toBe(1);
    expect(usToFrame(25_001, 60, "round")).toBe(2);
  });

  it("is exact for very long times", () => {
    const us = frameToUs(100_000_000, 60);
    expect(usToFrame(us, 60)).toBe(100_000_000);
    expect(usToFrame(us - 1, 60)).toBe(99_999_999);
  });

  it("rejects bad times", () => {
    expect(() => usToFrame(-1, 30)).toThrow(RangeError);
    expect(() => usToFrame(0.5, 30)).toThrow(/integer number of microseconds/);
    expect(() => usToFrame(Number.MAX_SAFE_INTEGER, 30)).toThrow(/too large/);
    expect(() => usToFrame(0, 0)).toThrow(/fps/);
  });
});

describe("snapToFrame", () => {
  it.each([
    [24, 50_000, 41_667],
    [24, 70_000, 83_333],
    [25, 59_999, 40_000],
    [25, 60_000, 80_000],
    [30, 50_000, 66_667], // 16667 past frame 1, 16667 before frame 2: tie goes later
    [30, 49_999, 33_333],
    [60, 10_000, 16_667],
    [60, 8_000, 0],
  ])("snaps to the nearest frame start at %i fps (%i -> %i)", (fps, us, expected) => {
    expect(snapToFrame(us, fps)).toBe(expected);
  });

  it("supports floor and ceil", () => {
    expect(snapToFrame(50_000, 30, "floor")).toBe(33_333);
    expect(snapToFrame(50_000, 30, "ceil")).toBe(66_667);
    expect(snapToFrame(33_333, 30, "ceil")).toBe(33_333);
  });

  it("leaves frame starts alone", () => {
    expect(isOnFrame(0, 24)).toBe(true);
    expect(isOnFrame(41_667, 24)).toBe(true);
    expect(isOnFrame(41_666, 24)).toBe(false);
  });
});

describe("maxTimeUs", () => {
  it.each([1, ...COMMON_FPS, 240])("is a frame start every helper handles at %i fps", (fps) => {
    const maxUs = maxTimeUs(fps);
    for (const rounding of ["floor", "ceil", "round"] as const) {
      expect(snapToFrame(maxUs, fps, rounding)).toBe(maxUs);
      expect(snapToFrame(maxUs - 1, fps, rounding)).toBeLessThanOrEqual(maxUs);
    }
    expect(frameToUs(usToFrame(maxUs, fps) + 1, fps)).toBeGreaterThan(maxUs);
    expect(() => snapToFrame(maxUs + frameToUs(2, fps), fps)).toThrow(/too large/);
  });

  it("is about 217 days at 240 fps, short of a valid year-long template", () => {
    expect(maxTimeUs(240)).toBe(18_764_998_441_667);
    expect(() => snapToFrame(31_536_000_000_000, 240)).toThrow(RangeError);
  });

  it("rejects bad frame rates", () => {
    expect(() => maxTimeUs(0)).toThrow(/fps/);
  });
});

describe("TimeRange", () => {
  const r = (startUs: number, endUs: number) => timeRange(startUs, endUs);

  it("validates its ends", () => {
    expect(r(0, 0)).toEqual({ startUs: 0, endUs: 0 });
    expect(() => r(5, 4)).toThrow(/before startUs/);
    expect(() => r(-1, 4)).toThrow(/startUs/);
    expect(() => r(0, 1.5)).toThrow(/endUs/);
  });

  it("builds from a duration", () => {
    expect(rangeFromDuration(100, 50)).toEqual({ startUs: 100, endUs: 150 });
    expect(() => rangeFromDuration(0, -1)).toThrow(/durationUs/);
  });

  it("measures duration and emptiness", () => {
    expect(rangeDuration(r(10, 35))).toBe(25);
    expect(rangeDuration(r(10, 10))).toBe(0);
    expect(isEmptyRange(r(10, 10))).toBe(true);
    expect(isEmptyRange(r(10, 11))).toBe(false);
  });

  it("treats ranges as half-open when testing overlap", () => {
    expect(rangesOverlap(r(0, 10), r(5, 15))).toBe(true);
    expect(rangesOverlap(r(5, 15), r(0, 10))).toBe(true);
    expect(rangesOverlap(r(0, 10), r(10, 20))).toBe(false); // touching
    expect(rangesOverlap(r(0, 10), r(2, 3))).toBe(true); // nested
    expect(rangesOverlap(r(0, 10), r(5, 5))).toBe(false); // empty
    expect(rangesOverlap(r(0, 10), r(20, 30))).toBe(false);
  });

  it("intersects ranges", () => {
    expect(intersectRanges(r(0, 10), r(5, 15))).toEqual(r(5, 10));
    expect(intersectRanges(r(0, 10), r(2, 3))).toEqual(r(2, 3));
    expect(intersectRanges(r(0, 10), r(10, 20))).toBeNull();
    expect(intersectRanges(r(0, 10), r(0, 10))).toEqual(r(0, 10));
  });

  it("contains times with the end excluded", () => {
    expect(rangeContains(r(10, 20), 10)).toBe(true);
    expect(rangeContains(r(10, 20), 19)).toBe(true);
    expect(rangeContains(r(10, 20), 20)).toBe(false);
    expect(rangeContains(r(10, 20), 9)).toBe(false);
    expect(rangeContains(r(10, 10), 10)).toBe(false);
  });

  it("contains ranges", () => {
    expect(rangeContainsRange(r(0, 10), r(0, 10))).toBe(true);
    expect(rangeContainsRange(r(0, 10), r(2, 8))).toBe(true);
    expect(rangeContainsRange(r(0, 10), r(10, 10))).toBe(true);
    expect(rangeContainsRange(r(0, 10), r(5, 11))).toBe(false);
  });

  it("clamps times with the end included", () => {
    expect(clampToRange(5, r(10, 20))).toBe(10);
    expect(clampToRange(15, r(10, 20))).toBe(15);
    expect(clampToRange(25, r(10, 20))).toBe(20);
  });

  it("snaps both ends to frames", () => {
    expect(snapRangeToFrames(r(1_000, 1_010_000), 30)).toEqual(r(0, 1_000_000));
    expect(snapRangeToFrames(r(1_000, 2_000), 30)).toEqual(r(0, 0));
  });
});
