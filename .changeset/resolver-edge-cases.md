---
"@stackreel/core": patch
---

Fix `resolve()` and `fitClip()` edge cases: empty source ranges for one-frame clips below half speed, off-frame music starts, NaN transforms from crops under a pixel or from asset sizes under 1 px or above `Number.MAX_SAFE_INTEGER` (now treated as missing), and a `RangeError` on very long but valid times (now clamped to the frame math's limit, about 217 days at 240 fps). `cropRect` now keeps crops at least 1 source px a side and inside the source, and `checkPlanInvariants` now reports non-finite transforms.
