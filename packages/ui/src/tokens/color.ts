/** A `#RRGGBB` color. */
export type HexColor = `#${string}`;

type Scale = Readonly<Record<string, HexColor>>;

/** Cool gray used for backgrounds, surfaces, borders and text. */
export const neutral = {
  0: "#FFFFFF",
  50: "#F7F7F8",
  100: "#EEEEF1",
  200: "#DCDCE2",
  300: "#BDBDC7",
  400: "#9A9AA8",
  500: "#787887",
  600: "#5C5C6A",
  700: "#42424D",
  800: "#2B2B33",
  900: "#1C1C22",
  950: "#111115",
} as const satisfies Scale;

/** The brand accent, a warm pink-red. */
export const accent = {
  50: "#FFF0F5",
  100: "#FFE0EC",
  200: "#FFC2D9",
  300: "#FF94BC",
  400: "#FF5C99",
  500: "#F2337A",
  600: "#D61A63",
  700: "#B0104F",
  800: "#8A0D3F",
  900: "#660A2F",
  950: "#3D0519",
} as const satisfies Scale;

export const red = { 300: "#FF9B95", 400: "#FF6B63", 600: "#D92D20", 700: "#B42318" } as const satisfies Scale;
export const green = { 300: "#7EE2B0", 400: "#3DD68C", 600: "#13824A", 700: "#0E6B3C" } as const satisfies Scale;
export const amber = { 300: "#FFD979", 400: "#FFC53D", 600: "#B25E00", 700: "#934D00" } as const satisfies Scale;

export const palette = { neutral, accent, red, green, amber } as const;

export const SEMANTIC_COLOR_ROLES = [
  "bg",
  "surface",
  "elevated",
  "text",
  "textMuted",
  "border",
  "accent",
  "onAccent",
  "danger",
  "success",
  "warning",
] as const;

/**
 * - `bg`: the app background behind everything.
 * - `surface`: panels, sheets and the timeline.
 * - `elevated`: menus, popovers and cards above a surface.
 * - `text` / `textMuted`: body text and secondary text.
 * - `border`: dividers and outlines.
 * - `accent`: primary actions, selection and focus.
 * - `onAccent`: text and icons drawn on an `accent` fill.
 * - `danger` / `success` / `warning`: status colors.
 */
export type SemanticColorRole = (typeof SEMANTIC_COLOR_ROLES)[number];
export type SemanticColors = Readonly<Record<SemanticColorRole, HexColor>>;

export const THEME_NAMES = ["dark", "light"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** The editor is dark-first, so this is the default. */
export const DEFAULT_THEME: ThemeName = "dark";

export const darkColors = {
  bg: neutral[950],
  surface: neutral[900],
  elevated: neutral[800],
  text: neutral[50],
  textMuted: neutral[400],
  border: neutral[700],
  accent: accent[400],
  onAccent: neutral[950],
  danger: red[400],
  success: green[400],
  warning: amber[400],
} as const satisfies SemanticColors;

export const lightColors = {
  bg: neutral[0],
  surface: neutral[50],
  elevated: neutral[0],
  text: neutral[950],
  textMuted: neutral[600],
  border: neutral[200],
  accent: accent[600],
  onAccent: neutral[0],
  danger: red[600],
  success: green[600],
  warning: amber[700],
} as const satisfies SemanticColors;

export const themes = { dark: darkColors, light: lightColors } as const satisfies Record<ThemeName, SemanticColors>;
