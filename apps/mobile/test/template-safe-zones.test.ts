import { safeZoneRegions, safeZones } from "@stackreel/ui";
import { describe, expect, it } from "vitest";
import { mobileTemplates } from "../src/template-editor";
import { fitPreviewCanvas, getTemplateSafeZoneGuide } from "../src/template-safe-zones";

const template = mobileTemplates[0]!;
const zeroInsets = { top: 0, bottom: 0, left: 0, right: 0 };

describe("assembled template safe-zone guidance", () => {
  it("uses the shared regions for the template preset", () => {
    const { width, height } = template.canvas;
    const { safe, top, bottom, left, right } = safeZoneRegions(safeZones["tiktok-reels-shorts"], width, height);

    expect(getTemplateSafeZoneGuide(template)).toEqual({ covered: [top, bottom, left, right], safe });
  });

  it("uses only the custom insets, including those on a none preset", () => {
    const insets = { ...zeroInsets, top: 0.1, right: 0.25 };
    for (const preset of ["tiktok", "none"] as const) {
      expect(getTemplateSafeZoneGuide({ ...template, safeZones: { preset, insets } })).toEqual({
        covered: [
          { x: 0, y: 0, width: 1080, height: 192 },
          { x: 810, y: 192, width: 270, height: 1728 },
        ],
        safe: { x: 0, y: 192, width: 810, height: 1728 },
      });
    }
  });

  it("omits guidance for absent, none, and all-zero overrides", () => {
    expect(getTemplateSafeZoneGuide({ ...template, safeZones: undefined })).toBeNull();
    expect(getTemplateSafeZoneGuide({ ...template, safeZones: { preset: "none" } })).toBeNull();
    expect(getTemplateSafeZoneGuide({ ...template, safeZones: { preset: "tiktok", insets: zeroInsets } })).toBeNull();
  });

  it("omits guidance when custom insets round down to zero canvas pixels", () => {
    const insets = { ...zeroInsets, top: 0.0001 };
    expect(getTemplateSafeZoneGuide({ ...template, safeZones: { preset: "tiktok", insets } })).toBeNull();
  });

  it.each([
    { ...zeroInsets, top: 0.25, bottom: 0.75 },
    { ...zeroInsets, left: 0.75, right: 0.75 },
    { ...zeroInsets, right: 1 },
  ])("shades the canvas once when no safe area remains (%o)", (insets) => {
    const { width, height } = template.canvas;

    expect(getTemplateSafeZoneGuide({ ...template, safeZones: { preset: "none", insets } })).toEqual({
      covered: [{ x: 0, y: 0, width, height }],
      safe: null,
    });
  });

  it("handles a safe area that disappears after rounding to the canvas pixels", () => {
    const canvas = { ...template.canvas, width: 16, height: 16 };
    const insets = { ...zeroInsets, top: 0.48, bottom: 0.49 };

    expect(getTemplateSafeZoneGuide({ ...template, canvas, safeZones: { preset: "none", insets } })).toEqual({
      covered: [{ x: 0, y: 0, width: 16, height: 16 }],
      safe: null,
    });
  });
});

describe("safe-zone overlay canvas alignment", () => {
  it.each([
    [
      { width: 270, height: 480 },
      { x: 0, y: 0, width: 270, height: 480 },
    ],
    [
      { width: 300, height: 480 },
      { x: 15, y: 0, width: 270, height: 480 },
    ],
    [
      { width: 270, height: 500 },
      { x: 0, y: 10, width: 270, height: 480 },
    ],
  ])("fits the video inside a %o point viewport", (viewport, frame) => {
    expect(fitPreviewCanvas(template.canvas, viewport)).toEqual(frame);
  });
});
