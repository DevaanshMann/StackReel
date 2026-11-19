# ADR 0003 — Place overlays with normalized coordinates and anchors

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

Text and stickers need consistent placement when the canvas changes resolution. The final bounds of a text block
depend on its content and layout. A fixed top-left placement would move the visual center as an editable title
grows, and fixed pixel offsets would need to be recalculated for each canvas size.

## Decision

Store the overlay's canvas position as `x` and `y` in the inclusive range 0–1. The canvas origin is top-left,
with x increasing rightward and y increasing downward. Convert to render-plan pixels with
`xPx = x * canvas.width` and `yPx = y * canvas.height`.

The anchor identifies the point in the laid-out overlay that lands at those canvas coordinates. Left, center,
and right correspond to local x fractions 0, 0.5, and 1. Top, center, and bottom correspond to the same
fractions along local y. The anchor is also the rotation pivot. Engines move the local anchor to the origin,
apply clockwise-positive rotation, then translate to the canvas position.

The default is a center anchor at `(0.5, 0.5)` with zero rotation. On a 1080×1920 canvas,
`{ "anchor": "bottom", "x": 0.5, "y": 0.8 }` places the overlay's bottom midpoint at `(540, 1536)` pixels,
including after its text is edited.

## Consequences

- The plan carries the anchor, its canvas pixel position, and the rotation. The engine computes the local anchor
  after laying out the overlay. See [`placementMatrix()`](../../packages/core/src/transform.ts).
- Sticker width is a fraction of canvas width, with height derived from the image's aspect ratio. Text size and
  style distances are in output pixels, so a template that changes canvas size may need to adjust typography
  to preserve its proportions.
- Placement is relative to the full canvas. Safe-zone presets and custom insets guide editing. The renderer
  clips any content that extends beyond the canvas.
- Project media crops use a separate coordinate space relative to the source. Core resolves them to source
  pixels before applying canvas fit. See the [render-plan contract](../../packages/core/README.md#layers) and
  [v1 field reference](../template-format.md#overlay-position).
