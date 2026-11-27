import { beforeEach, expect, it, vi } from "vitest";
import { clearDraftExport, restoreDraftExport, retainDraftExport } from "../src/draft-export";
import type { DraftExportKey } from "../src/draft-export";
import { Directory, File, storage } from "./draft-filesystem-fixture";

vi.mock("expo-file-system", () => import("./draft-filesystem-fixture"));

const key: DraftExportKey = { kind: "single", draftId: "legacy" };
const nativeUri = "file:///Caches/StackReelExports/job.mp4";

function source(width = 720, path = "draft/clip.mov", caption = "file:///Documents/unchanged") {
  return JSON.stringify({
    plan: { canvas: { width, height: 1280 }, caption },
    assets: { clip: storage.document + "/" + path },
  });
}

beforeEach(() => {
  storage.document = "file:///Documents";
  storage.files = new Map([
    [nativeUri, "rendered"],
    [storage.document + "/draft/clip.mov", "media"],
  ]);
  storage.directories = new Set([storage.document, "file:///Caches", "file:///Caches/StackReelExports"]);
  storage.interruptMove = false;
  storage.blockedListing = "";
  storage.blockedRead = "";
  storage.blockedDeletion = "";
});

it("restores after container relocation and compares the export dimensions, caption and asset bindings", () => {
  const cached = retainDraftExport(key, source(), nativeUri);
  expect(cached).not.toContain("StackReelExports/");
  expect(storage.files.has(nativeUri)).toBe(false);
  storage.document = "file:///another-container/Documents";
  storage.files.set(storage.document + "/draft/clip.mov", "media");
  expect(restoreDraftExport(key, source())).toBe(cached);
  expect(restoreDraftExport(key, source(1080))).toBeNull();
  expect(restoreDraftExport(key, source(720, "draft/clip.mov", storage.document + "/unchanged"))).toBeNull();
  storage.files.set(storage.document + "/other/clip.mov", "media");
  expect(restoreDraftExport(key, source(720, "other/clip.mov"))).toBeNull();
  storage.files.set(storage.document + "/draft/clip.mov", "");
  expect(restoreDraftExport(key, source())).toBeNull();
});

it("keeps the last successful export and native fallback on a failed replacement", () => {
  const first = retainDraftExport(key, source(), nativeUri);
  storage.files.set(nativeUri, "second");
  storage.interruptMove = true;
  expect(retainDraftExport(key, source(1080), nativeUri)).toBe(nativeUri);
  expect(storage.files.get(nativeUri)).toBe("second");
  expect(restoreDraftExport(key, source())).toBe(first);
  storage.interruptMove = false;
  const second = retainDraftExport(key, source(1080), nativeUri);
  expect(storage.files.has(first)).toBe(false);
  expect(restoreDraftExport(key, source(1080))).toBe(second);
  expect(restoreDraftExport(key, source())).toBeNull();
});

it("recovers the previous pair after interruption and skips occupied names", () => {
  const first = retainDraftExport(key, source(), nativeUri);
  const folder = new File(first).parentDirectory;
  new File(folder, "export-2.json").writeSync("{");
  new File(folder, "export-3.json").writeSync(new File(folder, "export-1.json").textSync());
  new Directory(folder, "export-4.mp4").create();
  expect(restoreDraftExport(key, source())).toBe(first);
  storage.files.set(nativeUri, "replacement");
  expect(retainDraftExport(key, source(), nativeUri)).toBe(folder.uri + "/export-5.mp4");
  expect(new Directory(folder, "export-4.mp4").exists).toBe(true);
});

it("treats incomplete, malformed and purged cache entries as misses", () => {
  const cached = retainDraftExport(key, source(), nativeUri);
  for (const contents of ["", "truncated", undefined]) {
    if (contents === undefined) storage.files.delete(cached);
    else storage.files.set(cached, contents);
    expect(restoreDraftExport(key, source())).toBeNull();
  }
  storage.files.set(cached, "rendered");
  expect(restoreDraftExport(key, null)).toBeNull();
  expect(restoreDraftExport(key, "{")).toBeNull();
  for (const malformed of ["{", "null", "{}", '{"version":1,"bytes":8,"identity":null}']) {
    storage.files.set(cached.replace(/\.mp4$/, ".json"), malformed);
    expect(restoreDraftExport(key, source())).toBeNull();
  }
});

it("isolates drafts and preserves unrelated files and directories on clear", () => {
  const single = retainDraftExport(key, source(), nativeUri);
  const folder = new File(single).parentDirectory;
  const unrelated = new File(folder, "notes.mp4");
  unrelated.writeSync("keep");
  const nested = new Directory(folder, "external");
  nested.create();
  const other: DraftExportKey = { kind: "template", template: { id: "Demo" }, draftId: key.draftId };
  storage.files.set(nativeUri, "another");
  const template = retainDraftExport(other, source(), nativeUri);
  expect(restoreDraftExport({ ...other, template: { id: "demo" } }, source())).toBeNull();
  clearDraftExport(key);
  expect(restoreDraftExport(key, source())).toBeNull();
  expect(restoreDraftExport(other, source())).toBe(template);
  expect(unrelated.exists && nested.exists).toBe(true);
});

it("returns the native file for invalid keys or an inaccessible cache", () => {
  expect(retainDraftExport({ ...key, draftId: "../escape" }, source(), nativeUri)).toBe(nativeUri);
  storage.files.set("file:///Caches/StackReelDraftExports", "foreign file");
  expect(retainDraftExport(key, source(), nativeUri)).toBe(nativeUri);
  expect(storage.files.get(nativeUri)).toBe("rendered");
  expect(restoreDraftExport(key, source())).toBeNull();
  expect(() => clearDraftExport(key)).not.toThrow();
});
