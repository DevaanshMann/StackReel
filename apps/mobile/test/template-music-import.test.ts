import { probeAudio } from "@stackreel/engine";
import { Asset } from "expo-asset";
import { getDocumentAsync } from "expo-document-picker";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createDraftMediaFile,
  createTemplateDraftSession,
  deleteTemplateDraft,
  duplicateTemplateDraft,
  loadTemplateDraft,
} from "../src/template-drafts";
import {
  createTemplateClip,
  getVideoSlots,
  mobileTemplates,
  setTemplateMusicStart,
  setTemplateMusicVolume,
} from "../src/template-editor";
import type { TemplateMusic } from "../src/template-editor";
import { importTemplateMusic } from "../src/template-music-import";
import { File, storage } from "./draft-filesystem-fixture";

const bundledUri = "file:///Caches/daybreak.m4a";
const pickerDir = "file:///Caches/DocumentPicker";
const pickedUri = pickerDir + "/daybreak.m4a";
const template = mobileTemplates.find(({ id }) => id === "before-after")!;
const render = { source: null, outputUri: null };
const draft = { ...render, clips: {}, textOverrides: {} };
const options = {
  template,
  draftId: template.id,
  source: "daybreak",
  currentMusic: null,
  isCurrent: () => true,
} as const;
const metadata = { startUs: 0, durationUs: 30_000_000 };

vi.mock("expo-asset", () => ({
  Asset: { fromModule: vi.fn(() => ({ downloadAsync: async () => ({ localUri: bundledUri }) })) },
}));
vi.mock("@stackreel/engine", () => ({ probeAudio: vi.fn() }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("expo-file-system", () => import("./draft-filesystem-fixture"));
vi.mock("expo-crypto", () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++storage.nextMedia).padStart(12, "0")}`,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(probeAudio).mockResolvedValue(metadata);
  storage.files = new Map([[bundledUri, "bundled audio"]]);
  storage.directories = new Set([storage.document, "file:///Caches", pickerDir]);
});
afterEach(() => vi.restoreAllMocks());

function chooseFile() {
  new File(pickedUri).writeSync("different audio");
  vi.mocked(getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: pickedUri, name: "Daybreak", lastModified: 0 }],
  });
}

it("stores an independently editable Daybreak and distinguishes a Files import with the same title", async () => {
  const session = createTemplateDraftSession(template, template.id);
  const clips = Object.fromEntries(
    getVideoSlots(template).map((slot) => {
      const file = createDraftMediaFile(template, "clip.mov");
      file.writeSync("video");
      return [slot.id, createTemplateClip(slot, file.uri, "clip.mov", { ...metadata, width: 720, height: 1280 })];
    }),
  );
  const commit = (music: TemplateMusic) => session.commit({ ...draft, clips, music }, "select music");
  try {
    await importTemplateMusic({ ...options, commit });
    const track = loadTemplateDraft(template)!.music!;
    expect(track).toMatchObject({ name: "Daybreak", starterId: "daybreak" });
    expect(track.uri).toMatch(/\/StackReelDrafts\/before-after\/[^/]+\.m4a$/);
    expect(new File(track.uri).textSync()).toBe("bundled audio");
    expect(getDocumentAsync).not.toHaveBeenCalled();

    const edited = setTemplateMusicStart(setTemplateMusicVolume(track, 35), 60, template.durationUs);
    commit(edited);
    const duplicate = await duplicateTemplateDraft(template, template.id, "Second cut");
    expect(duplicate.draft.music).toEqual({ ...edited, uri: expect.stringContaining(duplicate.draftId) });

    const { assets } = JSON.parse(duplicate.source!);
    expect(assets[`slot:${template.audio!.music!.slot}`]).toBe(duplicate.draft.music!.uri);

    const unchanged = vi.fn();
    await importTemplateMusic({ ...options, currentMusic: loadTemplateDraft(template)!.music, commit: unchanged });
    expect(unchanged).not.toHaveBeenCalled();
    expect(Asset.fromModule).toHaveBeenCalledTimes(1);

    chooseFile();
    await importTemplateMusic({ ...options, source: "files", currentMusic: edited, commit });
    const fromFiles = loadTemplateDraft(template)!.music!;
    expect(fromFiles.starterId).toBeUndefined();
    expect(new File(fromFiles.uri).textSync()).toBe("different audio");
    expect(new File(pickedUri).exists).toBe(false);
    expect(session.undo(render)?.music).toEqual(edited);
    expect(session.redo(render)?.music).toEqual(fromFiles);
    await importTemplateMusic({ ...options, currentMusic: fromFiles, commit });
    expect(loadTemplateDraft(template)!.music?.starterId).toBe("daybreak");

    deleteTemplateDraft(template);
    expect(loadTemplateDraft(template, duplicate.draftId)?.music).toEqual(duplicate.draft.music);
    expect(new File(duplicate.draft.music!.uri).textSync()).toBe("bundled audio");
    expect(new File(bundledUri).textSync()).toBe("bundled audio");
  } finally {
    session.close();
  }
});

it.each(["copy failure", "truncated copy", "stale copy", "commit failure"] as const)(
  "preserves the previous soundtrack and removes staged audio after a %s",
  async (failure) => {
    const session = createTemplateDraftSession(template, template.id);
    const commit = (music: TemplateMusic) => session.commit({ ...draft, music }, "select music");
    try {
      chooseFile();
      await importTemplateMusic({ ...options, source: "files", commit });
      const original = loadTemplateDraft(template)!;
      const files = new Map(storage.files);
      let current = true;
      const copy = File.prototype.copy;
      vi.spyOn(File.prototype, "copy").mockImplementation(async function (this: File, target) {
        await copy.call(this, target);
        if (failure === "copy failure") throw new Error("Interrupted copy");
        if (failure === "truncated copy") target.writeSync("part");
        if (failure === "stale copy") current = false;
      });
      const save = vi.fn((music: TemplateMusic) => {
        storage.interruptMove = failure === "commit failure";
        return commit(music);
      });
      const attempt = importTemplateMusic({
        ...options,
        currentMusic: original.music,
        isCurrent: () => current,
        commit: save,
      });
      if (failure === "stale copy") await expect(attempt).resolves.toBeUndefined();
      else await expect(attempt).rejects.toThrow();
      expect(save).toHaveBeenCalledTimes(failure === "commit failure" ? 1 : 0);
      expect(storage.files).toEqual(files);
      expect(loadTemplateDraft(template)).toEqual(original);
    } finally {
      storage.interruptMove = false;
      session.close();
    }
  },
);

it("keeps the missing soundtrack recoverable across a cancelled or incompatible Files pick", async () => {
  const session = createTemplateDraftSession(template, template.id);
  try {
    await importTemplateMusic({
      ...options,
      commit: (music) => session.commit({ ...draft, music }, "add music"),
    });
    new File(loadTemplateDraft(template)!.music!.uri).delete();
    const files = new Map(storage.files);
    const validateMusic = vi.fn((music: TemplateMusic) => {
      if (music.starterId !== "daybreak") throw new Error("Expected bundled Daybreak");
    });
    const commit = vi.fn<(music: TemplateMusic) => void>();
    const relink = { ...options, validateMusic, commit };

    vi.mocked(probeAudio).mockClear();
    vi.mocked(getDocumentAsync).mockResolvedValue({ canceled: true, assets: null });
    await importTemplateMusic({ ...relink, source: "files" });
    expect(probeAudio).not.toHaveBeenCalled();
    expect(validateMusic).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(storage.files).toEqual(files);

    chooseFile(); // The picker returns a different song also named Daybreak.
    const move = vi.spyOn(File.prototype, "move");
    await expect(importTemplateMusic({ ...relink, source: "files" })).rejects.toThrow("Expected bundled Daybreak");
    expect(validateMusic).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Daybreak", uri: pickedUri, sourceEndUs: metadata.durationUs }),
    );
    expect(move).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(storage.files).toEqual(files);
    expect(loadTemplateDraft(template)?.missingMusic).toBe(true);

    await importTemplateMusic(relink);
    expect(validateMusic).toHaveBeenLastCalledWith(expect.objectContaining({ uri: bundledUri, starterId: "daybreak" }));
    expect(commit).toHaveBeenCalledTimes(1);
    const restored = commit.mock.calls[0]![0];
    expect(restored.uri).not.toBe(bundledUri);
    expect(new File(restored.uri).textSync()).toBe("bundled audio");
  } finally {
    session.close();
  }
});
