import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validate } from "../src/index.js";
import { examplesDir, fixturesDir, jsonFiles, readJson } from "./helpers.js";

const invalidDir = join(fixturesDir, "invalid");
const expected = readJson(join(invalidDir, "expected.json")) as Record<string, { path: string; description: string }>;
const invalidFixtures = jsonFiles(invalidDir).filter((f) => f !== "expected.json");

describe("valid fixtures", () => {
  it.each(jsonFiles(join(fixturesDir, "valid")))("%s", (file) => {
    expect(validate(readJson(join(fixturesDir, "valid", file)))).toMatchObject({ ok: true });
  });
});

describe("example templates", () => {
  it.each(jsonFiles(examplesDir))("%s", (file) => {
    expect(validate(readJson(join(examplesDir, file)))).toMatchObject({ ok: true });
  });
});

describe("invalid fixtures", () => {
  it("every fixture has an entry in expected.json, and every entry has a fixture", () => {
    expect(Object.keys(expected).sort()).toEqual(invalidFixtures);
  });

  it.each(invalidFixtures)("%s", (file) => {
    const result = validate(readJson(join(invalidDir, file)));
    if (result.ok) throw new Error(`${file} should fail: ${expected[file]?.description}`);
    expect(result.errors.map((e) => e.path)).toContain(expected[file]?.path);
  });
});
