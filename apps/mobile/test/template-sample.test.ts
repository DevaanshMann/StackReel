import type { RenderPlan } from "@stackreel/core";
import { probeVideo } from "@stackreel/engine";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { File, storage } from "./draft-filesystem-fixture";
import {
  deleteTemplateDraft,
  listTemplateDraftIds,
  loadTemplateDraft,
  saveTemplateDraft,
} from "../src/template-drafts";
import { createTemplateSource, mobileTemplates } from "../src/template-editor";
import { createBeforeAfterSample } from "../src/template-sample";

vi.mock("@stackreel/engine", () => ({ probeVideo: vi.fn() }));
vi.mock("expo-file-system", () => import("./draft-filesystem-fixture"));
vi.mock("expo-crypto", () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++storage.nextMedia).padStart(12, "0")}`,
}));
// Metro returns module IDs while Vitest's asset imports resolve to paths.
vi.mock("expo-asset", () => ({
  Asset: {
    fromModule: (path: string) => ({
      downloadAsync: async () => ({ localUri: `file:///Caches/${path.split("/").at(-1)}` }),
    }),
  },
}));

const template = mobileTemplates.find(({ id }) => id === "before-after")!;
const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const bundledBefore = "file:///Caches/balcony-before.mp4";
const bundledAfter = "file:///Caches/balcony-after.mp4";
const metadata = { width: 720, height: 1280, startUs: 0, durationUs: 6_000_000 };
const create = (id = firstId, isCurrent = () => true) => createBeforeAfterSample(template, id, "Balcony", isCurrent);

beforeEach(() => {
  storage.files = new Map([
    [bundledBefore, "original before footage"],
    [bundledAfter, "original after footage"],
  ]);
  storage.directories = new Set([storage.document, "file:///Caches"]);
  storage.interruptMove = false;
  vi.mocked(probeVideo).mockReset().mockResolvedValue(metadata);
});
afterEach(() => vi.restoreAllMocks());

it("creates a playable Before / After project with independent, editable footage", async () => {
  const [first, second] = await Promise.all([create(firstId), create(secondId)]);
  expect(listTemplateDraftIds(template)).toEqual([firstId, secondId]);
  const { draft, source } = first!;
  expect(loadTemplateDraft(template, firstId)).toEqual(draft);
  const { plan, assets } = JSON.parse(source) as { plan: RenderPlan; assets: Record<string, string> };
  expect(plan.durationUs).toBe(8_000_000);
  expect(plan.layers.flatMap((layer) => (layer.kind === "text" ? [layer.text] : []))).toEqual([
    "BEFORE",
    "AFTER",
    "Three pots, one summer",
  ]);
  for (const [slot, original] of [
    ["before", bundledBefore],
    ["after", bundledAfter],
  ] as const) {
    const firstUri = draft.clips[slot]!.uri;
    const secondUri = second!.draft.clips[slot]!.uri;
    expect(firstUri).toContain(`/${firstId}/`);
    expect(secondUri).toContain(`/${secondId}/`);
    expect(assets[`slot:${slot}`]).toBe(firstUri);
    expect(new File(firstUri).textSync()).toBe(new File(original).textSync());
    expect(new File(secondUri).textSync()).toBe(new File(original).textSync());
  }

  saveTemplateDraft(template, { ...draft, textOverrides: { "labels/2": "A different summer" } }, firstId);
  expect(loadTemplateDraft(template, firstId)?.textOverrides["labels/2"]).toBe("A different summer");
  deleteTemplateDraft(template, firstId);
  const survivor = loadTemplateDraft(template, secondId)!;
  expect(survivor).toEqual(second!.draft);
  expect(createTemplateSource(template, survivor.clips, survivor.textOverrides, survivor.music)).toBe(second!.source);
  expect(new File(bundledBefore).exists && new File(bundledAfter).exists).toBe(true);
});

it("protects unpublished copies during discovery, and rejects a reused project ID", async () => {
  vi.mocked(probeVideo).mockImplementation(async (uri) => {
    expect(listTemplateDraftIds(template)).toEqual([]);
    expect(loadTemplateDraft(template, firstId)).toBeNull();
    expect(new File(uri).exists).toBe(true);
    return metadata;
  });
  const first = await create();
  await expect(create()).rejects.toThrow();
  expect(loadTemplateDraft(template, firstId)).toEqual(first!.draft);
});

it.each(["copy", "probe", "publish", "stale", "stale probe failure"] as const)(
  "cleans up a %s interruption and can retry the same ID",
  async (step) => {
    const existing = await create(secondId);
    const files = new Map(storage.files);
    const directories = new Set(storage.directories);
    let current = true;
    if (step === "copy") {
      const copy = File.prototype.copy;
      vi.spyOn(File.prototype, "copy").mockImplementation(async function (this: File, target) {
        await copy.call(this, target);
        if (this.uri === bundledAfter) throw new Error("Interrupted copy");
      });
    } else if (step === "publish") {
      storage.interruptMove = true;
    } else {
      vi.mocked(probeVideo)
        .mockResolvedValueOnce(metadata)
        .mockImplementationOnce(async () => {
          if (step === "probe") throw new Error("Unreadable video");
          current = false;
          if (step === "stale probe failure") throw new Error("Unreadable video");
          return metadata;
        });
    }
    const attempt = create(firstId, () => current);
    if (step === "stale" || step === "stale probe failure") await expect(attempt).resolves.toBeNull();
    else await expect(attempt).rejects.toThrow();

    expect(storage.files).toEqual(files);
    expect(storage.directories).toEqual(directories);
    expect(listTemplateDraftIds(template)).toEqual([secondId]);
    expect(loadTemplateDraft(template, secondId)).toEqual(existing!.draft);
    vi.restoreAllMocks();
    storage.interruptMove = false;
    const retry = await create();
    expect(loadTemplateDraft(template, firstId)).toEqual(retry!.draft);
  },
);
