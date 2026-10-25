import type { HexColor } from "./tokens/color.js";

/** Parses `#RGB` or `#RRGGBB` into 0–255 channels. */
export function parseHex(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Expected a #RGB or #RRGGBB color, got "${hex}"`);
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join("") : match[1];
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.x relative luminance, from 0 (black) to 1 (white). */
export function relativeLuminance(hex: HexColor | string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two colors, from 1 to 21. Order doesn't matter. */
export function contrastRatio(a: HexColor | string, b: HexColor | string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA minimums: 4.5:1 for body text, 3:1 for large text and UI components. */
export const WCAG_AA = { bodyText: 4.5, largeText: 3, ui: 3 } as const;
