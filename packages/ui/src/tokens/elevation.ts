export interface Shadow {
  /** Vertical offset in points. */
  readonly offsetY: number;
  /** Blur radius in points. */
  readonly blur: number;
  /** Opacity of black, from 0 to 1. */
  readonly opacity: number;
  /** Android `elevation`. */
  readonly androidElevation: number;
}

/**
 * Shadow levels. Shadows barely show on the dark theme, so pair each level with the `elevated` color
 * rather than relying on the shadow alone.
 */
export const elevation = {
  0: { offsetY: 0, blur: 0, opacity: 0, androidElevation: 0 },
  1: { offsetY: 1, blur: 3, opacity: 0.24, androidElevation: 2 },
  2: { offsetY: 4, blur: 12, opacity: 0.32, androidElevation: 6 },
  3: { offsetY: 12, blur: 32, opacity: 0.4, androidElevation: 12 },
} as const satisfies Record<number, Shadow>;

export type Elevation = keyof typeof elevation;

/** Stacking order, lowest first. */
export const zIndex = {
  base: 0,
  canvasOverlay: 10,
  sticky: 100,
  dropdown: 200,
  sheet: 300,
  modal: 400,
  toast: 500,
  tooltip: 600,
} as const;

export type ZIndex = keyof typeof zIndex;
