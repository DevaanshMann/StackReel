/** Inter is the UI font. Template fonts (Montserrat, Bebas Neue, Poppins) belong to templates, not the UI. */
export const fontFamily = {
  ui: "Inter",
  mono: "JetBrains Mono",
} as const;

/** CSS fallback stacks for the web and desktop apps. */
export const fontStack = {
  ui: `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  mono: `"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
} as const;

/** Font sizes in points (px on the web). */
export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/** Unitless multipliers. React Native needs absolute values, so multiply by the font size there. */
export const lineHeight = {
  tight: 1.2,
  snug: 1.35,
  normal: 1.5,
} as const;

export type FontSize = keyof typeof fontSize;
export type FontWeight = keyof typeof fontWeight;
export type LineHeight = keyof typeof lineHeight;
