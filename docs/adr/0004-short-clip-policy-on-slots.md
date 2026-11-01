# ADR 0004: Put the short-clip policy on slots

- **Status:** Proposed
- **Date:** 2026-10-29

## Context

When a user's clip is shorter than the part of the template it fills, every engine has to do the same thing with the
gap. `@stackreel/core` already supports three policies: `freeze` (hold the last frame), `slow` (slow the clip down to
fill the gap, but never below a minimum speed, then hold) and `loop` (play it again from the start). Audio never slows
down, so for audio `slow` acts as `freeze` and goes silent after the end.

Until now the policy was only a `resolve()` option, set once for the whole project. The template format had no field
for it, so a template author couldn't say how their template should behave (issue #38).

The field could live in one of three places:

1. **On the template**, once for every slot.
2. **On each slot**, next to `minDurationUs`.
3. **On each media item**, next to `speed`.

## Decision

Put it on the slot. Video slots get an optional `shortClipPolicy` (`freeze`, `slow` or `loop`) and an optional
`minSpeed` (0.25 to 4, like `speed`), which only `slow` uses; with any other policy it's ignored. Audio slots get an
optional `shortClipPolicy` limited to `freeze` or `loop`, and no `minSpeed`. Both fields default to `freeze` and 0.25,
in `TEMPLATE_DEFAULTS` and as JSON Schema `default` keywords.

A slot describes the user's clip: it already says how long that clip should be (`minDurationUs`), so it's also the
place to say what happens when the clip is shorter.

Alternatives considered:

- **Template-wide** is too coarse. A montage can loop its B-roll while a talking-head slot in the same template must
  freeze: looping someone mid-sentence looks broken.
- **Per media item** lets one clip behave differently in each place the template uses it, for example looping in one
  item and freezing in the next. The user picks one clip per slot, so that would be confusing, and every item using
  the slot would have to repeat the setting.

`resolve()` keeps its `shortClipPolicy` and `minSpeed` options, which now override every slot's fields. The effective
policy for a slot is the option, then the slot's field, then `freeze`. `minSpeed` is the option, then the slot's field
if the slot's own policy is `slow`, then 0.25.

## Consequences

- `schemaVersion` stays at 1 and there's no migration step. The fields are optional, and leaving them out means
  `freeze` with a minimum speed of 0.25, which is what `resolve()` did before. Existing templates stay valid and
  resolve to the same plans.
- Engines must read the policy per slot. Audio slots, the music slot included, use their own slot's policy.
- `minSpeed` is ignored, not rejected, when the policy isn't `slow`. Swift and Kotlin codegen, and any tool that writes
  out every default, emit `minSpeed: 0.25` on every video slot, and those documents must stay valid. `duckGainDb` works
  the same way when the template doesn't duck.
- `ShortClipPolicy` is now exported by `@stackreel/template-schema`. Core's `SHORT_CLIP_POLICIES`,
  `DEFAULT_SHORT_CLIP_POLICY` and `DEFAULT_MIN_SPEED` keep their names and values, but come from the schema package.
- If a later version needs a per-item policy (for example a slot used twice with different needs), an item-level
  field can be added on top that overrides the slot's, without changing this one.
