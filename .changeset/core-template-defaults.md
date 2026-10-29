---
"@stackreel/core": patch
---

`PLAN_DEFAULTS` now takes its template field values from `TEMPLATE_DEFAULTS` in `@stackreel/template-schema` instead of keeping its own copy. Its values and the render plans `resolve()` returns are unchanged.
