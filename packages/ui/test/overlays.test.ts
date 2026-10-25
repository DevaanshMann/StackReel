import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canvas,
  palette,
  renderSafeZoneOverlaySvg,
  safeZoneInsetsPx,
  safeZoneOverlayStyle,
  safeZoneRegions,
  safeZones,
  type Rect,
  type SafeZonePresetName,
} from "../src/index.js";
import { OVERLAY_PRESETS, OVERLAYS_DIR, overlayFileName, renderOverlayFile } from "../scripts/render-overlays.js";

const presets = Object.keys(safeZones) as SafeZonePresetName[];

const attribute = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

const parseRect = (tag: string): Rect => ({
  x: Number(attribute(tag, "x")),
  y: Number(attribute(tag, "y")),
  width: Number(attribute(tag, "width")),
  height: Number(attribute(tag, "height")),
});

/** The shaded rects inside the `<g>`, and the outline rect after it. */
function parseOverlay(svg: string) {
  const group = /<g [^>]*>([\s\S]*?)<\/g>/.exec(svg);
  const outline = /<\/g>\s*(<rect [^>]*>)/.exec(svg)?.[1] ?? "";
  return {
    root: /<svg [^>]*>/.exec(svg)?.[0] ?? "",
    group: group?.[0] ?? "",
    shaded: [...(group?.[1] ?? "").matchAll(/<rect [^>]*>/g)].map((m) => parseRect(m[0])),
    outline,
  };
}

const area = (r: Rect) => r.width * r.height;

describe("safe-zone overlay files", () => {
  it("has one committed SVG per preset except none", () => {
    expect(OVERLAY_PRESETS).not.toContain("none");
    expect(readdirSync(OVERLAYS_DIR).sort()).toEqual(OVERLAY_PRESETS.map(overlayFileName).sort());
  });

  it.each(OVERLAY_PRESETS)("committed overlays/%s.svg is up to date (run `pnpm build` to regenerate)", (preset) => {
    expect(readFileSync(join(OVERLAYS_DIR, overlayFileName(preset)), "utf8")).toBe(renderOverlayFile(preset));
  });

  it.each(OVERLAY_PRESETS)("overlays/%s.svg is 1080×1920", (preset) => {
    const { root } = parseOverlay(readFileSync(join(OVERLAYS_DIR, overlayFileName(preset)), "utf8"));
    expect(attribute(root, "width")).toBe("1080");
    expect(attribute(root, "height")).toBe("1920");
    expect(attribute(root, "viewBox")).toBe("0 0 1080 1920");
  });
});

describe("renderSafeZoneOverlaySvg", () => {
  it.each(presets)("%s shades exactly the insets from safeZoneInsetsPx", (preset) => {
    const { width, height } = canvas;
    const px = safeZoneInsetsPx(safeZones[preset], width, height);
    const middle = height - px.top - px.bottom;
    const { shaded } = parseOverlay(renderSafeZoneOverlaySvg(preset));
    expect(shaded).toEqual([
      { x: 0, y: 0, width, height: px.top },
      { x: 0, y: height - px.bottom, width, height: px.bottom },
      { x: 0, y: px.top, width: px.left, height: middle },
      { x: width - px.right, y: px.top, width: px.right, height: middle },
    ]);
  });

  it.each(presets)("%s outlines the safe area from just outside it", (preset) => {
    const { safe } = safeZoneRegions(safeZones[preset], canvas.width, canvas.height);
    const { outline } = parseOverlay(renderSafeZoneOverlaySvg(preset));
    const half = safeZoneOverlayStyle.outlineWidth / 2;
    expect(parseRect(outline)).toEqual({
      x: safe.x - half,
      y: safe.y - half,
      width: safe.width + 2 * half,
      height: safe.height + 2 * half,
    });
    expect(attribute(outline, "fill")).toBe("none");
    expect(attribute(outline, "stroke-dasharray")).toBe("24 16");
  });

  it.each(presets)("%s uses integer pixels", (preset) => {
    const svg = renderSafeZoneOverlaySvg(preset);
    for (const [, value] of svg.matchAll(/\s(?:x|y|width|height)="([^"]*)"/g)) expect(value).toMatch(/^-?\d+$/);
  });

  it("names the preset in a title and has no text that needs a font", () => {
    expect(renderSafeZoneOverlaySvg("tiktok")).toContain("<title>Safe zones: TikTok</title>");
    expect(renderSafeZoneOverlaySvg("instagram-reels")).toContain("<title>Safe zones: Instagram Reels</title>");
    expect(renderSafeZoneOverlaySvg("youtube-shorts")).toContain("<title>Safe zones: YouTube Shorts</title>");
    expect(renderSafeZoneOverlaySvg("tiktok-reels-shorts")).toContain(
      "<title>Safe zones: TikTok, Reels and Shorts</title>",
    );
    for (const preset of presets) expect(renderSafeZoneOverlaySvg(preset)).not.toMatch(/<text\b/);
  });

  it("takes its colors from the palette", () => {
    const { group, outline } = parseOverlay(renderSafeZoneOverlaySvg("tiktok"));
    expect(attribute(group, "fill")).toBe(palette.neutral[950]);
    expect(Number(attribute(group, "fill-opacity"))).toBeGreaterThan(0);
    expect(Number(attribute(group, "fill-opacity"))).toBeLessThan(1);
    expect(attribute(outline, "stroke")).toBe(palette.accent[400]);
  });

  it("renders other canvas sizes", () => {
    const { root, shaded } = parseOverlay(renderSafeZoneOverlaySvg("tiktok", 720, 1280));
    expect(attribute(root, "viewBox")).toBe("0 0 720 1280");
    expect(shaded[0]).toEqual({ x: 0, y: 0, width: 720, height: 102 });
  });
});

describe("safeZoneRegions", () => {
  it.each(presets)("%s regions tile the canvas without overlapping", (preset) => {
    const regions = safeZoneRegions(safeZones[preset], canvas.width, canvas.height);
    const total = Object.values(regions).reduce((sum, r) => sum + area(r), 0);
    expect(total).toBe(canvas.width * canvas.height);
    expect(regions.left.x + regions.left.width).toBe(regions.safe.x);
    expect(regions.safe.x + regions.safe.width).toBe(regions.right.x);
    expect(regions.top.height).toBe(regions.safe.y);
    expect(regions.safe.y + regions.safe.height).toBe(regions.bottom.y);
  });
});
