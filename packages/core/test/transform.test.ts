import type { FitMode } from "@stackreel/template-schema";
import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  anchorPoint,
  cropRect,
  fitMatrix,
  multiply,
  placementMatrix,
  rotation,
  scaling,
  transformPoint,
  translation,
  type Matrix3,
} from "../src/index.js";

const canvas = { width: 1080, height: 1920 };

function expectMatrix(actual: Matrix3, expected: Matrix3) {
  expected.forEach((value, i) => expect(actual[i], `entry ${i}`).toBeCloseTo(value, 6));
}

describe("fitMatrix at 1080×1920", () => {
  const W = 16 / 9; // 1920 / 1080
  const cases: [string, { width: number; height: number }, FitMode, Matrix3][] = [
    ["16:9", { width: 1920, height: 1080 }, "cover", [W, 0, (1080 - 1920 * W) / 2, 0, W, 0, 0, 0, 1]],
    ["16:9", { width: 1920, height: 1080 }, "contain", [0.5625, 0, 0, 0, 0.5625, 656.25, 0, 0, 1]],
    ["16:9", { width: 1920, height: 1080 }, "fill", [0.5625, 0, 0, 0, W, 0, 0, 0, 1]],
    ["4:3", { width: 1440, height: 1080 }, "cover", [W, 0, -740, 0, W, 0, 0, 0, 1]],
    ["4:3", { width: 1440, height: 1080 }, "contain", [0.75, 0, 0, 0, 0.75, 555, 0, 0, 1]],
    ["4:3", { width: 1440, height: 1080 }, "fill", [0.75, 0, 0, 0, W, 0, 0, 0, 1]],
    ["9:16", { width: 1080, height: 1920 }, "cover", IDENTITY],
    ["9:16", { width: 1080, height: 1920 }, "contain", IDENTITY],
    ["9:16", { width: 1080, height: 1920 }, "fill", IDENTITY],
    ["9:16 at 720p", { width: 720, height: 1280 }, "cover", [1.5, 0, 0, 0, 1.5, 0, 0, 0, 1]],
  ];

  it.each(cases)("%s %s", (_name, source, fit, expected) => {
    expectMatrix(fitMatrix(source, canvas, fit), expected);
  });

  it("cover fills the canvas and centers the overflow", () => {
    const m = fitMatrix({ width: 1920, height: 1080 }, canvas, "cover");
    const [left, top] = transformPoint(m, 0, 0);
    const [right, bottom] = transformPoint(m, 1920, 1080);
    expect(top).toBeCloseTo(0);
    expect(bottom).toBeCloseTo(1920);
    expect(left).toBeLessThan(0);
    expect(left + right).toBeCloseTo(1080);
  });

  it("contain keeps the whole source on the canvas", () => {
    const m = fitMatrix({ width: 1440, height: 1080 }, canvas, "contain");
    expect(transformPoint(m, 0, 0)).toEqual([0, 555]);
    expect(transformPoint(m, 1440, 1080)).toEqual([1080, 1365]);
  });

  it("maps the crop rectangle, not the whole frame", () => {
    const source = { width: 1920, height: 1080 };
    const crop = cropRect(source, { x: 0.25, y: 0, width: 0.5, height: 1 });
    expect(crop).toEqual({ x: 480, y: 0, width: 960, height: 1080 });
    const m = fitMatrix(source, canvas, "fill", crop);
    expect(transformPoint(m, 480, 0)).toEqual([0, 0]);
    const [x, y] = transformPoint(m, 1440, 1080);
    expect(x).toBeCloseTo(1080);
    expect(y).toBeCloseTo(1920);
    const cover = fitMatrix(source, canvas, "cover", crop);
    const [cx] = transformPoint(cover, 960, 540);
    expect(cx).toBeCloseTo(540);
  });

  it("uses the whole frame without a crop", () => {
    expect(cropRect({ width: 10, height: 20 })).toEqual({ x: 0, y: 0, width: 10, height: 20 });
  });
});

describe("matrix helpers", () => {
  it("multiplies right to left", () => {
    const m = multiply(translation(10, 20), scaling(2, 3));
    expect(transformPoint(m, 1, 1)).toEqual([12, 23]);
    expect(multiply(IDENTITY, m)).toEqual(m);
  });

  it("rotates clockwise on screen, exactly for quarter turns", () => {
    expect(rotation(90)).toEqual([0, -1, 0, 1, 0, 0, 0, 0, 1]);
    expect(rotation(-90)).toEqual(rotation(270));
    expect(rotation(180)).toEqual([-1, 0, 0, 0, -1, 0, 0, 0, 1]);
    expect(rotation(360)).toEqual(IDENTITY);
    const [x, y] = transformPoint(rotation(45), 1, 0);
    expect(x).toBeCloseTo(Math.SQRT1_2);
    expect(y).toBeCloseTo(Math.SQRT1_2);
  });

  it("never produces negative zero", () => {
    expect(Object.is(translation(-0, 0)[2], 0)).toBe(true);
    expect(multiply(scaling(-1, 1), translation(0, 0)).every((n) => !Object.is(n, -0))).toBe(true);
  });
});

describe("placementMatrix", () => {
  const content = { width: 200, height: 100 };

  it("puts the anchor point on the position", () => {
    const at = { xPx: 540, yPx: 960, rotationDeg: 0 };
    expect(transformPoint(placementMatrix(content, { ...at, anchor: "center" }), 0, 0)).toEqual([440, 910]);
    expect(transformPoint(placementMatrix(content, { ...at, anchor: "top-left" }), 0, 0)).toEqual([540, 960]);
    expect(transformPoint(placementMatrix(content, { ...at, anchor: "bottom-right" }), 200, 100)).toEqual([540, 960]);
  });

  it("rotates around the anchor", () => {
    const m = placementMatrix(content, { xPx: 540, yPx: 960, anchor: "center", rotationDeg: 90 });
    expect(transformPoint(m, 100, 50)).toEqual([540, 960]);
    expect(transformPoint(m, 0, 0)).toEqual([590, 860]);
  });

  it.each([
    ["top", [0.5, 0]],
    ["left", [0, 0.5]],
    ["right", [1, 0.5]],
    ["top-right", [1, 0]],
    ["bottom-left", [0, 1]],
    ["bottom", [0.5, 1]],
  ] as const)("knows where %s is", (anchor, point) => {
    expect(anchorPoint(anchor)).toEqual(point);
  });
});
