import type { RenderPlan } from "@stackreel/core";
import { Directory, File, Paths } from "expo-file-system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "expo-crypto";
import { defaultClipReframe } from "../src/clip-reframe";
import { createTrimmedClipSource } from "../src/clip-source";
import type { SingleClipFit } from "../src/clip-source";
import { discardPickerCopy } from "../src/draft-files";
import { captionLimit } from "../src/single-clip-caption";
import {
  createSingleClipDraftId,
  createSingleClipSource,
  deleteSingleClipDraft,
  importSingleClipDraft,
  legacySingleClipDraftId,
  listSingleClipDraftIds,
  loadSingleClipDraft,
  setSingleClipCaption,
  setSingleClipExportResolution,
  setSingleClipFit,
  setSingleClipReframe,
  setSingleClipVolume,
  trimSingleClipDraft,
} from "../src/single-clip-draft";
import type { SingleClip } from "../src/single-clip-draft";
import { storage } from "./draft-filesystem-fixture";

vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-file-system", () => import("./draft-filesystem-fixture"));

const media = { width: 1920, height: 1080, startUs: 1_000_000, durationUs: 4_000_000 };
const external = "file:///Files/from-outside.mov";
const trimmed = { startFrame: 45, endFrame: 99 };

function importVideo(uri = external, isCurrent = () => true, draftId?: string) {
  return importSingleClipDraft(
    { name: "Concert take.MOV", draftFileName: "representation.MP4", uri },
    media,
    isCurrent,
    draftId,
  );
}

function manifest(clip: SingleClip) {
  return new File(clip.uri).parentDirectory
    .list()
    .find((entry): entry is File => entry instanceof File && /^draft-\d+\.json$/.test(entry.name))!;
}

beforeEach(() => {
  storage.document = "file:///Documents";
  storage.files = new Map([[external, "video contents"]]);
  storage.directories = new Set([
    storage.document,
    "file:///Caches",
    "file:///Caches/ImagePicker",
    "file:///Caches/DocumentPicker",
    "file:///Files",
  ]);
  storage.interruptMove = false;
  storage.blockedListing = "";
  storage.blockedRead = "";
  storage.blockedDeletion = "";
});
afterEach(() => vi.restoreAllMocks());

describe("single-clip draft storage", () => {
  it("remembers export resolution per project while keeping the editor preview at 720p", async () => {
    const id = createSingleClipDraftId();
    const otherId = createSingleClipDraftId();
    const clip = (await importVideo(external, () => true, id))!;
    const other = (await importVideo(external, () => true, otherId))!;
    const fullHD = setSingleClipExportResolution(clip, 1080);
    expect(fullHD).toEqual({ ...clip, exportResolution: 1080 });
    expect(loadSingleClipDraft(id)).toEqual(fullHD);
    expect(loadSingleClipDraft(otherId)?.exportResolution).toBe(720);
    expect(JSON.parse(createSingleClipSource(fullHD, fullHD.exportResolution)).plan.canvas).toMatchObject({
      width: 1080,
      height: 1920,
    });
    expect(JSON.parse(fullHD.source).plan.canvas).toMatchObject({ width: 720, height: 1280 });
    const before = new Map(storage.files);
    expect(setSingleClipExportResolution(fullHD, 1080)).toBe(fullHD);
    expect(() => setSingleClipCaption(clip, "stale edit")).toThrow(/changed/);
    expect(storage.files).toEqual(before);

    const replacement = (await importVideo(external, () => true, id))!;
    expect(replacement.exportResolution).toBe(1080);
    expect(setSingleClipExportResolution(replacement, 720).exportResolution).toBe(720);
    expect(loadSingleClipDraft(id)?.exportResolution).toBe(720);
    expect(loadSingleClipDraft(otherId)).toEqual(other);
  });

  it("preserves an unreadable resolution for recovery", async () => {
    const clip = (await importVideo())!;
    const snapshot = manifest(clip);
    const saved = { ...JSON.parse(snapshot.textSync()), exportResolution: 2160 };
    snapshot.writeSync(JSON.stringify(saved));
    const before = new Map(storage.files);
    expect(() => loadSingleClipDraft()).toThrow(/invalid format/);
    expect(storage.files).toEqual(before);
  });

  it("renders the saved caption above the whole cut, including a one-frame trim audition", async () => {
    const original = (await importVideo())!;
    const text = "Look at the drummer 👩🏽‍🎤";
    const captioned = setSingleClipCaption(original, text);
    const { plan, assets } = JSON.parse(captioned.source);
    const baseline = JSON.parse(original.source);
    expect(assets).toEqual(baseline.assets);
    expect(plan).toEqual({
      ...baseline.plan,
      layers: [
        baseline.plan.layers[0],
        expect.objectContaining({
          kind: "text",
          text,
          z: 1,
          startUs: 0,
          endUs: plan.durationUs,
          placement: expect.objectContaining({ anchor: "bottom", xPx: plan.canvas.width / 2 }),
        }),
      ],
    });
    const selection = { startFrame: 60, endFrame: 61 };
    const audition = createSingleClipSource({ ...captioned, selection });
    const cut = trimSingleClipDraft(captioned, selection);
    expect(cut.source).toBe(audition);
    const filled = setSingleClipFit(cut, "cover");
    const reframed = setSingleClipReframe(filled, { zoom: 2, x: 1, y: 0 });
    const muted = setSingleClipVolume(reframed, 0);
    for (const clip of [cut, filled, reframed, muted, loadSingleClipDraft()!]) {
      const edited: RenderPlan = JSON.parse(clip.source).plan;
      expect(clip.caption).toBe(text);
      expect(edited.durationUs).toBe(33_333);
      expect(edited.layers[1]).toEqual({ ...plan.layers[1], endUs: edited.durationUs });
    }
  });

  it("preserves the export for equivalent captions and changes the source only when wording changes", async () => {
    const id = createSingleClipDraftId();
    const untouchedId = createSingleClipDraftId();
    const original = (await importVideo(external, () => true, id))!;
    const untouched = (await importVideo(external, () => true, untouchedId))!;
    const captioned = setSingleClipCaption(original, "My first cut");
    expect(loadSingleClipDraft(id)).toEqual(captioned);
    const before = new Map(storage.files);
    // publishSingleEdit retains the cached MP4 when an applied setting returns the current clip.
    expect(setSingleClipCaption(captioned, "  My\nfirst cut  ")).toBe(captioned);
    expect(() => setSingleClipCaption(original, "stale")).toThrow(/changed/);
    expect(storage.files).toEqual(before);
    const changed = setSingleClipCaption(captioned, "My second cut");
    expect(changed.source).not.toBe(captioned.source);
    const cleared = setSingleClipCaption(changed, " \n ");
    expect(cleared.source).toBe(original.source);
    expect(JSON.parse(manifest(cleared).textSync())).not.toHaveProperty("caption");
    expect(loadSingleClipDraft(id)).toEqual(original);
    expect(setSingleClipCaption(cleared, "")).toBe(cleared);
    expect(loadSingleClipDraft(untouchedId)).toEqual(untouched);
  });

  it("wraps pasted captions as one paragraph and counts astral emoji without splitting them", async () => {
    const clip = (await importVideo())!;
    const prefix = "🎬".repeat(captionLimit - 2);
    const captioned = setSingleClipCaption(clip, `${prefix}\n\r\u0085\u2028\u2029   🎉`);
    const text = `${prefix} 🎉`;
    expect(captioned.caption).toBe(text);
    expect(JSON.parse(captioned.source).plan.layers[1].text).toBe(text);
    expect(loadSingleClipDraft()).toEqual(captioned);
    const before = new Map(storage.files);
    expect(() => setSingleClipCaption(captioned, text + "🎉")).toThrow(/80 characters/);
    expect(storage.files).toEqual(before);
  });

  it("reopens the trim in a fresh module after the documents container moves", async () => {
    expect(loadSingleClipDraft()).toBeNull();
    const clip = (await importVideo())!;
    expect(clip.selection).toEqual({ startFrame: 30, endFrame: 150 });
    const edited = trimSingleClipDraft(clip, trimmed);
    expect(edited.source).toEqual(createTrimmedClipSource(clip.uri, media, trimmed));
    const saved = JSON.parse(manifest(edited).textSync());
    expect(saved).toEqual({
      version: 1,
      file: new File(clip.uri).name,
      bytes: "video contents".length,
      name: clip.name,
      media,
      selection: trimmed,
      fit: "contain",
      volumePercent: 100,
      exportResolution: 720,
    });
    expect(saved.file).toMatch(/^[\da-f-]+\.mp4$/);
    expect(manifest(edited).textSync()).not.toContain("file://");
    const oldDocument = storage.document;
    storage.document = "file:///NewContainer/Documents";
    const relocate = (uri: string) => uri.replace(oldDocument, storage.document);
    storage.files = new Map([...storage.files].map(([uri, data]) => [relocate(uri), data]));
    storage.directories = new Set([...storage.directories].map(relocate));
    vi.resetModules();
    const { loadSingleClipDraft: coldLoad } = await import("../src/single-clip-draft");
    const uri = relocate(clip.uri);
    expect(coldLoad()).toEqual({ ...edited, uri, source: createTrimmedClipSource(uri, media, trimmed) });
  });

  it("opens an older version 1 snapshot and writes its defaults on the next edit", async () => {
    const clip = (await importVideo())!;
    const snapshot = manifest(clip);
    const saved = JSON.parse(snapshot.textSync());
    delete saved.fit;
    delete saved.volumePercent;
    delete saved.exportResolution;
    snapshot.writeSync(JSON.stringify(saved));
    const before = new Map(storage.files);
    const legacy = loadSingleClipDraft()!;
    expect(legacy).toEqual(clip);
    expect(setSingleClipFit(legacy, "contain")).toBe(legacy);
    expect(setSingleClipVolume(legacy, 100)).toBe(legacy);
    expect(setSingleClipExportResolution(legacy, 720)).toBe(legacy);
    expect(storage.files).toEqual(before);
    const filled = setSingleClipFit(legacy, "cover");
    expect(JSON.parse(manifest(filled).textSync())).toEqual({
      ...saved,
      fit: "cover",
      volumePercent: 100,
      exportResolution: 720,
    });
    expect(loadSingleClipDraft()).toEqual(filled);
  });

  it("preserves the trim on a framing edit and preserves Fill on a later trim", async () => {
    const original = (await importVideo())!;
    const edited = trimSingleClipDraft(original, trimmed);
    const filled = setSingleClipFit(edited, "cover");
    expect(filled).toEqual({
      ...edited,
      fit: "cover",
      source: createTrimmedClipSource(edited.uri, media, trimmed, "cover"),
    });
    expect(loadSingleClipDraft()).toEqual(filled);
    expect(() => trimSingleClipDraft(edited, original.selection)).toThrow(/changed/);
    expect(() => setSingleClipFit(original, "cover")).toThrow(/changed/);

    const shortened = { ...trimmed, endFrame: 80 };
    const retrimmed = trimSingleClipDraft(filled, shortened);
    expect(retrimmed).toEqual({
      ...filled,
      selection: shortened,
      source: createTrimmedClipSource(filled.uri, media, shortened, "cover"),
    });
    expect(loadSingleClipDraft()).toEqual(retrimmed);
    expect(setSingleClipFit(retrimmed, "contain")).toMatchObject({ fit: "contain", selection: shortened });
  });

  it("remembers custom Fill across Fit, trimming, restart, and a failed edit, then resets to centered Fill", async () => {
    const initial = (await importVideo())!;
    const covered = setSingleClipFit(initial, "cover");
    const crop = { zoom: 3, x: 0, y: 1 };
    const reframed = setSingleClipReframe(covered, crop);
    expect(JSON.parse(manifest(reframed).textSync()).reframe).toEqual(crop);
    expect(reframed.source).toBe(createTrimmedClipSource(initial.uri, media, initial.selection, "cover", crop));

    const fitted = setSingleClipFit(reframed, "contain");
    expect(fitted.source).toBe(initial.source);
    expect(() => setSingleClipFit(initial, "cover")).toThrow(/changed/);
    expect(() => trimSingleClipDraft(initial, trimmed)).toThrow(/changed/);
    const oneFrame = { startFrame: 32, endFrame: 33 };
    const retrimmed = trimSingleClipDraft(fitted, oneFrame);
    vi.resetModules();
    const { loadSingleClipDraft: coldLoad } = await import("../src/single-clip-draft");
    const reopened = coldLoad()!;
    expect(reopened).toEqual(retrimmed);
    const restored = setSingleClipFit(reopened, "cover");
    expect(restored.source).toBe(createTrimmedClipSource(initial.uri, media, oneFrame, "cover", crop));

    const before = new Map(storage.files);
    storage.interruptMove = true;
    expect(() => setSingleClipReframe(restored, defaultClipReframe)).toThrow("Interrupted write");
    expect(storage.files).toEqual(before);
    expect(loadSingleClipDraft()).toEqual(restored);
    storage.interruptMove = false;
    const reset = setSingleClipReframe(restored, defaultClipReframe);
    expect(reset).not.toHaveProperty("reframe");
    expect(JSON.parse(manifest(reset).textSync())).not.toHaveProperty("reframe");
    expect(reset.source).toBe(createTrimmedClipSource(initial.uri, media, oneFrame, "cover"));
    expect(loadSingleClipDraft()).toEqual(reset);
  });

  it("preserves object identity and snapshot for equivalent crops on an axis with no travel", async () => {
    const clip = setSingleClipFit((await importVideo())!, "cover");
    const before = new Map(storage.files);
    expect(setSingleClipReframe(clip, { zoom: 1, x: 0.5, y: 0 })).toBe(clip);
    expect(storage.files).toEqual(before);
    const panned = setSingleClipReframe(clip, { zoom: 1, x: 1, y: 0 });
    expect(panned.reframe).toEqual({ zoom: 1, x: 1, y: 0.5 });
    const after = new Map(storage.files);
    expect(setSingleClipReframe(panned, { zoom: 1, x: 1, y: 1 })).toBe(panned);
    expect(() => setSingleClipReframe(panned, { zoom: NaN, x: 0, y: 0 })).toThrow();
    expect(storage.files).toEqual(after);
  });

  it.each([null, {}, [], { zoom: 4, x: 0, y: 0 }, { zoom: 1, x: -1, y: 0 }, { zoom: 1, x: "0", y: 0 }])(
    "preserves the recovery files for a Fit draft with a corrupt remembered crop %j",
    async (reframe) => {
      const clip = (await importVideo())!;
      const snapshot = manifest(clip);
      snapshot.writeSync(JSON.stringify({ ...JSON.parse(snapshot.textSync()), reframe }));
      const before = new Map(storage.files);
      expect(() => loadSingleClipDraft()).toThrow();
      await expect(importVideo()).rejects.toThrow();
      expect(storage.files).toEqual(before);
    },
  );

  it("auditions the saved trim and Fill crop, then commits the same plan and level on apply", async () => {
    const clip = (await importVideo())!;
    const filled = setSingleClipFit(trimSingleClipDraft(clip, trimmed), "cover");
    const reframed = setSingleClipReframe(filled, { zoom: 2, x: 1, y: 0 });
    const original: RenderPlan = JSON.parse(reframed.source).plan;
    const before = new Map(storage.files);
    const audition = createSingleClipSource({ ...reframed, volumePercent: 50 });
    const gainDb = 20 * Math.log10(0.5);
    expect(JSON.parse(audition).plan).toEqual({
      ...original,
      layers: [{ ...original.layers[0], gainDb }],
      audio: [{ ...original.audio[0], gainDb }],
    });
    expect(storage.files).toEqual(before);
    const applied = setSingleClipVolume(reframed, 50);
    expect(applied).toEqual({ ...reframed, volumePercent: 50, source: audition });
    expect(loadSingleClipDraft()).toEqual(applied);
    const after = new Map(storage.files);
    expect(setSingleClipVolume(applied, 50)).toBe(applied);
    expect(() => setSingleClipVolume(reframed, 100)).toThrow(/changed/);
    expect(storage.files).toEqual(after);
    expect(setSingleClipVolume(applied, 100).source).toBe(reframed.source);
  });

  it("keeps mute through trim, fit, reframe, and reload", async () => {
    const muted = setSingleClipVolume((await importVideo())!, 0);
    const retrimmed = trimSingleClipDraft(muted, trimmed);
    const filled = setSingleClipFit(retrimmed, "cover");
    const reframed = setSingleClipReframe(filled, { zoom: 2, x: 0, y: 1 });
    for (const clip of [muted, retrimmed, filled, reframed, loadSingleClipDraft()!]) {
      expect(clip.volumePercent).toBe(0);
      const plan: RenderPlan = JSON.parse(clip.source).plan;
      expect(plan.audio[0]?.gainDb).toBe(-60);
      expect(plan.layers[0]).toMatchObject({ gainDb: -60 });
    }
  });

  it("detects a stale edit even when two volume settings render at the same gain floor", async () => {
    const muted = setSingleClipVolume((await importVideo())!, 0);
    const quiet = setSingleClipVolume(muted, 0.01);
    expect(quiet.source).toBe(muted.source);
    expect(loadSingleClipDraft()).toEqual(quiet);
    expect(() => trimSingleClipDraft(muted, trimmed)).toThrow(/changed/);
    expect(() => setSingleClipVolume(muted, 0)).toThrow(/changed/);
  });

  it.each([null, false, "50", -1, 101])(
    "rejects stored volume %j and preserves recovery files",
    async (volumePercent) => {
      const clip = (await importVideo())!;
      const snapshot = manifest(clip);
      snapshot.writeSync(JSON.stringify({ ...JSON.parse(snapshot.textSync()), volumePercent }));
      const before = new Map(storage.files);
      expect(() => loadSingleClipDraft()).toThrow();
      await expect(importVideo()).rejects.toThrow();
      expect(storage.files).toEqual(before);
    },
  );

  it("starts a replacement video in Fit at full volume with its full trim range and no caption", async () => {
    const clip = (await importVideo())!;
    const previous = setSingleClipReframe(setSingleClipFit(trimSingleClipDraft(clip, trimmed), "cover"), {
      zoom: 2,
      x: 1,
      y: 0,
    });
    setSingleClipCaption(setSingleClipVolume(previous, 0), "Concert opener");
    const next = (await importVideo())!;
    expect(next).toMatchObject({ fit: "contain", selection: clip.selection, volumePercent: 100 });
    expect(next).not.toHaveProperty("reframe");
    expect(next).not.toHaveProperty("caption");
    expect(loadSingleClipDraft()).toEqual(next);
    expect(new File(previous.uri).exists).toBe(false);
  });

  it("returns the same object for unchanged edits and preserves the draft on invalid edits", async () => {
    const clip = (await importVideo())!;
    const before = new Map(storage.files);
    expect(trimSingleClipDraft(clip, { ...clip.selection })).toBe(clip);
    expect(setSingleClipFit(clip, "contain")).toBe(clip);
    expect(() => trimSingleClipDraft(clip, { startFrame: 20, endFrame: 900 })).toThrow();
    expect(() => setSingleClipFit(clip, "fill" as SingleClipFit)).toThrow(RangeError);
    for (const percent of [-1, 101, NaN, Infinity])
      expect(() => setSingleClipVolume(clip, percent)).toThrow(RangeError);
    expect(storage.files).toEqual(before);
  });

  it.each(["ImagePicker", "DocumentPicker"])(
    "moves %s cache media and replaces it only after committing the next draft",
    async (picker) => {
      const source = new File(Paths.cache, picker, "picker.mov");
      source.writeSync("picked video");
      const clip = (await importVideo(source.uri))!;
      expect(source.exists).toBe(false);
      expect(new File(clip.uri).textSync()).toBe("picked video");
      const next = (await importVideo())!;
      expect(loadSingleClipDraft()).toEqual(next);
      expect(new File(clip.uri).exists).toBe(false);
      expect(new File(external).textSync()).toBe("video contents");
      expect(() => trimSingleClipDraft(clip, trimmed)).toThrow(/changed/);
    },
  );

  it("copies picks outside picker-owned folders, including other cache files", async () => {
    const source = new File(Paths.cache, "video.mp4");
    source.writeSync("original");
    const clip = (await importVideo(source.uri))!;
    discardPickerCopy(source.uri);
    deleteSingleClipDraft();
    expect(new File(clip.uri).exists).toBe(false);
    expect(source.textSync()).toBe("original");
    expect(loadSingleClipDraft()).toBeNull();
  });

  it("cleans up the picker’s temporary copy when probing fails before import", () => {
    const copy = new File(Paths.cache, "DocumentPicker", "picked.mov");
    copy.writeSync("unreadable footage");
    discardPickerCopy(copy.uri);
    expect(copy.exists).toBe(false);
    discardPickerCopy(external);
    expect(new File(external).exists).toBe(true);
  });

  it("keeps the last commit after failed copies and manifest moves for edits and replacements", async () => {
    const clip = (await importVideo())!;
    const before = new Map(storage.files);
    await expect(importVideo("file:///Files/missing.mov")).rejects.toThrow();
    storage.interruptMove = true;
    await expect(importVideo()).rejects.toThrow("Interrupted write");
    expect(() => trimSingleClipDraft(clip, trimmed)).toThrow("Interrupted write");
    expect(() => setSingleClipFit(clip, "cover")).toThrow("Interrupted write");
    expect(() => setSingleClipVolume(clip, 50)).toThrow("Interrupted write");
    expect(storage.files).toEqual(before);
    expect(loadSingleClipDraft()).toEqual(clip);
  });

  it.each(["fill", "Cover", null, false, 0, {}])(
    "rejects a stored fit of %j and preserves the snapshot",
    async (fit) => {
      const clip = (await importVideo())!;
      const snapshot = manifest(clip);
      snapshot.writeSync(JSON.stringify({ ...JSON.parse(snapshot.textSync()), fit }));
      const before = new Map(storage.files);
      expect(() => loadSingleClipDraft()).toThrow(/invalid format/);
      await expect(importVideo()).rejects.toThrow(/invalid format/);
      expect(storage.files).toEqual(before);
    },
  );

  it("preserves in-flight media during discovery and drops a cancelled import", async () => {
    const previous = (await importVideo())!;
    const before = new Map(storage.files);
    let current = true;
    const copy = File.prototype.copy;
    vi.spyOn(File.prototype, "copy").mockImplementationOnce(async function (this: File, destination) {
      await copy.call(this, destination);
      expect(loadSingleClipDraft()).toEqual(previous);
      current = false;
    });
    expect(await importVideo(external, () => current)).toBeNull();
    expect(storage.files).toEqual(before);
  });

  it("prunes abandoned revisions, pending writes, and media on a successful cold load", async () => {
    const clip = (await importVideo())!;
    const directory = new File(clip.uri).parentDirectory;
    const before = new Map(storage.files);
    for (const name of ["draft-0.json", "pending.json", randomUUID() + ".mov"])
      new File(directory, name).writeSync("abandoned");
    expect(loadSingleClipDraft()).toEqual(clip);
    expect(storage.files).toEqual(before);
    manifest(clip).delete();
    expect(loadSingleClipDraft()).toBeNull();
    expect(new File(clip.uri).exists).toBe(false);
  });

  it.each([
    "missing video",
    "empty video",
    "truncated video",
    "unreadable video",
    "invalid JSON",
    "unreadable manifest",
    "unsupported version",
    "foreign media path",
    "bad metadata",
    "bad trim",
    "listing failure",
  ])("preserves all recovery files after %s and supports explicit deletion", async (damage) => {
    const clip = (await importVideo())!;
    const snapshot = manifest(clip);
    const file = new File(clip.uri);
    const directory = file.parentDirectory;
    new File(directory, randomUUID() + ".mov").writeSync("recovery");
    new File(directory, "draft-0.json").writeSync(snapshot.textSync());
    const saved = JSON.parse(snapshot.textSync());
    switch (damage) {
      case "missing video":
        file.delete();
        break;
      case "empty video":
        file.writeSync("");
        break;
      case "unreadable video":
        storage.blockedRead = clip.uri;
        break;
      case "truncated video":
        file.writeSync("vid");
        break;
      case "unreadable manifest":
        storage.blockedRead = snapshot.uri;
        break;
      case "invalid JSON":
        snapshot.writeSync("{");
        break;
      case "unsupported version":
        snapshot.writeSync(JSON.stringify({ ...saved, version: 2 }));
        break;
      case "foreign media path":
        snapshot.writeSync(JSON.stringify({ ...saved, file: "../../Files/from-outside.mov" }));
        break;
      case "bad metadata":
        snapshot.writeSync(JSON.stringify({ ...saved, media: { ...media, width: -1 } }));
        break;
      case "bad trim":
        snapshot.writeSync(JSON.stringify({ ...saved, selection: { startFrame: 29, endFrame: 150 } }));
        break;
      case "listing failure":
        storage.blockedListing = directory.uri;
        break;
    }
    const before = new Map(storage.files);
    expect(() => loadSingleClipDraft()).toThrow();
    await expect(importVideo()).rejects.toThrow();
    expect(storage.files).toEqual(before);
    storage.blockedListing = "";
    deleteSingleClipDraft();
    deleteSingleClipDraft();
    expect(loadSingleClipDraft()).toBeNull();
    expect([...storage.files.keys()]).toEqual([external]);
  });

  it("preserves unrelated files and retries media cleanup after deletion commits", async () => {
    const clip = (await importVideo())!;
    const directory = new File(clip.uri).parentDirectory;
    const other = new File(directory, "notes.txt");
    const subdirectory = new Directory(directory, "unrelated");
    subdirectory.create();
    other.writeSync("keep");
    const nested = new File(subdirectory, "draft-1.json");
    nested.writeSync("also keep");
    storage.blockedDeletion = clip.uri;
    deleteSingleClipDraft();
    expect(loadSingleClipDraft()).toBeNull();
    expect(new File(clip.uri).exists).toBe(true);
    storage.blockedDeletion = "";
    expect(loadSingleClipDraft()).toBeNull();
    expect(other.textSync()).toBe("keep");
    expect(nested.textSync()).toBe("also keep");
    expect(new File(clip.uri).exists).toBe(false);
  });

  it("recovers a file blocking the draft folder only on confirmed deletion", async () => {
    const clip = (await importVideo())!;
    const reserved = new File(new File(clip.uri).parentDirectory.uri);
    deleteSingleClipDraft();
    reserved.writeSync("preserve this");
    expect(() => loadSingleClipDraft()).toThrow(/folder is unreadable/);
    await expect(importVideo()).rejects.toThrow();
    expect(reserved.textSync()).toBe("preserve this");
    storage.interruptMove = true;
    expect(() => deleteSingleClipDraft()).toThrow();
    expect(reserved.textSync()).toBe("preserve this");
    storage.interruptMove = false;
    deleteSingleClipDraft();
    expect(loadSingleClipDraft()).toBeNull();
    const recovered = Paths.document.list().filter((entry) => entry instanceof File);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.textSync()).toBe("preserve this");
    expect(loadSingleClipDraft()).toBeNull();
    const next = await importVideo();
    expect(loadSingleClipDraft()).toEqual(next);
    expect(recovered[0]!.textSync()).toBe("preserve this");
  });

  it("retains the usable current draft if deleting its manifest fails", async () => {
    const clip = (await importVideo())!;
    const snapshot = manifest(clip);
    new File(snapshot.parentDirectory, "draft-0.json").writeSync(snapshot.textSync());
    storage.blockedDeletion = snapshot.uri;
    expect(() => deleteSingleClipDraft()).toThrow();
    expect(loadSingleClipDraft()).toEqual(clip);
    storage.blockedDeletion = "";
    deleteSingleClipDraft();
    expect(loadSingleClipDraft()).toBeNull();
    expect(new File(clip.uri).exists).toBe(false);
  });

  it("does not republish an in-flight import after explicit deletion", async () => {
    await importVideo();
    const pending = importVideo();
    deleteSingleClipDraft();
    expect(await pending).toBeNull();
    expect(loadSingleClipDraft()).toBeNull();
  });
});

describe("multiple single-clip projects", () => {
  it("keeps the legacy draft in place and reopens independent projects after restart", async () => {
    const legacy = (await importVideo())!;
    const directories = new Set(storage.directories);
    const firstId = createSingleClipDraftId();
    const secondId = createSingleClipDraftId();
    expect(firstId).not.toBe(secondId);
    expect(storage.directories).toEqual(directories);
    expect(listSingleClipDraftIds()).toEqual([legacySingleClipDraftId]);
    expect(loadSingleClipDraft(firstId)).toBeNull();
    expect(legacy.draftId).toBe(legacySingleClipDraftId);
    expect(new File(legacy.uri).parentDirectory.uri).toBe(`${storage.document}/StackReelSingleClip`);
    const legacySnapshot = manifest(legacy).textSync();

    const first = (await importVideo(external, () => true, firstId))!;
    const second = (await importVideo(external, () => true, secondId))!;
    expect(new File(first.uri).parentDirectory.name).toBe(firstId);
    expect(new File(second.uri).parentDirectory.name).toBe(secondId);
    const edited = setSingleClipVolume(setSingleClipFit(trimSingleClipDraft(first, trimmed), "cover"), 50);
    const reframed = setSingleClipReframe(edited, { zoom: 2, x: 0.25, y: 0.75 });
    const replacement = (await importVideo(external, () => true, secondId))!;
    expect(replacement).toMatchObject({ draftId: secondId, fit: "contain", volumePercent: 100 });
    expect(new File(second.uri).exists).toBe(false);
    expect(new File(first.uri).exists).toBe(true);
    expect(manifest(legacy).textSync()).toBe(legacySnapshot);

    vi.resetModules();
    const cold = await import("../src/single-clip-draft");
    expect(cold.listSingleClipDraftIds()).toEqual([legacySingleClipDraftId, ...[firstId, secondId].sort()]);
    expect(cold.loadSingleClipDraft()).toEqual(legacy);
    expect(cold.loadSingleClipDraft(firstId)).toEqual(reframed);
    expect(cold.loadSingleClipDraft(secondId)).toEqual(replacement);

    cold.deleteSingleClipDraft(firstId);
    expect(cold.listSingleClipDraftIds()).toEqual([legacySingleClipDraftId, secondId]);
    expect(cold.loadSingleClipDraft(firstId)).toBeNull();
    expect(cold.loadSingleClipDraft(secondId)).toEqual(replacement);
    expect(cold.loadSingleClipDraft()).toEqual(legacy);
    expect(new File(first.uri).exists).toBe(false);
    expect(new File(external).textSync()).toBe("video contents");
  });

  it("rejects invalid project paths before accessing the filesystem", async () => {
    const clip = (await importVideo())!;
    const files = new Map(storage.files);
    const directories = new Set(storage.directories);
    const uuid = createSingleClipDraftId();
    const list = vi.spyOn(Directory.prototype, "list");
    for (const invalidId of ["", ".", "..", "../StackReelSingleClip", `file:///${uuid}`, `${uuid}/`, `${uuid}\n`]) {
      expect(() => loadSingleClipDraft(invalidId)).toThrow(/invalid single-clip draft ID/i);
      expect(() => deleteSingleClipDraft(invalidId)).toThrow(/invalid single-clip draft ID/i);
      expect(() => trimSingleClipDraft({ ...clip, draftId: invalidId }, trimmed)).toThrow(
        /invalid single-clip draft ID/i,
      );
      await expect(importVideo(external, () => true, invalidId)).rejects.toThrow(/invalid single-clip draft ID/i);
    }
    expect(list).not.toHaveBeenCalled();
    expect(storage.files).toEqual(files);
    expect(storage.directories).toEqual(directories);
  });

  it("discovers unreadable projects and preserves their files until explicit deletion", async () => {
    const healthyId = createSingleClipDraftId();
    const unreadableId = createSingleClipDraftId();
    const healthy = (await importVideo(external, () => true, healthyId))!;
    const unreadable = (await importVideo(external, () => true, unreadableId))!;
    const directory = new File(unreadable.uri).parentDirectory;
    const recovery = new File(directory, randomUUID() + ".mov");
    recovery.writeSync("recovery media");
    storage.blockedListing = directory.uri;
    expect(listSingleClipDraftIds()).toEqual([healthyId, unreadableId].sort());
    expect(() => loadSingleClipDraft(unreadableId)).toThrow(/cannot list/i);
    expect(loadSingleClipDraft(healthyId)).toEqual(healthy);
    expect(recovery.textSync()).toBe("recovery media");

    storage.blockedListing = "";
    manifest(unreadable).writeSync("{");
    const damaged = new Map(storage.files);
    expect(listSingleClipDraftIds()).toEqual([healthyId, unreadableId].sort());
    expect(() => loadSingleClipDraft(unreadableId)).toThrow();
    await expect(importVideo(external, () => true, unreadableId)).rejects.toThrow();
    expect(storage.files).toEqual(damaged);
    deleteSingleClipDraft(unreadableId);
    expect(recovery.exists).toBe(false);
    expect(listSingleClipDraftIds()).toEqual([healthyId]);
    expect(loadSingleClipDraft(healthyId)).toEqual(healthy);
  });

  it("recovers a file at a project path without disturbing its siblings", async () => {
    const healthyId = createSingleClipDraftId();
    const blockedId = createSingleClipDraftId();
    const healthy = (await importVideo(external, () => true, healthyId))!;
    const projects = new File(healthy.uri).parentDirectory.parentDirectory;
    const blocker = new File(projects, blockedId);
    blocker.writeSync("keep this file");
    expect(listSingleClipDraftIds()).toEqual([healthyId, blockedId].sort());
    expect(() => loadSingleClipDraft(blockedId)).toThrow(/folder is unreadable/);
    await expect(importVideo(external, () => true, blockedId)).rejects.toThrow();
    expect(blocker.textSync()).toBe("keep this file");
    deleteSingleClipDraft(blockedId);
    expect(new File(projects, blockedId).exists).toBe(false);
    expect(listSingleClipDraftIds()).toEqual([healthyId]);
    expect(loadSingleClipDraft(healthyId)).toEqual(healthy);
    const preserved = projects.list().find((entry) => entry instanceof File);
    expect(preserved).toBeInstanceOf(File);
    expect((preserved as File).textSync()).toBe("keep this file");
  });

  it("keeps first imports hidden and prunes abandoned project files without touching a saved sibling", async () => {
    const healthyId = createSingleClipDraftId();
    const pendingId = createSingleClipDraftId();
    const healthy = (await importVideo(external, () => true, healthyId))!;
    const healthyDirectory = new File(healthy.uri).parentDirectory;
    const healthyOrphan = new File(healthyDirectory, randomUUID() + ".mov");
    healthyOrphan.writeSync("prune on load");
    const projects = healthyDirectory.parentDirectory;
    const pendingDirectory = new Directory(projects, pendingId);
    const copy = File.prototype.copy;
    const copyVideo = vi.spyOn(File.prototype, "copy").mockImplementationOnce(async function (this: File, destination) {
      expect(listSingleClipDraftIds()).toEqual([healthyId]);
      await copy.call(this, destination);
      expect(listSingleClipDraftIds()).toEqual([healthyId]);
      expect(destination.exists).toBe(true);
      expect(loadSingleClipDraft(pendingId)).toBeNull();
      expect(destination.exists).toBe(true);
    });
    storage.interruptMove = true;
    await expect(importVideo(external, () => true, pendingId)).rejects.toThrow("Interrupted write");
    storage.interruptMove = false;
    expect(pendingDirectory.exists).toBe(false);

    let current = true;
    copyVideo.mockImplementationOnce(async function (this: File, destination) {
      await copy.call(this, destination);
      current = false;
    });
    await expect(importVideo(external, () => current, pendingId)).resolves.toBeNull();
    expect(pendingDirectory.exists).toBe(false);

    pendingDirectory.create();
    new File(pendingDirectory, "pending.json").writeSync("interrupted manifest");
    new File(pendingDirectory, randomUUID() + ".mov").writeSync("interrupted media");
    expect(listSingleClipDraftIds()).toEqual([healthyId]);
    expect(pendingDirectory.exists).toBe(false);
    expect(healthyOrphan.exists).toBe(true);
    expect(loadSingleClipDraft(healthyId)).toEqual(healthy);
    expect(healthyOrphan.exists).toBe(false);
  });

  it("cancels only the deleted project's imports, even when their copies finish later", async () => {
    const deletedId = createSingleClipDraftId();
    const siblingId = createSingleClipDraftId();
    const deleted = (await importVideo(external, () => true, deletedId))!;
    let resumeCopy!: () => void;
    const held = new Promise<void>((resolve) => {
      resumeCopy = resolve;
    });
    const copy = File.prototype.copy;
    vi.spyOn(File.prototype, "copy").mockImplementation(async function (this: File, destination) {
      await held;
      await copy.call(this, destination);
    });
    const pendingDeleted = importVideo(external, () => true, deletedId);
    const pendingSibling = importVideo(external, () => true, siblingId);
    deleteSingleClipDraft(deletedId);
    expect(listSingleClipDraftIds()).toEqual([]);
    expect(new File(deleted.uri).exists).toBe(false);
    resumeCopy();
    await expect(pendingDeleted).resolves.toBeNull();
    const sibling = await pendingSibling;
    expect(sibling?.draftId).toBe(siblingId);
    expect(loadSingleClipDraft(siblingId)).toEqual(sibling);
    expect(loadSingleClipDraft(deletedId)).toBeNull();
    expect(new File(deleted.uri).parentDirectory.exists).toBe(false);
    expect(listSingleClipDraftIds()).toEqual([siblingId]);
  });
});
