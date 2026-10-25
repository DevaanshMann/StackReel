import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  parseHex,
  relativeLuminance,
  THEME_NAMES,
  themes,
  WCAG_AA,
  type SemanticColorRole,
} from "../src/index.js";

describe("contrastRatio", () => {
  it("matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#abc", "#abc")).toBe(1);
  });

  it("computes relative luminance", () => {
    expect(relativeLuminance("#000")).toBe(0);
    expect(relativeLuminance("#fff")).toBeCloseTo(1, 10);
  });

  it("rejects malformed colors", () => {
    expect(parseHex("#ff0000")).toEqual([255, 0, 0]);
    expect(() => parseHex("red")).toThrow(/#RGB or #RRGGBB/);
    expect(() => parseHex("#12345")).toThrow();
  });
});

const backgrounds = ["bg", "surface", "elevated"] as const;

/** A foreground role, the background it's drawn on, and the minimum ratio it needs. */
interface Pair {
  fg: SemanticColorRole;
  bg: SemanticColorRole;
  min: number;
}

const pairs: Pair[] = [
  ...backgrounds.flatMap((bg): Pair[] => [
    { fg: "text", bg, min: WCAG_AA.bodyText },
    { fg: "textMuted", bg, min: WCAG_AA.bodyText },
    { fg: "accent", bg, min: WCAG_AA.ui },
    { fg: "danger", bg, min: WCAG_AA.ui },
    { fg: "success", bg, min: WCAG_AA.ui },
    { fg: "warning", bg, min: WCAG_AA.ui },
  ]),
  { fg: "onAccent", bg: "accent", min: WCAG_AA.bodyText },
];

describe.each(THEME_NAMES)("%s theme contrast", (theme) => {
  it.each(pairs)(`$fg on $bg is at least $min:1`, ({ fg, bg, min }) => {
    const colors = themes[theme];
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(min);
  });
});
