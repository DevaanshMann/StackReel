import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import {
  createTemplateMusic,
  getTemplateCrop,
  getTemplateTextFields,
  getTemplateTrimWindow,
  getVideoSlots,
  setTemplateText,
} from "./template-editor";
import type { MobileTemplate, TemplateClip, TemplateMusic, TemplateTextOverrides } from "./template-editor";

export type TemplateDraftEdits = {
  clips: Readonly<Record<string, TemplateClip>>;
  textOverrides: TemplateTextOverrides;
  music: TemplateMusic | null;
};

const snapshotName = /^draft-(\d{1,15})\.json$/;
const pendingName = "pending.json";
const mediaName = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?:\.[a-z0-9]{1,10})?$/i;

function draftDirectory(template: MobileTemplate) {
  return new Directory(Paths.document, "StackReelDrafts", template.id);
}

function latestSnapshot(directory: Directory) {
  const snapshots = directory.list().flatMap((entry) => {
    const revision = entry instanceof File ? snapshotName.exec(entry.name)?.[1] : undefined;
    return revision === undefined ? [] : [{ file: entry as File, revision: Number(revision) }];
  });
  return snapshots.sort((a, b) => b.revision - a.revision)[0];
}

export function removeDraftFile(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    // An interrupted cleanup can be retried the next time the draft is opened or saved.
  }
}

function pruneDraftFiles(directory: Directory, keep: ReadonlySet<string>) {
  try {
    for (const entry of directory.list()) {
      if (!(entry instanceof File) || keep.has(entry.name)) continue;
      if (entry.name === pendingName || snapshotName.test(entry.name) || mediaName.test(entry.name)) {
        removeDraftFile(entry);
      }
    }
  } catch {
    // Cleanup must not turn a committed save into a failed edit.
  }
}

export function createDraftMediaFile(template: MobileTemplate, importedName: string) {
  const directory = draftDirectory(template);
  directory.create({ intermediates: true, idempotent: true });
  const extension = /\.[a-z0-9]{1,10}$/i.exec(importedName)?.[0] ?? "";
  return new File(directory, `${randomUUID()}${extension.toLowerCase()}`);
}

export function saveTemplateDraft(template: MobileTemplate, { clips, textOverrides, music }: TemplateDraftEdits) {
  const directory = draftDirectory(template);
  directory.create({ intermediates: true, idempotent: true });
  const next = new File(directory, `draft-${(latestSnapshot(directory)?.revision ?? 0) + 1}.json`);
  const keep = new Set([next.name]);
  function storeAsset<T extends TemplateClip | TemplateMusic>({ uri, ...settings }: T) {
    const file = new File(uri).name;
    if (!mediaName.test(file) || new File(directory, file).uri !== uri) {
      throw new Error("The draft can only save media imported into its own folder.");
    }
    keep.add(file);
    return { ...settings, file };
  }
  const manifest = {
    version: 1,
    clips: Object.fromEntries(Object.entries(clips).map(([slot, clip]) => [slot, storeAsset(clip)])),
    textOverrides,
    music: music ? storeAsset(music) : null,
  };

  // Expo's write can leave a partial file. Publish by renaming to a new path so the last
  // committed snapshot remains readable until the new one is in place.
  const pending = new File(directory, pendingName);
  pending.writeSync(JSON.stringify(manifest));
  pending.moveSync(next);
  pruneDraftFiles(directory, keep);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAsset(value: unknown, directory: Directory, keep: Set<string>) {
  if (!record(value) || typeof value.file !== "string" || !mediaName.test(value.file)) {
    throw new Error("Invalid draft media reference.");
  }
  const file = new File(directory, value.file);
  keep.add(file.name);
  if (
    !file.exists ||
    typeof value.name !== "string" ||
    !Number.isSafeInteger(value.sourceStartUs) ||
    !Number.isSafeInteger(value.sourceEndUs)
  ) {
    throw new Error("Draft media is unavailable.");
  }
  return {
    uri: file.uri,
    name: value.name,
    sourceStartUs: value.sourceStartUs as number,
    sourceEndUs: value.sourceEndUs as number,
  };
}

export function loadTemplateDraft(template: MobileTemplate) {
  const directory = draftDirectory(template);
  if (!directory.exists) return null;
  const snapshot = latestSnapshot(directory);
  const keep = new Set<string>();
  if (!snapshot) {
    pruneDraftFiles(directory, keep);
    return null;
  }
  keep.add(snapshot.file.name);
  const saved: unknown = JSON.parse(snapshot.file.textSync());
  if (!record(saved) || saved.version !== 1 || !record(saved.clips) || !record(saved.textOverrides)) {
    throw new Error("The saved draft has an unsupported format.");
  }

  const clips: Record<string, TemplateClip> = {};
  const missingSlots: string[] = [];
  for (const slot of getVideoSlots(template)) {
    const value = saved.clips[slot.id];
    if (value === undefined) continue;
    try {
      if (
        !record(value) ||
        typeof value.width !== "number" ||
        typeof value.height !== "number" ||
        typeof value.trimInUs !== "number" ||
        typeof value.trimOutUs !== "number"
      ) {
        throw new Error("Invalid saved video settings.");
      }
      const clip: TemplateClip = {
        ...readAsset(value, directory, keep),
        width: value.width,
        height: value.height,
        trimInUs: value.trimInUs,
        trimOutUs: value.trimOutUs,
      };
      if (value.reframe !== undefined) {
        const reframe = value.reframe;
        if (
          !record(reframe) ||
          typeof reframe.zoom !== "number" ||
          typeof reframe.x !== "number" ||
          typeof reframe.y !== "number"
        ) {
          throw new Error("Invalid saved framing.");
        }
        clip.reframe = { zoom: reframe.zoom, x: reframe.x, y: reframe.y };
        getTemplateCrop(clip, template.canvas);
      }
      getTemplateTrimWindow(slot, clip);
      clips[slot.id] = clip;
    } catch {
      missingSlots.push(slot.id);
    }
  }

  let textOverrides: TemplateTextOverrides = {};
  for (const field of getTemplateTextFields(template)) {
    const value = saved.textOverrides[field.id];
    if (typeof value === "string" && [...value].length <= (field.maxChars ?? Infinity)) {
      textOverrides = setTemplateText(field, textOverrides, value);
    }
  }

  let music: TemplateMusic | null = null;
  let missingMusic = false;
  if (saved.music && template.audio?.music) {
    try {
      const { uri, name, sourceStartUs, sourceEndUs } = readAsset(saved.music, directory, keep);
      music = createTemplateMusic(uri, name, { startUs: sourceStartUs, durationUs: sourceEndUs - sourceStartUs });
    } catch {
      missingMusic = true;
    }
  }

  if (missingSlots.length === 0 && !missingMusic) pruneDraftFiles(directory, keep);
  return { clips, textOverrides, music, missingSlots, missingMusic };
}
