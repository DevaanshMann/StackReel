---
"@stackreel/template-schema": minor
---

Add music ducking settings to the template format: `audio.music.duckGainDb` (-30 to 0 dB, default -12) and `audio.music.duckRampUs` (default 200 ms), both in `TEMPLATE_DEFAULTS` and the JSON Schema. Media items get an optional `voice` flag that marks clips with speech; when any item sets it, music ducks only under those clips. `validate()` rejects `voice: true` on an item for an image slot. The new fields are optional, so existing templates stay valid and `schemaVersion` stays at 1.
