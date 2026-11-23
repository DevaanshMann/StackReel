import { Id } from "@stackreel/template-schema";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import {
  createTemplateMusic,
  createTemplateSource,
  getTemplateCrop,
  getTemplateTextFields,
  getTemplateTrimWindow,
  getVideoSlots,
  normalizeTemplateText,
  setTemplateClipVolume,
  setTemplateMusicVolume,
} from "./template-editor";
import type { MobileTemplate, TemplateClip, TemplateMusic, TemplateTextOverrides } from "./template-editor";

export type TemplateDraftEdits = {
  name?: string | null;
  clips: Readonly<Record<string, TemplateClip>>;
  textOverrides: TemplateTextOverrides;
  music: TemplateMusic | null;
  missingSlots?: readonly string[];
  missingMusic?: boolean;
};

const snapshotName = /^draft-(\d{1,15})\.json$/;
const pendingName = "pending.json";
const mediaName = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?:\.[a-z0-9]{1,10})?$/i;
const draftUuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const copyingDirectories = new Set<string>();

function templateDirectory(template: MobileTemplate, root: "StackReelDrafts" | "StackReelDraftInstances") {
  return new Directory(Paths.document, root, Id.parse(template.id));
}

function draftDirectory(template: MobileTemplate, draftId: string) {
  if (draftId === template.id) return templateDirectory(template, "StackReelDrafts");
  if (!draftUuid.test(draftId)) throw new Error("Invalid draft ID.");
  return new Directory(templateDirectory(template, "StackReelDraftInstances"), draftId);
}

function hasDiscoverableDraft(directory: Directory) {
  try {
    if (directory.list().some((entry) => entry instanceof File && snapshotName.test(entry.name))) return true;
  } catch {
    // Keep an inaccessible directory visible so its individual load can report the failure.
    return true;
  }
  // Startup can find staging files left behind before a first commit or after a deletion.
  pruneDraftFiles(directory, new Set());
  return false;
}

export function listTemplateDraftIds(template: MobileTemplate): string[] {
  const legacy = draftDirectory(template, template.id);
  const ids = legacy.exists && hasDiscoverableDraft(legacy) ? [template.id] : [];
  const instances = templateDirectory(template, "StackReelDraftInstances");
  if (instances.exists) {
    const saved = instances.list().flatMap((entry) => {
      if (!(entry instanceof Directory) || entry.name === template.id || !draftUuid.test(entry.name)) return [];
      return hasDiscoverableDraft(entry) ? [entry.name] : [];
    });
    ids.push(...saved.sort());
  }
  return ids;
}

function draftSnapshots(directory: Directory) {
  const snapshots = directory.list().flatMap((entry) => {
    const revision = entry instanceof File ? snapshotName.exec(entry.name)?.[1] : undefined;
    return revision === undefined ? [] : [{ file: entry as File, revision: Number(revision) }];
  });
  return snapshots.sort((a, b) => a.revision - b.revision);
}

export function removeDraftFile(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    // An interrupted cleanup can be retried the next time the draft is opened or saved.
  }
}

function pruneDraftFiles(directory: Directory, keep: ReadonlySet<string>) {
  // Discovery can run while a duplicate is still copying media into its unpublished folder.
  if (copyingDirectories.has(directory.uri)) return;
  try {
    for (const entry of directory.list()) {
      if (!(entry instanceof File) || keep.has(entry.name)) continue;
      if (entry.name === pendingName || snapshotName.test(entry.name) || mediaName.test(entry.name)) {
        removeDraftFile(entry);
      }
    }
    // Directory.delete() is recursive. Leave any unrecognized file or subdirectory in place.
    if (keep.size === 0 && directory.list().length === 0) directory.delete();
  } catch {
    // Cleanup must not turn a committed save into a failed edit.
  }
}

export function createDraftMediaFile(template: MobileTemplate, importedName: string, draftId = template.id) {
  const directory = draftDirectory(template, draftId);
  directory.create({ intermediates: true, idempotent: true });
  const extension = /\.[a-z0-9]{1,10}$/i.exec(importedName)?.[0] ?? "";
  return new File(directory, `${randomUUID()}${extension.toLowerCase()}`);
}

export function deleteTemplateDraft(template: MobileTemplate, draftId = template.id) {
  const directory = draftDirectory(template, draftId);
  if (!directory.exists) return;

  // Delete the current snapshot last so an interrupted deletion cannot restore an older revision.
  for (const { file } of draftSnapshots(directory)) file.delete();
  pruneDraftFiles(directory, new Set());
}

function commitDraftManifest(directory: Directory, revision: number, manifest: unknown) {
  const next = new File(directory, `draft-${revision + 1}.json`);
  // Publish by renaming to a new path so the last committed snapshot survives a failed write.
  const pending = new File(directory, pendingName);
  try {
    pending.writeSync(JSON.stringify(manifest));
    pending.moveSync(next);
  } catch (cause) {
    removeDraftFile(pending);
    throw cause;
  }
  return next.name;
}

export function renameTemplateDraft(template: MobileTemplate, name: string, draftId = template.id) {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Enter a name for the draft.");

  const directory = draftDirectory(template, draftId);
  const snapshots = draftSnapshots(directory);
  const snapshot = snapshots.at(-1);
  if (!snapshot) throw new Error("The saved draft is unavailable.");
  const { saved } = readDraftManifest(template, snapshot.file);

  // Keep the stored edits and media references, including files the editor could not reopen.
  commitDraftManifest(directory, snapshot.revision, { ...saved, name: trimmedName });
  for (const { file } of snapshots) removeDraftFile(file);
}

export async function duplicateTemplateDraft(template: MobileTemplate, sourceId: string, name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Enter a name for the draft.");
  const original = draftDirectory(template, sourceId);
  const snapshot = draftSnapshots(original).at(-1);
  if (!snapshot) throw new Error("The saved draft is unavailable.");
  const manifest = readDraftManifest(template, snapshot.file);
  const saved = { ...manifest.saved, name: trimmedName };
  const files = new Set<string>();
  for (const reference of [...Object.values(manifest.clips), manifest.saved.music]) {
    if (hasDraftMediaFile(reference)) files.add(reference.file);
  }

  const instances = templateDirectory(template, "StackReelDraftInstances");
  instances.create({ intermediates: true, idempotent: true });
  let draftId = randomUUID();
  while (draftId === template.id || new Directory(instances, draftId).exists) draftId = randomUUID();
  const destination = new Directory(instances, draftId);
  destination.create();
  copyingDirectories.add(destination.uri);
  let committed = false;
  try {
    for (const basename of files) {
      const file = new File(original, basename);
      if (file.exists) await file.copy(new File(destination, basename));
    }
    const draft = restoreDraftEdits(template, destination, { ...manifest, saved }, new Set());
    const source = createTemplateSource(template, draft.clips, draft.textOverrides, draft.music);
    commitDraftManifest(destination, 0, saved);
    committed = true;
    return { draftId, draft, source };
  } finally {
    copyingDirectories.delete(destination.uri);
    if (!committed) pruneDraftFiles(destination, new Set());
  }
}

export function saveTemplateDraft(
  template: MobileTemplate,
  { name, clips, textOverrides, music, missingSlots = [], missingMusic = false }: TemplateDraftEdits,
  draftId = template.id,
) {
  const directory = draftDirectory(template, draftId);
  directory.create({ intermediates: true, idempotent: true });
  const snapshot = draftSnapshots(directory).at(-1);
  // Read the current snapshot before writing or pruning so an unreadable draft stays recoverable.
  const previous = snapshot ? readDraftManifest(template, snapshot.file) : null;
  const keep = new Set<string>();
  function storeAsset<T extends TemplateClip | TemplateMusic>({ uri, ...settings }: T) {
    const file = new File(uri).name;
    if (!mediaName.test(file) || new File(directory, file).uri !== uri) {
      throw new Error("The draft can only save media imported into its own folder.");
    }
    keep.add(file);
    return { ...settings, file };
  }
  function preserveAsset(reference: unknown) {
    if (hasDraftMediaFile(reference)) {
      keep.add(reference.file);
    }
    return reference;
  }

  const storedClips: [string, unknown][] = Object.entries(clips).map(([slot, clip]) => [slot, storeAsset(clip)]);
  let storedMusic: unknown = music ? storeAsset(music) : null;
  // An unrelated edit must retain the references and settings needed to recover missing media.
  if (previous) {
    for (const slot of missingSlots) {
      if (!Object.hasOwn(clips, slot) && Object.hasOwn(previous.clips, slot)) {
        storedClips.push([slot, preserveAsset(previous.clips[slot])]);
      }
    }
    if (missingMusic && !music) storedMusic = preserveAsset(previous.saved.music ?? null);
  }

  const manifest = {
    version: 1,
    name: name ?? undefined,
    clips: Object.fromEntries(storedClips),
    textOverrides,
    music: storedMusic,
  };

  keep.add(commitDraftManifest(directory, snapshot?.revision ?? 0, manifest));
  pruneDraftFiles(directory, keep);
}

export function commitTemplateDraftUpdate(
  template: MobileTemplate,
  draft: TemplateDraftEdits & { source: string | null; outputUri: string | null },
  draftId = template.id,
) {
  const source = createTemplateSource(template, draft.clips, draft.textOverrides, draft.music);
  const outputUri = source === draft.source ? draft.outputUri : null;
  saveTemplateDraft(template, draft, draftId);
  return { source, outputUri };
}

export function clearTemplateVideoSlot(draft: TemplateDraftEdits, slotId: string) {
  const { [slotId]: _cleared, ...clips } = draft.clips;
  return { clips, missingSlots: (draft.missingSlots ?? []).filter((id) => id !== slotId) };
}

export function clearTemplateMusic<T extends TemplateDraftEdits>({
  music: _music,
  missingMusic: _missingMusic,
  ...draft
}: T) {
  return { ...draft, music: null, missingMusic: false };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasDraftMediaFile(value: unknown): value is Record<string, unknown> & { file: string } {
  return record(value) && typeof value.file === "string" && mediaName.test(value.file);
}

function readDraftManifest(template: MobileTemplate, snapshot: File) {
  const saved: unknown = JSON.parse(snapshot.textSync());
  if (!record(saved) || saved.version !== 1 || !record(saved.clips) || !record(saved.textOverrides)) {
    throw new Error("The saved draft has an unsupported format.");
  }
  const videoSlotIds = new Set(template.slots.filter((slot) => slot.kind === "video").map((slot) => slot.id));
  if (Object.keys(saved.clips).some((id) => !videoSlotIds.has(id))) {
    throw new Error("The saved draft references a video slot that is unavailable in this template.");
  }
  if (saved.music !== undefined && saved.music !== null && !template.audio?.music) {
    throw new Error("The saved draft references music that is unavailable in this template.");
  }
  const fields = getTemplateTextFields(template);
  const textOverrides: Record<string, string> = {};
  for (const [id, value] of Object.entries(saved.textOverrides)) {
    const field = fields.find((field) => field.id === id);
    if (!field) throw new Error(`The saved draft references an unavailable text field at "${id}".`);
    // A saved override remains explicit even when a newer template has the same default.
    textOverrides[id] = normalizeTemplateText(field, value);
  }
  return { saved, clips: saved.clips, textOverrides };
}

function readAsset(value: unknown, directory: Directory, keep: Set<string>) {
  if (!hasDraftMediaFile(value)) {
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
  if (value.volumePercent !== undefined && typeof value.volumePercent !== "number") {
    throw new Error("Invalid saved volume.");
  }
  return {
    uri: file.uri,
    name: value.name,
    sourceStartUs: value.sourceStartUs as number,
    sourceEndUs: value.sourceEndUs as number,
    volumePercent: value.volumePercent ?? 100,
  };
}

export function loadTemplateDraft(template: MobileTemplate, draftId = template.id) {
  const directory = draftDirectory(template, draftId);
  if (!directory.exists) return null;
  const snapshot = draftSnapshots(directory).at(-1);
  const keep = new Set<string>();
  if (!snapshot) {
    pruneDraftFiles(directory, keep);
    return null;
  }
  keep.add(snapshot.file.name);
  const draft = restoreDraftEdits(template, directory, readDraftManifest(template, snapshot.file), keep);
  if (draft.missingSlots.length === 0 && !draft.missingMusic) pruneDraftFiles(directory, keep);
  return draft;
}

function restoreDraftEdits(
  template: MobileTemplate,
  directory: Directory,
  { saved, clips: savedClips, textOverrides }: ReturnType<typeof readDraftManifest>,
  keep: Set<string>,
) {
  const name = typeof saved.name === "string" ? saved.name.trim() || null : null;

  const clips: Record<string, TemplateClip> = {};
  const missingSlots: string[] = [];
  for (const slot of getVideoSlots(template)) {
    const value = savedClips[slot.id];
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
      const { volumePercent, ...asset } = readAsset(value, directory, keep);
      const clip: TemplateClip = {
        ...asset,
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
      clips[slot.id] = setTemplateClipVolume(clip, volumePercent);
    } catch {
      missingSlots.push(slot.id);
    }
  }

  let music: TemplateMusic | null = null;
  let missingMusic = false;
  if (saved.music) {
    try {
      const { uri, name, sourceStartUs, sourceEndUs, volumePercent } = readAsset(saved.music, directory, keep);
      const track = createTemplateMusic(uri, name, { startUs: sourceStartUs, durationUs: sourceEndUs - sourceStartUs });
      music = setTemplateMusicVolume(track, volumePercent);
    } catch {
      missingMusic = true;
    }
  }

  return { name, clips, textOverrides, music, missingSlots, missingMusic };
}
