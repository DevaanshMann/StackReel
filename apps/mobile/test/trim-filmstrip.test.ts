import { describe, expect, it } from "vitest";
import { filmstripGrabOffset, filmstripSamples, filmstripStartFrame, filmstripWindow } from "../src/trim-filmstrip";

const bounds = { firstFrame: 12, sourceEndFrame: 112, durationFrames: 20 };

describe("trim filmstrip", () => {
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
