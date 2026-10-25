import { existsSync, readFileSync, readdirSync } from "node:fs";
import { checkPlanInvariants, parseProject, resolve, type RenderPlan } from "@stackreel/core";
import { describe, expect, it } from "vitest";
import {
  EXAMPLES_DIR,
  FIXTURES_DIR,
  GENERATED_DIRS,
  SHORT_CLIP_US,
  loadExampleTemplates,
  renderFixtures,
  sha256,
  sortKeys,
  type Manifest,
} from "../src/fixtures.js";

const REGENERATE = "run `pnpm --filter @stackreel/fixtures generate`";

const files = await renderFixtures();
const read = (path: string) => readFileSync(FIXTURES_DIR + path, "utf8");
const manifest = JSON.parse(files.get("manifest.json")!) as Manifest;

describe("committed fixtures", () => {
  it.each([...files.keys()])(`%s is up to date (${REGENERATE})`, (path) => {
    expect(existsSync(FIXTURES_DIR + path), `${path} is missing: ${REGENERATE}`).toBe(true);
    expect(read(path), `${path} is stale: ${REGENERATE}`).toBe(files.get(path));
  });

  it.each(GENERATED_DIRS)(`%s/ holds no leftover files (${REGENERATE})`, (dir) => {
    const extra = readdirSync(FIXTURES_DIR + dir).filter((name) => !files.has(`${dir}/${name}`));
    expect(extra).toEqual([]);
  });

  it("generates the same bytes every time", async () => {
    expect(await renderFixtures()).toEqual(files);
  });
});

describe("manifest.json", () => {
  it("lists one case per built-in template, sorted by id", () => {
    const ids = loadExampleTemplates().map((t) => t.id);
    expect(ids).toHaveLength(10);
    expect(manifest.cases.map((c) => c.id)).toEqual(ids);
  });

  it("names every other generated file once, with its SHA-256", () => {
    const refs = [manifest.assets, ...manifest.cases.flatMap((c) => [c.template, c.project, c.renderPlan])];
    expect(refs.map((r) => r.path).sort()).toEqual([...files.keys()].filter((p) => p !== "manifest.json").sort());
    for (const ref of refs) expect(ref.sha256).toBe(sha256(files.get(ref.path)!));
  });
});

describe.each(manifest.cases)("$id", (c) => {
  const template = JSON.parse(files.get(c.template.path)!);
  const assets = JSON.parse(files.get(manifest.assets.path)!)[c.id];
  const plan = JSON.parse(files.get(c.renderPlan.path)!) as RenderPlan;

  it("copies the template from templates/examples", () => {
    expect(template).toEqual(JSON.parse(readFileSync(`${EXAMPLES_DIR}${c.id}.json`, "utf8")));
  });

  it("decodes the project file and resolves it back to the same plan", () => {
    const loaded = parseProject(files.get(c.project.path)!);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    expect(sortKeys(resolve(loaded.project, { assets, ...c.resolveOptions }))).toEqual(plan);
  });

  it("holds a sound plan with the declared versions", () => {
    expect(checkPlanInvariants(plan)).toEqual([]);
    expect(plan.renderPlanVersion).toBe(c.renderPlanVersion);
    expect(template.schemaVersion).toBe(c.schemaVersion);
    expect(plan.warnings.filter((w) => w.type !== "clip-too-short" && w.type !== "min-speed-reached")).toEqual([]);
  });

  it("uses only fixture:// files that assets.json describes", () => {
    const project = JSON.parse(files.get(c.project.path)!);
    for (const binding of Object.values(project.bindings) as { assetUri: string }[]) {
      expect(binding.assetUri).toMatch(/^fixture:\/\/[A-Za-z0-9_-]+\.(mp4|jpg|m4a)$/);
      expect(assets).toHaveProperty([binding.assetUri]);
    }
  });
});

it("covers 16:9, 4:3 and 9:16 sources and a clip shorter than its slot", () => {
  const all = Object.values(JSON.parse(files.get("assets.json")!) as Record<string, object>).flatMap((a) =>
    Object.values(a as Record<string, { width?: number; height?: number; durationUs?: number }>),
  );
  const ratios = new Set(all.filter((a) => a.width && a.height).map((a) => (a.width! / a.height!).toFixed(3)));
  expect([...ratios].sort()).toEqual(["0.563", "1.333", "1.778"]);
  expect(all.some((a) => a.durationUs === SHORT_CLIP_US)).toBe(true);
  const plans = manifest.cases.map((c) => JSON.parse(files.get(c.renderPlan.path)!) as RenderPlan);
  expect(plans.some((p) => p.warnings.some((w) => w.type === "clip-too-short"))).toBe(true);
});
