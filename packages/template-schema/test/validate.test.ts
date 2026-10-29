import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { toJsonPointer, validate, type Template } from "../src/index.js";
import { fixturesDir, readJson } from "./helpers.js";

const minimal = () => readJson(join(fixturesDir, "valid/minimal.json")) as Template;

describe("validate", () => {
  it("returns the typed template on success", () => {
    const result = validate(minimal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectTypeOf(result.template).toEqualTypeOf<Template>();
    expect(result.template.tracks[0]?.items[0]).toEqual({ slot: "clip1", startUs: 0, durationUs: 3000000 });
  });

  it("does not add defaults, so a parsed template round-trips unchanged", () => {
    const input = readJson(join(fixturesDir, "valid/every-feature.json"));
    const result = validate(input);
    expect(result.ok && result.template).toEqual(input);
  });

  it("reports errors with JSON Pointer paths and readable messages", () => {
    const doc = minimal();
    doc.slots.push({ id: "clip1", kind: "image", label: "Again" });
    const result = validate(doc);
    expect(result).toEqual({ ok: false, errors: [{ path: "/slots/1/id", message: 'Duplicate slot id "clip1"' }] });
  });

  it("reports every problem at once, including cross-field rules when the shape is right", () => {
    const doc = minimal() as unknown as Record<string, unknown>;
    doc["name"] = "";
    doc["durationUs"] = -5;
    const result = validate(doc);
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual([
      "/name",
      "/durationUs",
      "/tracks/0/items/0/durationUs",
    ]);
  });

  it.each([null, "a string", 42, [], undefined])("rejects %j at the root path", (value) => {
    const result = validate(value);
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.errors[0]?.path).toBe("");
  });

  it("skips cross-field rules when the shape is wrong, instead of crashing", () => {
    const doc = minimal() as unknown as { tracks: unknown[] };
    doc.tracks[0] = { id: "main", type: "overlay", items: [{ kind: "text", startUs: 0, durationUs: 1 }] };
    const result = validate(doc);
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual(["/tracks/0/items/0/text"]);
  });

  it("explains slot kind mismatches", () => {
    const doc = minimal();
    doc.slots[0] = { id: "clip1", kind: "text", label: "Words" };
    const result = validate(doc);
    expect(result.ok ? [] : result.errors).toEqual([
      { path: "/tracks/0/items/0/slot", message: 'Slot "clip1" is text, expected video or image' },
    ]);
  });

  it("marks only clips with sound as voice", () => {
    const doc = minimal();
    doc.slots.push({ id: "photo", kind: "image", label: "Photo" });
    doc.tracks[0]!.items = [
      { slot: "clip1", startUs: 0, durationUs: 1000000, voice: true },
      { slot: "photo", startUs: 1000000, durationUs: 1000000, voice: false },
      { slot: "photo", startUs: 2000000, durationUs: 1000000, voice: true },
    ];
    const result = validate(doc);
    expect(result.ok ? [] : result.errors).toEqual([
      { path: "/tracks/0/items/2/voice", message: 'Slot "photo" is an image, which has no sound to mark as voice' },
    ]);
  });

  it("checks overlap on video tracks regardless of item order", () => {
    const doc = minimal();
    doc.durationUs = 6000000;
    doc.tracks[0]!.items = [
      { slot: "clip1", startUs: 3000000, durationUs: 3000000 },
      { slot: "clip1", startUs: 0, durationUs: 3000001 },
    ];
    const result = validate(doc);
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual(["/tracks/0/items/0/startUs"]);
  });

  it("counts maxChars in code points, so emoji count once", () => {
    const doc = minimal();
    doc.tracks.push({
      id: "text",
      type: "overlay",
      items: [{ kind: "text", startUs: 0, durationUs: 1000, text: { default: "🔥🔥", maxChars: 2 } }],
    });
    expect(validate(doc).ok).toBe(true);
  });
});

describe("toJsonPointer", () => {
  it("escapes ~ and / as RFC 6901 requires", () => {
    expect(toJsonPointer(["a/b", "c~d", 0])).toBe("/a~1b/c~0d/0");
  });

  it("returns an empty string for the root", () => {
    expect(toJsonPointer([])).toBe("");
  });
});
