# @stackreel/fixtures

One set of JSON test cases shared by every engine. The TypeScript tests, the iOS (Swift) tests and the Android
(Kotlin) tests all read these same files, so a feature is done only when every engine passes them.

Everything here except the package's own code is **generated** by
[`@stackreel/core`](../packages/core/README.md), the source of truth. **Never edit a fixture by hand.** Change the
code or the [example templates](../templates/examples/) and regenerate.

## Layout

```text
fixtures/
├── manifest.json                          # every case, its paths and SHA-256s: start here
├── assets.json                            # facts about each fake media file, per case
├── templates/<id>.json                    # a copy of templates/examples/<id>.json
├── projects/<id>.project.json             # a Project with a fake file bound to every media slot
└── render-plans/<id>.renderplan.json      # resolve(project, options): the expected RenderPlan
```

There is one case per built-in template (10 today). The formats are documented in:

- Templates: [`@stackreel/template-schema`](../packages/template-schema/README.md), with the JSON Schema at
  [`stackreel-template.v1.json`](../packages/template-schema/schema/stackreel-template.v1.json)
- Projects and RenderPlan v1: [`@stackreel/core`](../packages/core/README.md#renderplan-format-v1)

### `manifest.json`

```json
{
  "manifestVersion": 1,
  "schemaVersion": 1,
  "projectSchemaVersion": 1,
  "renderPlanVersion": 1,
  "generatedBy": "pnpm --filter @stackreel/fixtures generate",
  "assets": { "path": "assets.json", "sha256": "…" },
  "cases": [
    {
      "id": "hook-and-reveal",
      "schemaVersion": 1,
      "projectSchemaVersion": 1,
      "renderPlanVersion": 1,
      "template": { "path": "templates/hook-and-reveal.json", "sha256": "…" },
      "project": { "path": "projects/hook-and-reveal.project.json", "sha256": "…" },
      "renderPlan": { "path": "render-plans/hook-and-reveal.renderplan.json", "sha256": "…" },
      "resolveOptions": { "shortClipPolicy": "freeze" }
    }
  ]
}
```

- Paths are relative to `fixtures/`. Cases are sorted by `id`.
- `sha256` is the lowercase hex SHA-256 of the file's exact bytes.
- `schemaVersion` is the template format version, `projectSchemaVersion` the project file version and
  `renderPlanVersion` the RenderPlan version. A runner should fail, not skip, on a version it doesn't support.

### Fake media

No real media is involved yet. Every media slot, optional ones included, is bound to `fixture://<slot-id>.mp4`
(`.jpg` for image slots, `.m4a` for audio slots), trimmed to the whole file. `assets.json` maps each case id to the
facts `resolve()` gets as `options.assets`:

```json
{ "hook-and-reveal": { "fixture://clip1.mp4": { "durationUs": 120000000, "height": 1080, "width": 1920 } } }
```

Slot `i` of a template (counting every slot, text slots too) gets a 16:9 (1920×1080), 4:3 (1440×1080) or 9:16
(1080×1920) source, in that order. Video clips are 120 s long, except every third slot's (`i % 3 == 2`), which is
400 ms: shorter than its slot, so the short-clip policy runs and the plan carries a `clip-too-short` warning. Audio
files are 90 s long. A URI is only unique within its case, so always look facts up under the case id.

## Writing a runner (Swift, Kotlin)

Copy or reference `fixtures/` from the repository, then:

1. Read `manifest.json`. Check `manifestVersion` and each case's `schemaVersion`, `projectSchemaVersion` and
   `renderPlanVersion` against what the engine supports.
2. For each file you load, check its SHA-256 against the manifest. A mismatch means a stale or edited copy: fail
   and ask for a fresh copy of `fixtures/`.
3. Assert, per case:
   - **Template and project decoding.** Decode `templates/<id>.json` and `projects/<id>.project.json` with the
     engine's generated models, and decode `render-plans/<id>.renderplan.json` as a `RenderPlan`.
   - **RenderPlan equality.** Decoding then re-encoding the plan gives an equal value: compare decoded values, not
     text. Integers (every `…Us` time, sizes, indices) must match exactly. Floats (transform matrices, placement,
     rates) are written by JavaScript as the shortest decimal that round-trips a 64-bit double, so parsing them as
     `Double` gives the exact value; compare with a tolerance of `1e-9` only if an engine does its own math on them.
   - Once an engine has its own resolver, or computes anything from the plan, the same inputs (`project` plus
     `assets.json[id]` plus `resolveOptions`) must give the same plan.
   - **Golden frames** (later): frames sampled from the engine's export of each case are compared with reference
     PNGs by SSIM. The references and real media clips will be added here when the engines exist.
4. Report failures by case `id`.

Key order in these files carries no meaning (keys are sorted only to keep the bytes stable), so decoders must not
depend on it.

## Regenerating

```bash
pnpm build
pnpm --filter @stackreel/fixtures generate
```

`generate` (`tsx scripts/generate.ts`) needs `@stackreel/core` and `@stackreel/template-schema` built, hence
`pnpm build` first. It rewrites every file and removes generated files whose case no longer exists. Commit the result
in the same change as the code that caused it.

The output is byte-stable: keys sorted at every level, 2-space indent, a trailing newline, laid out by the repo's
Prettier config (so `pnpm format:check` passes), and no timestamps. Running `generate` twice changes nothing.

`pnpm test` regenerates everything in memory and fails if any committed file differs, if one is missing or left
over, or if a hash in the manifest is wrong, so CI catches stale fixtures. It also checks that each project loads,
resolves back to its committed plan, and passes `checkPlanInvariants`.

## Scripts

| Script           | What it does                                       |
| ---------------- | -------------------------------------------------- |
| `pnpm generate`  | Rewrite every fixture file                         |
| `pnpm test`      | Check the committed fixtures are current and sound |
| `pnpm typecheck` | `tsc --noEmit`                                     |
| `pnpm lint`      | ESLint with no warnings allowed                    |

See **Testing strategy** in the [root README](../README.md#testing-strategy).
