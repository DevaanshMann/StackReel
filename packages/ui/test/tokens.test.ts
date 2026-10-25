import { describe, expect, it } from "vitest";
import {
  canvas,
  DEFAULT_THEME,
  duration,
  fontFamily,
  fontSize,
  MIN_HIT_TARGET,
  motion,
  motionFor,
  palette,
  radius,
  reducedMotion,
  SEMANTIC_COLOR_ROLES,
  space,
  themes,
  zIndex,
} from "../src/index.js";

describe("tokens", () => {
  it("uses #RRGGBB for every palette color", () => {
    for (const scale of Object.values(palette)) {
      for (const color of Object.values(scale)) expect(color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("defines every semantic role in both themes, with dark as the default", () => {
    expect(DEFAULT_THEME).toBe("dark");
    for (const colors of Object.values(themes))
      expect(Object.keys(colors).sort()).toEqual([...SEMANTIC_COLOR_ROLES].sort());
  });

  it("uses Inter as the UI font", () => {
    expect(fontFamily.ui).toBe("Inter");
  });

  it("keeps the type scale increasing", () => {
    const sizes = Object.values(fontSize);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });

  it("is a 4-pt spacing scale", () => {
    for (const [step, value] of Object.entries(space)) expect(value).toBe(Number(step) * 4);
  });

  it("keeps radii and z-index layers increasing", () => {
    for (const tokens of [radius, zIndex]) {
      const values = Object.values(tokens);
      expect(values).toEqual([...values].sort((a, b) => a - b));
    }
  });

  it("has a 44-pt hit target and a 9:16 canvas", () => {
    expect(MIN_HIT_TARGET).toBe(44);
    expect(canvas.width / canvas.height).toBe(9 / 16);
    expect(canvas.aspectRatio).toBe(9 / 16);
  });

  it("removes motion when reduced motion is on", () => {
    expect(motionFor(false)).toBe(motion);
    expect(motionFor(true)).toBe(reducedMotion);
    expect(Object.keys(reducedMotion.duration)).toEqual(Object.keys(duration));
    expect(Object.keys(reducedMotion.easing)).toEqual(Object.keys(motion.easing));
    for (const ms of Object.values(reducedMotion.duration)) expect(ms).toBe(0);
  });
});
