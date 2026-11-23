import { safeZoneRegions, safeZones } from "@stackreel/ui";
import type { Rect } from "@stackreel/ui";
import type { MobileTemplate } from "./template-editor";

type Size = Pick<Rect, "width" | "height">;

export type SafeZoneGuide = { covered: readonly Rect[]; safe: Rect | null };

export function getTemplateSafeZoneGuide({
  canvas: { width, height },
  safeZones: zones,
}: MobileTemplate): SafeZoneGuide | null {
  if (!zones) return null;

  const insets = zones.insets ?? safeZones[zones.preset];
  const { safe, ...covered } = safeZoneRegions(insets, width, height);
  if (insets.top + insets.bottom >= 1 || insets.left + insets.right >= 1 || safe.width <= 0 || safe.height <= 0) {
    return { covered: [{ x: 0, y: 0, width, height }], safe: null };
  }

  const bands = Object.values(covered).filter((region) => region.width > 0 && region.height > 0);
  return bands.length > 0 ? { covered: bands, safe } : null;
}

export function fitPreviewCanvas(canvas: Size, viewport: Size): Rect {
  const scale = Math.min(viewport.width / canvas.width, viewport.height / canvas.height);
  const width = canvas.width * scale;
  const height = canvas.height * scale;
  return { x: (viewport.width - width) / 2, y: (viewport.height - height) / 2, width, height };
}
