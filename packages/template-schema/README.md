# @stackreel/template-schema

The **StackReel Template Format (SRT-JSON)** is the single contract shared by every platform.
A template or project is a JSON document. Each engine (iOS, Android, Web) must render the same
document to the same output.

This package will contain:

- `src/schema.ts`: the Zod schema (source of truth)
- `schema/stackreel-template.v1.json`: generated JSON Schema, consumed by Swift and Kotlin code generators
- `src/migrate.ts`: upgrades older `schemaVersion` documents
- Golden test fixtures shared with the native engines

Not set up yet. See **Phase 1** in the [root README](../../README.md#phase-1-template-format--core-model).
An example document lives at [`templates/examples/hook-and-reveal.json`](../../templates/examples/hook-and-reveal.json).
