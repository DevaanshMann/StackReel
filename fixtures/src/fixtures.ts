import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SHORT_CLIP_POLICY,
  PROJECT_SCHEMA_VERSION,
  RENDER_PLAN_VERSION,
  createProject,
  resolve,
  serializeProject,
  type AssetInfo,
  type Project,
  type RenderPlan,
  type ShortClipPolicy,
} from "@stackreel/core";
import { CURRENT_SCHEMA_VERSION, validate, type Template } from "@stackreel/template-schema";
import { format, resolveConfig } from "prettier";

/** The `fixtures/` directory, which holds the package and the files it generates. */
export const FIXTURES_DIR = fileURLToPath(new URL("../", import.meta.url));

/** The built-in templates every case is made from. */
export const EXAMPLES_DIR = fileURLToPath(new URL("../../templates/examples/", import.meta.url));

/** Directories whose `.json` files are all generated. Anything else in them is stale and gets removed. */
export const GENERATED_DIRS = ["templates", "projects", "render-plans"] as const;

export const MANIFEST_VERSION = 1;

/** Source sizes, cycled through each template's slots: 16:9, 4:3 and 9:16. */
export const SOURCE_SIZES = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 1080 },
  { width: 1080, height: 1920 },
] as const;

/** Length of a video clip long enough for any slot. Every third video slot gets `SHORT_CLIP_US` instead. */
export const LONG_CLIP_US = 120_000_000;
export const SHORT_CLIP_US = 400_000;
/** Length of every audio file, longer than any built-in template. */
export const AUDIO_US = 90_000_000;

export interface FileRef {
  path: string;
  sha256: string;
}

export interface ManifestCase {
  id: string;
  schemaVersion: number;
  projectSchemaVersion: number;
  renderPlanVersion: number;
  template: FileRef;
  project: FileRef;
  renderPlan: FileRef;
  /** `resolve()` options other than `assets`, which come from `assets.json` under the case id. */
  resolveOptions: { shortClipPolicy: ShortClipPolicy };
}

export interface Manifest {
  manifestVersion: number;
  schemaVersion: number;
  projectSchemaVersion: number;
  renderPlanVersion: number;
  generatedBy: string;
  assets: FileRef;
  cases: ManifestCase[];
}

/** One fixture case: a template, the project that fills it, the facts about its files, and the resolved plan. */
export interface FixtureCase {
  id: string;
  template: Template;
  project: Project;
  assets: Record<string, AssetInfo>;
  plan: RenderPlan;
}

/** The built-in templates, sorted by file name, validated. */
export function loadExampleTemplates(): Template[] {
  return readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const result = validate(JSON.parse(readFileSync(EXAMPLES_DIR + file, "utf8")));
      if (!result.ok) throw new Error(`templates/examples/${file} is not a valid template`);
      if (`${result.template.id}.json` !== file) throw new Error(`${file} has id "${result.template.id}"`);
      return result.template;
    });
}

const extension = (kind: "video" | "image" | "audio") => (kind === "image" ? "jpg" : kind === "audio" ? "m4a" : "mp4");

/**
 * Binds a fake file to every media slot, optional ones too, with the whole file as the trim. Slot `i` gets size
 * `SOURCE_SIZES[i % 3]`, and every video slot with `i % 3 === 2` gets a clip too short for it.
 */
export function buildCase(template: Template): FixtureCase {
  const project = createProject(template);
  const assets: Record<string, AssetInfo> = {};
  template.slots.forEach((slot, i) => {
    if (slot.kind === "text") return;
    const assetUri = `fixture://${slot.id}.${extension(slot.kind)}`;
    const size = SOURCE_SIZES[i % SOURCE_SIZES.length]!;
    const info: AssetInfo =
      slot.kind === "audio"
        ? { durationUs: AUDIO_US }
        : slot.kind === "image"
          ? { ...size }
          : { ...size, durationUs: i % 3 === 2 ? SHORT_CLIP_US : LONG_CLIP_US };
    assets[assetUri] = info;
    project.bindings[slot.id] = { assetUri, trimInUs: 0, trimOutUs: info.durationUs ?? LONG_CLIP_US };
  });
  const plan = resolve(project, { assets, shortClipPolicy: DEFAULT_SHORT_CLIP_POLICY });
  return { id: template.id, template, project, assets, plan };
}

/** A copy of a JSON value with every object's keys sorted, so the output doesn't depend on how it was built. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * The exact bytes of a fixture file: sorted keys, 2-space indent, trailing newline, laid out the way `pnpm format`
 * leaves it so the formatting check passes.
 */
export async function toFixtureJson(value: unknown, path: string): Promise<string> {
  const filepath = FIXTURES_DIR + path;
  const config = await resolveConfig(filepath);
  return format(JSON.stringify(sortKeys(value), null, 2), { ...config, filepath });
}

export const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** Every generated file, keyed by its path relative to `fixtures/`, in a stable order. */
export async function renderFixtures(): Promise<Map<string, string>> {
  const cases = loadExampleTemplates().map(buildCase);
  const files = new Map<string, string>();
  const add = async (path: string, value: unknown): Promise<FileRef> => {
    const text = await toFixtureJson(value, path);
    files.set(path, text);
    return { path, sha256: sha256(text) };
  };

  const assets = await add("assets.json", Object.fromEntries(cases.map((c) => [c.id, c.assets])));
  const entries: ManifestCase[] = [];
  for (const c of cases) {
    entries.push({
      id: c.id,
      schemaVersion: c.template.schemaVersion,
      projectSchemaVersion: c.project.schemaVersion,
      renderPlanVersion: c.plan.renderPlanVersion,
      template: await add(`templates/${c.id}.json`, c.template),
      // serializeProject validates the project, so a fixture can never hold one that won't load.
      project: await add(`projects/${c.id}.project.json`, JSON.parse(serializeProject(c.project))),
      renderPlan: await add(`render-plans/${c.id}.renderplan.json`, c.plan),
      resolveOptions: { shortClipPolicy: DEFAULT_SHORT_CLIP_POLICY },
    });
  }
  const manifest: Manifest = {
    manifestVersion: MANIFEST_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projectSchemaVersion: PROJECT_SCHEMA_VERSION,
    renderPlanVersion: RENDER_PLAN_VERSION,
    generatedBy: "pnpm --filter @stackreel/fixtures generate",
    assets,
    cases: entries,
  };
  await add("manifest.json", manifest);
  return files;
}
