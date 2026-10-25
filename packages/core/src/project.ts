import {
  Microseconds,
  Normalized,
  Style,
  Template,
  migrate,
  toJsonPointer,
  type TextItem,
  type ValidationError,
} from "@stackreel/template-schema";
import { z } from "zod";

/** The `schemaVersion` of the project files this package reads and writes. Separate from the template's. */
export const PROJECT_SCHEMA_VERSION = 1;

/** Part of the source frame to show, in normalized source coordinates (0 to 1). */
export const Crop = z.strictObject({
  x: Normalized,
  y: Normalized,
  width: Normalized.positive(),
  height: Normalized.positive(),
});

/** The user's media in one slot: which file, and which part of it. */
export const SlotBinding = z.strictObject({
  assetUri: z.string().min(1),
  /** Where the used part of the source starts. */
  trimInUs: Microseconds,
  /** Where it ends (exclusive). Must be after `trimInUs`. */
  trimOutUs: Microseconds,
  crop: Crop.optional(),
});

/** Style fields that replace the template's for one text item. */
export const StyleOverride = Style.partial();

export const Overrides = z.strictObject({
  /** New text, keyed by a text slot id or a text item key (see `itemKey`). */
  text: z.record(z.string(), z.string()),
  /** Style tweaks, keyed by a text item key. */
  style: z.record(z.string(), StyleOverride),
});

const ProjectShape = z.strictObject({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION, `Expected project schemaVersion ${PROJECT_SCHEMA_VERSION}`),
  template: Template,
  /** Filled slots, keyed by slot id. A slot with no entry is empty. */
  bindings: z.record(z.string(), SlotBinding),
  overrides: Overrides,
});

export type Crop = z.infer<typeof Crop>;
export type SlotBinding = z.infer<typeof SlotBinding>;
export type StyleOverride = z.infer<typeof StyleOverride>;
export type Overrides = z.infer<typeof Overrides>;
export type Project = z.infer<typeof ProjectShape>;

/**
 * Addresses one item in a template, such as `"captions/0"` for the first item of track `captions`. Template ids
 * can't contain `/`, so an item key never collides with a slot id.
 */
export function itemKey(trackId: string, itemIndex: number): string {
  return `${trackId}/${itemIndex}`;
}

/** The text item an item key points to, or `undefined` if the key is malformed or points elsewhere. */
export function findTextItem(template: Template, key: string): TextItem | undefined {
  const match = /^([^/]+)\/(0|[1-9][0-9]*)$/.exec(key);
  if (!match) return undefined;
  const [, trackId, index] = match;
  const track = template.tracks.find((t) => t.id === trackId);
  if (track?.type !== "overlay") return undefined;
  const item = track.items[Number(index)];
  return item?.kind === "text" ? item : undefined;
}

// Rules shared by validateProject() and the edit commands. Each returns an error message, or null if the edit is fine.

export function checkBinding(template: Template, slotId: string, binding: SlotBinding): string | null {
  const slot = template.slots.find((s) => s.id === slotId);
  if (!slot) return `Unknown slot "${slotId}"`;
  if (slot.kind === "text") return `Slot "${slotId}" is a text slot; set its text with an override`;
  return checkTrim(binding.trimInUs, binding.trimOutUs) ?? (binding.crop ? checkCrop(binding.crop) : null);
}

export function checkTrim(trimInUs: number, trimOutUs: number): string | null {
  if (!Number.isSafeInteger(trimInUs) || trimInUs < 0) return "trimInUs must be a non-negative integer";
  if (!Number.isSafeInteger(trimOutUs) || trimOutUs < 0) return "trimOutUs must be a non-negative integer";
  if (trimOutUs <= trimInUs) return `trimOutUs (${trimOutUs}) must be after trimInUs (${trimInUs})`;
  return null;
}

// Normalized values are floats, so allow for rounding when an edge lands on 1 (0.7 + 0.3 > 1 in binary).
const EPSILON = 1e-9;

export function checkCrop(crop: Crop): string | null {
  if (crop.x + crop.width > 1 + EPSILON) return "Crop extends past the right edge of the source";
  if (crop.y + crop.height > 1 + EPSILON) return "Crop extends past the bottom edge of the source";
  return null;
}

/** `key` is a text slot id, or the item key of a text item with `editable: true`. */
export function checkTextOverride(template: Template, key: string, text: string): string | null {
  let maxChars: number | undefined;
  if (key.includes("/")) {
    const item = findTextItem(template, key);
    if (!item) return `No text item at "${key}"`;
    if (item.text.editable !== true) return `Text item "${key}" is not editable`;
    maxChars = item.text.maxChars;
  } else {
    const slot = template.slots.find((s) => s.id === key);
    if (!slot) return `Unknown slot "${key}"`;
    if (slot.kind !== "text") return `Slot "${key}" is ${slot.kind}, not text`;
    maxChars = slot.maxChars;
  }
  if (maxChars !== undefined && [...text].length > maxChars) return `Text is longer than maxChars (${maxChars})`;
  return null;
}

export function checkStyleOverride(template: Template, key: string): string | null {
  return findTextItem(template, key) ? null : `No text item at "${key}"`;
}

/** Rules that need the template: every binding and override must point at something that exists. */
function checkReferences(p: Project): ValidationError[] {
  const errors: ValidationError[] = [];
  const issue = (path: string[], message: string | null) => {
    if (message !== null) errors.push({ path: toJsonPointer(path), message });
  };
  for (const [slotId, binding] of Object.entries(p.bindings)) {
    issue(["bindings", slotId], checkBinding(p.template, slotId, binding));
  }
  for (const [key, text] of Object.entries(p.overrides.text)) {
    issue(["overrides", "text", key], checkTextOverride(p.template, key, text));
  }
  for (const key of Object.keys(p.overrides.style)) {
    issue(["overrides", "style", key], checkStyleOverride(p.template, key));
  }
  return errors;
}

export type ProjectResult = { ok: true; project: Project } | { ok: false; errors: ValidationError[] };

/**
 * Checks a parsed value against the project format: the shape first, including the whole template, then (once the
 * shape is right) that every binding and override points at something in the template.
 */
export function validateProject(json: unknown): ProjectResult {
  const result = ProjectShape.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => ({ path: toJsonPointer(i.path), message: i.message })),
    };
  }
  const errors = checkReferences(result.data);
  return errors.length === 0 ? { ok: true, project: result.data } : { ok: false, errors };
}

/** A copy of plain JSON data. Projects hold only JSON values, so this is a full deep copy. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Starts an empty project from a template: no slots filled, no overrides. The template is copied. */
export function createProject(template: Template): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    template: copy(template),
    bindings: {},
    overrides: { text: {}, style: {} },
  };
}

/** Thrown by `serializeProject` when given a project that `parseProject` would reject. */
export class ProjectValidationError extends Error {
  readonly errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    super(`Invalid project: ${errors.map((e) => `${e.path || "/"}: ${e.message}`).join("; ")}`);
    this.name = "ProjectValidationError";
    this.errors = errors;
  }
}

/**
 * Saves a project as JSON. Validates first and throws `ProjectValidationError`, so it never writes a file that won't
 * load. Keys come out in schema order, so saving a loaded project gives back the same text.
 */
export function serializeProject(project: Project): string {
  const result = validateProject(project);
  if (!result.ok) throw new ProjectValidationError(result.errors);
  return JSON.stringify(result.project, null, 2) + "\n";
}

/**
 * Loads a project saved by `serializeProject`. The embedded template is migrated to the current template version
 * first, then everything is validated. Never throws; problems come back as errors with JSON Pointer paths.
 */
export function parseProject(text: string): ProjectResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [{ path: "", message: `Not valid JSON: ${(error as Error).message}` }] };
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, errors: [{ path: "", message: "Expected a project object" }] };
  }
  const doc = json as Record<string, unknown>;
  const version = doc["schemaVersion"];
  if (typeof version === "number" && version > PROJECT_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        {
          path: "/schemaVersion",
          message:
            `Project schemaVersion ${version} is newer than this version of @stackreel/core supports ` +
            `(${PROJECT_SCHEMA_VERSION}). Update the app to open this project.`,
        },
      ],
    };
  }
  if (doc["template"] !== undefined) {
    const migrated = migrate(doc["template"]);
    if (!migrated.ok) {
      return { ok: false, errors: migrated.errors.map((e) => ({ path: "/template" + e.path, message: e.message })) };
    }
    doc["template"] = migrated.document;
  }
  return validateProject(doc);
}
