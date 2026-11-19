# ADR 0002 — Use integer microseconds for time

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

StackReel shares templates, projects, and render plans across platforms. The same cut must mean the same time
when a template is saved, loaded, or rendered at a different frame rate. Floating-point seconds can put
equivalent boundaries on either side of a comparison. Frame indices at the authored frame rate would tie the
template timeline to that rate.

## Decision

Store timestamps and durations as integer microseconds and use the `Us` suffix. One second is `1000000` µs.
A template item starts at `startUs` relative to template time zero and covers the half-open range
`[startUs, startUs + durationUs)`. Items that meet at a boundary share no time.

Keep template timings in microseconds and snap output timeline boundaries when building the render plan.
Core uses the nearest canvas frame start and picks the later frame on a tie. Compute each frame start from its
index and frame rate, rounding to the nearest microsecond with ties up. At 30 fps the first four frame starts
are `0`, `33333`, `66667`, and `100000` µs. Each start is independent of the previous frame's rounded duration.

## Consequences

- Adjacent intervals use the same boundary after snapping. An item shorter than a frame can snap to an empty
  interval and produce no layer.
- Resolved layer boundaries use the output frame grid. Source timestamps are measured from the original asset's
  start. Core fits the source range inside the user's trim, and engines use that range and the plan's playback
  rate to map timeline time to source time.
- Media3 can consume microseconds directly. On iOS, convert an integer timestamp to
  `CMTime(value: timeUs, timescale: 1_000_000)` at the native boundary.
- JavaScript readers keep serialized times within the safe integer range and core applies stricter arithmetic
  bounds when calculating a plan. See the [time helpers](../../packages/core/src/time.ts) and
  [v1 field reference](../template-format.md#reading-a-template).
