import { palette } from "./tokens/color.js";
import { canvas } from "./tokens/layout.js";
import { safeZoneInsetsPx, safeZones, type SafeZoneInsets, type SafeZonePresetName } from "./tokens/safe-zones.js";

/** A rectangle in canvas pixels. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The covered bands around the safe area. They don't overlap, and with `safe` they fill the canvas. */
export interface SafeZoneRegions {
  readonly top: Rect;
  readonly bottom: Rect;
  readonly left: Rect;
  readonly right: Rect;
  readonly safe: Rect;
}

/** Splits a canvas into covered bands and the safe area. Top and bottom span the full width. */
export function safeZoneRegions(insets: SafeZoneInsets, width: number, height: number): SafeZoneRegions {
  const px = safeZoneInsetsPx(insets, width, height);
  const middle = height - px.top - px.bottom;
  return {
    top: { x: 0, y: 0, width, height: px.top },
    bottom: { x: 0, y: height - px.bottom, width, height: px.bottom },
    left: { x: 0, y: px.top, width: px.left, height: middle },
    right: { x: width - px.right, y: px.top, width: px.right, height: middle },
    safe: { x: px.left, y: px.top, width: width - px.left - px.right, height: middle },
  };
}

const presetLabels = {
  none: "None",
  "tiktok-reels-shorts": "TikTok, Reels and Shorts",
  tiktok: "TikTok",
  "instagram-reels": "Instagram Reels",
  "youtube-shorts": "YouTube Shorts",
} as const satisfies Record<SafeZonePresetName, string>;

/** Overlay colors from the palette, with the outline's width and dash pattern in pixels. */
export const safeZoneOverlayStyle = {
  shade: palette.neutral[950],
  shadeOpacity: 0.6,
  outline: palette.accent[400],
  outlineWidth: 4,
  outlineDash: [24, 16],
} as const;

const rect = ({ x, y, width, height }: Rect, attributes = "") =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}"${attributes} />`;

/**
 * Renders a preset's safe-zone overlay as an SVG: covered areas shaded, the safe area outlined with a dashed line
 * drawn just outside it. Defaults to the 1080×1920 canvas. Has no text, so it doesn't depend on fonts.
 */
export function renderSafeZoneOverlaySvg(
  preset: SafeZonePresetName,
  width: number = canvas.width,
  height: number = canvas.height,
): string {
  const { safe, ...covered } = safeZoneRegions(safeZones[preset], width, height);
  const { shade, shadeOpacity, outline, outlineWidth, outlineDash } = safeZoneOverlayStyle;
  const half = outlineWidth / 2;
  const outlineRect = {
    x: safe.x - half,
    y: safe.y - half,
    width: safe.width + outlineWidth,
    height: safe.height + outlineWidth,
  };
  const dash = outlineDash.join(" ");
  const stroke = ` fill="none" stroke="${outline}" stroke-width="${outlineWidth}" stroke-dasharray="${dash}"`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <title>Safe zones: ${presetLabels[preset]}</title>`,
    `  <desc>Shaded areas are covered by platform UI (approximate). Keep text and faces inside the dashed line.</desc>`,
    `  <g fill="${shade}" fill-opacity="${shadeOpacity}">`,
    ...Object.values(covered).map((region) => `    ${rect(region)}`),
    "  </g>",
    `  ${rect(outlineRect, stroke)}`,
    "</svg>",
    "",
  ].join("\n");
}
