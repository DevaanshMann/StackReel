---
"@stackreel/template-schema": minor
---

Add `TEMPLATE_DEFAULTS`, the values every engine uses where a template leaves a field out: text style, position, animation in and out durations, canvas background, fit, speed, gain, transition direction, music start and the `optional` and `duckMusicUnderVoice` flags. The generated JSON Schema now carries them as `default` keywords for code generators, in place of the "Defaults to …" notes in field descriptions. Validation is unchanged.
