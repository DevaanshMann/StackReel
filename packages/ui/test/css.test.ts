import { describe, expect, it } from "vitest";
import { cssVar, renderTokensCss, SEMANTIC_COLOR_ROLES, themes } from "../src/index.js";

const css = renderTokensCss();

/** Returns the custom properties declared directly in the first block whose selector matches. */
function declarations(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  return new Map([...body.matchAll(/^\s*(--[\w-]+): (.+);$/gm)].map((m) => [m[1] as string, m[2] as string]));
}

describe("tokens.css", () => {
  it("names properties with the --sr- prefix in kebab case", () => {
    expect(cssVar("color", "textMuted")).toBe("--sr-color-text-muted");
    expect(cssVar("space", 4)).toBe("--sr-space-4");
  });

  it.each([
    [":root", themes.dark],
    ['[data-theme="light"]', themes.light],
  ] as const)("%s sets every semantic color", (selector, colors) => {
    const vars = declarations(selector);
    for (const role of SEMANTIC_COLOR_ROLES) expect(vars.get(cssVar("color", role))).toBe(colors[role]);
  });

  it("puts the dark theme on :root and sets color-scheme", () => {
    expect(css).toMatch(/:root \{\n {2}color-scheme: dark;/);
    expect(css).toMatch(/\[data-theme="light"\] \{\n {2}color-scheme: light;/);
  });

  it("includes the non-color tokens on :root", () => {
    const vars = declarations(":root");
    expect(vars.get("--sr-font-ui")).toContain('"Inter"');
    expect(vars.get("--sr-font-size-md")).toBe("16px");
    expect(vars.get("--sr-space-4")).toBe("16px");
    expect(vars.get("--sr-radius-md")).toBe("8px");
    expect(vars.get("--sr-shadow-0")).toBe("none");
    expect(vars.get("--sr-shadow-2")).toBe("0 4px 12px rgba(0, 0, 0, 0.32)");
    expect(vars.get("--sr-z-modal")).toBe("400");
    expect(vars.get("--sr-duration-normal")).toBe("200ms");
    expect(vars.get("--sr-easing-standard")).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(vars.get("--sr-hit-target-min")).toBe("44px");
    expect(vars.get("--sr-canvas-aspect")).toBe("9 / 16");
    expect(vars.get("--sr-safe-zone-tiktok-bottom")).toBe("0.2");
  });

  it("zeroes durations for reduced motion", () => {
    const media = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(media).toContain("--sr-duration-normal: 0ms;");
    expect(media).toContain("--sr-easing-standard: cubic-bezier(0, 0, 1, 1);");
  });

  it("has balanced braces and ends with a newline", () => {
    expect(css.split("{").length).toBe(css.split("}").length);
    expect(css.endsWith("}\n")).toBe(true);
  });
});
