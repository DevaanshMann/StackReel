import type { Slot } from "@stackreel/template-schema";
import { describe, expect, it } from "vitest";
import { fitClip, fitSlot, isOnFrame, type FitRequest, type Fitted } from "../src/index.js";

const base: FitRequest = { durationUs: 2_000_000, trimInUs: 0, trimOutUs: 10_000_000, fps: 30 };

function fitted(request: Partial<FitRequest>): Fitted {
  const fit = fitClip({ ...base, ...request });
  if (fit.status !== "fitted") throw new Error(`expected a fit, got ${fit.status}`);
  return fit;
}

describe("fitClip with a long clip", () => {
  it("plays from the start of the trim window by default", () => {
    expect(fitted({ trimInUs: 1_000_000 })).toEqual({
      status: "fitted",
      mode: "trim",
      sourceStartUs: 1_000_000,
      sourceEndUs: 3_000_000,
      rate: 1,
      afterEnd: "hold",
      neededUs: 2_000_000,
      availableUs: 9_000_000,
      minSpeedReached: false,
    });
  });

  it("uses speed to work out how much source it needs", () => {
    const fit = fitted({ speed: 2 });
    expect([fit.sourceStartUs, fit.sourceEndUs, fit.rate]).toEqual([0, 4_000_000, 2]);
    const slow = fitted({ speed: 0.5 });
    expect([slow.sourceEndUs, slow.rate]).toEqual([1_000_000, 0.5]);
  });

  it("fits exactly when the window is as long as needed", () => {
    expect(fitted({ trimOutUs: 2_000_000 }).mode).toBe("trim");
  });

  it("lets a picker choose the window, clamped and snapped to frames", () => {
    expect(fitted({ pickWindow: () => 3_010_000 }).sourceStartUs).toBe(3_000_000);
    expect(fitted({ pickWindow: () => 50_000_000 }).sourceStartUs).toBe(8_000_000);
    expect(fitted({ trimInUs: 1_000_000, pickWindow: () => -5 }).sourceStartUs).toBe(1_000_000);
    expect(fitted({ pickWindow: () => Number.NaN }).sourceStartUs).toBe(0);
  });

  it("passes the frame-aligned window to the picker", () => {
    let seen: unknown;
    fitted({ trimInUs: 10, trimOutUs: 9_999_990, pickWindow: (c) => ((seen = c), c.windowStartUs) });
    expect(seen).toEqual({ windowStartUs: 33_333, windowEndUs: 9_966_667, neededUs: 2_000_000 });
  });

  it("clamps the trim to the source length", () => {
    const fit = fitted({ trimOutUs: 10_000_000, sourceDurationUs: 1_000_000 });
    expect([fit.mode, fit.sourceEndUs]).toEqual(["freeze", 1_000_000]);
  });
});

describe("fitClip with a short clip", () => {
  const short = { trimInUs: 500_000, trimOutUs: 1_500_000 };

  it("freezes the last frame by default", () => {
    expect(fitted(short)).toMatchObject({
      mode: "freeze",
      sourceStartUs: 500_000,
      sourceEndUs: 1_500_000,
      rate: 1,
      afterEnd: "hold",
      neededUs: 2_000_000,
      availableUs: 1_000_000,
    });
  });

  it("loops", () => {
    expect(fitted({ ...short, policy: "loop", speed: 1.5 })).toMatchObject({
      mode: "loop",
      rate: 1.5,
      afterEnd: "loop",
    });
  });

  it("slows down to fill the slot", () => {
    expect(fitted({ ...short, policy: "slow" })).toMatchObject({
      mode: "slow",
      rate: 0.5,
      afterEnd: "hold",
      minSpeedReached: false,
    });
  });

  it("stops slowing at the minimum speed and holds the last frame", () => {
    const fit = fitted({ trimInUs: 0, trimOutUs: 100_000, policy: "slow" });
    expect(fit).toMatchObject({ mode: "slow", rate: 0.25, minSpeedReached: true });
    expect(fitted({ trimInUs: 0, trimOutUs: 100_000, policy: "slow", minSpeed: 0.01 }).rate).toBe(0.05);
  });
});

describe("fitClip frame snapping", () => {
  it.each([24, 25, 30, 60])("puts every source time on a frame at %i fps", (fps) => {
    for (const request of [
      { trimInUs: 12_345, trimOutUs: 9_876_543 },
      { trimInUs: 12_345, trimOutUs: 987_654 },
      { trimInUs: 1, trimOutUs: 1_234_567, speed: 1.25, durationUs: 777_777 },
    ]) {
      const fit = fitted({ ...request, fps });
      expect(isOnFrame(fit.sourceStartUs, fps)).toBe(true);
      expect(isOnFrame(fit.sourceEndUs, fps)).toBe(true);
      expect(fit.sourceStartUs).toBeGreaterThanOrEqual(request.trimInUs);
      expect(fit.sourceEndUs).toBeLessThanOrEqual(request.trimOutUs);
    }
  });

  it("reports a window with no whole frame", () => {
    expect(fitClip({ ...base, trimInUs: 10, trimOutUs: 20_000 })).toEqual({
      status: "empty-window",
      windowStartUs: 33_333,
      windowEndUs: 33_333,
    });
    expect(fitClip({ ...base, trimInUs: 5_000_000, sourceDurationUs: 4_000_000 }).status).toBe("empty-window");
  });
});

describe("fitSlot", () => {
  const slot: Slot = { id: "clip", kind: "video", label: "Clip" };
  const request = { durationUs: 1_000_000, fps: 30 };

  it("skips an empty optional slot", () => {
    expect(fitSlot({ ...slot, optional: true }, undefined, request)).toEqual({ status: "skipped", slotId: "clip" });
  });

  it("reports an empty required slot", () => {
    expect(fitSlot(slot, undefined, request)).toEqual({ status: "missing-slot", slotId: "clip" });
  });

  it("fits a bound clip", () => {
    const binding = { assetUri: "a.mp4", trimInUs: 0, trimOutUs: 5_000_000 };
    expect(fitSlot(slot, binding, request)).toMatchObject({ status: "fitted", sourceEndUs: 1_000_000 });
  });

  it("names the slot when the trim has no frames", () => {
    const binding = { assetUri: "a.mp4", trimInUs: 0, trimOutUs: 10 };
    expect(fitSlot(slot, binding, request)).toMatchObject({ status: "empty-window", slotId: "clip" });
  });
});
