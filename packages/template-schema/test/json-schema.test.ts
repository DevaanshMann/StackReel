import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JSON_SCHEMA_ID, templateJsonSchema } from "../src/index.js";
import { JSON_SCHEMA_PATH, renderJsonSchema } from "../scripts/render-json-schema.js";

describe("JSON Schema", () => {
  it("committed schema/stackreel-template.v1.json is up to date (run `pnpm build` to regenerate)", async () => {
    expect(readFileSync(JSON_SCHEMA_PATH, "utf8")).toBe(await renderJsonSchema());
  });

  it("is draft 2020-12 with a stable $id", () => {
    const schema = templateJsonSchema();
    expect(schema["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema["$id"]).toBe(JSON_SCHEMA_ID);
  });

  it("names the shared types so code generators get real type names", () => {
    const defs = Object.keys(templateJsonSchema()["$defs"] as object);
    for (const name of ["Template", "Canvas", "Slot", "Track", "MediaItem", "TextItem", "StickerItem", "Transition"]) {
      expect(defs).toContain(name);
    }
  });
});
