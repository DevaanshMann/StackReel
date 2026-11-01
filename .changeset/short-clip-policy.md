---
"@stackreel/template-schema": minor
---

Add a short-clip policy to slots. Video slots get an optional `shortClipPolicy` (`freeze`, `slow` or `loop`) and `minSpeed` (0.25 to 4), and audio slots an optional `shortClipPolicy` of `freeze` or `loop`. `TEMPLATE_DEFAULTS.slot` and the JSON Schema default them to `freeze` and 0.25, and the policy enum is exported as `ShortClipPolicy`. `minSpeed` is only used with `slow` and ignored with other policies, so documents that write out every default stay valid. The new fields are optional, so existing templates stay valid and `schemaVersion` stays at 1.
