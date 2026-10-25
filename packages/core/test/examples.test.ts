import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate, type Template } from "@stackreel/template-schema";
import { describe, expect, it } from "vitest";
import {
  SHORT_CLIP_POLICIES,
  checkPlanInvariants,
  createProject,
  resolve,
  validateProject,
  type AssetInfo,
  type Project,
} from "../src/index.js";

// Every built-in template must resolve to a sound plan, with clips of every shape and length bound to its slots.

const examplesDir = fileURLToPath(new URL("../../../templates/examples/", import.meta.url));
const templates = readdirSync(examplesDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) => {
    const result = validate(JSON.parse(readFileSync(examplesDir + file, "utf8")));
    if (!result.ok) throw new Error(`${file} is not a valid template`);
    return [file, result.template] as const;
  });

const SIZES = [
  { width: 1920, height: 1080 }, // 16:9
  { width: 1440, height: 1080 }, // 4:3
  { width: 1080, height: 1920 }, // 9:16
];

/** Binds fake media to every media slot. Every third slot gets a clip too short for its longest use. */
function fill(template: Template): { project: Project; assets: Record<string, AssetInfo> } {
  const project = createProject(template);
  const assets: Record<string, AssetInfo> = {};
  template.slots.forEach((slot, i) => {
    if (slot.kind === "text") return;
    const assetUri = `fake://${slot.id}.${slot.kind === "image" ? "jpg" : slot.kind === "audio" ? "m4a" : "mp4"}`;
    const durationUs = i % 3 === 2 ? 400_000 : 120_000_000;
    project.bindings[slot.id] = { assetUri, trimInUs: 0, trimOutUs: durationUs };
    assets[assetUri] =
      slot.kind === "audio" ? { durationUs } : slot.kind === "image" ? SIZES[i % 3]! : { ...SIZES[i % 3]!, durationUs };
  });
  return { project, assets };
}

describe.each(templates)("%s", (_file, template) => {
  const { project, assets } = fill(template);

  it("binds to a valid project", () => {
    expect(validateProject(project).ok).toBe(true);
  });

  it.each(SHORT_CLIP_POLICIES)("resolves with the %s policy and keeps every invariant", (policy) => {
    const plan = resolve(project, { assets, shortClipPolicy: policy });
    expect(checkPlanInvariants(plan)).toEqual([]);
    expect(plan.durationUs).toBe(template.durationUs);
    expect(plan.warnings.filter((w) => w.type !== "clip-too-short" && w.type !== "min-speed-reached")).toEqual([]);

    const visualItems = template.tracks.reduce((n, t) => n + (t.type === "audio" ? 0 : t.items.length), 0);
    expect(plan.layers).toHaveLength(visualItems);
    for (const layer of plan.layers) {
      expect(layer.endUs - layer.startUs).toBeGreaterThan(0);
      expect(layer.startUs).toBeGreaterThanOrEqual(0);
      expect(layer.endUs).toBeLessThanOrEqual(plan.durationUs);
    }
    const transitions = template.tracks.flatMap((t) =>
      t.type === "video" ? t.items.filter((i) => i.transitionIn && i.transitionIn.type !== "cut") : [],
    );
    expect(plan.transitions).toHaveLength(transitions.length);
    if (template.audio?.music) expect(plan.audio.some((a) => a.kind === "music")).toBe(true);
  });

  it("resolves with nothing bound, warning about each required media slot", () => {
    const plan = resolve(createProject(template));
    expect(checkPlanInvariants(plan)).toEqual([]);
    const required = template.slots.filter((s) => s.kind !== "text" && s.optional !== true).map((s) => s.id);
    expect(plan.warnings.map((w) => (w.type === "missing-slot" ? w.slotId : w.type))).toEqual(required);
    expect(plan.layers.every((l) => l.kind === "text" || l.kind === "sticker")).toBe(true);
  });
});

it("covers all ten built-in templates", () => {
  expect(templates).toHaveLength(10);
});
