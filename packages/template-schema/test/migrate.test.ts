import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMigrator, type MigrationStep } from "../src/migrate.js";
import { CURRENT_SCHEMA_VERSION, migrate, MIGRATIONS, validate } from "../src/index.js";
import { fixturesDir, readJson } from "./helpers.js";

describe("migrate", () => {
  it("is a no-op for the current version", () => {
    const doc = readJson(join(fixturesDir, "valid/minimal.json"));
    expect(migrate(doc)).toEqual({ ok: true, document: doc, fromVersion: 1 });
  });

  it("has a step for every version below the current one", () => {
    for (let v = 1; v < CURRENT_SCHEMA_VERSION; v++) expect(MIGRATIONS[v]).toBeTypeOf("function");
  });

  it("output of migrate() passes validate()", () => {
    const result = migrate(readJson(join(fixturesDir, "valid/every-feature.json")));
    expect(result.ok && validate(result.document).ok).toBe(true);
  });

  it("rejects versions newer than this library", () => {
    expect(migrate({ schemaVersion: 2 })).toEqual({
      ok: false,
      errors: [
        {
          path: "/schemaVersion",
          message:
            "schemaVersion 2 is newer than this version of @stackreel/template-schema supports (1). " +
            "Update the app to open this template.",
        },
      ],
    });
  });

  it.each([0, -1, 1.5, "1", null])("rejects unknown schemaVersion %j", (schemaVersion) => {
    expect(migrate({ schemaVersion })).toEqual({
      ok: false,
      errors: [{ path: "/schemaVersion", message: `Unknown schemaVersion ${JSON.stringify(schemaVersion)}` }],
    });
  });

  it("rejects a document without schemaVersion", () => {
    expect(migrate({})).toEqual({ ok: false, errors: [{ path: "/schemaVersion", message: "Missing schemaVersion" }] });
  });

  it.each([null, [], "{}", 1])("rejects non-object input %j", (value) => {
    expect(migrate(value)).toEqual({ ok: false, errors: [{ path: "", message: "Expected a template object" }] });
  });
});

describe("migration pipeline", () => {
  const renameTitle: MigrationStep = ({ title, ...rest }) => ({ ...rest, name: title });
  const addTracks: MigrationStep = (doc) => ({ ...doc, tracks: [] });
  const migrateTo3 = createMigrator({ 1: renameTitle, 2: addTracks }, 3);

  it("runs each step in order and stamps the new version", () => {
    expect(migrateTo3({ schemaVersion: 1, title: "Old" })).toEqual({
      ok: true,
      document: { schemaVersion: 3, name: "Old", tracks: [] },
      fromVersion: 1,
    });
  });

  it("starts from the document's own version", () => {
    expect(migrateTo3({ schemaVersion: 2, name: "Mid" })).toEqual({
      ok: true,
      document: { schemaVersion: 3, name: "Mid", tracks: [] },
      fromVersion: 2,
    });
  });

  it("never mutates the input, even if a step does", () => {
    const mutating: MigrationStep = (doc) => {
      (doc["nested"] as { n: number }).n = 99;
      return doc;
    };
    const input = { schemaVersion: 1, nested: { n: 1 } };
    const result = createMigrator({ 1: mutating }, 2)(input);
    expect(input).toEqual({ schemaVersion: 1, nested: { n: 1 } });
    expect(result).toMatchObject({ ok: true, document: { schemaVersion: 2, nested: { n: 99 } } });
  });

  it("fails clearly when a step is missing", () => {
    expect(createMigrator({ 1: renameTitle }, 3)({ schemaVersion: 1, title: "x" })).toEqual({
      ok: false,
      errors: [{ path: "/schemaVersion", message: "No migration from schemaVersion 2 to 3" }],
    });
  });
});
