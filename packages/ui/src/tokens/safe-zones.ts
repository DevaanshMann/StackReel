/** Fractions of the canvas edge (0–1) covered by platform UI on each side. */
export interface SafeZoneInsets {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * Areas covered by each platform's UI on a 9:16 video. Values are approximate, from public creator guidance,
 * and need checking on real devices. Each one rounds up, so text inside the safe area stays visible.
 */
const tiktok = { top: 0.08, bottom: 0.2, left: 0.06, right: 0.13 } as const;
const instagramReels = { top: 0.1, bottom: 0.22, left: 0.05, right: 0.11 } as const;
const youtubeShorts = { top: 0.07, bottom: 0.2, left: 0.05, right: 0.15 } as const;

function union(...insets: SafeZoneInsets[]): SafeZoneInsets {
  return {
    top: Math.max(...insets.map((i) => i.top)),
    bottom: Math.max(...insets.map((i) => i.bottom)),
    left: Math.max(...insets.map((i) => i.left)),
    right: Math.max(...insets.map((i) => i.right)),
  };
}

/**
 * Keyed by the template schema's `safeZones.preset` values. `tiktok-reels-shorts` is safe on all three platforms.
 * A test fails if these keys drift from the schema's enum.
 */
export const safeZones = {
  none: { top: 0, bottom: 0, left: 0, right: 0 },
  "tiktok-reels-shorts": union(tiktok, instagramReels, youtubeShorts),
  tiktok,
  "instagram-reels": instagramReels,
  "youtube-shorts": youtubeShorts,
} as const satisfies Record<string, SafeZoneInsets>;

export type SafeZonePresetName = keyof typeof safeZones;

/** Converts normalized insets to pixels for a canvas size. */
export function safeZoneInsetsPx(insets: SafeZoneInsets, width: number, height: number): SafeZoneInsets {
  return {
    top: Math.round(insets.top * height),
    bottom: Math.round(insets.bottom * height),
    left: Math.round(insets.left * width),
    right: Math.round(insets.right * width),
  };
}
