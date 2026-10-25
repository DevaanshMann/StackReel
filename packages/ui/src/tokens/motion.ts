/** A cubic Bézier curve as `[x1, y1, x2, y2]`, the same values as CSS `cubic-bezier()`. */
export type CubicBezier = readonly [number, number, number, number];

/** Durations in milliseconds. */
export const duration = {
  instant: 0,
  fast: 120,
  normal: 200,
  slow: 320,
} as const;

export const easing = {
  /** Most UI transitions. */
  standard: [0.2, 0, 0, 1],
  /** Things entering the screen. */
  decelerate: [0, 0, 0, 1],
  /** Things leaving the screen. */
  accelerate: [0.3, 0, 1, 1],
  linear: [0, 0, 1, 1],
} as const satisfies Record<string, CubicBezier>;

export type Duration = keyof typeof duration;
export type Easing = keyof typeof easing;

export interface Motion {
  readonly duration: Readonly<Record<Duration, number>>;
  readonly easing: Readonly<Record<Easing, CubicBezier>>;
}

export const motion = { duration, easing } as const satisfies Motion;

/** Used when the OS asks for reduced motion: UI changes happen at once, with no movement. */
export const reducedMotion = {
  duration: { instant: 0, fast: 0, normal: 0, slow: 0 },
  easing: { standard: easing.linear, decelerate: easing.linear, accelerate: easing.linear, linear: easing.linear },
} as const satisfies Motion;

/** Picks the motion tokens for the user's reduced-motion setting. */
export function motionFor(prefersReducedMotion: boolean): Motion {
  return prefersReducedMotion ? reducedMotion : motion;
}
