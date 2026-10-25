/** Corner radii in points. `full` makes pills and circles. */
export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export type Radius = keyof typeof radius;
