---
"@stackreel/core": minor
---

`resolve()` now reads the ducking gain and ramp from the template's `audio.music.duckGainDb` and `audio.music.duckRampUs`, and when any media item is marked `voice: true` it ducks music only under those clips. The `duckGainDb` and `duckRampUs` options still take precedence over the template. Templates that use none of the new fields resolve to the same plans as before.
