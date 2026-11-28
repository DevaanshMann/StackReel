import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { normalizeClipReframe } from "./clip-reframe";
import type { ClipReframe } from "./clip-reframe";
import {
  canvas,
  createTrimmedClipSource,
  getClipFrameRange,
  isSingleClipFit,
  isSingleClipResolution,
} from "./clip-source";
import type { ClipFrameRange, ClipMetadata, SingleClipFit, SingleClipResolution } from "./clip-source";
import {
  allocateDraftMedia,
  commitDraftManifest,
  discardFile,
  draftSnapshots,
  isPickerCacheFile,
  mediaName,
  pendingName,
  snapshotName,
  readableSize,
} from "./draft-files";
import { readSingleClipCaption } from "./single-clip-caption";
import type { PickedVideo } from "./video-picker";
import { getVolumeGainDb } from "./volume";

export type SingleClip = {
  draftId: string;
  name: string;
  uri: string;
  media: ClipMetadata;
  selection: ClipFrameRange;
  fit: SingleClipFit;
  reframe?: ClipReframe | undefined;
  volumePercent: number;
  caption?: string | undefined;
  exportResolution: SingleClipResolution;
  source: string;
};
export type SingleClipRecovery = { draftId: string; name: string; revision: string };

export class MissingSingleClipVideoError extends Error {
  constructor(readonly recovery: SingleClipRecovery) {
    super("The saved video is missing or damaged. Select the original video to relink this draft.");
    this.name = "MissingSingleClipVideoError";
  }
}

type SingleClipEdits = Pick<
  SingleClip,
  "selection" | "fit" | "reframe" | "volumePercent" | "caption" | "exportResolution"
>;
type Manifest = SingleClipEdits & Pick<SingleClip, "name" | "media"> & { version: 1; file: string; bytes: number };
type ReadableManifest = Omit<Manifest, "fit" | "volumePercent" | "exportResolution"> & {
  fit?: unknown;
  volumePercent?: number;
  exportResolution?: unknown;
};
type HistoryEntry = { label: string; saved: ReadableManifest };
type EditHistory = { past: HistoryEntry[]; future: HistoryEntry[]; revision?: number };
const activeHistories = new Map<string, EditHistory>();
const maxHistoryEdits = 20;

export const legacySingleClipDraftId = "legacy";
const draftUuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
type StagedImport = { cancelled: boolean };
const stagedMedia = new Map<string, Map<string, StagedImport>>();

export function createSingleClipSource(
  {
    uri,
    media,
    selection,
    fit,
    reframe,
    volumePercent,
    caption,
  }: Omit<SingleClip, "draftId" | "source" | "name" | "exportResolution">,
  resolution: SingleClipResolution = 720,
) {
  return createTrimmedClipSource(
    uri,
    media,
    selection,
    fit,
    reframe,
    getVolumeGainDb(volumePercent),
    caption,
    resolution,
  );
}

function projectsDirectory() {
  return new Directory(Paths.document, "StackReelSingleClipProjects");
}

function draftDirectory(draftId: string) {
  if (draftId === legacySingleClipDraftId) return new Directory(Paths.document, "StackReelSingleClip");
  if (typeof draftId !== "string" || !draftUuid.test(draftId)) throw new Error("Invalid single-clip draft ID.");
  return new Directory(projectsDirectory(), draftId);
}

function existingEntry(directory: Directory) {
  if (directory.exists) return directory;
  const parent = directory.parentDirectory;
  // A file or inaccessible directory can occupy the reserved path.
  if (parent.exists) return parent.list().find((entry) => entry.name === directory.name);
}

export function createSingleClipDraftId(): string {
  let draftId: string;
  do {
    draftId = randomUUID();
  } while (existingEntry(draftDirectory(draftId)));
  return draftId;
}

function hasDiscoverableDraft(entry: Directory | File) {
  if (entry instanceof File) return true;
  try {
    if (entry.list().some((file) => file instanceof File && snapshotName.test(file.name))) return true;
  } catch {
    // Let the individual load report the failure without hiding the project.
    return true;
  }
  prune(entry);
  return false;
}

export function listSingleClipDraftIds(): string[] {
  const legacy = existingEntry(draftDirectory(legacySingleClipDraftId));
  const ids = legacy && hasDiscoverableDraft(legacy) ? [legacySingleClipDraftId] : [];
  const projects = existingEntry(projectsDirectory());
  if (projects instanceof Directory) {
    const saved = projects.list().filter((entry) => draftUuid.test(entry.name) && hasDiscoverableDraft(entry));
    ids.push(...saved.map((entry) => entry.name).sort());
  }
  return ids;
}

function readManifest(directory: Directory, draftId: string) {
  const snapshot = draftSnapshots(directory).at(-1);
  if (!snapshot) return null;
  const contents = snapshot.file.textSync();
  const saved = JSON.parse(contents) as ReadableManifest | null;
  if (!saved) throw new Error("The saved single-clip draft has an invalid format.");
  // The contents also distinguish a draft deleted and recreated at revision one.
  const revision = `${snapshot.file.name}:${contents}`;
  return { snapshot, saved, clip: clipFromManifest(directory, draftId, saved), revision };
}

function clipFromManifest(directory: Directory, draftId: string, saved: ReadableManifest): SingleClip {
  if (
    saved.version !== 1 ||
    typeof saved.name !== "string" ||
    !saved.name.trim() ||
    typeof saved.file !== "string" ||
    !mediaName.test(saved.file) ||
    !Number.isSafeInteger(saved.bytes) ||
    saved.bytes <= 0 ||
    !saved.media ||
    !saved.selection ||
    (saved.fit !== undefined && !isSingleClipFit(saved.fit)) ||
    (saved.exportResolution !== undefined && !isSingleClipResolution(saved.exportResolution)) ||
    (saved.reframe !== undefined && (saved.reframe === null || typeof saved.reframe !== "object"))
  ) {
    throw new Error("The saved single-clip draft has an invalid format.");
  }
  const file = new File(directory, saved.file);
  const { name, media, selection, fit = "contain", volumePercent = 100, exportResolution = 720 } = saved;
  const caption = readSingleClipCaption(saved.caption);
  const reframe = saved.reframe === undefined ? undefined : normalizeClipReframe(media, canvas, saved.reframe);
  const edits = {
    name,
    media,
    selection,
    fit,
    ...(reframe && { reframe }),
    ...(caption && { caption }),
    volumePercent,
    exportResolution,
    uri: file.uri,
  };
  return { ...edits, draftId, source: createSingleClipSource(edits) };
}

function checkMedia(file: File, bytes: number) {
  if (!file.exists || readableSize(file) !== bytes) throw new Error("The saved video is missing or damaged.");
}

function hasReadableMedia(current: DraftSnapshot) {
  try {
    checkMedia(new File(current.clip.uri), current.saved.bytes);
    return true;
  } catch {
    return false;
  }
}

function readSnapshot(directory: Directory, draftId: string) {
  const current = readManifest(directory, draftId);
  if (current && !hasReadableMedia(current)) {
    throw new MissingSingleClipVideoError({ draftId, name: current.clip.name, revision: current.revision });
  }
  return current;
}

function removeEmptyDirectory(directory: Directory) {
  try {
    if (!stagedMedia.has(directory.uri) && directory.list().length === 0) directory.delete();
  } catch {
    // A later load can retry cleanup.
  }
}

function prune(directory: Directory, manifest?: string, media?: string) {
  const staged = stagedMedia.get(directory.uri);
  const history = activeHistories.get(directory.uri);
  const retained = new Set(history && [...history.past, ...history.future].map(({ saved }) => saved.file));
  try {
    for (const file of directory.list()) {
      if (
        !(file instanceof File) ||
        staged?.has(file.name) ||
        retained.has(file.name) ||
        file.name === manifest ||
        file.name === media
      )
        continue;
      if (file.name === pendingName || snapshotName.test(file.name) || mediaName.test(file.name)) discardFile(file);
    }
    if (!manifest) removeEmptyDirectory(directory);
  } catch {
    // A cleanup failure does not invalidate a published snapshot.
  }
}

export function loadSingleClipDraft(draftId = legacySingleClipDraftId): SingleClip | null {
  const directory = existingEntry(draftDirectory(draftId));
  if (!directory) return null;
  if (!(directory instanceof Directory)) throw new Error("The saved single-clip draft folder is unreadable.");
  const current = readSnapshot(directory, draftId);
  prune(directory, current?.snapshot.file.name, current?.saved.file);
  return current?.clip ?? null;
}

type DraftSnapshot = NonNullable<ReturnType<typeof readManifest>>;

function checkHistoryRevision(history: EditHistory | undefined, revision: number) {
  if (history?.revision !== undefined && history.revision !== revision) {
    throw new Error("The saved draft changed. Reopen it before editing.");
  }
}

function publishEdit(
  directory: Directory,
  current: DraftSnapshot | null,
  saved: ReadableManifest,
  label: string | null,
) {
  const history = activeHistories.get(directory.uri);
  const revision = current?.snapshot.revision ?? 0;
  checkHistoryRevision(history, revision);
  const snapshot = commitDraftManifest(directory, revision, saved);
  if (history) {
    history.revision = revision + 1;
    history.past = current && label ? [...history.past, { label, saved: current.saved }].slice(-maxHistoryEdits) : [];
    history.future = [];
  }
  prune(directory, snapshot, saved.file);
}

function endHistory(directory: Directory) {
  const history = activeHistories.get(directory.uri);
  if (!history) return;
  history.past = [];
  history.future = [];
  activeHistories.delete(directory.uri);
}

export function createSingleClipDraftSession(draftId: string) {
  const directory = draftDirectory(draftId);
  if (activeHistories.has(directory.uri)) closeActiveHistory();
  const history: EditHistory = { past: [], future: [] };
  activeHistories.set(directory.uri, history);

  function closeActiveHistory() {
    endHistory(directory);
    try {
      loadSingleClipDraft(draftId);
    } catch {
      // Preserve recovery files when the current snapshot cannot be read.
    }
  }

  function step(direction: "undo" | "redo"): SingleClip {
    if (activeHistories.get(directory.uri) !== history) throw new Error("The draft session has ended.");
    const undoing = direction === "undo";
    const from = undoing ? history.past : history.future;
    const to = undoing ? history.future : history.past;
    const entry = from.at(-1);
    if (!entry) throw new Error(`There is no edit to ${direction}.`);
    const current = readSnapshot(directory, draftId);
    if (!current) throw new Error("The saved draft is unavailable.");
    checkHistoryRevision(history, current.snapshot.revision);
    const restored = clipFromManifest(directory, draftId, entry.saved);
    checkMedia(new File(restored.uri), entry.saved.bytes);
    const snapshot = commitDraftManifest(directory, current.snapshot.revision, entry.saved);
    // Advance history and release unreachable media only after the atomic rename succeeds.
    from.pop();
    to.push({ label: entry.label, saved: current.saved });
    history.revision = current.snapshot.revision + 1;
    prune(directory, snapshot, entry.saved.file);
    return restored;
  }

  return {
    get undoLabel() {
      return history.past.at(-1)?.label ?? null;
    },
    get redoLabel() {
      return history.future.at(-1)?.label ?? null;
    },
    undo: () => step("undo"),
    redo: () => step("redo"),
    close() {
      if (activeHistories.get(directory.uri) === history) closeActiveHistory();
    },
  };
}

export async function importSingleClipDraft(
  asset: PickedVideo,
  media: ClipMetadata,
  isCurrent: () => boolean,
  draftId = legacySingleClipDraftId,
): Promise<SingleClip | null> {
  const directory = draftDirectory(draftId);
  if (!isCurrent()) return null;
  if (!asset.name.trim()) throw new Error("The selected video is missing its name.");
  const selection = getClipFrameRange(media);
  return stageVideo(directory, asset, isCurrent, (target, bytes, startRevision) => {
    const current = readSnapshot(directory, draftId);
    if ((current?.snapshot.revision ?? 0) !== startRevision) {
      throw new Error("The saved draft changed. Reopen it before editing.");
    }
    const exportResolution = current?.clip.exportResolution ?? 720;
    const edits = { name: asset.name, media, selection, fit: "contain", volumePercent: 100, exportResolution } as const;
    const imported = { ...edits, uri: target.uri };
    const clip = { ...imported, draftId, source: createSingleClipSource(imported) };
    publishEdit(directory, current, { version: 1, file: target.name, bytes, ...edits }, "replace video");
    return clip;
  });
}

function readRecoveryManifest(directory: Directory, recovery: SingleClipRecovery) {
  const current = directory.exists ? readManifest(directory, recovery.draftId) : null;
  if (!current || current.revision !== recovery.revision || hasReadableMedia(current)) {
    throw new Error("The saved draft changed. Reopen it before relinking.");
  }
  return current;
}

export async function relinkSingleClipDraft(
  recovery: SingleClipRecovery,
  asset: PickedVideo,
  media: ClipMetadata,
  isCurrent: () => boolean,
): Promise<SingleClip | null> {
  if (!isCurrent()) return null;
  const directory = draftDirectory(recovery.draftId);
  const current = readRecoveryManifest(directory, recovery);
  const original = current.clip.media;
  if (original.width !== media.width || original.height !== media.height) {
    throw new Error(`Select the original video with dimensions ${original.width} × ${original.height}.`);
  }
  const expected = getClipFrameRange(original);
  const actual = getClipFrameRange(media);
  if (expected.startFrame !== actual.startFrame || expected.endFrame !== actual.endFrame) {
    throw new Error("Select the original, untrimmed video. The source frame range differs from this draft.");
  }

  return stageVideo(
    directory,
    asset,
    isCurrent,
    (target, bytes) => {
      const latest = readRecoveryManifest(directory, recovery);
      const saved = { ...latest.saved, file: target.name, bytes, media };
      const clip = clipFromManifest(directory, recovery.draftId, saved);
      // Relinking establishes a new baseline. Undo must never restore the broken binding.
      publishEdit(directory, latest, saved, null);
      return clip;
    },
    current.saved.file,
  );
}

async function stageVideo(
  directory: Directory,
  asset: PickedVideo,
  isCurrent: () => boolean,
  publish: (target: File, bytes: number, startRevision: number) => SingleClip,
  reservedFile?: string,
): Promise<SingleClip | null> {
  const history = activeHistories.get(directory.uri);
  const imports = stagedMedia.get(directory.uri) ?? new Map<string, StagedImport>();
  let target: File;
  do {
    target = allocateDraftMedia(directory, asset.draftFileName);
  } while (imports.has(target.name) || target.name === reservedFile);
  const staged = { cancelled: false };
  imports.set(target.name, staged);
  stagedMedia.set(directory.uri, imports);
  let committed = false;
  try {
    const startRevision = draftSnapshots(directory).at(-1)?.revision ?? 0;
    const file = new File(asset.uri);
    const bytes = file.size;
    if (isPickerCacheFile(file)) await file.move(target);
    else await file.copy(target);
    if (staged.cancelled || !isCurrent() || activeHistories.get(directory.uri) !== history) return null;
    if (readableSize(target) !== bytes) throw new Error("The imported video is incomplete.");
    const clip = publish(target, bytes, startRevision);
    committed = true;
    return clip;
  } finally {
    imports.delete(target.name);
    if (imports.size === 0) stagedMedia.delete(directory.uri);
    if (!committed) {
      discardFile(target);
      removeEmptyDirectory(directory);
    }
  }
}

export function trimSingleClipDraft(clip: SingleClip, selection: ClipFrameRange): SingleClip {
  return saveSingleClipEdits(clip, { selection }, "trim");
}

export function setSingleClipFit(clip: SingleClip, fit: SingleClipFit): SingleClip {
  if (!isSingleClipFit(fit)) throw new RangeError("Invalid single-clip fit.");
  return saveSingleClipEdits(clip, { fit }, "framing");
}

export function setSingleClipReframe(clip: SingleClip, reframe: ClipReframe): SingleClip {
  const normalized = normalizeClipReframe(clip.media, canvas, reframe);
  return saveSingleClipEdits(clip, { reframe: normalized }, "reframe");
}

export function setSingleClipVolume(clip: SingleClip, volumePercent: number): SingleClip {
  return saveSingleClipEdits(clip, { volumePercent }, "volume");
}

export function setSingleClipCaption(clip: SingleClip, value: string): SingleClip {
  return saveSingleClipEdits(clip, { caption: readSingleClipCaption(value) }, "caption");
}

export function setSingleClipExportResolution(clip: SingleClip, exportResolution: SingleClipResolution): SingleClip {
  if (!isSingleClipResolution(exportResolution)) throw new RangeError("Choose 720p or 1080p.");
  return saveSingleClipEdits(clip, { exportResolution }, "export resolution");
}

function sameReframe(a: ClipReframe | undefined, b: ClipReframe | undefined) {
  return a?.zoom === b?.zoom && a?.x === b?.x && a?.y === b?.y;
}

function saveSingleClipEdits(clip: SingleClip, changes: Partial<SingleClipEdits>, label: string): SingleClip {
  const directory = existingEntry(draftDirectory(clip.draftId));
  if (!(directory instanceof Directory)) throw new Error("The saved draft changed. Reopen it before editing.");
  const current = readSnapshot(directory, clip.draftId);
  // Fit can hide a remembered Fill crop, and multiple levels can resolve to the mute floor.
  if (
    !current ||
    current.clip.source !== clip.source ||
    current.clip.exportResolution !== clip.exportResolution ||
    current.clip.volumePercent !== clip.volumePercent ||
    !sameReframe(current.clip.reframe, clip.reframe)
  )
    throw new Error("The saved draft changed. Reopen it before editing.");
  const updated = { ...current.clip, ...changes };
  const { selection, fit, reframe, volumePercent, caption, exportResolution } = updated;
  const source = createSingleClipSource(updated);
  if (
    source === clip.source &&
    exportResolution === clip.exportResolution &&
    volumePercent === clip.volumePercent &&
    (fit === "cover" || sameReframe(clip.reframe, reframe))
  )
    return clip;

  const edits = {
    selection,
    fit,
    volumePercent,
    exportResolution,
    ...(reframe && { reframe }),
    ...(caption && { caption }),
  };
  const { reframe: _oldReframe, caption: _oldCaption, ...previous } = current.clip;
  const { reframe: _savedReframe, caption: _savedCaption, ...saved } = current.saved;
  publishEdit(directory, current, { ...saved, ...edits }, label);
  return { ...previous, ...edits, source };
}

export function deleteSingleClipDraft(draftId = legacySingleClipDraftId): void {
  const directory = draftDirectory(draftId);
  const entry = existingEntry(directory);
  if (entry instanceof File) {
    // Preserve unexpected contents while freeing the reserved draft path.
    entry.moveSync(new File(entry.parentDirectory, `${entry.name}-recovered-${randomUUID()}`));
  } else if (entry) {
    // Removing snapshots oldest first prevents an interrupted deletion from reviving an older edit.
    for (const { file } of draftSnapshots(entry)) file.delete();
  }
  endHistory(directory);
  // Keep staged paths reserved until their asynchronous copies settle.
  for (const staged of stagedMedia.get(directory.uri)?.values() ?? []) staged.cancelled = true;
  // Once the last manifest is gone the UI can discard the draft. Retry orphan cleanup on the next load.
  if (entry instanceof Directory) prune(entry);
}
