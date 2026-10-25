import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate, type Template } from "@stackreel/template-schema";
import { format, resolveConfig } from "prettier";
import { describe, expect, it } from "vitest";
import {
  checkPlanInvariants,
  createProject,
  resolve,
  validateProject,
  type AssetInfo,
  type Project,
} from "../src/index.js";

// Locks down the full RenderPlan of every built-in template. Each plan is written to
// __snapshots__/<template-id>.renderplan.json, formatted like the rest of the repo so reviews show readable JSON.
// Update them with `pnpm test -- -u` after an intended resolver change.

const examplesDir = fileURLToPath(new URL("../../../templates/examples/", import.meta.url));
const files = readdirSync(examplesDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

const SIZES = [
  { width: 1920, height: 1080 }, // 16:9
  { width: 1080, height: 1920 }, // 9:16
  { width: 1080, height: 1350 }, // 4:5
];

/** Binds fixed fake media, long enough for every slot, to each media slot. */
function bindAll(template: Template): { project: Project; assets: Record<string, AssetInfo> } {
  const project = createProject(template);
  const assets: Record<string, AssetInfo> = {};
  template.slots.forEach((slot, i) => {
    if (slot.kind === "text") return;
    const ext = slot.kind === "image" ? "jpg" : slot.kind === "audio" ? "m4a" : "mp4";
    const assetUri = `fake://${template.id}/${slot.id}.${ext}`;
    const durationUs = 600_000_000;
    project.bindings[slot.id] = { assetUri, trimInUs: 0, trimOutUs: durationUs };
    const size = SIZES[i % SIZES.length]!;
    assets[assetUri] = slot.kind === "audio" ? { durationUs } : slot.kind === "image" ? size : { ...size, durationUs };
  });
  return { project, assets };
}

const prettierConfig = { ...(await resolveConfig(examplesDir)), parser: "json" };

it("covers all ten built-in templates", () => {
  expect(files).toHaveLength(10);
});

describe.each(files)("%s", (file) => {
  const result = validate(JSON.parse(readFileSync(examplesDir + file, "utf8")));

  it("validates", () => {
    expect(result.ok).toBe(true);
  });

  it("resolves without warnings to the snapshotted plan", async () => {
    if (!result.ok) throw new Error(`${file} is not a valid template`);
    const { project, assets } = bindAll(result.template);
    expect(validateProject(project).ok).toBe(true);

    const plan = resolve(project, { assets });
    expect(plan.warnings).toEqual([]);
    expect(checkPlanInvariants(plan)).toEqual([]);

    const json = await format(JSON.stringify(plan, null, 2), prettierConfig);
    await expect(json).toMatchFileSnapshot(`__snapshots__/${result.template.id}.renderplan.json`);
  });
});
