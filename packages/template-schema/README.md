# @stackreel/template-schema

The **StackReel Template Format (SRT-JSON)** is the single contract shared by every platform.
A template or project is a JSON document. Each engine (iOS, Android, Web) must render the same
document to the same output.

This package contains:

- [`src/schema.ts`](src/schema.ts): the Zod schema, the source of truth
- [`schema/stackreel-template.v1.json`](schema/stackreel-template.v1.json): the generated JSON Schema (draft 2020-12), consumed by Swift and Kotlin code generators
- [`src/validate.ts`](src/validate.ts): `validate()`, with errors addressed by JSON Pointer
- [`src/migrate.ts`](src/migrate.ts): `migrate()`, which upgrades older `schemaVersion` documents
- [`fixtures/`](fixtures): golden fixtures shared with the native engines

An example document lives at [`templates/examples/hook-and-reveal.json`](../../templates/examples/hook-and-reveal.json).

## Usage

```ts
import { migrate, validate, type Template } from "@stackreel/template-schema";

const migrated = migrate(JSON.parse(text));
if (!migrated.ok) return showErrors(migrated.errors);

const result = validate(migrated.document);
if (!result.ok) return showErrors(result.errors);

const template: Template = result.template;
```

### `validate(json)`

Checks a parsed JSON value against the current format and returns one of:

```ts
{ ok: true, template: Template }
{ ok: false, errors: { path: string, message: string }[] }
```

`path` is a [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901), such as `/tracks/0/items/1/slot`. The empty string
`""` means the document itself. All problems are reported at once. `validate()` never adds defaults, so a valid document
comes back unchanged.

### `migrate(json)`

Upgrades a parsed document to the current `schemaVersion` by running one step per version (`MIGRATIONS[1]` upgrades
v1 to v2, and so on). It never mutates its input and doesn't validate its output, so call `validate()` next.

```ts
{ ok: true, document: unknown, fromVersion: number }
{ ok: false, errors: { path: "/schemaVersion", message: string }[] }
```

v1 is the only version, so for now `migrate()` returns v1 documents as they are. It rejects documents with no
`schemaVersion`, with one that never existed (`0`, `1.5`, `"1"`), or with one newer than this package supports.

### JSON Schema

`pnpm build` compiles `dist/` and regenerates `schema/stackreel-template.v1.json` with Zod's built-in
`z.toJSONSchema`. The file is committed, and a test fails if it's out of date. Shared types (`Canvas`, `Slot`,
`MediaItem`, …) are named entries in `$defs`, so generated code gets real type names. Consumers can also import it as
`@stackreel/template-schema/schema.json`, or call `templateJsonSchema()`.

The JSON Schema covers the shape of a document. The cross-field rules below can't be expressed in JSON Schema, so
engines that only use the JSON Schema must check them too.

## Rules

- `schemaVersion` is required and must be `1`.
- **Time** is integer microseconds (`*Us`): never a float, never negative. Item and template durations are greater
  than zero.
- **Positions** (`x`, `y`, safe-zone insets, `widthNorm`) are normalized from 0 to 1 relative to the canvas.
- **Colors** are `#RRGGBB` or `#RRGGBBAA`. **Ids** use letters, digits, `-` and `_`.
- Unknown fields are rejected, so typos don't pass silently.
- **Tracks** are ordered bottom to top:
  - `video` tracks hold media items for `video` or `image` slots. Items on one video track must not overlap. Back to
    back is fine, and transitions play across the cut.
  - `overlay` tracks hold `text` and `sticker` items, which may overlap.
  - `audio` tracks hold media items for `audio` slots.

Cross-field rules, checked by `validate()`:

- Slot ids are unique, and so are track ids.
- Every `slot` reference exists and has the right kind (media items as above, text items use `text` slots, music uses
  an `audio` slot).
- Every item ends within `durationUs` (`startUs + durationUs <= template.durationUs`).
- A `transitionIn` is no longer than its item.
- `text.default` fits in `text.maxChars`, counted in code points.
- `audio.music.startUs` is before the end of the template.
- Only clips with sound are marked as voice: `voice: true` isn't allowed on an item for an `image` slot.

### Defaults

The schema doesn't fill in defaults, so every engine must apply the same ones. They're exported as
`TEMPLATE_DEFAULTS`, and the JSON Schema carries each one as a `default` keyword on its field.

| Field                                               | Default                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `canvas.background`                                 | `#000000`                                                                       |
| `slot.optional`                                     | `false`                                                                         |
| `mediaItem.fit`                                     | `cover`                                                                         |
| `mediaItem.speed`                                   | `1`                                                                             |
| `mediaItem.gainDb`                                  | `0`                                                                             |
| `transition.direction`                              | `left`                                                                          |
| `textItem.style`                                    | `{ "font": "Inter-Bold", "sizePx": 64, "color": "#FFFFFF", "align": "center" }` |
| `style.align`                                       | `center`                                                                        |
| `textItem.position`, `stickerItem.position`         | `{ "anchor": "center", "x": 0.5, "y": 0.5, "rotationDeg": 0 }`                  |
| `position.rotationDeg`                              | `0`                                                                             |
| `animation.inDurationUs`, `animation.outDurationUs` | `300000` (300 ms)                                                               |
| `audio.music.startUs`                               | `0`                                                                             |
| `audio.music.gainDb`                                | `0`                                                                             |
| `audio.music.duckGainDb`                            | `-12`                                                                           |
| `audio.music.duckRampUs`                            | `200000` (200 ms)                                                               |
| `audio.duckMusicUnderVoice`                         | `false`                                                                         |

A text item with no `style` gets the whole default style; one with a `style` only fills in `align`. Positions work
the same way with `rotationDeg`. Animation durations apply to any `in` or `out` but `none`, which always lasts 0.

### Ducking

With `audio.duckMusicUnderVoice: true`, engines add `audio.music.duckGainDb` (-30 to 0 dB) to the music while voice
plays, with a ramp of `audio.music.duckRampUs` centered on each edge. Which clips count as voice:

- If any media item sets `voice: true`, only those items' clips. Unmarked clips never duck the music, even when the
  marked items' slots are empty.
- Otherwise every clip with sound: video clips and audio-track items. This is how templates made before `voice` existed
  behave.

Clips at -60 dB count as muted and never duck the music, marked or not. `voice` has no default: leaving it out
everywhere and setting it to `false` everywhere mean the same thing.

For now a voice clip ducks the music for its whole length. Phase 6 brings on-device speech detection, which will fill
in voice regions automatically so the music only ducks while someone is talking. Templates won't need to change for
it.

## Fixtures

- `fixtures/valid/*.json` must pass. `every-feature.json` uses every field at least once.
- `fixtures/invalid/*.json` each break exactly one rule. `fixtures/invalid/expected.json` maps each file to the JSON
  Pointer of the error it must produce, so native test suites can check the same cases.

## Scripts

| Script           | What it does                                      |
| ---------------- | ------------------------------------------------- |
| `pnpm build`     | Compile to `dist/` and regenerate the JSON Schema |
| `pnpm test`      | Run the tests with coverage (90% minimum)         |
| `pnpm typecheck` | `tsc --noEmit`                                    |
| `pnpm lint`      | ESLint with no warnings allowed                   |

See **Phase 1** in the [root README](../../README.md#phase-1-template-format--core-model).
