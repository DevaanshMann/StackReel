import { probeVideo } from "@stackreel/engine";
import { randomUUID } from "expo-crypto";
import { Directory, File } from "expo-file-system";
import { storage } from "./draft-filesystem-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTemplateMusic,
  clearTemplateVideoSlot,
  commitTemplateDraftUpdate,
  createDraftMediaFile,
  createTemplateDraftSession,
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
  getTemplateMusicStartRange,
  getTemplateTextFields,
  getVideoSlots,
  mobileTemplates,
  setTemplateClipReframe,
  setTemplateClipTrim,
  setTemplateClipVolume,
  setTemplateMusicStart,
  setTemplateMusicVolume,
  setTemplateText,
  swapTemplateClips,
} from "../src/template-editor";

import type { TemplateClip } from "../src/template-editor";
import * as templateEditor from "../src/template-editor";
import { importTemplateVideos } from "../src/template-video-import";
import { pickOrderedVideos, pickVideo } from "../src/video-picker";

vi.mock("@stackreel/engine", () => ({ probeVideo: vi.fn() }));
vi.mock("../src/video-picker", () => ({ pickOrderedVideos: vi.fn(), pickVideo: vi.fn() }));

vi.mock("expo-crypto", () => ({
  randomUUID: vi.fn(() => `00000000-0000-4000-8000-${String(++storage.nextMedia).padStart(12, "0")}`),
}));

vi.mock("expo-file-system", () => import("./draft-filesystem-fixture"));

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

function fixture(draftId = beforeAfter.id, musicDurationUs = 2_000_000) {
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
    music: createTemplateMusic(musicFile.uri, "Track.m4a", { startUs: 25_000, durationUs: musicDurationUs }),
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
    const { edits, beforeFile, afterFile, musicFile } = fixture(sourceId, 12_000_000);
    edits.clips[before.id] = setTemplateClipVolume(edits.clips[before.id]!, 0);
    edits.music = setTemplateMusicStart(setTemplateMusicVolume(edits.music, 35), 60, beforeAfter.durationUs);
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
  it("reopens a short clip swapped into a longer countdown slot with its sound and held frame intact", () => {
    const template = mobileTemplates.find(({ id }) => id === "top-5-countdown")!;
    const slots = getVideoSlots(template);
    const clips = Object.fromEntries(
      slots.map((slot) => {
        const file = createDraftMediaFile(template, slot.id + ".mov");
        file.writeSync("video");
        return [slot.id, createTemplateClip(slot, file.uri, file.name, { ...metadata, durationUs: 4_000_000 })];
      }),
    );
    const first = slots[0]!;
    const last = slots.at(-1)!;
    const swapped = swapTemplateClips(clips, first, last);
    saveTemplateDraft(template, { clips: swapped, textOverrides: {}, music: null });
    const reopened = loadTemplateDraft(template)!;
    expect(reopened.missingSlots).toEqual([]);
    expect(reopened.clips[last.id]).toEqual(clips[first.id]);
    const { plan } = JSON.parse(createTemplateSource(template, reopened.clips)!);
    const source = { sourceEndUs: 4_000_000, rate: 1, fitMode: "freeze", afterEnd: "hold" };
    expect(plan.layers).toContainEqual(
      expect.objectContaining({ slotId: last.id, source: expect.objectContaining(source) }),
    );
    expect(plan.audio).toContainEqual(
      expect.objectContaining({ slotId: last.id, source: expect.objectContaining(source) }),
    );
  });

  it("retains a legacy export at the template music level and requires a new export after muting", () => {
    const { edits } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const legacy = loadTemplateDraft(beforeAfter)!;
    expect(legacy.music).toEqual(edits.music);
    const source = createTemplateSource(beforeAfter, edits.clips, edits.textOverrides, edits.music);
    const outputUri = "file:///Exports/rendered.mp4";
    const current = { ...legacy, source, outputUri };
    expect(
      commitTemplateDraftUpdate(beforeAfter, { ...current, music: setTemplateMusicVolume(legacy.music!, 100) }),
    ).toEqual({ source, outputUri });

    const music = setTemplateMusicVolume(legacy.music!, 0);
    const muted = commitTemplateDraftUpdate(beforeAfter, { ...current, music });
    expect(muted.source).not.toBe(source);
    expect(muted.outputUri).toBeNull();
    const reopened = loadTemplateDraft(beforeAfter)!;
    expect(reopened.music).toEqual(music);
    expect(commitTemplateDraftUpdate(beforeAfter, { ...reopened, source: muted.source, outputUri })).toEqual({
      source: muted.source,
      outputUri,
    });
  });

  it("keeps a legacy export at the default music start, saves a changed start, and removes it on reset", () => {
    const { edits, musicFile } = fixture(beforeAfter.id, 12_000_000);
    saveTemplateDraft(beforeAfter, edits);
    const current = loadTemplateDraft(beforeAfter)!;
    const music = current.music!;
    const source = createTemplateSource(beforeAfter, current.clips, current.textOverrides, music);
    const outputUri = "file:///Exports/rendered.mp4";
    const session = createTemplateDraftSession(beforeAfter);
    const same = session.commit(
      { ...current, music: setTemplateMusicStart(music, 0, beforeAfter.durationUs), source, outputUri },
      "Music start",
    );
    expect(same).toEqual({ source, outputUri });
    expect(session.undoLabel).toBeNull();

    const shifted = setTemplateMusicStart(music, 60, beforeAfter.durationUs);
    const changed = session.commit({ ...current, ...same, music: shifted }, "Music start");
    expect(changed.source).not.toBe(source);
    expect(changed.outputUri).toBeNull();
    expect(loadTemplateDraft(beforeAfter)!.music).toEqual(shifted);
    const reset = session.commit(
      { ...current, ...changed, music: setTemplateMusicStart(shifted, 0, beforeAfter.durationUs) },
      "Reset music start",
    );
    expect(reset.source).toBe(source);
    session.close();
    expect(loadTemplateDraft(beforeAfter)!.music).toEqual(music);
    expect(JSON.parse(new File(musicFile.parentDirectory, "draft-3.json").textSync()).music).not.toHaveProperty(
      "startFrame",
    );
  });

  it("keeps the nearest playable start if a revised template needs more of the song", () => {
    const { edits } = fixture(beforeAfter.id, 12_000_000);
    const music = setTemplateMusicStart(edits.music, 90, beforeAfter.durationUs);
    saveTemplateDraft(beforeAfter, { ...edits, music });
    const longer = { ...beforeAfter, durationUs: 11_000_000 };
    const { maxFrame } = getTemplateMusicStartRange(edits.music, longer.durationUs);
    expect(maxFrame).toBeLessThan(90);
    expect(loadTemplateDraft(longer)!.music).toEqual(setTemplateMusicStart(edits.music, maxFrame, longer.durationUs));
    expect(loadTemplateDraft(beforeAfter)!.music).toEqual(music);
  });

  it.each([
    ["volumePercent", null],
    ["volumePercent", "50"],
    ["volumePercent", -1],
    ["volumePercent", 101],
    ["startFrame", null],
    ["startFrame", "50"],
    ["startFrame", -1],
    ["startFrame", 0.5],
    ["startFrame", Number.MAX_SAFE_INTEGER + 1],
  ] as const)("preserves a soundtrack with an invalid saved %s (%s)", (field, value) => {
    const { edits, musicFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const snapshot = new File(musicFile.parentDirectory, "draft-1.json");
    const saved = JSON.parse(snapshot.textSync());
    saved.music[field] = value;
    snapshot.writeSync(JSON.stringify(saved));
    const loaded = loadTemplateDraft(beforeAfter)!;
    expect(loaded).toEqual({
      ...edits,
      name: null,
      music: null,
      recoverableSlots: {},
      missingSlots: [],
      missingMusic: true,
      recoverableMusic: null,
    });
    saveTemplateDraft(beforeAfter, loaded);
    const next = new File(musicFile.parentDirectory, "draft-2.json");
    expect(JSON.parse(next.textSync()).music).toEqual(saved.music);
    expect(musicFile.exists).toBe(true);
  });

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
      recoverableSlots: {},
      missingSlots: [before.id],
      missingMusic: false,
      recoverableMusic: null,
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
      recoverableSlots: {},
      missingSlots: [],
      missingMusic: false,
      recoverableMusic: null,
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
        [hookShot!.id]: { ...clips[reveal!.id], trimOutUs: hookShot!.trimDurationUs },
        [bRoll!.id]: clips[bRoll!.id],
        [reveal!.id]: { ...framedHook, trimOutUs: 5_000_000 },
      },
      recoverableSlots: {},
      missingSlots: [],
      missingMusic: false,
      recoverableMusic: null,
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
      recoverableSlots: { [before.id]: "Before.mov" },
      missingSlots: [before.id],
      missingMusic: true,
      recoverableMusic: { name: "Track.m4a" },
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
    edits.music = setTemplateMusicVolume(edits.music, 25);
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
      recoverableSlots: {},
      missingSlots: [],
      missingMusic: false,
      recoverableMusic: null,
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
    expect(reopened).toEqual({ ...draft, clips, recoverableSlots: {}, missingSlots: [], missingMusic: true });

    const soundtrack = createDraftMediaFile(beforeAfter, "Replacement.m4a");
    soundtrack.writeSync("fixture");
    const music = createTemplateMusic(soundtrack.uri, "Replacement.m4a", { startUs: 0, durationUs: 2_000_000 });
    saveTemplateDraft(beforeAfter, { ...reopened, music, missingMusic: false });
    expect(loadTemplateDraft(beforeAfter)).toEqual({ ...reopened, music, missingMusic: false, recoverableMusic: null });
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

    expect(loadTemplateDraft(beforeAfter)).toEqual({ ...draft, missingMusic: false, recoverableMusic: null });
    musicFile.writeSync("restored music copy");
    expect(loadTemplateDraft(beforeAfter)).toEqual({ ...draft, missingMusic: false, recoverableMusic: null });
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
    expect(loadTemplateDraft(beforeAfter)).toEqual({ ...draft, missingMusic: false, recoverableMusic: null });

    afterFile.writeSync("restored video copy");
    expect(loadTemplateDraft(beforeAfter)).toEqual({
      ...draft,
      clips: edits.clips,
      recoverableSlots: {},
      missingSlots: [],
      missingMusic: false,
      recoverableMusic: null,
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
      expect(loadTemplateDraft(beforeAfter)).toEqual({
        ...edits,
        name,
        recoverableSlots: {},
        missingSlots: [],
        missingMusic: false,
        recoverableMusic: null,
      });
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
      expect(loadTemplateDraft(beforeAfter)).toEqual({
        ...edits,
        name,
        recoverableSlots: {},
        missingSlots: [],
        missingMusic: false,
        recoverableMusic: null,
      });
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
      expect(restored).toEqual({
        ...edits,
        name: null,
        music: null,
        recoverableSlots: {},
        missingSlots: [],
        missingMusic: false,
        recoverableMusic: null,
      });

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
    expect(restored).toEqual({
      ...edits,
      name: null,
      recoverableSlots: {},
      missingSlots: [],
      missingMusic: false,
      recoverableMusic: null,
    });

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

describe("in-session template draft history", () => {
  const empty = { name: "First cut", clips: {}, textOverrides: {}, music: null };
  const noExport = { source: null, outputUri: null };
  afterEach(() => vi.restoreAllMocks());

  it("undoes an ordered first import as one edit, then redoes it using the same files", async () => {
    const session = createTemplateDraftSession(hook, firstDraftId);
    const slots = getVideoSlots(hook);
    const picked = slots.map((slot) => {
      const file = new File(storage.document, slot.id + ".mov");
      file.writeSync(slot.id);
      return { uri: file.uri, name: file.name, draftFileName: file.name };
    });
    vi.mocked(pickOrderedVideos).mockResolvedValueOnce(picked);
    vi.mocked(probeVideo).mockResolvedValue(metadata);
    await importTemplateVideos({
      template: hook,
      draftId: firstDraftId,
      slots,
      source: "Photos",
      isCurrent: () => true,
      commit: (clips) => {
        session.commit({ ...empty, clips, ...noExport }, "Import videos");
      },
    });
    const imported = loadTemplateDraft(hook, firstDraftId)!;
    const source = createTemplateSource(hook, imported.clips);
    expect(Object.values(imported.clips).map((clip) => clip.name)).toEqual(picked.map((file) => file.name));
    const copy = vi.spyOn(File.prototype, "copy");
    expect(session.undoLabel).toBe("Import videos");
    expect(session.undo({ source, outputUri: "file:///export.mp4" })).toEqual({
      ...empty,
      ...noExport,
      recoverableSlots: {},
      missingSlots: [],
      missingMusic: false,
      recoverableMusic: null,
    });
    expect(session.undo(noExport)).toBeNull();
    expect(session.redoLabel).toBe("Import videos");
    for (const clip of Object.values(imported.clips)) expect(new File(clip.uri).exists).toBe(true);
    expect(session.redo(noExport)).toEqual({ ...imported, source, outputUri: null });
    expect(session.redo(noExport)).toBeNull();
    expect(copy).not.toHaveBeenCalled();
    session.close();
    const reopened = createTemplateDraftSession(hook, firstDraftId);
    expect(reopened.undoLabel).toBeNull();
    expect(reopened.redoLabel).toBeNull();
    expect(loadTemplateDraft(hook, firstDraftId)).toEqual(imported);
    reopened.close();
  });

  it("keeps an asynchronous import's staging files through discovery or reads of the active draft", () => {
    const session = createTemplateDraftSession(beforeAfter);
    const { edits, beforeFile, musicFile } = fixture();
    expect(listTemplateDraftIds(beforeAfter)).toEqual([]);
    expect(loadTemplateDraft(beforeAfter)).toBeNull();
    expect(beforeFile.exists && musicFile.exists).toBe(true);
    session.commit({ ...edits, ...noExport }, "Import");
    const staged = createDraftMediaFile(beforeAfter, "replacement.mov");
    staged.writeSync("staged");
    expect(loadTemplateDraft(beforeAfter)).toMatchObject(edits);
    expect(staged.exists).toBe(true);
    session.close();
    expect(staged.exists).toBe(false);
  });

  it("round-trips clip swaps, trim, framing, volumes, music start, text, and clearing video or music", () => {
    const { edits } = fixture(beforeAfter.id, 12_000_000);
    saveTemplateDraft(beforeAfter, edits);
    const session = createTemplateDraftSession(beforeAfter);
    const initial = loadTemplateDraft(beforeAfter)!;
    let draft = initial;
    const states = [initial];
    const labels: string[] = [];
    const apply = (changes: Partial<typeof initial>, label: string) => {
      draft = { ...draft, ...changes };
      session.commit({ ...draft, ...noExport }, label);
      states.push(draft);
      labels.push(label);
    };
    apply({ clips: swapTemplateClips(draft.clips, before, after) }, "Swap clips");
    apply({ clips: { ...draft.clips, [before.id]: setTemplateClipTrim(before, draft.clips[before.id]!, 3) } }, "Trim");
    apply(
      {
        clips: {
          ...draft.clips,
          [before.id]: setTemplateClipReframe(draft.clips[before.id]!, beforeAfter.canvas, { zoom: 2, x: 0.6, y: 0.3 }),
        },
      },
      "Frame",
    );
    apply({ clips: { ...draft.clips, [after.id]: setTemplateClipVolume(draft.clips[after.id]!, 25) } }, "Clip volume");
    apply({ music: setTemplateMusicVolume(draft.music!, 0) }, "Music volume");
    apply({ music: setTemplateMusicStart(draft.music!, 60, beforeAfter.durationUs) }, "Music start");
    apply({ music: setTemplateMusicStart(draft.music!, 0, beforeAfter.durationUs) }, "Reset music start");
    apply(
      { textOverrides: setTemplateText(getTemplateTextFields(beforeAfter)[0]!, draft.textOverrides, "New cut") },
      "Text",
    );
    const newTrack = createDraftMediaFile(beforeAfter, "New.m4a");
    newTrack.writeSync("new music");
    apply(
      { music: createTemplateMusic(newTrack.uri, newTrack.name, { startUs: 0, durationUs: 2_000_000 }) },
      "Replace music",
    );
    apply({ clips: clearTemplateVideoSlot(draft, before.id).clips }, "Clear slot");
    apply({ music: null }, "Clear music");
    for (let i = labels.length - 1; i >= 0; i--) {
      expect(session.undoLabel).toBe(labels[i]);
      expect(session.undo(noExport)).toMatchObject(states[i]!);
      expect(loadTemplateDraft(beforeAfter)).toEqual(states[i]);
    }
    for (const [i, label] of labels.entries()) {
      expect(session.redoLabel).toBe(label);
      expect(session.redo(noExport)).toMatchObject(states[i + 1]!);
      expect(loadTemplateDraft(beforeAfter)).toEqual(states[i + 1]);
    }
    session.close();
    expect(newTrack.exists).toBe(false);
  });

  it("retains exactly 20 edits and releases expired or discarded media independently of sibling drafts", () => {
    const sibling = fixture(secondDraftId);
    saveTemplateDraft(beforeAfter, sibling.edits, secondDraftId);
    const siblingSession = createTemplateDraftSession(beforeAfter, secondDraftId);
    siblingSession.commit({ ...sibling.edits, music: null, ...noExport }, "Clear music");
    const session = createTemplateDraftSession(beforeAfter, firstDraftId);
    const files: File[] = [];
    for (let i = 0; i < 22; i++) {
      const file = createDraftMediaFile(beforeAfter, "clip.mov", firstDraftId);
      file.writeSync(String(i));
      files.push(file);
      const clips = { [before.id]: createTemplateClip(before, file.uri, "clip " + i, metadata) };
      expect(session.commit({ ...empty, clips, ...noExport }, "Video " + i)).toEqual(noExport);
    }
    expect(files.filter((file) => file.exists)).toEqual(files.slice(1));
    for (let i = 21; i >= 2; i--) {
      expect(session.undoLabel).toBe("Video " + i);
      expect(session.undo(noExport)?.clips[before.id]?.uri).toBe(files[i - 1]!.uri);
    }
    expect(session.undo(noExport)).toBeNull();
    const current = session.redo(noExport)!;
    const shared = files[2]!;
    expect(current.clips[before.id]?.uri).toBe(shared.uri);
    session.commit({ ...current, textOverrides: { ...current.textOverrides } }, "Unchanged");
    expect(session.redoLabel).toBe("Video 3");
    const field = getTemplateTextFields(beforeAfter)[0]!;
    session.commit({ ...current, textOverrides: setTemplateText(field, {}, "Partial cut") }, "Edit text");
    expect(session.redoLabel).toBeNull();
    expect(files.filter((file) => file.exists)).toEqual([files[1], shared]);
    expect(session.undo(noExport)).toMatchObject(current);
    expect(siblingSession.undoLabel).toBe("Clear music");
    expect(sibling.musicFile.exists).toBe(true);
    session.close();
    expect(files.filter((file) => file.exists)).toEqual([shared]);
    expect(siblingSession.undo(noExport)?.music).toEqual(sibling.edits.music);
    siblingSession.close();
  });

  it("keeps current exports for metadata-only changes and never resurrects an export from history", () => {
    const { edits } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const session = createTemplateDraftSession(beforeAfter);
    const source = createTemplateSource(beforeAfter, edits.clips, edits.textOverrides, edits.music);
    const exported = { source, outputUri: "file:///Caches/render.mp4" };
    expect(session.commit({ ...edits, name: "Named cut", ...exported }, "Name")).toEqual(exported);
    expect(session.undo(exported)).toMatchObject({ name: null, ...exported });
    const renamed = session.redo(exported)!;
    expect(renamed).toMatchObject({ name: "Named cut", ...exported });
    const muted = session.commit({ ...renamed, music: setTemplateMusicVolume(renamed.music!, 0) }, "Mute");
    expect(muted.source).not.toBe(source);
    expect(muted.outputUri).toBeNull();
    expect(session.undo(muted)).toMatchObject({ source, outputUri: null });
    session.close();
  });

  it("restores raw missing and malformed media references and retains unknown fields and files", () => {
    const { edits, beforeFile, musicFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const folder = beforeFile.parentDirectory;
    const extra = createDraftMediaFile(beforeAfter, "aux.mov");
    extra.writeSync("extension media");
    const snapshot = new File(folder, "draft-1.json");
    const original = JSON.parse(snapshot.textSync());
    original.clips[before.id].width = "unknown dimensions";
    original.clips[after.id].extension = { file: extra.name };
    original.music.futureSetting = { version: 7 };
    original.extension = { format: "future" };
    snapshot.writeSync(JSON.stringify(original));
    musicFile.delete();
    const partial = loadTemplateDraft(beforeAfter)!;
    expect(partial).toMatchObject({ missingSlots: [before.id], missingMusic: true });
    const session = createTemplateDraftSession(beforeAfter);
    const replacement = createDraftMediaFile(beforeAfter, "replacement.mov");
    replacement.writeSync("replacement");
    const render = session.commit(
      {
        ...clearTemplateMusic(partial),
        clips: { ...partial.clips, [before.id]: createTemplateClip(before, replacement.uri, "Replacement", metadata) },
        missingSlots: [],
        ...noExport,
      },
      "Replace missing media",
    );
    expect(beforeFile.exists && extra.exists).toBe(true);
    const restored = session.undo(render)!;
    expect(restored).toMatchObject(partial);
    expect(JSON.parse(new File(folder, "draft-3.json").textSync())).toEqual(original);
    expect(session.redo(restored)).toMatchObject({ missingSlots: [], missingMusic: false });
    musicFile.writeSync("recovered");
    expect(session.undo(render)).toMatchObject({ missingSlots: [before.id], missingMusic: false, music: edits.music });
    session.close();
    expect(beforeFile.exists && extra.exists && musicFile.exists).toBe(true);
    expect(replacement.exists).toBe(false);
    // A healthy cold load can also reclaim the older recovery revisions.
    const latest = new File(folder, "draft-5.json");
    const repaired = JSON.parse(latest.textSync());
    repaired.clips[before.id].width = edits.clips[before.id]!.width;
    latest.writeSync(JSON.stringify(repaired));
    expect(loadTemplateDraft(beforeAfter)).toMatchObject({ missingSlots: [], missingMusic: false });
    expect(snapshot.exists).toBe(false);
  });

  it("leaves history, files, and the current manifest intact on failed first saves, edits, undo, and redo", () => {
    const { edits } = fixture();
    const session = createTemplateDraftSession(beforeAfter);
    const beforeFirst = new Map(storage.files);
    storage.interruptMove = true;
    expect(() => session.commit({ ...edits, ...noExport }, "Import")).toThrow("Interrupted write");
    expect(storage.files).toEqual(beforeFirst);
    expect(session.undoLabel).toBeNull();
    storage.interruptMove = false;
    const render = session.commit({ ...edits, ...noExport }, "Import");
    session.commit({ ...edits, music: null, ...render }, "Clear music");
    const restored = session.undo(noExport)!;
    const files = new Map(storage.files);
    storage.interruptMove = true;
    for (const attempt of [
      () => session.commit({ ...restored, clips: {} }, "Clear videos"),
      () => session.undo(restored),
      () => session.redo(restored),
    ]) {
      expect(attempt).toThrow("Interrupted write");
      expect(session.undoLabel).toBe("Import");
      expect(session.redoLabel).toBe("Clear music");
      expect(storage.files).toEqual(files);
    }
    storage.interruptMove = false;
    vi.spyOn(templateEditor, "createTemplateSource").mockImplementationOnce(() => {
      throw new Error("Preview failed");
    });
    expect(() => session.redo(restored)).toThrow("Preview failed");
    expect(storage.files).toEqual(files);
    expect(session.redo(restored)).toMatchObject({ music: null });
    session.close();
  });

  it("reclaims only session imports on expiry, branching and exit while a soundtrack reference is damaged", () => {
    const { edits, beforeFile, musicFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const folder = musicFile.parentDirectory;
    const recovery = new File(folder, "draft-1.json");
    const damaged = JSON.parse(recovery.textSync());
    damaged.music.file = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.m4a";
    const brokenRevision = new File(folder, "draft-2.json");
    brokenRevision.writeSync(JSON.stringify(damaged));
    const partial = loadTemplateDraft(beforeAfter)!;
    expect(partial.missingMusic).toBe(true);

    const session = createTemplateDraftSession(beforeAfter);
    const pending = createDraftMediaFile(beforeAfter, "pending.mov");
    pending.writeSync("import in progress");
    const replacements: File[] = [];
    for (let i = 0; i < 22; i++) {
      const file = createDraftMediaFile(beforeAfter, "video.mov");
      file.writeSync(String(i));
      replacements.push(file);
      const clips = { ...partial.clips, [before.id]: createTemplateClip(before, file.uri, file.name, metadata) };
      session.commit({ ...partial, clips, ...noExport }, "Replace video");
    }
    expect(replacements.filter((file) => file.exists)).toEqual(replacements.slice(1));
    const current = session.undo(noExport)!;
    expect(current.clips[before.id]?.uri).toBe(replacements[20]!.uri);
    const branch = { ...current, name: "Alternate cut" };
    storage.interruptMove = true;
    expect(() => session.commit(branch, "Rename")).toThrow("Interrupted write");
    expect(replacements[21]!.exists).toBe(true);
    storage.interruptMove = false;
    session.commit(branch, "Rename");
    expect(session.redoLabel).toBeNull();
    expect(replacements.filter((file) => file.exists)).toEqual(replacements.slice(1, 21));
    expect(pending.textSync()).toBe("import in progress");

    session.close();
    expect(replacements.filter((file) => file.exists)).toEqual([replacements[20]]);
    expect(pending.exists).toBe(false);
    expect(loadTemplateDraft(beforeAfter)).toMatchObject({
      name: branch.name,
      clips: current.clips,
      missingMusic: true,
    });
    expect(beforeFile.exists && musicFile.exists).toBe(true);
    expect(recovery.exists && brokenRevision.exists).toBe(true);
  });

  it.each([null, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mov"])(
    "protects original footage and recovery revisions through a degraded load, unrelated edit and exit (%s)",
    (badFile) => {
      const { edits, beforeFile } = fixture();
      saveTemplateDraft(beforeAfter, edits);
      const folder = beforeFile.parentDirectory;
      const recoverable = new File(folder, "draft-1.json");
      const damaged = JSON.parse(recoverable.textSync());
      damaged.clips[before.id].file = badFile;
      const latest = new File(folder, "draft-2.json");
      latest.writeSync(JSON.stringify(damaged));
      const partial = loadTemplateDraft(beforeAfter)!;
      expect(partial.missingSlots).toEqual([before.id]);
      const session = createTemplateDraftSession(beforeAfter);
      session.commit({ ...partial, name: "Renamed", ...noExport }, "Name");
      expect(session.undo(noExport)).toMatchObject(partial);
      expect(session.redo(noExport)).toMatchObject({ missingSlots: [before.id] });
      session.close();
      expect(loadTemplateDraft(beforeAfter)?.missingSlots).toEqual([before.id]);
      expect(beforeFile.textSync()).toBe("fixture");
      expect(recoverable.exists && latest.exists).toBe(true);
    },
  );

  it("sweeps abandoned history on a healthy cold load and leaves unrelated files alone", async () => {
    const { edits, beforeFile, afterFile, musicFile } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    const session = createTemplateDraftSession(beforeAfter);
    const current = loadTemplateDraft(beforeAfter)!;
    session.commit({ ...clearTemplateMusic(current), ...noExport }, "Clear music");
    expect(musicFile.exists).toBe(true);
    const note = new File(afterFile.parentDirectory, "notes.txt");
    note.writeSync("keep");
    // A new JS runtime has no session pins, even if the editor never got to close.
    vi.resetModules();
    const cold = await import("../src/template-drafts");
    expect(cold.loadTemplateDraft(beforeAfter)).toMatchObject({ missingSlots: [], missingMusic: false });
    expect(musicFile.exists).toBe(false);
    expect(beforeFile.exists && afterFile.exists && note.exists).toBe(true);
    expect(cold.createTemplateDraftSession(beforeAfter).undoLabel).toBeNull();
    session.close();
  });
});

describe("recovering a missing template soundtrack", () => {
  const load = () => loadTemplateDraft(beforeAfter, firstDraftId)!;
  const noExport = { source: null, outputUri: null };

  function missingMusic(starterId?: "daybreak") {
    const { edits, musicFile } = fixture(firstDraftId, 15_000_000);
    edits.music = setTemplateMusicStart(setTemplateMusicVolume(edits.music, 0), 60, beforeAfter.durationUs);
    if (starterId) edits.music.starterId = starterId;
    saveTemplateDraft(beforeAfter, { ...edits, name: "Weekend cut" }, firstDraftId);
    const snapshot = new File(musicFile.parentDirectory, "draft-1.json");
    const saved = JSON.parse(snapshot.textSync());
    saved.music.futureMix = { balance: 25 };
    snapshot.writeSync(JSON.stringify(saved));
    musicFile.delete();
    return { edits, musicFile, saved, snapshot };
  }

  it.each([undefined, "daybreak"] as const)(
    "restores the original mix for source %s and starts fresh undo history",
    (starterId) => {
      const { edits, musicFile, saved } = missingMusic(starterId);
      const partial = load();
      expect(partial.recoverableMusic).toEqual({ name: edits.music.name, ...(starterId && { starterId }) });
      const session = createTemplateDraftSession(beforeAfter, firstDraftId);
      try {
        const silent = session.commit({ ...partial, ...noExport, name: "Final cut" }, "Rename");
        expect(session.undoLabel).toBe("Rename");
        const validate = session.prepareMusicRelink();
        const file = createDraftMediaFile(beforeAfter, "new-name.m4a", firstDraftId);
        const imported = createTemplateMusic(file.uri, "new-name.m4a", { startUs: 25_001, durationUs: 15_000_000 });
        if (starterId) imported.starterId = starterId;
        validate(imported);
        file.writeSync("restored soundtrack");
        const restored = session.relinkMusic(imported, { ...silent, outputUri: "file:///silent.mp4" });
        expect(restored).toMatchObject({
          name: "Final cut",
          clips: edits.clips,
          textOverrides: edits.textOverrides,
          music: {
            ...edits.music,
            uri: file.uri,
            sourceStartUs: imported.sourceStartUs,
            sourceEndUs: imported.sourceEndUs,
          },
          missingMusic: false,
          recoverableMusic: null,
          outputUri: null,
        });
        const source = createTemplateSource(beforeAfter, edits.clips, edits.textOverrides, edits.music)!;
        expect(JSON.parse(restored.source!).plan).toEqual(JSON.parse(source).plan);
        expect(Object.values(JSON.parse(restored.source!).assets)).toContain(file.uri);
        const published = JSON.parse(new File(musicFile.parentDirectory, "draft-3.json").textSync());
        expect(published.music).toEqual({
          ...saved.music,
          file: file.name,
          sourceStartUs: imported.sourceStartUs,
          sourceEndUs: imported.sourceEndUs,
        });
        expect(session.undoLabel).toBeNull();
        expect(session.redoLabel).toBeNull();
        const changed = session.commit({ ...restored, music: setTemplateMusicVolume(restored.music!, 50) }, "Volume");
        expect(session.undo(changed)?.music).toEqual(restored.music);
        expect(load().music).toEqual(restored.music);
      } finally {
        session.close();
      }
      expect(load().music).toMatchObject({ name: edits.music.name, startFrame: 60, volumePercent: 0 });
    },
  );

  it("rejects incompatible timing or source before staging and again before publication", () => {
    const { edits } = missingMusic();
    const partial = load();
    const session = createTemplateDraftSession(beforeAfter, firstDraftId);
    try {
      const beforePick = new Map(storage.files);
      const validate = session.prepareMusicRelink();
      for (const candidate of [
        { ...edits.music, sourceStartUs: 0 },
        { ...edits.music, sourceEndUs: 20_000_000 },
        { ...edits.music, starterId: "daybreak" as const },
      ]) {
        expect(() => validate(candidate)).toThrow(/original/);
        expect(() => session.relinkMusic(candidate, noExport)).toThrow(/original/);
      }
      // Closing the picker after validation is prepared makes no persistent change.
      expect(storage.files).toEqual(beforePick);
      expect(load()).toEqual(partial);
      expect(session.undoLabel).toBeNull();
    } finally {
      session.close();
    }
  });

  it("requires a readable, staged file owned by the draft and allows retry after a failed commit", () => {
    const { edits } = missingMusic("daybreak");
    const partial = load();
    const session = createTemplateDraftSession(beforeAfter, firstDraftId);
    try {
      const validate = session.prepareMusicRelink();
      const { starterId: _starterId, ...fromFiles } = edits.music;
      expect(() => validate(fromFiles)).toThrow(/original/);
      const tryFile = (uri: string) => session.relinkMusic({ ...edits.music, uri }, noExport);
      const file = createDraftMediaFile(beforeAfter, "track.m4a", firstDraftId);
      const foreign = createDraftMediaFile(beforeAfter, "track.m4a", secondDraftId);
      foreign.writeSync("other draft");
      expect(() => tryFile(foreign.uri)).toThrow(/staged/);
      expect(() => tryFile(edits.clips[before.id]!.uri)).toThrow(/staged/);
      expect(() => tryFile(file.uri)).toThrow(/unreadable/);
      file.writeSync("");
      expect(() => tryFile(file.uri)).toThrow(/empty/);
      file.writeSync("audio");
      storage.blockedRead = file.uri;
      expect(() => tryFile(file.uri)).toThrow(/unreadable/);
      storage.blockedRead = "";
      storage.interruptMove = true;
      expect(() => tryFile(file.uri)).toThrow(/Interrupted/);
      expect(load()).toEqual(partial);
      expect(session.undoLabel).toBeNull();
      storage.interruptMove = false;
      expect(tryFile(file.uri).music).toMatchObject({ uri: file.uri, starterId: "daybreak" });
    } finally {
      storage.blockedRead = "";
      storage.interruptMove = false;
      session.close();
    }
  });

  it("preserves a newer revision while the picker is open", () => {
    const { edits } = missingMusic();
    const stale = load();
    const session = createTemplateDraftSession(beforeAfter, firstDraftId);
    try {
      session.prepareMusicRelink();
      renameTemplateDraft(beforeAfter, "Newer cut", firstDraftId);
      const file = createDraftMediaFile(beforeAfter, "track.m4a", firstDraftId);
      file.writeSync("audio");
      expect(() => session.relinkMusic({ ...edits.music, uri: file.uri }, noExport)).toThrow(/changed/);
      expect(() => session.commit({ ...stale, ...noExport, name: "Stale cut" }, "Rename")).toThrow(/changed/);
      expect(load()).toMatchObject({
        name: "Newer cut",
        missingMusic: true,
        recoverableMusic: { name: edits.music.name },
      });
    } finally {
      session.close();
    }
  });

  it("requires a fresh selection after another edit in the same session", () => {
    const { edits } = missingMusic();
    const session = createTemplateDraftSession(beforeAfter, firstDraftId);
    try {
      session.prepareMusicRelink();
      session.commit({ ...load(), ...noExport, name: "Revised cut" }, "Rename");
      const file = createDraftMediaFile(beforeAfter, "track.m4a", firstDraftId);
      file.writeSync("audio");
      const imported = { ...edits.music, uri: file.uri };
      expect(() => session.relinkMusic(imported, noExport)).toThrow(/changed/);
      expect(session.undoLabel).toBe("Rename");
      session.prepareMusicRelink()(imported);
      expect(session.relinkMusic(imported, noExport).name).toBe("Revised cut");
    } finally {
      session.close();
    }
  });

  it("recovers legacy defaults from an empty saved file and keeps a separate slot warning", () => {
    const { musicFile, beforeFile, edits } = fixture(firstDraftId);
    saveTemplateDraft(beforeAfter, edits, firstDraftId);
    musicFile.writeSync("");
    beforeFile.delete();
    const session = createTemplateDraftSession(beforeAfter, firstDraftId);
    try {
      const partial = load();
      expect(partial).toMatchObject({ missingMusic: true, music: null, recoverableMusic: { name: edits.music.name } });
      const validate = session.prepareMusicRelink();
      const imported = { ...edits.music, name: "Renamed.m4a" };
      validate(imported);
      const file = createDraftMediaFile(beforeAfter, imported.name, firstDraftId);
      file.writeSync("audio");
      const restored = session.relinkMusic({ ...imported, uri: file.uri }, noExport);
      expect(restored).toMatchObject({
        missingMusic: false,
        recoverableMusic: null,
        missingSlots: [before.id],
        recoverableSlots: partial.recoverableSlots,
        source: null,
      });
      expect(restored.music).toEqual({ ...edits.music, uri: file.uri });
    } finally {
      session.close();
    }
  });

  it("preserves unsupported soundtrack provenance until an explicit replacement or removal", () => {
    const { saved, snapshot } = missingMusic();
    saved.music.starterId = "future-track";
    snapshot.writeSync(JSON.stringify(saved));
    const session = createTemplateDraftSession(beforeAfter, firstDraftId);
    try {
      const partial = load();
      expect(partial).toMatchObject({ music: null, missingMusic: true, recoverableMusic: null });
      expect(() => session.prepareMusicRelink()).toThrow(/unsupported/);
      expect(JSON.parse(snapshot.textSync()).music).toEqual(saved.music);
      session.commit({ ...clearTemplateMusic(partial), ...noExport }, "Remove music");
      expect(load()).toMatchObject({ music: null, missingMusic: false, recoverableMusic: null });
    } finally {
      session.close();
    }
  });
});

describe("recovering a missing template video", () => {
  const picked = { uri: "file:///Documents/pick.mov", name: "Selected.mov", draftFileName: "pick.mov" };
  const load = () => loadTemplateDraft(beforeAfter, firstDraftId)!;

  function missingVideo() {
    const { beforeFile, edits } = fixture(firstDraftId, 15_000_000);
    edits.clips[before.id] = setTemplateClipVolume(edits.clips[before.id]!, 35);
    edits.music = setTemplateMusicStart(setTemplateMusicVolume(edits.music, 60), 30, beforeAfter.durationUs);
    saveTemplateDraft(beforeAfter, { ...edits, name: "Balcony cut" }, firstDraftId);
    const original = load();
    beforeFile.delete();
    const damaged = load();
    expect(damaged.missingSlots).toEqual([before.id]);
    expect(damaged.recoverableSlots).toEqual({ [before.id]: original.clips[before.id]!.name });
    return { original, damaged };
  }

  beforeEach(() => {
    new File(picked.uri).writeSync("original footage");
    vi.mocked(pickVideo).mockResolvedValue(picked);
    vi.mocked(probeVideo).mockResolvedValue(metadata);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  async function recover(
    session: ReturnType<typeof createTemplateDraftSession>,
    source: "Photos" | "Files",
  ): Promise<ReturnType<typeof session.relink> | undefined> {
    let restored: ReturnType<typeof session.relink> | undefined;
    await importTemplateVideos({
      template: beforeAfter,
      draftId: firstDraftId,
      slots: [before],
      source,
      isCurrent: () => true,
      validateClip: session.prepareRelink(before.id),
      commit: (clips) => {
        restored = session.relink(before.id, clips[before.id]!, { source: null, outputUri: null });
      },
    });
    return restored;
  }

  it.each(["Photos", "Files"] as const)(
    "restores the cut and mix from %s and reopens the recovered reel",
    async (source) => {
      const { original, damaged } = missingVideo();
      const initialSource = createTemplateSource(beforeAfter, original.clips, original.textOverrides, original.music)!;
      const session = createTemplateDraftSession(beforeAfter, firstDraftId);
      try {
        const beforeRelink = session.commit({ ...damaged, source: null, outputUri: null, music: null }, "remove music");
        session.undo(beforeRelink);
        expect(session.redoLabel).toBe("remove music");
        // A representation with a slightly different timebase can have exactly the same playable frames.
        vi.mocked(probeVideo).mockResolvedValueOnce({ ...metadata, durationUs: metadata.durationUs + 1 });
        const render = await recover(session, source);
        expect(session.redoLabel).toBeNull();
        expect(render?.outputUri).toBeNull();
        expect(pickVideo).toHaveBeenCalledWith(source);
        const restored = load();
        const clip = restored.clips[before.id]!;
        expect(clip.uri).not.toBe(original.clips[before.id]!.uri);
        expect(clip).toEqual({ ...original.clips[before.id], uri: clip.uri, sourceEndUs: metadata.durationUs + 1 });
        expect(new File(clip.uri).textSync()).toBe("original footage");
        expect(restored).toEqual({ ...original, clips: { ...original.clips, [before.id]: clip } });
        const sourceAfter = createTemplateSource(beforeAfter, restored.clips, restored.textOverrides, restored.music)!;
        expect(JSON.parse(sourceAfter).plan).toEqual(JSON.parse(initialSource).plan);
        expect(render?.source).toBe(sourceAfter);
        expect(Object.values(JSON.parse(sourceAfter).assets)).toContain(clip.uri);
        expect(session.undo({ source: sourceAfter, outputUri: null })).toBeNull();
        const muted = { ...restored, clips: { ...restored.clips, [before.id]: setTemplateClipVolume(clip, 0) } };
        const next = session.commit({ ...muted, source: sourceAfter, outputUri: null }, "mute");
        expect(session.undo(next)).toMatchObject({ clips: restored.clips, source: sourceAfter });
      } finally {
        session.close();
      }
      const reopened = load();
      expect(reopened.missingSlots).toEqual([]);
      expect(reopened.clips[before.id]).toMatchObject({
        volumePercent: 35,
        reframe: original.clips[before.id]!.reframe,
      });
    },
  );

  it.each([
    ["dimensions", { ...metadata, width: 1080, height: 1920 }, /dimensions/i],
    ["source start", { ...metadata, startUs: 100_000, durationUs: metadata.durationUs - 100_000 }, /frame range/i],
    ["source end", { ...metadata, durationUs: metadata.durationUs + 100_000 }, /frame range/i],
  ] as const)("can retry a selection with incompatible %s", async (_reason, candidate, message) => {
    const { damaged } = missingVideo();
    const session = createTemplateDraftSession(beforeAfter, firstDraftId);
    const beforeAttempt = new Map(storage.files);
    const copy = vi.spyOn(File.prototype, "copy");
    vi.mocked(probeVideo).mockResolvedValueOnce(candidate);
    try {
      await expect(recover(session, "Files")).rejects.toThrow(message);
      expect(copy).not.toHaveBeenCalled();
      expect(storage.files).toEqual(beforeAttempt);
      expect(load()).toEqual(damaged);
      expect(session.undoLabel).toBeNull();
      await recover(session, "Files");
      expect(load().missingSlots).toEqual([]);
    } finally {
      session.close();
    }
  });

  it("keeps a newer revision if the draft changes while the selected footage is copying", async () => {
    const { damaged } = missingVideo();
    const session = createTemplateDraftSession(beforeAfter, firstDraftId);
    let stagedFile: File | undefined;
    vi.spyOn(File.prototype, "copy").mockImplementationOnce(async function (this: File, destination) {
      stagedFile = new File(destination.uri);
      stagedFile.writeSync(this.textSync());
      renameTemplateDraft(beforeAfter, "Newer edit", firstDraftId);
    });
    try {
      await expect(recover(session, "Files")).rejects.toThrow(/changed/i);
      expect(stagedFile?.exists).toBe(false);
      expect(load()).toEqual({ ...damaged, name: "Newer edit" });
      expect(session.undoLabel).toBeNull();
    } finally {
      session.close();
    }
  });

  it.each(["cancel", "copy failure", "truncated copy", "manifest failure"] as const)(
    "keeps the saved edits and can retry after %s",
    async (failure) => {
      const { damaged } = missingVideo();
      const session = createTemplateDraftSession(beforeAfter, firstDraftId);
      const beforeAttempt = new Map(storage.files);
      try {
        if (failure === "cancel") vi.mocked(pickVideo).mockResolvedValueOnce(null);
        if (failure === "copy failure" || failure === "truncated copy") {
          vi.spyOn(File.prototype, "copy").mockImplementationOnce(async (destination) => {
            new File(destination.uri).writeSync("partial");
            if (failure === "copy failure") throw new Error("Interrupted copy");
          });
        }
        if (failure === "manifest failure") storage.interruptMove = true;
        const attempt = recover(session, "Files");
        if (failure === "cancel") await attempt;
        else await expect(attempt).rejects.toThrow();
        expect(storage.files).toEqual(beforeAttempt);
        expect(load()).toEqual(damaged);
        expect(session.undoLabel).toBeNull();
        storage.interruptMove = false;
        await recover(session, "Files");
        expect(load().missingSlots).toEqual([]);
      } finally {
        storage.interruptMove = false;
        session.close();
      }
    },
  );

  it("recovers an unreadable video independently while another slot and the soundtrack are missing", async () => {
    const { original } = missingVideo();
    const clip = original.clips[before.id]!;
    const afterClip = original.clips[after.id]!;
    new File(clip.uri).writeSync("unreadable file");
    storage.blockedRead = clip.uri;
    new File(afterClip.uri).delete();
    new File(original.music!.uri).delete();
    const session = createTemplateDraftSession(beforeAfter, firstDraftId);
    try {
      expect(load().recoverableSlots).toEqual({ [before.id]: clip.name, [after.id]: afterClip.name });
      const restored = await recover(session, "Files");
      expect(restored).toMatchObject({
        clips: { [before.id]: { name: clip.name, volumePercent: 35 } },
        missingSlots: [after.id],
        recoverableSlots: { [after.id]: afterClip.name },
        missingMusic: true,
        source: null,
      });
      expect(load().recoverableSlots).toEqual({ [after.id]: afterClip.name });
      new File(afterClip.uri).writeSync("other footage");
      new File(original.music!.uri).writeSync("soundtrack");
      const reopened = load();
      expect(reopened.clips[after.id]).toEqual(afterClip);
      expect(reopened.music).toEqual(original.music);
    } finally {
      storage.blockedRead = "";
      session.close();
    }
  });

  it("can deliberately replace the missing video with different footage and start a fresh cut", async () => {
    const { original, damaged } = missingVideo();
    const portrait = { ...metadata, width: 720, height: 1280 };
    vi.mocked(probeVideo).mockResolvedValueOnce(portrait);
    await importTemplateVideos({
      template: beforeAfter,
      draftId: firstDraftId,
      slots: [before],
      source: "Files",
      isCurrent: () => true,
      commit: (clips) =>
        saveTemplateDraft(beforeAfter, { ...damaged, clips: { ...damaged.clips, ...clips } }, firstDraftId),
    });
    const replaced = load();
    expect(replaced.recoverableSlots).toEqual({});
    const clip = replaced.clips[before.id]!;
    expect(clip).toEqual(createTemplateClip(before, clip.uri, picked.name, portrait));
    expect(replaced).toEqual({ ...original, clips: { ...original.clips, [before.id]: clip } });
    expect(new File(picked.uri).textSync()).toBe("original footage");
  });
});

describe("ordered template video import", () => {
  const slots = getVideoSlots(hook);
  const textOverrides = { "text/0": "Watch closely" };
  const draft = { name: "Series intro", clips: {}, music: null, textOverrides };
  const commit = vi.fn((clips: Record<string, TemplateClip>) => saveTemplateDraft(hook, { ...draft, clips }));
  const run = (overrides: Partial<Parameters<typeof importTemplateVideos>[0]> = {}) =>
    importTemplateVideos({ template: hook, slots, source: "Photos", isCurrent: () => true, commit, ...overrides });

  function cachedVideo(name: string) {
    const uri = `file:///Caches/ImagePicker/${name}`;
    storage.files.set(uri, name);
    return { uri, name, draftFileName: name };
  }

  function pick(names: string[]) {
    const videos = names.map(cachedVideo);
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

  it("reopens the five countdown picks in rank order with the edited title and names", async () => {
    const countdown = mobileTemplates.find(({ id }) => id === "top-5-countdown")!;
    const rankedNames = ["Ridge", "Cove", "Falls", "Dunes", "Peak"];
    const editedText = Object.fromEntries(
      ["Weekend hikes", ...rankedNames].map((value, index) => [`names/${index}`, value]),
    );
    const files = rankedNames.map((name) => `${name}.mov`);
    pick(files);
    await importTemplateVideos({
      template: countdown,
      draftId: firstDraftId,
      slots: getVideoSlots(countdown),
      source: "Photos",
      isCurrent: () => true,
      commit: (clips) => saveTemplateDraft(countdown, { clips, textOverrides: editedText, music: null }, firstDraftId),
    });

    expect(pickOrderedVideos).toHaveBeenCalledWith(5);
    expect(listTemplateDraftIds(countdown)).toEqual([firstDraftId]);
    const saved = loadTemplateDraft(countdown, firstDraftId)!;
    expect(saved.textOverrides).toEqual(editedText);
    expect(saved.missingSlots).toEqual([]);
    const rankedFiles = ["item5", "item4", "item3", "item2", "item1"].map((slotId) =>
      new File(saved.clips[slotId]!.uri).textSync(),
    );
    expect(rankedFiles).toEqual(files);
    expect(createTemplateSource(countdown, saved.clips, saved.textOverrides, saved.music)).not.toBeNull();
  });

  it("replaces only the rejected rank and saves all five picks in one edit", async () => {
    const countdown = mobileTemplates.find(({ id }) => id === "top-5-countdown")!;
    const ranks = getVideoSlots(countdown);
    const originals = pick(["Fifth.mov", "Fourth.mov", "Short.mov", "Second.mov", "First.mov"]);
    const unreadable = cachedVideo("Unreadable.mov");
    const replacement = cachedVideo("Third.mov");
    vi.mocked(pickVideo).mockResolvedValueOnce(unreadable).mockResolvedValueOnce(replacement);
    vi.mocked(probeVideo).mockImplementation(async (uri) => {
      if (uri === unreadable.uri) throw new Error("Unreadable video");
      return uri === originals[2]!.uri ? { ...metadata, durationUs: 1_000_000 } : metadata;
    });
    const save = vi.fn((clips: Record<string, TemplateClip>) =>
      saveTemplateDraft(countdown, { clips, textOverrides: {}, music: null }, firstDraftId),
    );
    const rejectedCopies = [originals[2]!, unreadable];
    const onInvalidVideo = vi.fn(async () => {
      expect(save).not.toHaveBeenCalled();
      expect(storage.files.has(rejectedCopies.shift()!.uri)).toBe(false);
      return true;
    });

    await run({ template: countdown, draftId: firstDraftId, slots: ranks, commit: save, onInvalidVideo });

    expect(pickOrderedVideos).toHaveBeenCalledExactlyOnceWith(5);
    expect(vi.mocked(pickVideo).mock.calls).toEqual([["Photos"], ["Photos"]]);
    expect(onInvalidVideo).toHaveBeenCalledTimes(2);
    expect(onInvalidVideo).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        slot: ranks[2],
        message: expect.stringContaining("4.00 seconds"),
      }),
    );
    expect(onInvalidVideo).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        slot: ranks[2],
        message: expect.stringContaining("Unreadable video"),
      }),
    );
    expect(save).toHaveBeenCalledTimes(1);
    const restored = loadTemplateDraft(countdown, firstDraftId)!;
    expect(ranks.map(({ id }) => new File(restored.clips[id]!.uri).textSync())).toEqual([
      "Fifth.mov",
      "Fourth.mov",
      "Third.mov",
      "Second.mov",
      "First.mov",
    ]);
    expect(createTemplateSource(countdown, restored.clips, restored.textOverrides, restored.music)).not.toBeNull();
    for (const { uri } of [...originals, unreadable, replacement]) expect(storage.files.has(uri)).toBe(false);
  });

  it("offers another replacement for the same slot when Photos fails to deliver a replacement video", async () => {
    pick(["First.mp4", "Short.mp4", "Third.mp4"]);
    vi.mocked(probeVideo)
      .mockResolvedValueOnce(metadata)
      .mockResolvedValueOnce({ ...metadata, durationUs: 1 });
    vi.mocked(pickVideo)
      .mockRejectedValueOnce(new Error("Photos could not load the selection"))
      .mockResolvedValueOnce(cachedVideo("Second.mp4"));
    const onInvalidVideo = vi.fn(async () => true);

    await run({ onInvalidVideo });

    expect(onInvalidVideo).toHaveBeenCalledTimes(2);
    expect(onInvalidVideo).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        slot: slots[1],
        message: expect.stringContaining("Photos could not load the selection"),
      }),
    );
    expect(vi.mocked(pickVideo).mock.calls).toEqual([["Photos"], ["Photos"]]);
    expect(commit).toHaveBeenCalledTimes(1);
    const { clips } = loadTemplateDraft(hook)!;
    expect(slots.map(({ id }) => new File(clips[id]!.uri).textSync())).toEqual([
      "First.mp4",
      "Second.mp4",
      "Third.mp4",
    ]);
  });

  it("reports an initial ordered picker failure without prompting for an individual slot", async () => {
    const failure = new Error("Photos could not deliver the batch");
    vi.mocked(pickOrderedVideos).mockRejectedValueOnce(failure);
    const onInvalidVideo = vi.fn(async () => true);
    await expect(run({ onInvalidVideo })).rejects.toBe(failure);
    expect(onInvalidVideo).not.toHaveBeenCalled();
    expect(pickVideo).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("keeps a rejected pick and a replacement available when later slots use the same URIs", async () => {
    const short = cachedVideo("Two-seconds.mov");
    const long = cachedVideo("Full-length.mov");
    vi.mocked(pickOrderedVideos).mockResolvedValueOnce([short, short, long]);
    vi.mocked(pickVideo).mockResolvedValueOnce(long);
    vi.mocked(probeVideo).mockImplementation(async (uri) =>
      uri === short.uri ? { ...metadata, durationUs: 2_000_000 } : metadata,
    );
    const onInvalidVideo = vi.fn(async () => {
      expect(new File(short.uri).textSync()).toBe(short.name);
      return true;
    });

    await run({ onInvalidVideo });

    expect(onInvalidVideo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ slot: slots[0] }));
    expect(commit).toHaveBeenCalledTimes(1);
    const { clips } = loadTemplateDraft(hook)!;
    expect(slots.map(({ id }) => new File(clips[id]!.uri).textSync())).toEqual([long.name, short.name, long.name]);
    expect(storage.files.has(short.uri)).toBe(false);
    expect(storage.files.has(long.uri)).toBe(false);
  });

  it("preserves both staged and rejected inputs from a different cache folder when the user declines a retry", async () => {
    const originals = ["First.mp4", "Short.mp4"].map((name) => {
      const uri = `file:///Caches/ImagePickerBackup/${name}`;
      storage.files.set(uri, name);
      return { uri, name, draftFileName: name };
    });
    const before = new Map(storage.files);
    vi.mocked(pickOrderedVideos).mockResolvedValueOnce(originals);
    vi.mocked(probeVideo)
      .mockResolvedValueOnce(metadata)
      .mockResolvedValueOnce({ ...metadata, durationUs: 1 });
    const onInvalidVideo = vi.fn(async () => {
      for (const { uri, name } of originals) expect(new File(uri).textSync()).toBe(name);
      return false;
    });

    await run({ onInvalidVideo });

    expect(onInvalidVideo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ slot: slots[1] }));
    expect(commit).not.toHaveBeenCalled();
    expect(storage.files).toEqual(before);
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
    expect(reopened).toEqual({ ...saved, recoverableSlots: {}, missingSlots: [] });
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

  it.each(["decline", "cancel picker", "stale decision", "stale replacement"])(
    "discards the entire uncommitted selection on %s",
    async (outcome) => {
      const before = new Map(storage.files);
      pick(["First.mp4", "Short.mp4", "Third.mp4"]);
      vi.mocked(probeVideo)
        .mockResolvedValueOnce(metadata)
        .mockResolvedValueOnce({ ...metadata, durationUs: 1 });
      let current = true;
      const onInvalidVideo = vi.fn(async () => {
        if (outcome === "stale decision") current = false;
        return outcome !== "decline";
      });
      vi.mocked(pickVideo).mockImplementationOnce(async () => {
        if (outcome === "cancel picker") return null;
        current = false;
        return cachedVideo("Replacement.mp4");
      });

      await run({ isCurrent: () => current, onInvalidVideo });

      expect(onInvalidVideo).toHaveBeenCalledTimes(1);
      expect(pickVideo).toHaveBeenCalledTimes(outcome === "cancel picker" || outcome === "stale replacement" ? 1 : 0);
      expect(commit).not.toHaveBeenCalled();
      expect(storage.files).toEqual(before);
    },
  );

  it.each(["Photos", "Files"] as const)("reports a single-slot %s error without starting a retry", async (source) => {
    const before = new Map(storage.files);
    vi.mocked(pickVideo).mockResolvedValueOnce(cachedVideo("Short.mp4"));
    vi.mocked(probeVideo).mockResolvedValueOnce({ ...metadata, durationUs: 1 });
    const onInvalidVideo = vi.fn(async () => true);
    await expect(run({ slots: [slots[0]!], source, onInvalidVideo })).rejects.toMatchObject({ slot: slots[0] });
    expect(pickVideo).toHaveBeenCalledExactlyOnceWith(source);
    expect(onInvalidVideo).not.toHaveBeenCalled();
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

      const onInvalidVideo = vi.fn(async () => true);
      await expect(run(failure === "partial move" ? { onInvalidVideo } : {})).rejects.toMatchObject({
        slot: slots[1],
        message: expect.stringContaining("B-roll"),
      });
      expect(onInvalidVideo).not.toHaveBeenCalled();
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
    await run({ isCurrent: () => current });
    expect(commit).not.toHaveBeenCalled();
    expect(storage.files).toEqual(before);
  });

  it("keeps external originals and the previous draft when the manifest cannot be published", async () => {
    const original = { uri: "file:///Documents/Original.mov", name: "Original", draftFileName: "clip.mov" };
    storage.files.set(original.uri, "original video");
    const before = new Map(storage.files);
    vi.mocked(pickOrderedVideos).mockResolvedValueOnce([original]);
    storage.interruptMove = true;
    const onInvalidVideo = vi.fn(async () => true);
    await expect(run({ onInvalidVideo })).rejects.toThrow("Interrupted write");
    expect(onInvalidVideo).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(storage.files).toEqual(before);
    expect(loadTemplateDraft(hook)).toMatchObject(draft);
  });
});
