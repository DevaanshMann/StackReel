import { Id } from "@stackreel/template-schema";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import {
  allocateDraftMedia,
  commitDraftManifest,
  draftSnapshots,
  mediaName,
  pendingName,
  snapshotName,
} from "./draft-files";
import {
  createTemplateMusic,
  createTemplateSource,
  getTemplateCrop,
  getTemplateMusicStartRange,
  getTemplateTextFields,
  getTemplateTrimWindow,
  getVideoSlots,
  normalizeTemplateText,
  setTemplateClipVolume,
  setTemplateMusicStart,
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

const draftUuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const copyingDirectories = new Set<string>();
type SessionFiles = {
  historyMedia: Set<string>;
  allocated: Set<string>;
  staged: Set<string>;
  preserveRecoveryFiles: boolean;
};
const activeSessionFiles = new Map<string, SessionFiles>();
const maxHistoryEdits = 20;

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
  // An open editor can still be staging its first import.
  if (!activeSessionFiles.has(directory.uri)) pruneDraftFiles(directory, new Set());
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

export function removeDraftFile(file: File) {
  try {
    if (file.exists) file.delete();
    const session = activeSessionFiles.get(file.parentDirectory.uri);
    session?.allocated.delete(file.name);
    session?.staged.delete(file.name);
  } catch {
    // An interrupted cleanup can be retried the next time the draft is opened or saved.
  }
}

function pruneDraftFiles(directory: Directory, keep: ReadonlySet<string>) {
  // Discovery can run while a new draft is still copying media into its unpublished folder.
  const session = activeSessionFiles.get(directory.uri);
  if (copyingDirectories.has(directory.uri)) return;
  try {
    for (const entry of directory.list()) {
      if (!(entry instanceof File) || keep.has(entry.name)) continue;
      if (session?.historyMedia.has(entry.name) || session?.staged.has(entry.name)) continue;
      if (session?.preserveRecoveryFiles && !session.allocated.has(entry.name)) continue;
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
  const file = allocateDraftMedia(directory, importedName);
  const session = activeSessionFiles.get(directory.uri);
  session?.allocated.add(file.name);
  session?.staged.add(file.name);
  return file;
}

export function deleteTemplateDraft(template: MobileTemplate, draftId = template.id) {
  const directory = draftDirectory(template, draftId);
  if (!directory.exists) return;

  // Delete the current snapshot last so an interrupted deletion cannot restore an older revision.
  for (const { file } of draftSnapshots(directory)) file.delete();
  activeSessionFiles.delete(directory.uri);
  pruneDraftFiles(directory, new Set());
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

/** Reserve a new instance folder. The writer publishes its first manifest or returns null to cancel. */
export async function withNewTemplateDraft<T>(
  template: MobileTemplate,
  draftId: string,
  write: (directory: Directory) => Promise<T>,
): Promise<T> {
  if (draftId === template.id) throw new Error("A new draft needs a unique ID.");
  const directory = draftDirectory(template, draftId);
  directory.parentDirectory.create({ intermediates: true, idempotent: true });
  directory.create();
  copyingDirectories.add(directory.uri);
  let committed = false;
  try {
    const result = await write(directory);
    committed = result !== null;
    return result;
  } finally {
    copyingDirectories.delete(directory.uri);
    if (!committed) pruneDraftFiles(directory, new Set());
  }
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
  let draftId = randomUUID();
  while (draftId === template.id || new Directory(instances, draftId).exists) draftId = randomUUID();
  return withNewTemplateDraft(template, draftId, async (destination) => {
    for (const basename of files) {
      const file = new File(original, basename);
      if (file.exists) await file.copy(new File(destination, basename));
    }
    const draft = restoreDraftEdits(template, destination, { ...manifest, saved });
    const source = createTemplateSource(template, draft.clips, draft.textOverrides, draft.music);
    commitDraftManifest(destination, 0, saved);
    return { draftId, draft, source };
  });
}

type Manifest = ReturnType<typeof readDraftManifest>;
type RenderState = { source: string | null; outputUri: string | null };

function currentManifest(template: MobileTemplate, directory: Directory) {
  const snapshot = directory.exists ? draftSnapshots(directory).at(-1) : undefined;
  // Never overwrite an unsupported or unreadable snapshot.
  return snapshot
    ? { revision: snapshot.revision, manifest: readDraftManifest(template, snapshot.file) }
    : { revision: 0, manifest: null };
}

function buildDraftManifest(
  directory: Directory,
  { name, clips, textOverrides, music, missingSlots = [], missingMusic = false }: TemplateDraftEdits,
  previous: Manifest | null,
) {
  function storeAsset(asset: TemplateClip | TemplateMusic, original: unknown) {
    const { uri, ...settings } = asset;
    const file = new File(uri).name;
    if (!mediaName.test(file) || new File(directory, file).uri !== uri) {
      throw new Error("The draft can only save media imported into its own folder.");
    }
    // Keep extension fields on the same asset, including when its slot changes.
    const originalAsset =
      hasDraftMediaFile(original) && original.file === file
        ? original
        : Object.values(previous?.clips ?? {}).find((entry) => hasDraftMediaFile(entry) && entry.file === file);
    const prior = record(originalAsset) ? originalAsset : {};
    const reframe =
      "reframe" in asset && asset.reframe
        ? { ...(record(prior.reframe) ? prior.reframe : {}), ...asset.reframe }
        : undefined;
    return { ...prior, volumePercent: undefined, ...settings, reframe, file };
  }

  const storedClips: [string, unknown][] = Object.entries(clips).map(([slot, clip]) => [
    slot,
    storeAsset(clip, previous?.clips[slot]),
  ]);
  let storedMusic: unknown = music
    ? { ...storeAsset(music, previous?.saved.music), startFrame: music.startFrame }
    : null;
  if (previous) {
    for (const slot of missingSlots) {
      if (!Object.hasOwn(clips, slot) && Object.hasOwn(previous.clips, slot)) {
        storedClips.push([slot, previous.clips[slot]]);
      }
    }
    if (missingMusic && !music) storedMusic = previous.saved.music ?? null;
  }

  return {
    ...previous?.saved,
    version: 1,
    name: name ?? undefined,
    clips: Object.fromEntries(storedClips),
    textOverrides,
    music: storedMusic,
  };
}

// Collect safe basenames from the raw manifest, even for unavailable or unrecognized media settings.
function collectMediaFiles(value: unknown, files: Set<string>) {
  if (!record(value) && !Array.isArray(value)) return;
  if (hasDraftMediaFile(value)) files.add(value.file);
  for (const item of Object.values(value)) collectMediaFiles(item, files);
}

function publishManifest(directory: Directory, revision: number, saved: Record<string, unknown>) {
  const keep = new Set<string>();
  collectMediaFiles(saved, keep);
  directory.create({ intermediates: true, idempotent: true });
  keep.add(commitDraftManifest(directory, revision, saved));
  // Other imports can still be copying. Only the published references are finished staging.
  const session = activeSessionFiles.get(directory.uri);
  if (session) for (const name of keep) session.staged.delete(name);
  return keep;
}

export function saveTemplateDraft(template: MobileTemplate, edits: TemplateDraftEdits, draftId = template.id) {
  const directory = draftDirectory(template, draftId);
  const { revision, manifest } = currentManifest(template, directory);
  const keep = publishManifest(directory, revision, buildDraftManifest(directory, edits, manifest));
  pruneDraftFiles(directory, keep);
}

function renderDraftUpdate(template: MobileTemplate, draft: TemplateDraftEdits, current: RenderState) {
  const source = createTemplateSource(template, draft.clips, draft.textOverrides, draft.music);
  return { source, outputUri: source === current.source ? current.outputUri : null };
}

export function commitTemplateDraftUpdate(
  template: MobileTemplate,
  draft: TemplateDraftEdits & RenderState,
  draftId = template.id,
) {
  const render = renderDraftUpdate(template, draft, draft);
  saveTemplateDraft(template, draft, draftId);
  return render;
}

// Object key order can change when clips are swapped or restored from a missing slot.
function comparableManifest(saved: Record<string, unknown>) {
  return JSON.stringify(saved, (_key, value: unknown) =>
    record(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
}

type HistoryEntry = { label: string; manifest: Manifest };
export type TemplateDraftSession = ReturnType<typeof createTemplateDraftSession>;

export function createTemplateDraftSession(template: MobileTemplate, draftId = template.id) {
  const directory = draftDirectory(template, draftId);
  const sessionFiles: SessionFiles = {
    historyMedia: new Set(),
    allocated: new Set(),
    staged: new Set(),
    preserveRecoveryFiles: false,
  };
  activeSessionFiles.set(directory.uri, sessionFiles);
  let past: HistoryEntry[] = [];
  let future: HistoryEntry[] = [];
  let lastRevision: number | undefined;

  function current() {
    if (activeSessionFiles.get(directory.uri) !== sessionFiles) throw new Error("The draft session has ended.");
    const state = currentManifest(template, directory);
    if (lastRevision !== undefined && state.revision !== lastRevision) {
      throw new Error("The saved draft changed. Reopen it before editing.");
    }
    return state;
  }

  function publish(
    revision: number,
    saved: Record<string, unknown>,
    nextPast: HistoryEntry[],
    nextFuture: HistoryEntry[],
    degraded: boolean,
  ) {
    const files = new Set<string>();
    for (const entry of [...nextPast, ...nextFuture]) collectMediaFiles(entry.manifest.saved, files);
    const keep = publishManifest(directory, revision, saved);
    // Only a successful atomic rename changes history or releases any of its media.
    // A damaged reference can point at the wrong basename. Any pre-existing file or
    // revision could be needed for recovery, even if no readable reference names it.
    if (sessionFiles.preserveRecoveryFiles && lastRevision !== undefined) {
      removeDraftFile(new File(directory, `draft-${lastRevision}.json`));
    }
    sessionFiles.preserveRecoveryFiles ||= degraded;
    lastRevision = revision + 1;
    past = nextPast;
    future = nextFuture;
    sessionFiles.historyMedia = files;
    pruneDraftFiles(directory, keep);
  }

  function step(direction: "undo" | "redo", render: RenderState) {
    const entry = (direction === "undo" ? past : future).at(-1);
    if (!entry) return null;
    const { revision, manifest } = current();
    if (!manifest) throw new Error("The saved draft is unavailable.");
    const edits = restoreDraftEdits(template, directory, entry.manifest);
    const restored = { ...edits, ...renderDraftUpdate(template, edits, render) };
    const inverse = { label: entry.label, manifest };
    const degraded = isDegraded(edits) || isDegraded(restoreDraftEdits(template, directory, manifest));
    if (direction === "undo")
      publish(revision, entry.manifest.saved, past.slice(0, -1), [...future, inverse], degraded);
    else publish(revision, entry.manifest.saved, [...past, inverse], future.slice(0, -1), degraded);
    return restored;
  }

  return {
    get undoLabel() {
      return past.at(-1)?.label ?? null;
    },
    get redoLabel() {
      return future.at(-1)?.label ?? null;
    },
    commit(draft: TemplateDraftEdits & RenderState, label: string) {
      const { revision, manifest } = current();
      const render = renderDraftUpdate(template, draft, draft);
      const saved = buildDraftManifest(directory, draft, manifest);
      // A first edit can undo to an ordinary, named empty draft without deleting the project.
      const baseline =
        manifest ??
        parseDraftManifest(template, {
          version: 1,
          name: draft.name ?? undefined,
          clips: {},
          textOverrides: {},
          music: null,
        });
      const priorEdits = restoreDraftEdits(template, directory, baseline);
      // A legacy encoding of the same edits (e.g. an omitted music field) is a no-op.
      const comparable = buildDraftManifest(directory, priorEdits, baseline);
      if (comparableManifest(comparable) !== comparableManifest(saved)) {
        publish(
          revision,
          saved,
          [...past, { label, manifest: baseline }].slice(-maxHistoryEdits),
          [],
          isDegraded(priorEdits) || isDegraded(draft),
        );
      } else if (!manifest) {
        publish(revision, saved, past, future, false);
      }
      return render;
    },
    undo: (render: RenderState) => step("undo", render),
    redo: (render: RenderState) => step("redo", render),
    close() {
      past = [];
      future = [];
      if (activeSessionFiles.get(directory.uri) !== sessionFiles) return;
      sessionFiles.historyMedia.clear();
      sessionFiles.staged.clear();
      try {
        readTemplateDraft(template, directory, true);
      } catch {
        // An unreadable current manifest must keep all its files. Retry on the next cold load.
      } finally {
        activeSessionFiles.delete(directory.uri);
        sessionFiles.allocated.clear();
      }
    },
  };
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
  return parseDraftManifest(template, JSON.parse(snapshot.textSync()));
}

function parseDraftManifest(template: MobileTemplate, saved: unknown) {
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

function readAsset(value: unknown, directory: Directory) {
  if (!hasDraftMediaFile(value)) {
    throw new Error("Invalid draft media reference.");
  }
  const file = new File(directory, value.file);
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

function isDegraded(draft: TemplateDraftEdits) {
  return Boolean(draft.missingSlots?.length || draft.missingMusic);
}

export function loadTemplateDraft(template: MobileTemplate, draftId = template.id) {
  const directory = draftDirectory(template, draftId);
  // Reads during an editor session can race an async import before its files reach the manifest.
  return readTemplateDraft(template, directory, !activeSessionFiles.has(directory.uri));
}

function readTemplateDraft(template: MobileTemplate, directory: Directory, cleanup: boolean) {
  if (!directory.exists) return null;
  const snapshot = draftSnapshots(directory).at(-1);
  const keep = new Set<string>();
  if (!snapshot) {
    if (cleanup) pruneDraftFiles(directory, keep);
    return null;
  }
  keep.add(snapshot.file.name);
  const manifest = readDraftManifest(template, snapshot.file);
  const draft = restoreDraftEdits(template, directory, manifest);
  if (cleanup) {
    const session = activeSessionFiles.get(directory.uri);
    const degraded = isDegraded(draft);
    // On exit we still know which imports are ours. A cold load has no ownership record.
    if (session) session.preserveRecoveryFiles = degraded;
    if (!degraded || session) {
      collectMediaFiles(manifest.saved, keep);
      pruneDraftFiles(directory, keep);
    }
  }
  return draft;
}

function restoreDraftEdits(
  template: MobileTemplate,
  directory: Directory,
  { saved, clips: savedClips, textOverrides }: ReturnType<typeof readDraftManifest>,
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
      const { volumePercent, ...asset } = readAsset(value, directory);
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
      const { uri, name, sourceStartUs, sourceEndUs, volumePercent } = readAsset(saved.music, directory);
      const track = createTemplateMusic(uri, name, { startUs: sourceStartUs, durationUs: sourceEndUs - sourceStartUs });
      if (record(saved.music) && saved.music.starterId === "daybreak") track.starterId = saved.music.starterId;
      let restored = setTemplateMusicVolume(track, volumePercent);
      if (record(saved.music) && saved.music.startFrame !== undefined) {
        const { startFrame } = saved.music;
        if (typeof startFrame !== "number" || !Number.isSafeInteger(startFrame) || startFrame < 0) {
          throw new Error("Invalid saved music start.");
        }
        // A longer revision of the template can leave less room to move the soundtrack.
        const { maxFrame } = getTemplateMusicStartRange(restored, template.durationUs);
        restored = setTemplateMusicStart(restored, Math.min(startFrame, maxFrame), template.durationUs);
      }
      music = restored;
    } catch {
      missingMusic = true;
    }
  }

  return { name, clips, textOverrides, music, missingSlots, missingMusic };
}
