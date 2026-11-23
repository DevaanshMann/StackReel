import { probeVideo } from "@stackreel/engine";
import { randomUUID } from "expo-crypto";
import { Directory, File } from "expo-file-system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTemplateMusic,
  clearTemplateVideoSlot,
  commitTemplateDraftUpdate,
  createDraftMediaFile,
  deleteTemplateDraft,
  duplicateTemplateDraft,
  listTemplateDraftIds,
  loadTemplateDraft,
  renameTemplateDraft,
  saveTemplateDraft,
} from "../src/template-drafts";
import {
  createTemplateClip,
  createTemplateMusic,
  createTemplateSource,
  getEmptyVideoSlots,
  getTemplateTextFields,
  getVideoSlots,
  mobileTemplates,
  setTemplateClipReframe,
  setTemplateClipTrim,
  setTemplateClipVolume,
  setTemplateText,
  swapTemplateClips,
} from "../src/template-editor";

import type { TemplateClip } from "../src/template-editor";
import * as templateEditor from "../src/template-editor";
import { importTemplateVideos } from "../src/template-video-import";
import { pickOrderedVideos } from "../src/video-picker";

vi.mock("@stackreel/engine", () => ({ probeVideo: vi.fn() }));
vi.mock("../src/video-picker", () => ({ pickOrderedVideos: vi.fn(), pickVideo: vi.fn() }));

const storage = vi.hoisted(() => ({
  document: "file:///Documents",
  files: new Map<string, string>(),
  directories: new Set<string>(),
  interruptMove: false,
  blockedDeletion: "",
  blockedListing: "",
  nextMedia: 0,
}));

vi.mock("expo-crypto", () => ({
  randomUUID: vi.fn(() => `00000000-0000-4000-8000-${String(++storage.nextMedia).padStart(12, "0")}`),
}));

vi.mock("expo-file-system", () => {
  class Entry {
    uri: string;

    constructor(origin: string | Entry, ...parts: string[]) {
      this.uri = [typeof origin === "string" ? origin : origin.uri, ...parts].join("/");
    }

    get name() {
      return this.uri.slice(this.uri.lastIndexOf("/") + 1);
    }

    get parentDirectory(): Directory {
      return new Directory(this.uri.slice(0, this.uri.lastIndexOf("/")));
    }
  }

  class File extends Entry {
    get exists() {
      return storage.files.has(this.uri);
    }

    delete() {
      if (this.uri === storage.blockedDeletion) throw new Error("Couldn’t delete file");
      storage.files.delete(this.uri);
    }

    textSync() {
      const text = storage.files.get(this.uri);
      if (text === undefined) throw new Error("File is missing");
      return text;
    }

    writeSync(data: string) {
      if (!this.parentDirectory.exists) throw new Error("Parent directory is missing");
      storage.files.set(this.uri, data);
    }

    async move(destination: File) {
      this.moveSync(destination);
    }

    async copy(destination: File) {
      destination.writeSync(this.textSync());
    }

    moveSync(destination: File) {
      if (storage.interruptMove) throw new Error("Interrupted write");
      if (destination.exists) throw new Error("Destination already exists");
      destination.writeSync(this.textSync());
      this.delete();
      this.uri = destination.uri;
    }
  }

  class Directory extends Entry {
    get exists() {
      return storage.directories.has(this.uri);
    }

    create({ intermediates = false, idempotent = false } = {}) {
      if (this.exists) {
        if (!idempotent) throw new Error("Directory already exists");
        return;
      }
      if (!this.parentDirectory.exists) {
        if (!intermediates) throw new Error("Parent directory is missing");
        this.parentDirectory.create({ intermediates, idempotent });
      }
      storage.directories.add(this.uri);
    }

    list() {
      if (!this.exists || this.uri === storage.blockedListing) throw new Error("Cannot list directory");
      const isChild = (uri: string) => uri.slice(0, uri.lastIndexOf("/")) === this.uri;
      return [
        ...[...storage.directories].filter(isChild).map((uri) => new Directory(uri)),
        ...[...storage.files.keys()].filter(isChild).map((uri) => new File(uri)),
      ];
    }

    delete() {
      for (const entry of this.list()) entry.delete();
      storage.directories.delete(this.uri);
    }
  }

  return {
    File,
    Directory,
    Paths: {
      cache: new Directory("file:///Caches"),
      get document() {
        return new Directory(storage.document);
      },
    },
  };
});

const beforeAfter = mobileTemplates.find(({ id }) => id === "before-after")!;
const beforeAfterWithoutMusic = { ...beforeAfter, audio: {} };
const beforeAfterRenamedLabels = {
  ...beforeAfter,
  tracks: beforeAfter.tracks.map((track) => (track.id === "labels" ? { ...track, id: "corner-labels" } : track)),
};
const beforeAfterShorterCaption = {
  ...beforeAfter,
  slots: beforeAfter.slots.map((slot) => (slot.id === "caption" ? { ...slot, maxChars: 24 } : slot)),
};
const hook = mobileTemplates.find(({ id }) => id === "hook-and-reveal")!;
const [before, after] = getVideoSlots(beforeAfter) as [
  ReturnType<typeof getVideoSlots>[number],
  ReturnType<typeof getVideoSlots>[number],
];
const metadata = { width: 1920, height: 1080, startUs: 0, durationUs: 9_000_000 };
const firstDraftId = "11111111-1111-4111-8111-111111111111";
const secondDraftId = "22222222-2222-4222-8222-222222222222";

function fixture(draftId = beforeAfter.id) {
  const beforeFile = createDraftMediaFile(beforeAfter, "Before.mov", draftId);
  const afterFile = createDraftMediaFile(beforeAfter, "After.mov", draftId);
  const musicFile = createDraftMediaFile(beforeAfter, "Track.m4a", draftId);
  for (const file of [beforeFile, afterFile, musicFile]) file.writeSync("fixture");
  const beforeClip = createTemplateClip(before, beforeFile.uri, "Before.mov", metadata);
  const edits = {
    clips: {
      [before.id]: setTemplateClipReframe(setTemplateClipTrim(before, beforeClip, 30), beforeAfter.canvas, {
        zoom: 2,
        x: 0.7,
        y: 0.25,
      }),
      [after.id]: createTemplateClip(after, afterFile.uri, "After.mov", metadata),
    },
    textOverrides: setTemplateText(getTemplateTextFields(beforeAfter)[0]!, {}, "First cut"),
    music: createTemplateMusic(musicFile.uri, "Track.m4a", { startUs: 25_000, durationUs: 2_000_000 }),
  };
  return { edits, beforeFile, afterFile, musicFile };
}

beforeEach(() => {
  storage.document = "file:///Documents";
  storage.files.clear();
  storage.directories = new Set([storage.document, "file:///Caches", "file:///Caches/ImagePicker"]);
  storage.interruptMove = false;
  storage.blockedDeletion = "";
  storage.blockedListing = "";
});

describe("duplicating a template draft", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [beforeAfter.id, true],
    [beforeAfter.id, false],
    [firstDraftId, true],
    [firstDraftId, false],
  ] as const)("copies %s independently (delete source first: %s)", async (sourceId, deleteSource) => {
    const { edits, beforeFile, afterFile, musicFile } = fixture(sourceId);
    edits.clips[before.id] = setTemplateClipVolume(edits.clips[before.id]!, 0);
    for (const file of [beforeFile, afterFile, musicFile]) file.writeSync(file.name);
    saveTemplateDraft(beforeAfter, edits, sourceId);
    renameTemplateDraft(beforeAfter, "Original", sourceId);
    // Restore the files a previous cleanup may have left. Only the newest manifest and its assets belong in the copy.
    const original = beforeFile.parentDirectory;
    new File(original, "draft-1.json").writeSync("old");
    new File(original, "pending.json").writeSync("staging");
    createDraftMediaFile(beforeAfter, "unused.mov", sourceId).writeSync("unused");
    const originalFiles = new Map(storage.files);
    vi.mocked(randomUUID).mockReturnValueOnce(sourceId).mockReturnValueOnce(secondDraftId);
    const { draftId, draft, source } = await duplicateTemplateDraft(beforeAfter, sourceId, " Copy ");
    expect(draftId).toBe(secondDraftId);
    expect(draft.name).toBe("Copy");
    expect(draft.textOverrides).toEqual(edits.textOverrides);
    expect(draft.missingSlots).toEqual([]);
    expect(draft.missingMusic).toBe(false);
    const destination = new Directory(storage.document, "StackReelDraftInstances", beforeAfter.id, draftId);
    for (const [asset, file, copied] of [
      [edits.clips[before.id], beforeFile, draft.clips[before.id]],
      [edits.clips[after.id], afterFile, draft.clips[after.id]],
      [edits.music, musicFile, draft.music],
    ] as const) {
      const expected = new File(destination, file.name);
      expect(copied).toEqual({ ...asset, uri: expected.uri });
      expect(expected.textSync()).toBe(file.name);
    }
    expect(source).not.toBeNull();
    expect(source).toBe(createTemplateSource(beforeAfter, draft.clips, draft.textOverrides, draft.music));
    expect(source).not.toContain(original.uri + "/");
    expect(destination.list()).toHaveLength(4);
    for (const [uri, bytes] of originalFiles) expect(storage.files.get(uri)).toBe(bytes);
    expect(loadTemplateDraft(beforeAfter, draftId)).toEqual(draft);

    const removedId = deleteSource ? sourceId : draftId;
    const survivorId = deleteSource ? draftId : sourceId;
    const survivor = loadTemplateDraft(beforeAfter, survivorId)!;
    const removed = loadTemplateDraft(beforeAfter, removedId)!;
    saveTemplateDraft(beforeAfter, { ...removed, ...clearTemplateVideoSlot(removed, before.id) }, removedId);
    deleteTemplateDraft(beforeAfter, removedId);
    expect(listTemplateDraftIds(beforeAfter)).toEqual([survivorId]);
    expect(loadTemplateDraft(beforeAfter, survivorId)).toEqual(survivor);
    for (const asset of [...Object.values(survivor.clips), survivor.music!]) {
      const file = new File(asset.uri);
      expect(file.textSync()).toBe(file.name);
    }
  });

  it("copies a shared basename once and keeps the copy undiscoverable while staging", async () => {
    const { edits, beforeFile } = fixture(firstDraftId);
    const shared = {
      ...edits,
      clips: { ...edits.clips, [after.id]: { ...edits.clips[after.id]!, uri: beforeFile.uri } },
      music: { ...edits.music, uri: beforeFile.uri },
    };
    saveTemplateDraft(beforeAfter, shared, firstDraftId);
    const copy = vi.spyOn(File.prototype, "copy").mockImplementation(async function (this: File, target) {
      new File(target.uri).writeSync(this.textSync());
      expect(listTemplateDraftIds(beforeAfter)).toEqual([firstDraftId]);
    });
    const { draftId, draft } = await duplicateTemplateDraft(beforeAfter, firstDraftId, "Shared copy");
    expect(copy).toHaveBeenCalledTimes(1);
    const uri = new File(
      new Directory(storage.document, "StackReelDraftInstances", beforeAfter.id, draftId),
      beforeFile.name,
    ).uri;
    expect(draft.clips[before.id]?.uri).toBe(uri);
    expect(draft.clips[after.id]?.uri).toBe(uri);
    expect(draft.music?.uri).toBe(uri);
  });

  it("retains missing media settings and unsafe references without accessing unsafe paths", async () => {
    const { edits, beforeFile, afterFile, musicFile } = fixture(firstDraftId);
    saveTemplateDraft(beforeAfter, edits, firstDraftId);
    const manifest = new File(beforeFile.parentDirectory, "draft-1.json");
    const stored = JSON.parse(manifest.textSync());
    stored.clips[after.id].file = "../elsewhere.mov";
    stored.extraSetting = "preserved";
    manifest.writeSync(JSON.stringify(stored));
    beforeFile.delete();
    musicFile.delete();
    const reads = vi.spyOn(File.prototype, "exists", "get");
    const copy = vi.spyOn(File.prototype, "copy");
    const { draftId, draft, source } = await duplicateTemplateDraft(beforeAfter, firstDraftId, "Partial");
    expect(copy).not.toHaveBeenCalled();
    expect(reads.mock.contexts).not.toContainEqual(
      expect.objectContaining({ uri: expect.stringContaining("elsewhere") }),
    );
    expect(source).toBeNull();
    expect(draft).toMatchObject({
      missingSlots: [before.id, after.id],
      missingMusic: true,
      textOverrides: edits.textOverrides,
    });
    const destination = new Directory(storage.document, "StackReelDraftInstances", beforeAfter.id, draftId);
    const saved = new File(destination, "draft-1.json");
    expect(JSON.parse(saved.textSync())).toEqual({ ...stored, name: "Partial" });
    expect(afterFile.exists).toBe(true);
    for (const file of [beforeFile, musicFile]) new File(destination, file.name).writeSync("recovered");
    expect(loadTemplateDraft(beforeAfter, draftId)).toMatchObject({
      clips: { [before.id]: { ...edits.clips[before.id], uri: new File(destination, beforeFile.name).uri } },
      missingSlots: [after.id],
      missingMusic: false,
    });
    expect(beforeFile.exists || musicFile.exists).toBe(false);
  });

  it.each(["media copy", "preview", "manifest"])("rolls back a failed %s and allows retry", async (step) => {
    const { edits } = fixture(firstDraftId);
    saveTemplateDraft(beforeAfter, edits, firstDraftId);
    const files = new Map(storage.files);
    const directories = new Set(storage.directories);
    if (step === "media copy") {
      vi.spyOn(File.prototype, "copy")
        .mockImplementationOnce(async function (this: File, target) {
          new File(target.uri).writeSync(this.textSync());
        })
        .mockImplementationOnce(async (target) => {
          new File(target.uri).writeSync("partial");
          throw new Error("Interrupted copy");
        });
    } else if (step === "preview") {
      vi.spyOn(templateEditor, "createTemplateSource").mockImplementationOnce(() => {
        throw new Error("Invalid preview");
      });
    } else {
      storage.interruptMove = true;
    }
    await expect(duplicateTemplateDraft(beforeAfter, firstDraftId, "Copy")).rejects.toThrow();
    expect(storage.files).toEqual(files);
    expect(storage.directories).toEqual(directories);
    expect(listTemplateDraftIds(beforeAfter)).toEqual([firstDraftId]);
    storage.interruptMove = false;
    const copy = await duplicateTemplateDraft(beforeAfter, firstDraftId, "Copy");
    expect(loadTemplateDraft(beforeAfter, copy.draftId)).toEqual(copy.draft);
  });

  it("rejects a blank name or unreadable latest manifest before allocating a destination", async () => {
    const { edits, beforeFile } = fixture(firstDraftId);
    saveTemplateDraft(beforeAfter, edits, firstDraftId);
    await expect(duplicateTemplateDraft(beforeAfter, firstDraftId, "  ")).rejects.toThrow("name");
    new File(beforeFile.parentDirectory, "draft-2.json").writeSync("broken");
    const files = new Map(storage.files);
    const directories = new Set(storage.directories);
    await expect(duplicateTemplateDraft(beforeAfter, firstDraftId, "Copy")).rejects.toThrow();
    expect(storage.files).toEqual(files);
    expect(storage.directories).toEqual(directories);
  });
});

describe("template draft storage", () => {
  it("reopens a legacy mix, invalidates a rendered export on a volume change, and retains it on a no-op", () => {
    const { edits, beforeFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const snapshot = new File(beforeFile.parentDirectory, "draft-1.json");
    expect(JSON.parse(snapshot.textSync()).clips[before.id]).not.toHaveProperty("volumePercent");
    const loaded = loadTemplateDraft(beforeAfter)!;
    const source = createTemplateSource(beforeAfter, edits.clips, edits.textOverrides, edits.music);
    const outputUri = "file:///Exports/rendered.mp4";
    expect(commitTemplateDraftUpdate(beforeAfter, { ...loaded, source, outputUri })).toEqual({ source, outputUri });

    const quiet = setTemplateClipVolume(loaded.clips[before.id]!, 40);
    const clips = { ...loaded.clips, [before.id]: quiet };
    const changed = commitTemplateDraftUpdate(beforeAfter, { ...loaded, clips, source, outputUri });
    expect(changed.source).not.toBe(source);
    expect(changed.outputUri).toBeNull();
    const reopened = loadTemplateDraft(beforeAfter)!;
    expect(reopened.clips).toEqual(clips);
    expect(commitTemplateDraftUpdate(beforeAfter, { ...reopened, source: changed.source, outputUri })).toEqual({
      source: changed.source,
      outputUri,
    });
  });

  it.each([null, "50", -1, 101])("retains other edits when one saved volume is invalid (%s)", (volumePercent) => {
    const { edits, beforeFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const snapshot = new File(beforeFile.parentDirectory, "draft-1.json");
    const saved = JSON.parse(snapshot.textSync());
    saved.clips[before.id].volumePercent = volumePercent;
    snapshot.writeSync(JSON.stringify(saved));

    expect(loadTemplateDraft(beforeAfter)).toEqual({
      ...edits,
      name: null,
      clips: { [after.id]: edits.clips[after.id] },
      missingSlots: [before.id],
      missingMusic: false,
    });
    expect(beforeFile.exists).toBe(true);
  });

  it("discovers and reopens two independent cuts of the same template", () => {
    const first = fixture(firstDraftId);
    const second = fixture(secondDraftId);
    const field = getTemplateTextFields(beforeAfter)[0]!;
    const secondEdits = {
      ...second.edits,
      name: "Second cut",
      textOverrides: setTemplateText(field, {}, "Alternate"),
    };
    saveTemplateDraft(beforeAfter, secondEdits, secondDraftId);
    saveTemplateDraft(beforeAfter, first.edits, firstDraftId);
    renameTemplateDraft(beforeAfter, "First cut", firstDraftId);
    expect(listTemplateDraftIds(beforeAfter)).toEqual([firstDraftId, secondDraftId]);
    expect(listTemplateDraftIds(hook)).toEqual([]);

    const firstEdits = loadTemplateDraft(beforeAfter, firstDraftId)!;
    expect(firstEdits).toMatchObject({ ...first.edits, name: "First cut" });
    const update = { ...firstEdits, ...clearTemplateVideoSlot(firstEdits, after.id), music: null };
    commitTemplateDraftUpdate(beforeAfter, { ...update, source: null, outputUri: null }, firstDraftId);
    expect(loadTemplateDraft(beforeAfter, firstDraftId)).toEqual(update);
    expect(first.afterFile.exists || first.musicFile.exists).toBe(false);
    expect(loadTemplateDraft(beforeAfter, secondDraftId)).toEqual({
      ...secondEdits,
      missingSlots: [],
      missingMusic: false,
    });
    for (const file of [first.beforeFile, second.beforeFile, second.afterFile, second.musicFile]) {
      expect(file.textSync()).toBe("fixture");
    }
  });

  it.each([
    [firstDraftId, secondDraftId],
    [secondDraftId, firstDraftId],
  ] as const)("deletes %s while keeping reel %s ready to export after relaunch", (deletedId, survivorId) => {
    const deleted = fixture(deletedId);
    const survivor = fixture(survivorId);
    saveTemplateDraft(beforeAfter, { ...deleted.edits, name: "Opening" }, deletedId);
    const edits = { ...survivor.edits, name: "Closing" };
    saveTemplateDraft(beforeAfter, edits, survivorId);
    const expectedSource = createTemplateSource(beforeAfter, edits.clips, edits.textOverrides, edits.music);
    expect(expectedSource).not.toBeNull();

    deleteTemplateDraft(beforeAfter, deletedId);
    expect(listTemplateDraftIds(beforeAfter)).toEqual([survivorId]);
    const restored = loadTemplateDraft(beforeAfter, survivorId)!;
    expect(restored.name).toBe("Closing");
    expect(createTemplateSource(beforeAfter, restored.clips, restored.textOverrides, restored.music)).toBe(
      expectedSource,
    );
    expect(deleted.beforeFile.parentDirectory.exists).toBe(false);
  });

  it.each([true, false])(
    "preserves a version-one draft in place and deletes independently (legacy first: %s)",
    (legacyFirst) => {
      const folder = new Directory(storage.document, "StackReelDrafts", beforeAfter.id);
      folder.create({ intermediates: true });
      const soundtrack = new File(folder, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.m4a");
      soundtrack.writeSync("old soundtrack");
      const manifest = new File(folder, "draft-7.json");
      const oldJson = JSON.stringify({
        version: 1,
        clips: {},
        textOverrides: {},
        music: { file: soundtrack.name, name: "Old song", sourceStartUs: 0, sourceEndUs: 2_000_000 },
      });
      manifest.writeSync(oldJson);
      const second = fixture(secondDraftId);
      saveTemplateDraft(beforeAfter, second.edits, secondDraftId);
      expect(listTemplateDraftIds(beforeAfter)).toEqual([beforeAfter.id, secondDraftId]);
      expect(loadTemplateDraft(beforeAfter, beforeAfter.id)).toMatchObject({
        name: null,
        music: { uri: soundtrack.uri, name: "Old song" },
      });
      expect(manifest.textSync()).toBe(oldJson);

      const deletedId = legacyFirst ? beforeAfter.id : secondDraftId;
      const survivorId = legacyFirst ? secondDraftId : beforeAfter.id;
      const survivor = loadTemplateDraft(beforeAfter, survivorId)!;
      deleteTemplateDraft(beforeAfter, deletedId);
      expect(listTemplateDraftIds(beforeAfter)).toEqual([survivorId]);
      expect(loadTemplateDraft(beforeAfter, deletedId)).toBeNull();
      expect(loadTemplateDraft(beforeAfter, survivorId)).toEqual(survivor);
      expect(soundtrack.exists).toBe(!legacyFirst);
      expect(manifest.exists).toBe(!legacyFirst);
      expect(second.musicFile.exists).toBe(legacyFirst);
      deleteTemplateDraft(beforeAfter, survivorId);
      expect(listTemplateDraftIds(beforeAfter)).toEqual([]);
      expect(storage.files.size).toBe(0);
    },
  );

  it("discovers committed snapshots even when one draft cannot be opened", () => {
    const good = fixture(firstDraftId);
    saveTemplateDraft(beforeAfter, good.edits, firstDraftId);
    const legacy = fixture();
    saveTemplateDraft(beforeAfter, legacy.edits);
    const corrupt = fixture(secondDraftId);
    new File(corrupt.musicFile.parentDirectory, "draft-1.json").writeSync("unreadable JSON");
    const ids = [beforeAfter.id, firstDraftId, secondDraftId];
    expect(listTemplateDraftIds(beforeAfter)).toEqual(ids);
    expect(() => loadTemplateDraft(beforeAfter, secondDraftId)).toThrow();
    for (const blocked of [legacy, corrupt]) {
      storage.blockedListing = blocked.musicFile.parentDirectory.uri;
      expect(listTemplateDraftIds(beforeAfter)).toEqual(ids);
      expect(() => loadTemplateDraft(beforeAfter, blocked === legacy ? beforeAfter.id : secondDraftId)).toThrow(
        "Cannot list",
      );
      expect(loadTemplateDraft(beforeAfter, firstDraftId)).toMatchObject(good.edits);
    }
  });

  it("cleans up interrupted first saves while preserving unrelated files and directories", () => {
    expect(listTemplateDraftIds(beforeAfter)).toEqual([]);
    const { edits, musicFile } = fixture(firstDraftId);
    storage.interruptMove = true;
    expect(() => saveTemplateDraft(beforeAfter, edits, firstDraftId)).toThrow("Interrupted write");
    const folder = musicFile.parentDirectory;
    new File(folder, "pending.json").writeSync("incomplete save");
    const nested = new Directory(folder, "draft-1.json");
    nested.create();
    new File(nested, "draft-2.json").writeSync("nested snapshot");
    const unrelated = new Directory(folder.parentDirectory, "notes");
    unrelated.create();
    new File(unrelated, "draft-1.json").writeSync("unrelated");
    new File(folder.parentDirectory, secondDraftId).writeSync("a regular file");
    expect(listTemplateDraftIds(beforeAfter)).toEqual([]);
    expect(musicFile.exists).toBe(false);
    expect([...storage.files.values()].sort()).toEqual(["a regular file", "nested snapshot", "unrelated"]);
    expect(folder.exists).toBe(true);
  });

  it("retries interrupted deletion cleanup on startup and removes empty draft folders", () => {
    const old = fixture(firstDraftId);
    const good = fixture(secondDraftId);
    saveTemplateDraft(beforeAfter, old.edits, firstDraftId);
    saveTemplateDraft(beforeAfter, good.edits, secondDraftId);
    storage.blockedDeletion = old.musicFile.uri;
    deleteTemplateDraft(beforeAfter, firstDraftId);
    expect(listTemplateDraftIds(beforeAfter)).toEqual([secondDraftId]);
    expect(old.musicFile.exists).toBe(true);
    storage.blockedDeletion = "";
    expect(listTemplateDraftIds(beforeAfter)).toEqual([secondDraftId]);
    expect(old.musicFile.parentDirectory.exists).toBe(false);
    expect(loadTemplateDraft(beforeAfter, secondDraftId)).toMatchObject(good.edits);
  });

  it("propagates a collection listing failure while leaving the legacy draft accessible", () => {
    const legacy = fixture();
    const newer = fixture(firstDraftId);
    saveTemplateDraft(beforeAfter, legacy.edits);
    saveTemplateDraft(beforeAfter, newer.edits, firstDraftId);
    storage.blockedListing = newer.musicFile.parentDirectory.parentDirectory.uri;
    const files = new Map(storage.files);
    expect(() => listTemplateDraftIds(beforeAfter)).toThrow("Cannot list directory");
    expect(storage.files).toEqual(files);
    expect(loadTemplateDraft(beforeAfter)).toMatchObject(legacy.edits);
  });

  it("rejects foreign clips and music and preserves both drafts if an update cannot be published", () => {
    const first = fixture(firstDraftId);
    const second = fixture(secondDraftId);
    saveTemplateDraft(beforeAfter, first.edits, firstDraftId);
    saveTemplateDraft(beforeAfter, second.edits, secondDraftId);
    const files = new Map(storage.files);
    for (const foreign of [{ clips: first.edits.clips }, { music: first.edits.music }]) {
      expect(() => saveTemplateDraft(beforeAfter, { ...second.edits, ...foreign }, secondDraftId)).toThrow(
        "own folder",
      );
    }
    storage.interruptMove = true;
    expect(() =>
      commitTemplateDraftUpdate(
        beforeAfter,
        { ...second.edits, music: null, source: null, outputUri: null },
        secondDraftId,
      ),
    ).toThrow("Interrupted write");
    expect(() => renameTemplateDraft(beforeAfter, "Retitled", secondDraftId)).toThrow("Interrupted write");
    expect(storage.files).toEqual(files);
    expect(loadTemplateDraft(beforeAfter, firstDraftId)).toMatchObject(first.edits);
    expect(loadTemplateDraft(beforeAfter, secondDraftId)).toMatchObject(second.edits);
  });

  it("rejects unsafe path segments before accessing a draft", () => {
    const { edits } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const files = new Map(storage.files);
    const directories = new Set(storage.directories);
    for (const id of ["..", "../" + beforeAfter.id, "nested/draft", "%2e%2e", "", hook.id]) {
      expect(() => loadTemplateDraft(beforeAfter, id)).toThrow("Invalid draft ID");
      expect(() => deleteTemplateDraft(beforeAfter, id)).toThrow("Invalid draft ID");
      expect(() => createDraftMediaFile(beforeAfter, "Clip.mov", id)).toThrow("Invalid draft ID");
    }
    const invalid = { ...beforeAfter, id: "../escape" };
    expect(() => listTemplateDraftIds(invalid)).toThrow();
    expect(() => saveTemplateDraft(invalid, edits, firstDraftId)).toThrow();
    expect(storage.files).toEqual(files);
    expect(storage.directories).toEqual(directories);
  });

  it("restores edited media, trims, framing, and text after the app sandbox moves", () => {
    const { edits } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const original = createTemplateSource(beforeAfter, edits.clips, edits.textOverrides, edits.music);
    const oldRoot = storage.document;
    const newRoot = "file:///New-Container/Documents";
    storage.files = new Map([...storage.files].map(([uri, data]) => [uri.replace(oldRoot, newRoot), data]));
    storage.directories = new Set([...storage.directories].map((uri) => uri.replace(oldRoot, newRoot)));
    storage.document = newRoot;
    const restored = loadTemplateDraft(beforeAfter)!;
    expect(restored.missingSlots).toEqual([]);
    expect(restored.missingMusic).toBe(false);
    const updated = createTemplateSource(beforeAfter, restored.clips, restored.textOverrides, restored.music);
    expect(updated?.replaceAll(newRoot, oldRoot)).toBe(original);
  });

  it("reopens swapped media references in a partial draft and keeps its recoverable media settings", () => {
    const slots = getVideoSlots(hook);
    const [hookShot, bRoll, reveal] = slots;
    const files = slots.map(({ id }) => createDraftMediaFile(hook, `${id}.mov`));
    const clips = Object.fromEntries(
      slots.map((slot, index) => {
        const file = files[index]!;
        file.writeSync(slot.id);
        return [slot.id, createTemplateClip(slot, file.uri, `${slot.id}.mov`, metadata)];
      }),
    );
    const framedHook = setTemplateClipReframe(setTemplateClipTrim(hookShot!, clips[hookShot!.id]!, 30), hook.canvas, {
      zoom: 2,
      x: 1,
      y: 0.5,
    });
    clips[hookShot!.id] = framedHook;
    const musicFile = createDraftMediaFile(hook, "Track.m4a");
    musicFile.writeSync("soundtrack");
    const music = createTemplateMusic(musicFile.uri, "Track.m4a", { startUs: 0, durationUs: 2_000_000 });
    const edits = { name: "Weekend cut", clips, textOverrides: { "text/0": "Watch this" }, music };
    saveTemplateDraft(hook, edits);

    const bRollFile = files[1]!;
    bRollFile.delete();
    musicFile.delete();
    const draft = loadTemplateDraft(hook)!;
    expect(draft).toMatchObject({ missingSlots: [bRoll!.id], missingMusic: true });
    const swapped = { ...draft, clips: swapTemplateClips(draft.clips, hookShot!, reveal!) };
    expect(createTemplateSource(hook, swapped.clips)).toBeNull();
    saveTemplateDraft(hook, swapped);

    const folder = `${storage.document}/StackReelDrafts/${hook.id}`;
    expect([...storage.files.keys()].sort()).toEqual([files[0]!.uri, files[2]!.uri, `${folder}/draft-2.json`].sort());
    expect(files[0]!.textSync()).toBe(hookShot!.id);
    expect(files[2]!.textSync()).toBe(reveal!.id);
    expect(loadTemplateDraft(hook)).toEqual(swapped);

    bRollFile.writeSync(bRoll!.id);
    musicFile.writeSync("soundtrack");
    const reopened = loadTemplateDraft(hook)!;
    expect(reopened).toEqual({
      ...edits,
      clips: {
        [hookShot!.id]: { ...clips[reveal!.id], trimOutUs: hookShot!.minDurationUs },
        [bRoll!.id]: clips[bRoll!.id],
        [reveal!.id]: { ...framedHook, trimOutUs: 5_000_000 },
      },
      missingSlots: [],
      missingMusic: false,
    });
    expect(
      JSON.parse(createTemplateSource(hook, reopened.clips, reopened.textOverrides, reopened.music)!).assets,
    ).toEqual({
      [`slot:${hookShot!.id}`]: files[2]!.uri,
      [`slot:${bRoll!.id}`]: bRollFile.uri,
      [`slot:${reveal!.id}`]: files[0]!.uri,
      "slot:music": musicFile.uri,
    });
  });

  it("keeps drafts independent and prunes media only after committing a change", () => {
    const { edits, beforeFile, afterFile, musicFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const hookText = setTemplateText(getTemplateTextFields(hook)[0]!, {}, "Watch this");
    saveTemplateDraft(hook, { clips: {}, textOverrides: hookText, music: null });
    const replacement = createDraftMediaFile(beforeAfter, "New video.MOV");
    replacement.writeSync("fixture");
    const clips = {
      ...edits.clips,
      [before.id]: createTemplateClip(before, replacement.uri, "New video.MOV", metadata),
    };
    const pendingEdits = { ...edits, clips, music: null };
    const folder = `${storage.document}/StackReelDrafts/${beforeAfter.id}`;
    const pending = `${folder}/pending.json`;
    const unrelatedFile = `${folder}/notes.txt`;
    storage.files.set(unrelatedFile, "keep");

    storage.interruptMove = true;
    expect(() => saveTemplateDraft(beforeAfter, pendingEdits)).toThrow("Interrupted write");
    expect(storage.files.has(pending)).toBe(false);
    expect(beforeFile.exists && musicFile.exists).toBe(true);
    expect(loadTemplateDraft(beforeAfter)).toMatchObject(edits);
    expect(replacement.exists).toBe(false);

    storage.interruptMove = false;
    replacement.writeSync("fixture");
    saveTemplateDraft(beforeAfter, pendingEdits);
    expect(beforeFile.exists || musicFile.exists).toBe(false);
    expect(afterFile.exists && replacement.exists).toBe(true);
    expect(loadTemplateDraft(beforeAfter)).toMatchObject(pendingEdits);
    expect(loadTemplateDraft(hook)).toMatchObject({ textOverrides: hookText });
    expect([...storage.files.keys()].filter((uri) => uri.startsWith(`${folder}/`)).sort()).toEqual(
      [afterFile.uri, replacement.uri, `${folder}/draft-2.json`, unrelatedFile].sort(),
    );
  });

  it("recovers remaining edits when a saved clip and soundtrack are missing", () => {
    const { edits, beforeFile, musicFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    beforeFile.delete();
    musicFile.delete();

    expect(loadTemplateDraft(beforeAfter)).toEqual({
      name: null,
      clips: { [after.id]: edits.clips[after.id] },
      textOverrides: edits.textOverrides,
      music: null,
      missingSlots: [before.id],
      missingMusic: true,
    });
  });

  it("reopens a cleared slot as empty, keeping the original and the other draft edits", () => {
    const { edits, beforeFile, afterFile, musicFile } = fixture();
    const name = "Weekend cut";
    const original = new File("file:///Documents/After.mov");
    original.writeSync("original video");
    saveTemplateDraft(beforeAfter, { ...edits, name });

    const draft = loadTemplateDraft(beforeAfter)!;
    const source = createTemplateSource(beforeAfter, draft.clips, draft.textOverrides, draft.music);
    expect(source).not.toBeNull();
    const cleared = clearTemplateVideoSlot(draft, after.id);
    const render = commitTemplateDraftUpdate(beforeAfter, {
      ...draft,
      ...cleared,
      source,
      outputUri: "file:///Caches/export.mp4",
    });

    expect(render).toEqual({ source: null, outputUri: null });
    const reopened = loadTemplateDraft(beforeAfter)!;
    expect(reopened).toEqual({ ...draft, clips: { [before.id]: edits.clips[before.id] } });
    expect(getEmptyVideoSlots([before, after], reopened.clips, reopened.missingSlots)).toEqual([after]);
    expect(afterFile.exists).toBe(false);
    expect(beforeFile.exists && musicFile.exists).toBe(true);
    expect(original.textSync()).toBe("original video");
  });

  it("keeps the saved clips, render source, and previous export when clearing cannot commit", () => {
    const { edits } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const draft = loadTemplateDraft(beforeAfter)!;
    const source = createTemplateSource(beforeAfter, draft.clips, draft.textOverrides, draft.music);
    expect(source).not.toBeNull();
    const output = new File("file:///Caches/export.mp4");
    output.writeSync("saved export");
    const files = new Map(storage.files);
    const cleared = clearTemplateVideoSlot(draft, after.id);

    storage.interruptMove = true;
    expect(() =>
      commitTemplateDraftUpdate(beforeAfter, { ...draft, ...cleared, source, outputUri: output.uri }),
    ).toThrow("Interrupted write");

    expect(storage.files).toEqual(files);
    const reopened = loadTemplateDraft(beforeAfter)!;
    expect(reopened).toEqual(draft);
    expect(createTemplateSource(beforeAfter, reopened.clips, reopened.textOverrides, reopened.music)).toBe(source);
    expect(output.textSync()).toBe("saved export");
  });

  it("preserves missing media and its settings when a caption autosaves", () => {
    const { edits, beforeFile, musicFile } = fixture();
    saveTemplateDraft(beforeAfter, { ...edits, name: "Weekend cut" });
    beforeFile.delete();
    musicFile.delete();

    const draft = loadTemplateDraft(beforeAfter)!;
    const field = getTemplateTextFields(beforeAfter)[0]!;
    const textOverrides = setTemplateText(field, draft.textOverrides, "Final cut");
    saveTemplateDraft(beforeAfter, { ...draft, textOverrides });

    const reopened = loadTemplateDraft(beforeAfter)!;
    expect(reopened).toEqual({ ...draft, textOverrides });

    beforeFile.writeSync("fixture");
    musicFile.writeSync("fixture");
    saveTemplateDraft(beforeAfter, reopened);
    expect(loadTemplateDraft(beforeAfter)).toEqual({
      ...edits,
      name: "Weekend cut",
      textOverrides,
      missingSlots: [],
      missingMusic: false,
    });
  });

  it("clears only the resolved warning when replacing missing media", () => {
    const { edits, beforeFile, musicFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    beforeFile.delete();
    musicFile.delete();

    const draft = loadTemplateDraft(beforeAfter)!;
    const replacement = createDraftMediaFile(beforeAfter, "Replacement.mov");
    replacement.writeSync("fixture");
    const clips = {
      ...draft.clips,
      [before.id]: createTemplateClip(before, replacement.uri, "Replacement.mov", metadata),
    };
    saveTemplateDraft(beforeAfter, { ...draft, clips, missingSlots: [] });

    const reopened = loadTemplateDraft(beforeAfter)!;
    expect(reopened).toEqual({ ...draft, clips, missingSlots: [], missingMusic: true });

    const soundtrack = createDraftMediaFile(beforeAfter, "Replacement.m4a");
    soundtrack.writeSync("fixture");
    const music = createTemplateMusic(soundtrack.uri, "Replacement.m4a", { startUs: 0, durationUs: 2_000_000 });
    saveTemplateDraft(beforeAfter, { ...reopened, music, missingMusic: false });
    expect(loadTemplateDraft(beforeAfter)).toEqual({ ...reopened, music, missingMusic: false });
  });

  it("forgets missing music and keeps the rendered export and draft edits", () => {
    const { edits, musicFile } = fixture();
    const name = "Weekend cut";
    saveTemplateDraft(beforeAfter, { ...edits, name });
    musicFile.delete();

    const draft = loadTemplateDraft(beforeAfter)!;
    expect(draft).toMatchObject({ music: null, missingMusic: true });
    const source = createTemplateSource(beforeAfter, draft.clips, draft.textOverrides, draft.music);
    expect(source).not.toBeNull();
    const outputUri = "file:///Caches/export.mp4";
    const render = commitTemplateDraftUpdate(beforeAfter, clearTemplateMusic({ ...draft, source, outputUri }));
    expect(render).toEqual({ source, outputUri });

    expect(loadTemplateDraft(beforeAfter)).toEqual({ ...draft, missingMusic: false });
    musicFile.writeSync("restored music copy");
    expect(loadTemplateDraft(beforeAfter)).toEqual({ ...draft, missingMusic: false });
  });

  it("can retry a failed missing music removal and keeps missing video references", () => {
    const { edits, afterFile, musicFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    afterFile.delete();
    musicFile.delete();

    const draft = loadTemplateDraft(beforeAfter)!;
    expect(draft).toMatchObject({ missingSlots: [after.id], missingMusic: true });
    const files = new Map(storage.files);
    const removeMusic = () =>
      commitTemplateDraftUpdate(beforeAfter, clearTemplateMusic({ ...draft, source: null, outputUri: null }));

    storage.interruptMove = true;
    expect(removeMusic).toThrow("Interrupted write");
    expect(storage.files).toEqual(files);
    expect(loadTemplateDraft(beforeAfter)).toEqual(draft);

    storage.interruptMove = false;
    removeMusic();
    expect(loadTemplateDraft(beforeAfter)).toEqual({ ...draft, missingMusic: false });

    afterFile.writeSync("restored video copy");
    expect(loadTemplateDraft(beforeAfter)).toEqual({
      ...draft,
      clips: edits.clips,
      missingSlots: [],
      missingMusic: false,
    });
  });

  it("renames a legacy draft and carries the name through later edits", () => {
    const { edits, musicFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    expect(loadTemplateDraft(beforeAfter)?.name).toBeNull();

    renameTemplateDraft(beforeAfter, "  Weekend cut  ");
    const renamed = loadTemplateDraft(beforeAfter)!;
    expect(renamed).toMatchObject({ ...edits, name: "Weekend cut" });

    saveTemplateDraft(beforeAfter, { ...renamed, music: null });
    expect(loadTemplateDraft(beforeAfter)).toMatchObject({ name: "Weekend cut", music: null });
    expect(musicFile.exists).toBe(false);
  });

  it("preserves missing media references when renaming a draft", () => {
    const { edits, beforeFile, musicFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    beforeFile.delete();
    musicFile.delete();

    renameTemplateDraft(beforeAfter, "Weekend cut");
    expect(loadTemplateDraft(beforeAfter)).toMatchObject({
      name: "Weekend cut",
      missingSlots: [before.id],
      missingMusic: true,
    });

    beforeFile.writeSync("fixture");
    musicFile.writeSync("fixture");
    expect(loadTemplateDraft(beforeAfter)).toMatchObject({ ...edits, missingSlots: [], missingMusic: false });
  });

  it("keeps the last name when a rename is blank or its write is interrupted", () => {
    const { edits } = fixture();
    saveTemplateDraft(beforeAfter, { ...edits, name: "Original cut" });

    expect(() => renameTemplateDraft(beforeAfter, "   ")).toThrow("Enter a name");
    storage.interruptMove = true;
    expect(() => renameTemplateDraft(beforeAfter, "Weekend cut")).toThrow("Interrupted write");
    expect(loadTemplateDraft(beforeAfter)).toMatchObject({ ...edits, name: "Original cut" });
  });

  it.each([
    ["malformed JSON", "broken snapshot"],
    ["an unsupported version", JSON.stringify({ version: 2, clips: {}, textOverrides: {} })],
  ])("preserves the saved files when autosave encounters %s", (_reason, contents) => {
    const { edits } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const folder = `${storage.document}/StackReelDrafts/${beforeAfter.id}`;
    storage.files.set(`${folder}/draft-1.json`, contents);
    const originalFiles = new Map(storage.files);
    const textOverrides = setTemplateText(getTemplateTextFields(beforeAfter)[0]!, {}, "New caption");

    expect(() => loadTemplateDraft(beforeAfter)).toThrow();
    expect(() => saveTemplateDraft(beforeAfter, { clips: {}, textOverrides, music: null })).toThrow();
    expect(storage.files).toEqual(originalFiles);
  });

  it.each(["loading", "autosaving"])(
    "preserves a version-one draft when %s after a video slot ID changes",
    (action) => {
      const { edits, beforeFile } = fixture();
      const name = "Weekend cut";
      beforeFile.writeSync("imported before video");
      saveTemplateDraft(beforeAfter, { ...edits, name });
      const originalFiles = new Map(storage.files);
      const manifest = new File(`${storage.document}/StackReelDrafts/${beforeAfter.id}/draft-1.json`);
      expect(JSON.parse(manifest.textSync())).toMatchObject({
        version: 1,
        clips: { [before.id]: { file: beforeFile.name } },
      });

      const renamedId = "opening-clip";
      const updatedTemplate = {
        ...beforeAfter,
        slots: beforeAfter.slots.map((slot) => (slot.id === before.id ? { ...slot, id: renamedId } : slot)),
        tracks: beforeAfter.tracks.map((track) =>
          track.type === "video"
            ? {
                ...track,
                items: track.items.map((item) => (item.slot === before.id ? { ...item, slot: renamedId } : item)),
              }
            : track,
        ),
      };

      if (action === "loading") {
        expect(() => loadTemplateDraft(updatedTemplate)).toThrow();
      } else {
        const textOverrides = setTemplateText(
          getTemplateTextFields(updatedTemplate)[0]!,
          edits.textOverrides,
          "New caption",
        );
        expect(() =>
          saveTemplateDraft(updatedTemplate, {
            ...edits,
            name,
            clips: { [after.id]: edits.clips[after.id]! },
            textOverrides,
          }),
        ).toThrow();
      }

      expect(storage.files).toEqual(originalFiles);
      expect(loadTemplateDraft(beforeAfter)).toEqual({ ...edits, name, missingSlots: [], missingMusic: false });
    },
  );

  it.each(["loading", "renaming", "saving directly"] as const)(
    "preserves a version-one draft when %s after the template drops music support",
    (action) => {
      const { edits, musicFile } = fixture();
      const name = "Weekend cut";
      musicFile.writeSync("imported soundtrack");
      saveTemplateDraft(beforeAfter, { ...edits, name });
      const originalFiles = new Map(storage.files);

      const attempts = {
        loading: () => loadTemplateDraft(beforeAfterWithoutMusic),
        renaming: () => renameTemplateDraft(beforeAfterWithoutMusic, "New name"),
        "saving directly": () => saveTemplateDraft(beforeAfterWithoutMusic, { ...edits, music: null }),
      };
      expect(attempts[action]).toThrow("The saved draft references music that is unavailable in this template.");

      expect(storage.files).toEqual(originalFiles);
      expect(musicFile.textSync()).toBe("imported soundtrack");
      expect(loadTemplateDraft(beforeAfter)).toEqual({ ...edits, name, missingSlots: [], missingMusic: false });
    },
  );

  it.each([null, undefined])(
    "reopens and edits a draft with saved music %s after the template drops support",
    (music) => {
      const { edits } = fixture();
      saveTemplateDraft(beforeAfter, { ...edits, music: null });
      const manifest = new File(`${storage.document}/StackReelDrafts/${beforeAfter.id}/draft-1.json`);
      manifest.writeSync(JSON.stringify({ ...JSON.parse(manifest.textSync()), music }));

      const restored = loadTemplateDraft(beforeAfterWithoutMusic)!;
      expect(restored).toEqual({ ...edits, name: null, music: null, missingSlots: [], missingMusic: false });

      const name = "Weekend cut";
      renameTemplateDraft(beforeAfterWithoutMusic, name);
      const textOverrides = setTemplateText(getTemplateTextFields(beforeAfterWithoutMusic)[0]!, {}, "New caption");
      saveTemplateDraft(beforeAfterWithoutMusic, { ...restored, name, textOverrides });
      expect(loadTemplateDraft(beforeAfterWithoutMusic)).toEqual({ ...restored, name, textOverrides });
    },
  );

  it("reopens and autosaves a draft after only a video slot label changes", () => {
    const { edits, beforeFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);

    const updatedTemplate = {
      ...beforeAfter,
      slots: beforeAfter.slots.map((slot) => (slot.id === before.id ? { ...slot, label: "Opening shot" } : slot)),
    };
    const restored = loadTemplateDraft(updatedTemplate)!;
    expect(restored).toEqual({ ...edits, name: null, missingSlots: [], missingMusic: false });

    const textOverrides = setTemplateText(
      getTemplateTextFields(updatedTemplate)[0]!,
      restored.textOverrides,
      "New caption",
    );
    saveTemplateDraft(updatedTemplate, { ...restored, textOverrides });

    expect(loadTemplateDraft(updatedTemplate)).toEqual({ ...restored, textOverrides });
    expect(beforeFile.textSync()).toBe("fixture");
  });

  it.each([
    ["the overlay track is renamed", beforeAfterRenamedLabels],
    ["the caption limit is reduced", beforeAfterShorterCaption],
  ] as const)("preserves the saved caption and media when %s", async (_change, updatedTemplate) => {
    const { edits } = fixture(firstDraftId);
    const caption = getTemplateTextFields(beforeAfter).find((field) => field.label === "Caption")!;
    const textOverrides = setTemplateText(caption, {}, "Training progress after six weeks");
    saveTemplateDraft(beforeAfter, { ...edits, textOverrides }, firstDraftId);
    const originalFiles = new Map(storage.files);

    expect(() => loadTemplateDraft(updatedTemplate, firstDraftId)).toThrow();
    expect(() => renameTemplateDraft(updatedTemplate, "Updated cut", firstDraftId)).toThrow();
    await expect(duplicateTemplateDraft(updatedTemplate, firstDraftId, "Copy")).rejects.toThrow();
    expect(() => saveTemplateDraft(updatedTemplate, { ...edits, textOverrides: {} }, firstDraftId)).toThrow();

    expect(listTemplateDraftIds(updatedTemplate)).toEqual([firstDraftId]);
    expect(storage.files).toEqual(originalFiles);
    expect(loadTemplateDraft(beforeAfter, firstDraftId)).toMatchObject({ ...edits, textOverrides });
  });

  it.each([
    ["an unedited track is renamed", beforeAfterRenamedLabels, undefined],
    ["the caption fits the new limit in Unicode code points", beforeAfterShorterCaption, "🎬".repeat(24)],
  ] as const)("keeps compatible drafts editable when %s", (_change, updatedTemplate, text) => {
    const { edits } = fixture();
    const caption = getTemplateTextFields(beforeAfter).find((field) => field.label === "Caption")!;
    const textOverrides = text === undefined ? {} : setTemplateText(caption, {}, text);
    saveTemplateDraft(beforeAfter, { ...edits, textOverrides });
    const restored = loadTemplateDraft(updatedTemplate)!;
    saveTemplateDraft(updatedTemplate, { ...restored, name: "Final" });
    expect(loadTemplateDraft(updatedTemplate)).toMatchObject({ ...edits, name: "Final", textOverrides });
  });

  it("keeps a custom label through an unrelated edit when it matches a new template default", () => {
    const { edits } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const updatedTemplate = structuredClone(beforeAfter);
    const labels = updatedTemplate.tracks.find((track) => track.type === "overlay" && track.id === "labels");
    const item = labels?.items[0];
    if (!item || !("kind" in item) || item.kind !== "text") throw new Error("Missing Before label");
    item.text.default = "First cut";

    const restored = loadTemplateDraft(updatedTemplate)!;
    saveTemplateDraft(updatedTemplate, { ...restored, music: null });
    expect(loadTemplateDraft(beforeAfter)).toMatchObject({ ...edits, music: null });
  });

  it("deletes an unreadable draft and its imported copies without affecting other files", () => {
    const { edits, beforeFile, afterFile, musicFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const hookEdits = { clips: {}, textOverrides: { "text/0": "Watch this" }, music: null };
    saveTemplateDraft(hook, hookEdits);
    const folder = `${storage.document}/StackReelDrafts/${beforeAfter.id}`;
    const original = `${storage.document}/Before.mov`;
    const unrelated = `${folder}/notes.txt`;
    storage.files.set(original, "original");
    storage.files.set(unrelated, "keep");
    storage.files.set(`${folder}/draft-1.json`, "broken snapshot");
    storage.files.set(`${folder}/pending.json`, "interrupted edit");
    afterFile.delete();

    deleteTemplateDraft(beforeAfter);

    expect([...storage.files.keys()].filter((uri) => uri.startsWith(`${folder}/`))).toEqual([unrelated]);
    expect(beforeFile.exists || musicFile.exists).toBe(false);
    expect(storage.files.get(original)).toBe("original");
    expect(loadTemplateDraft(hook)).toMatchObject(hookEdits);
    expect(loadTemplateDraft(beforeAfter)).toBeNull();
    expect(() => deleteTemplateDraft(beforeAfter)).not.toThrow();

    const freshEdits = { clips: {}, textOverrides: {}, music: null };
    saveTemplateDraft(beforeAfter, freshEdits);
    expect(loadTemplateDraft(beforeAfter)).toMatchObject(freshEdits);
  });

  it("preserves the current draft when deleting its snapshot fails", () => {
    const { edits, beforeFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    saveTemplateDraft(beforeAfter, edits);
    const folder = `${storage.document}/StackReelDrafts/${beforeAfter.id}`;
    const oldSnapshot = `${folder}/draft-1.json`;
    storage.files.set(oldSnapshot, "older revision");
    storage.blockedDeletion = `${folder}/draft-2.json`;

    expect(() => deleteTemplateDraft(beforeAfter)).toThrow("Couldn’t delete file");
    expect(storage.files.has(oldSnapshot)).toBe(false);
    expect(beforeFile.exists).toBe(true);
    expect(loadTemplateDraft(beforeAfter)).toMatchObject(edits);

    storage.blockedDeletion = "";
    deleteTemplateDraft(beforeAfter);
    expect(loadTemplateDraft(beforeAfter)).toBeNull();
  });
});

describe("ordered template video import", () => {
  const slots = getVideoSlots(hook);
  const textOverrides = { "text/0": "Watch closely" };
  const draft = { name: "Series intro", clips: {}, music: null, textOverrides };
  const commit = vi.fn((clips: Record<string, TemplateClip>) => saveTemplateDraft(hook, { ...draft, clips }));
  const run = (isCurrent = () => true) =>
    importTemplateVideos({ template: hook, slots, source: "Photos", isCurrent, commit });

  function pick(names: string[]) {
    const videos = names.map((name) => {
      const uri = `file:///Caches/ImagePicker/${name}`;
      storage.files.set(uri, name);
      return { uri, name, draftFileName: name };
    });
    vi.mocked(pickOrderedVideos).mockResolvedValueOnce(videos);
    return videos;
  }

  beforeEach(() => {
    saveTemplateDraft(hook, draft);
    vi.mocked(probeVideo).mockResolvedValue(metadata);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("saves one revision in selection order and reopens the partial draft", async () => {
    pick(["Zebra.mov", "Acorn.mp4"]);
    await run();
    expect(commit).toHaveBeenCalledTimes(1);
    const restored = loadTemplateDraft(hook)!;
    expect(restored).toMatchObject({ name: draft.name, textOverrides });
    expect(Object.keys(restored.clips)).toEqual(["clip1", "clip2"]);
    expect(storage.files.get(restored.clips.clip1!.uri)).toBe("Zebra.mov");
    expect(storage.files.get(restored.clips.clip2!.uri)).toBe("Acorn.mp4");
  });

  it("stages ordered videos in the selected draft and preserves its sibling's import", async () => {
    pick(["Original.mov", "Original B-roll.mp4"]);
    await run();
    const legacy = loadTemplateDraft(hook)!;

    pick(["Zebra.mov", "Acorn.mp4"]);
    await importTemplateVideos({
      template: hook,
      draftId: firstDraftId,
      slots,
      source: "Photos",
      isCurrent: () => true,
      commit: (clips) => saveTemplateDraft(hook, { ...draft, clips }, firstDraftId),
    });
    expect(listTemplateDraftIds(hook)).toEqual([hook.id, firstDraftId]);
    const selected = loadTemplateDraft(hook, firstDraftId)!;
    expect(Object.values(selected.clips).map((clip) => new File(clip.uri).textSync())).toEqual([
      "Zebra.mov",
      "Acorn.mp4",
    ]);
    deleteTemplateDraft(hook, firstDraftId);
    expect(loadTemplateDraft(hook)).toEqual(legacy);
    expect(Object.values(legacy.clips).map((clip) => new File(clip.uri).textSync())).toEqual([
      "Original.mov",
      "Original B-roll.mp4",
    ]);
  });

  it("reserves filled slots and missing-media slots in the displayed order", () => {
    const clip = createTemplateClip(slots[1]!, "file:///existing.mov", "existing", metadata);
    expect(getEmptyVideoSlots(slots, { clip2: clip }, [])).toEqual([slots[0], slots[2]]);
    expect(getEmptyVideoSlots(slots, {}, ["clip2"])).toEqual([slots[0], slots[2]]);
    expect(getEmptyVideoSlots(slots, { clip3: clip }, ["clip1"])).toEqual([slots[1]]);
  });

  it("fills around a missing video and reopens its saved trim when the video is recovered", async () => {
    const middleSlot = slots[1]!;
    const file = createDraftMediaFile(hook, "Original.mp4");
    file.writeSync("original video");
    const original = setTemplateClipTrim(middleSlot, createTemplateClip(middleSlot, file.uri, "Original", metadata), 8);
    saveTemplateDraft(hook, { ...draft, clips: { [middleSlot.id]: original } });
    file.delete();
    const saved = loadTemplateDraft(hook)!;
    const targets = getEmptyVideoSlots(slots, saved.clips, saved.missingSlots);
    pick(["Hook.mp4", "Reveal.mp4"]);
    await importTemplateVideos({
      template: hook,
      slots: targets,
      source: "Photos",
      isCurrent: () => true,
      commit: (clips) => saveTemplateDraft(hook, { ...saved, clips }),
    });
    expect(pickOrderedVideos).toHaveBeenCalledWith(2);
    expect(loadTemplateDraft(hook)).toMatchObject({
      clips: { clip1: { name: "Hook.mp4" }, clip3: { name: "Reveal.mp4" } },
      missingSlots: [middleSlot.id],
    });
    file.writeSync("original video");
    expect(loadTemplateDraft(hook)?.clips[middleSlot.id]).toEqual(original);
  });

  it("releases a cleared missing video for ordered import after reopening", async () => {
    const [first, middle, last] = slots;
    const missing = createDraftMediaFile(hook, "Missing.mp4");
    const reveal = createDraftMediaFile(hook, "Reveal.mp4");
    missing.writeSync("missing video");
    reveal.writeSync("reveal video");
    saveTemplateDraft(hook, {
      ...draft,
      clips: {
        [middle!.id]: createTemplateClip(middle!, missing.uri, "Missing.mp4", metadata),
        [last!.id]: createTemplateClip(last!, reveal.uri, "Reveal.mp4", metadata),
      },
    });
    missing.delete();
    const saved = loadTemplateDraft(hook)!;
    expect(saved.missingSlots).toEqual([middle!.id]);
    expect(getEmptyVideoSlots(slots, saved.clips, saved.missingSlots)).toEqual([first]);

    commitTemplateDraftUpdate(hook, {
      ...saved,
      ...clearTemplateVideoSlot(saved, middle!.id),
      source: null,
      outputUri: null,
    });
    missing.writeSync("recovered video");
    const reopened = loadTemplateDraft(hook)!;
    expect(reopened).toEqual({ ...saved, missingSlots: [] });
    expect(missing.exists).toBe(false);
    const targets = getEmptyVideoSlots(slots, reopened.clips, reopened.missingSlots);
    expect(targets).toEqual([first, middle]);

    pick(["Hook.mp4", "B-roll.mp4"]);
    await importTemplateVideos({
      template: hook,
      slots: targets,
      source: "Photos",
      isCurrent: () => true,
      commit: (clips) => saveTemplateDraft(hook, { ...reopened, clips: { ...reopened.clips, ...clips } }),
    });
    expect(pickOrderedVideos).toHaveBeenCalledWith(2);
    expect(loadTemplateDraft(hook)?.clips).toMatchObject({
      clip1: { name: "Hook.mp4" },
      clip2: { name: "B-roll.mp4" },
      clip3: { name: "Reveal.mp4" },
    });
  });

  it("leaves the saved draft alone on cancel", async () => {
    const before = new Map(storage.files);
    vi.mocked(pickOrderedVideos).mockResolvedValueOnce(null);
    await run();
    expect(probeVideo).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(storage.files).toEqual(before);
  });

  it.each(["short video", "probe failure", "partial move"])(
    "identifies the second slot and removes all three picker files and staged media after a %s",
    async (failure) => {
      const before = new Map(storage.files);
      const [, second] = pick(["First.mp4", "Second.mp4", "Third.mp4"]);
      if (failure === "short video") {
        vi.mocked(probeVideo)
          .mockResolvedValueOnce(metadata)
          .mockResolvedValueOnce({ ...metadata, durationUs: 1 });
      } else if (failure === "probe failure") {
        vi.mocked(probeVideo).mockResolvedValueOnce(metadata).mockRejectedValueOnce(new Error("Unreadable video"));
      } else {
        vi.spyOn(File.prototype, "move").mockImplementation(async function (this: File, target) {
          if (this.uri === second!.uri) {
            (target as File).writeSync("partial file");
            throw new Error("Storage full");
          }
          this.moveSync(target);
        });
      }

      await expect(run()).rejects.toMatchObject({ slot: slots[1], message: expect.stringContaining("B-roll") });
      expect(commit).not.toHaveBeenCalled();
      expect(storage.files).toEqual(before);
    },
  );

  it.each(["picker", "probe", "move"])("cleans up if the operation becomes stale during the %s", async (step) => {
    const before = new Map(storage.files);
    pick(["First.mp4", "Second.mp4", "Third.mp4"]);
    let current = step !== "picker";
    if (step === "probe") {
      vi.mocked(probeVideo)
        .mockResolvedValueOnce(metadata)
        .mockImplementationOnce(async () => {
          current = false;
          return metadata;
        });
    } else if (step === "move") {
      vi.spyOn(File.prototype, "move").mockImplementation(async function (this: File, target) {
        this.moveSync(target);
        current = false;
      });
    }
    await run(() => current);
    expect(commit).not.toHaveBeenCalled();
    expect(storage.files).toEqual(before);
  });

  it("keeps external originals and the previous draft when the manifest cannot be published", async () => {
    const original = { uri: "file:///Documents/Original.mov", name: "Original", draftFileName: "clip.mov" };
    storage.files.set(original.uri, "original video");
    const before = new Map(storage.files);
    vi.mocked(pickOrderedVideos).mockResolvedValueOnce([original]);
    storage.interruptMove = true;
    await expect(run()).rejects.toThrow("Interrupted write");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(storage.files).toEqual(before);
    expect(loadTemplateDraft(hook)).toMatchObject(draft);
  });
});
