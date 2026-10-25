---
"@stackreel/core": patch
---

Fix `resolve()` edge cases: empty source ranges for one-frame clips below half speed, off-frame music starts, NaN transforms from crops under a pixel, and a `RangeError` on very long but valid times (now clamped to the new `maxTimeUs(fps)`)
