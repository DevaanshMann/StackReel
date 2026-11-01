---
"@stackreel/core": minor
---

`resolve()` now reads each slot's `shortClipPolicy` and `minSpeed`, so one template can freeze one slot and loop another. A slot's `minSpeed` only counts when that slot's policy is `slow`. Audio slots, the music slot included, use their own slot's policy, and `slow` still acts as `freeze` for audio. The `shortClipPolicy` and `minSpeed` options still work and now override every slot's fields. `SHORT_CLIP_POLICIES`, `DEFAULT_SHORT_CLIP_POLICY` and `DEFAULT_MIN_SPEED` keep their values and now come from `@stackreel/template-schema`. Templates that use none of the new fields resolve to the same plans as before.
