import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDraftMediaFile, loadTemplateDraft, saveTemplateDraft } from "../src/template-drafts";
import {
  createTemplateClip,
  createTemplateMusic,
  createTemplateSource,
  getTemplateTextFields,
  getVideoSlots,
  mobileTemplates,
  setTemplateClipReframe,
  setTemplateClipTrim,
  setTemplateText,
} from "../src/template-editor";

const storage = vi.hoisted(() => ({
  document: "file:///Documents",
  files: new Map<string, string>(),
  directories: new Set<string>(),
  interruptMove: false,
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

describe("template draft storage", () => {
  beforeEach(() => {
    storage.document = "file:///Documents";
    storage.files.clear();
    storage.directories.clear();
    storage.interruptMove = false;
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
    expect(storage.files.has(pending)).toBe(true);
    expect(beforeFile.exists && musicFile.exists).toBe(true);
    expect(loadTemplateDraft(beforeAfter)).toMatchObject(edits);
    expect(replacement.exists).toBe(false);
    expect(storage.files.has(pending)).toBe(false);

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
      clips: { [after.id]: edits.clips[after.id] },
      textOverrides: edits.textOverrides,
      music: null,
      missingSlots: [before.id],
      missingMusic: true,
    });
  });
});
