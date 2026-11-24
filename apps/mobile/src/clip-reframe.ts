import type { Crop, Size } from "@stackreel/core";

export type ClipReframe = { zoom: number; x: number; y: number };
export const defaultClipReframe: Readonly<ClipReframe> = Object.freeze({ zoom: 1, x: 0.5, y: 0.5 });
export const maxClipReframeZoom = 3;

export function isValidSize({ width, height }: Size): boolean {
  return [width, height].every(
    (dimension) => Number.isFinite(dimension) && dimension >= 1 && dimension <= Number.MAX_SAFE_INTEGER,
  );
}

/** The visible part of the oriented source. Zoom is relative to cover and x/y are fractions of the available travel. */
export function getClipCrop(clip: Size, canvas: Size, { zoom, x, y }: ClipReframe = defaultClipReframe): Crop {
  if (!isValidSize(clip) || !isValidSize(canvas)) throw new RangeError("Invalid video or canvas dimensions.");
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > maxClipReframeZoom) {
    throw new RangeError(`Reframe zoom must be between 1 and ${maxClipReframeZoom}.`);
  }
  if (![x, y].every((position) => Number.isFinite(position) && position >= 0 && position <= 1)) {
    throw new RangeError("Reframe positions must be between 0 and 1.");
  }

  const scaleX = canvas.width / clip.width;
  const scaleY = canvas.height / clip.height;
  const coverScale = Math.max(scaleX, scaleY);
  const width = scaleX / coverScale / zoom;
  const height = scaleY / coverScale / zoom;
  return { x: x === 0 ? 0 : (1 - width) * x, y: y === 0 ? 0 : (1 - height) * y, width, height };
}

export function sameCrop(a: Crop, b: Crop): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Omit centered cover and center any axis that has no room to pan. */
export function normalizeClipReframe(size: Size, canvas: Size, reframe: ClipReframe): ClipReframe | undefined {
  const crop = getClipCrop(size, canvas, reframe);
  if (sameCrop(crop, getClipCrop(size, canvas))) return undefined;
  return {
    zoom: reframe.zoom,
    x: crop.width === 1 ? defaultClipReframe.x : reframe.x,
    y: crop.height === 1 ? defaultClipReframe.y : reframe.y,
  };
}
