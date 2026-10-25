import { validate } from "@stackreel/template-schema";
import { describe, expect, it } from "vitest";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectValidationError,
  createProject,
  findTextItem,
  itemKey,
  parseProject,
  serializeProject,
  validateProject,
  type Project,
} from "../src/index.js";
import { testTemplate } from "./helpers.js";

/** A project that uses every kind of binding and override. */
const fullProject = (): Project => ({
  ...createProject(testTemplate()),
  bindings: {
    clip1: { assetUri: "file:///videos/a.mp4", trimInUs: 500_000, trimOutUs: 3_500_000 },
    photo: {
      assetUri: "ph://ABC-123",
      trimInUs: 0,
      trimOutUs: 3_000_000,
      crop: { x: 0.7, y: 0, width: 0.3, height: 1 },
    },
  },
  overrides: {
    text: { title: "Hello", "captions/0": "Watch this ✨" },
    style: { "captions/0": { color: "#FF0000", sizePx: 120 } },
  },
});

const errorsOf = (json: unknown) => {
  const result = validateProject(json);
  return result.ok ? [] : result.errors;
};

describe("test template", () => {
  it("is valid", () => {
    expect(validate(testTemplate()).ok).toBe(true);
  });
});

describe("createProject", () => {
  it("starts with no bindings or overrides", () => {
    const project = createProject(testTemplate());
    expect(project).toEqual({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      template: testTemplate(),
      bindings: {},
      overrides: { text: {}, style: {} },
    });
    expect(validateProject(project).ok).toBe(true);
  });

  it("copies the template", () => {
    const template = testTemplate();
    const project = createProject(template);
    template.name = "Changed";
    expect(project.template.name).toBe("Test");
  });
});

describe("serializeProject / parseProject", () => {
  it("round-trips a project unchanged", () => {
    const project = fullProject();
    const text = serializeProject(project);
    expect(parseProject(text)).toEqual({ ok: true, project });
    expect(serializeProject((parseProject(text) as { project: Project }).project)).toBe(text);
  });

  it("round-trips an empty project", () => {
    const project = createProject(testTemplate());
    expect(parseProject(serializeProject(project))).toEqual({ ok: true, project });
  });

  it("writes readable JSON with schemaVersion first", () => {
    const text = serializeProject(createProject(testTemplate()));
    expect(text.startsWith('{\n  "schemaVersion": 1,')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("refuses to serialize an invalid project", () => {
    const project = fullProject();
    project.bindings["nope"] = { assetUri: "a", trimInUs: 0, trimOutUs: 1 };
    expect(() => serializeProject(project)).toThrow(ProjectValidationError);
    expect(() => serializeProject(project)).toThrow('Invalid project: /bindings/nope: Unknown slot "nope"');
  });

  it("reports text that is not JSON or not an object", () => {
    expect(parseProject("{")).toMatchObject({ ok: false, errors: [{ path: "", message: /^Not valid JSON/ }] });
    expect(parseProject("[]")).toEqual({ ok: false, errors: [{ path: "", message: "Expected a project object" }] });
    expect(parseProject("null")).toEqual({ ok: false, errors: [{ path: "", message: "Expected a project object" }] });
  });

  it("rejects projects from a newer version", () => {
    const doc = { ...fullProject(), schemaVersion: 2 };
    const result = parseProject(JSON.stringify(doc));
    expect(result).toMatchObject({ ok: false, errors: [{ path: "/schemaVersion", message: /newer than/ }] });
  });

  it("rejects a missing or unknown project version", () => {
    const { schemaVersion: _, ...doc } = fullProject();
    expect(parseProject(JSON.stringify(doc))).toMatchObject({ ok: false, errors: [{ path: "/schemaVersion" }] });
    expect(parseProject(JSON.stringify({ ...doc, schemaVersion: "1" }))).toMatchObject({
      ok: false,
      errors: [{ path: "/schemaVersion" }],
    });
  });

  it("runs the embedded template through migrate() and reports its errors under /template", () => {
    const doc = fullProject() as unknown as { template: Record<string, unknown> };
    doc.template["schemaVersion"] = 99;
    expect(parseProject(JSON.stringify(doc))).toMatchObject({
      ok: false,
      errors: [{ path: "/template/schemaVersion", message: /newer than/ }],
    });
  });

  it("reports template errors under /template", () => {
    const doc = fullProject();
    doc.template.durationUs = -1;
    const result = parseProject(JSON.stringify(doc));
    expect(result.ok ? [] : result.errors[0]).toMatchObject({ path: "/template/durationUs" });
  });

  it("requires a template", () => {
    const { template: _, ...doc } = fullProject();
    expect(parseProject(JSON.stringify(doc))).toMatchObject({ ok: false, errors: [{ path: "/template" }] });
  });
});

describe("validateProject", () => {
  it("accepts every kind of binding and override", () => {
    expect(errorsOf(fullProject())).toEqual([]);
  });

  it("rejects unknown keys", () => {
    expect(errorsOf({ ...fullProject(), extra: true })).toMatchObject([{ path: "" }]);
  });

  it("rejects bindings to unknown slots and to text slots", () => {
    const project = fullProject();
    project.bindings["ghost"] = { assetUri: "a", trimInUs: 0, trimOutUs: 1 };
    project.bindings["title"] = { assetUri: "a", trimInUs: 0, trimOutUs: 1 };
    expect(errorsOf(project)).toEqual([
      { path: "/bindings/ghost", message: 'Unknown slot "ghost"' },
      { path: "/bindings/title", message: 'Slot "title" is a text slot; set its text with an override' },
    ]);
  });

  it.each([
    [{ trimInUs: 2, trimOutUs: 1 }, "/bindings/clip1", "trimOutUs (1) must be after trimInUs (2)"],
    [{ trimInUs: 1, trimOutUs: 1 }, "/bindings/clip1", "trimOutUs (1) must be after trimInUs (1)"],
    [{ trimInUs: -1, trimOutUs: 1 }, "/bindings/clip1/trimInUs", undefined],
    [{ trimInUs: 0, trimOutUs: -5 }, "/bindings/clip1/trimOutUs", undefined],
    [{ trimInUs: 0.5, trimOutUs: 1 }, "/bindings/clip1/trimInUs", undefined],
  ])("rejects bad trims %o", (trim, path, message) => {
    const project = fullProject();
    project.bindings["clip1"] = { assetUri: "a", ...trim };
    const errors = errorsOf(project);
    expect(errors.map((e) => e.path)).toEqual([path]);
    if (message) expect(errors[0]?.message).toBe(message);
  });

  it("rejects an empty asset URI", () => {
    const project = fullProject();
    project.bindings["clip1"] = { assetUri: "", trimInUs: 0, trimOutUs: 1 };
    expect(errorsOf(project).map((e) => e.path)).toEqual(["/bindings/clip1/assetUri"]);
  });

  it.each([
    [{ x: 0.5, y: 0, width: 0.6, height: 1 }, "Crop extends past the right edge of the source"],
    [{ x: 0, y: 0.5, width: 1, height: 0.6 }, "Crop extends past the bottom edge of the source"],
  ])("rejects a crop outside the source %o", (crop, message) => {
    const project = fullProject();
    project.bindings["photo"] = { assetUri: "a", trimInUs: 0, trimOutUs: 1, crop };
    expect(errorsOf(project)).toEqual([{ path: "/bindings/photo", message }]);
  });

  it("rejects a crop with no area", () => {
    const project = fullProject();
    project.bindings["photo"] = { assetUri: "a", trimInUs: 0, trimOutUs: 1, crop: { x: 0, y: 0, width: 0, height: 1 } };
    expect(errorsOf(project).map((e) => e.path)).toEqual(["/bindings/photo/crop/width"]);
  });

  it("checks text overrides against slots and items", () => {
    const project = fullProject();
    project.overrides.text = {
      ghost: "x",
      clip1: "x",
      title: "Far too long",
      "captions/2": "x",
      "captions/3": "x",
      "captions/9": "x",
      "main/0": "x",
      "captions/01": "x",
    };
    expect(errorsOf(project)).toEqual([
      { path: "/overrides/text/ghost", message: 'Unknown slot "ghost"' },
      { path: "/overrides/text/clip1", message: 'Slot "clip1" is video, not text' },
      { path: "/overrides/text/title", message: "Text is longer than maxChars (10)" },
      { path: "/overrides/text/captions~12", message: 'Text item "captions/2" is not editable' },
      { path: "/overrides/text/captions~13", message: 'No text item at "captions/3"' },
      { path: "/overrides/text/captions~19", message: 'No text item at "captions/9"' },
      { path: "/overrides/text/main~10", message: 'No text item at "main/0"' },
      { path: "/overrides/text/captions~101", message: 'No text item at "captions/01"' },
    ]);
  });

  it("counts maxChars in code points", () => {
    const project = fullProject();
    project.overrides.text = { title: "✨✨✨✨✨✨✨✨✨✨" };
    expect(errorsOf(project)).toEqual([]);
  });

  it("checks style overrides", () => {
    const project = fullProject();
    project.overrides.style = { "captions/3": { sizePx: 10 }, title: { sizePx: 10 }, "captions/1": { sizePx: -1 } };
    expect(errorsOf(project)).toEqual([{ path: "/overrides/style/captions~11/sizePx", message: expect.any(String) }]);
    project.overrides.style = { "captions/3": { sizePx: 10 }, title: { sizePx: 10 } };
    expect(errorsOf(project)).toEqual([
      { path: "/overrides/style/captions~13", message: 'No text item at "captions/3"' },
      { path: "/overrides/style/title", message: 'No text item at "title"' },
    ]);
  });
});

describe("itemKey / findTextItem", () => {
  it("addresses text items by track id and index", () => {
    const template = testTemplate();
    expect(itemKey("captions", 1)).toBe("captions/1");
    expect(findTextItem(template, "captions/1")?.slot).toBe("title");
    expect(findTextItem(template, "captions")).toBeUndefined();
    expect(findTextItem(template, "captions/3")).toBeUndefined();
  });
});
