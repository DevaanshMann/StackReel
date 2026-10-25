/** The smallest tap target, in points (Apple HIG and WCAG 2.5.5). */
export const MIN_HIT_TARGET = 44;

/** The default canvas: 9:16 at 1080×1920. */
export const canvas = {
  width: 1080,
  height: 1920,
  aspectRatio: 9 / 16,
} as const;

export const layout = { minHitTarget: MIN_HIT_TARGET, canvas } as const;
