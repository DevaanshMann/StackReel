import { probeVideo } from "@stackreel/engine";
import { File } from "expo-file-system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTemplateVideoSlot,
  commitTemplateDraftUpdate,
  createDraftMediaFile,
  deleteTemplateDraft,
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
  setTemplateText,
  swapTemplateClips,
} from "../src/template-editor";

import type { TemplateClip } from "../src/template-editor";
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
  nextMedia: 0,
}));

vi.mock("expo-crypto", () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++storage.nextMedia).padStart(12, "0")}`,
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

    create() {
      storage.directories.add(this.uri);
    }

    list() {
      return [...storage.files.keys()].filter((uri) => uri.startsWith(`${this.uri}/`)).map((uri) => new File(uri));
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
const hook = mobileTemplates.find(({ id }) => id === "hook-and-reveal")!;
const [before, after] = getVideoSlots(beforeAfter) as [
  ReturnType<typeof getVideoSlots>[number],
  ReturnType<typeof getVideoSlots>[number],
];
const metadata = { width: 1920, height: 1080, startUs: 0, durationUs: 9_000_000 };

function fixture() {
  const beforeFile = createDraftMediaFile(beforeAfter, "Before.mov");
  const afterFile = createDraftMediaFile(beforeAfter, "After.mov");
  const musicFile = createDraftMediaFile(beforeAfter, "Track.m4a");
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
  storage.directories.clear();
  storage.interruptMove = false;
  storage.blockedDeletion = "";
});

describe("template draft storage", () => {
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

  it("renames a legacy draft and carries the name through later edits", () => {
    const { edits } = fixture();
    saveTemplateDraft(beforeAfter, edits);
    expect(loadTemplateDraft(beforeAfter)?.name).toBeNull();

    renameTemplateDraft(beforeAfter, "  Weekend cut  ");
    const renamed = loadTemplateDraft(beforeAfter)!;
    expect(renamed).toMatchObject({ ...edits, name: "Weekend cut" });

    saveTemplateDraft(beforeAfter, { ...renamed, music: null });
    expect(loadTemplateDraft(beforeAfter)).toMatchObject({ name: "Weekend cut", music: null });
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
