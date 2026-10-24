import { CURRENT_SCHEMA_VERSION } from "./schema.js";
import type { ValidationError } from "./validate.js";

/** Upgrades a document from version N to N + 1. It may assume `doc.schemaVersion === N`. */
export type MigrationStep = (doc: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version a step upgrades from. Add `1: v1ToV2` here when v2 ships. */
export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {};

export type MigrateResult =
  { ok: true; document: unknown; fromVersion: number } | { ok: false; errors: ValidationError[] };

const fail = (message: string): MigrateResult => ({ ok: false, errors: [{ path: "/schemaVersion", message }] });

/** Builds a migrator for a step table. Exported so the pipeline can be tested with fake versions. */
export function createMigrator(steps: Readonly<Record<number, MigrationStep>>, currentVersion: number) {
  return function migrate(json: unknown): MigrateResult {
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      return { ok: false, errors: [{ path: "", message: "Expected a template object" }] };
    }
    const version = (json as Record<string, unknown>)["schemaVersion"];
    if (version === undefined) return fail("Missing schemaVersion");
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      return fail(`Unknown schemaVersion ${JSON.stringify(version)}`);
    }
    if (version > currentVersion) {
      return fail(
        `schemaVersion ${version} is newer than this version of @stackreel/template-schema supports ` +
          `(${currentVersion}). Update the app to open this template.`,
      );
    }

    let doc = json as Record<string, unknown>;
    for (let v = version; v < currentVersion; v++) {
      const step = steps[v];
      if (!step) return fail(`No migration from schemaVersion ${v} to ${v + 1}`);
      // Documents are plain JSON, so a JSON round trip is a full copy and keeps steps from mutating the input.
      doc = { ...step(JSON.parse(JSON.stringify(doc)) as Record<string, unknown>), schemaVersion: v + 1 };
    }
    return { ok: true, document: doc, fromVersion: version };
  };
}

/**
 * Upgrades a parsed template of any supported version to the current `schemaVersion`. The input is never
 * mutated. The output is not validated; pass it to `validate()`.
 */
export const migrate = createMigrator(MIGRATIONS, CURRENT_SCHEMA_VERSION);
