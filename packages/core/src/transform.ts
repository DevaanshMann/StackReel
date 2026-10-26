import type { Anchor, FitMode } from "@stackreel/template-schema";
import type { Crop } from "./project.js";

/**
 * A 2D affine transform as a row-major 3×3 matrix `[a, b, c, d, e, f, 0, 0, 1]`. It maps a point `(x, y)` in pixels
 * to `(a*x + b*y + c, d*x + e*y + f)`. Pixel coordinates have the origin at the top-left corner and y pointing down.
 */
export type Matrix3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** A rectangle in pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** `-0` becomes `0`, so plans compare and serialize the same everywhere. */
const clean = (n: number): number => (n === 0 ? 0 : n);

/** `a × b`: applying the result is the same as applying `b`, then `a`. */
export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[row * 3 + k]! * b[k * 3 + col]!;
      out[row * 3 + col] = clean(sum);
    }
  }
  return out as Matrix3;
}

export function translation(x: number, y: number): Matrix3 {
  return [1, 0, clean(x), 0, 1, clean(y), 0, 0, 1];
}

export function scaling(x: number, y: number): Matrix3 {
  return [clean(x), 0, 0, 0, clean(y), 0, 0, 0, 1];
}

/** Rotates around the origin. Positive degrees turn clockwise on screen, because y points down. */
export function rotation(degrees: number): Matrix3 {
  const radians = (degrees * Math.PI) / 180;
  // Exact values for quarter turns, so 90° doesn't leave 6e-17 in the matrix.
  const quarter = degrees / 90;
  const [cos, sin] = Number.isInteger(quarter)
    ? ([
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ][((quarter % 4) + 4) % 4] as [number, number])
    : [Math.cos(radians), Math.sin(radians)];
  return [clean(cos), clean(-sin), 0, clean(sin), clean(cos), 0, 0, 0, 1];
}

export function transformPoint(m: Matrix3, x: number, y: number): [number, number] {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
}

/** The part of the source to show, in pixels: the whole frame, or the crop kept inside it and at least 1 px a side. */
export function cropRect(source: Size, crop?: Crop): Rect {
  if (!crop) return { x: 0, y: 0, width: source.width, height: source.height };
  const width = Math.min(Math.max(crop.width * source.width, 1), source.width);
  const height = Math.min(Math.max(crop.height * source.height, 1), source.height);
  return {
    x: Math.min(crop.x * source.width, source.width - width),
    y: Math.min(crop.y * source.height, source.height - height),
    width,
    height,
  };
}

/**
 * Maps source pixels onto the canvas so the crop rectangle fills it according to `fit`, centered:
 * - `cover`: scale evenly until the crop covers the whole canvas; the overflow is cut off
 * - `contain`: scale evenly until the whole crop fits; the canvas background shows in the bars
 * - `fill`: stretch each axis on its own so the crop matches the canvas exactly
 *
 * Engines draw only the crop rectangle of the source through this matrix, clipped to the canvas.
 */
export function fitMatrix(source: Size, canvas: Size, fit: FitMode, crop: Rect = cropRect(source)): Matrix3 {
  let sx = canvas.width / crop.width;
  let sy = canvas.height / crop.height;
  if (fit !== "fill") sx = sy = fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  const offsetX = (canvas.width - crop.width * sx) / 2;
  const offsetY = (canvas.height - crop.height * sy) / 2;
  return multiply(translation(offsetX, offsetY), multiply(scaling(sx, sy), translation(-crop.x, -crop.y)));
}

const ANCHOR_POINTS: Record<Anchor, [number, number]> = {
  "top-left": [0, 0],
  top: [0.5, 0],
  "top-right": [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  "bottom-left": [0, 1],
  bottom: [0.5, 1],
  "bottom-right": [1, 1],
};

/** Where an anchor sits inside an element, as fractions of its width and height. */
export function anchorPoint(anchor: Anchor): [number, number] {
  return ANCHOR_POINTS[anchor];
}

/** Where an overlay goes on the canvas. Engines combine it with the overlay's own size via `placementMatrix`. */
export interface Placement {
  /** Canvas position, in pixels, of the overlay's anchor point. */
  xPx: number;
  yPx: number;
  anchor: Anchor;
  /** Clockwise rotation around the anchor point. */
  rotationDeg: number;
}

/**
 * Maps an overlay's own pixels (a laid-out text block or a sticker image, `content` in size) onto the canvas: its
 * anchor point lands on `(xPx, yPx)` and it rotates around that point. Text and sticker sizes are only known once
 * an engine lays them out, so the plan carries the placement and engines build the matrix with this function.
 */
export function placementMatrix(content: Size, placement: Placement): Matrix3 {
  const [ax, ay] = anchorPoint(placement.anchor);
  return multiply(
    translation(placement.xPx, placement.yPx),
    multiply(rotation(placement.rotationDeg), translation(-ax * content.width, -ay * content.height)),
  );
}
