import { randomUUID } from "expo-crypto";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { normalizeClipReframe } from "./clip-reframe";
import type { ClipReframe } from "./clip-reframe";
import { canvas, createTrimmedClipSource, getClipFrameRange, isSingleClipFit } from "./clip-source";
import type { ClipFrameRange, ClipMetadata, SingleClipFit } from "./clip-source";
import {
  allocateDraftMedia,
  commitDraftManifest,
  discardFile,
  draftSnapshots,
  isPickerCacheFile,
  mediaName,
  pendingName,
  snapshotName,
} from "./draft-files";
import type { PickedVideo } from "./video-picker";
import { getVolumeGainDb } from "./volume";

export type SingleClip = {
  name: string;
  uri: string;
  media: ClipMetadata;
  selection: ClipFrameRange;
  fit: SingleClipFit;
  reframe?: ClipReframe | undefined;
  volumePercent: number;
  source: string;
};
type SingleClipEdits = Pick<SingleClip, "selection" | "fit" | "reframe" | "volumePercent">;
type Manifest = SingleClipEdits & Pick<SingleClip, "name" | "media"> & { version: 1; file: string; bytes: number };
type ReadableManifest = Omit<Manifest, "fit" | "volumePercent"> & { fit?: unknown; volumePercent?: number };
const folder = "StackReelSingleClip";
const staged = new Set<string>();

export function createSingleClipSource({
  uri,
  media,
  selection,
  fit,
  reframe,
  volumePercent,
}: Omit<SingleClip, "source" | "name">) {
  return createTrimmedClipSource(uri, media, selection, fit, reframe, getVolumeGainDb(volumePercent));
}

function draftEntry() {
  const directory = new Directory(Paths.document, folder);
  if (directory.exists) return directory;
  // Expo's exists getter also returns false when access is denied.
  return Paths.document.list().find((entry) => entry.name === folder);
}

function readableSize(file: File) {
  const handle = file.open(FileMode.ReadOnly);
  try {
    const bytes = handle.size;
    if (bytes === null || !Number.isSafeInteger(bytes) || bytes <= 0)
      throw new Error("The video is empty or unreadable.");
    return bytes;
  } finally {
    handle.close();
  }
}

function readSnapshot(directory: Directory) {
  const snapshot = draftSnapshots(directory).at(-1);
  if (!snapshot) return null;
  const saved = JSON.parse(snapshot.file.textSync()) as ReadableManifest | null;
  if (
    saved?.version !== 1 ||
    typeof saved.name !== "string" ||
    !saved.name.trim() ||
    typeof saved.file !== "string" ||
    !mediaName.test(saved.file) ||
    !Number.isSafeInteger(saved.bytes) ||
    saved.bytes <= 0 ||
    !saved.media ||
    !saved.selection ||
    (saved.fit !== undefined && !isSingleClipFit(saved.fit)) ||
    (saved.reframe !== undefined && (saved.reframe === null || typeof saved.reframe !== "object"))
  ) {
    throw new Error("The saved single-clip draft has an invalid format.");
  }
  const file = new File(directory, saved.file);
  if (!file.exists || readableSize(file) !== saved.bytes) throw new Error("The saved video is missing or damaged.");
  const { name, media, selection, fit = "contain", volumePercent = 100 } = saved;
  const reframe = saved.reframe === undefined ? undefined : normalizeClipReframe(media, canvas, saved.reframe);
  const edits = {
    name,
    media,
    selection,
    fit,
    ...(reframe && { reframe }),
    volumePercent,
    uri: file.uri,
  };
  return { snapshot, saved, clip: { ...edits, source: createSingleClipSource(edits) } };
}

function prune(directory: Directory, manifest?: string, media?: string) {
  try {
    for (const file of directory.list()) {
      if (!(file instanceof File) || staged.has(file.uri) || file.name === manifest || file.name === media) continue;
      if (file.name === pendingName || snapshotName.test(file.name) || mediaName.test(file.name)) discardFile(file);
    }
    if (!manifest && !staged.size && !directory.list().length) directory.delete();
  } catch {
    // A cleanup failure does not invalidate a published snapshot.
  }
}

export function loadSingleClipDraft(): SingleClip | null {
  const directory = draftEntry();
  if (!directory) return null;
  if (!(directory instanceof Directory)) throw new Error("The saved single-clip draft folder is unreadable.");
  const current = readSnapshot(directory);
  prune(directory, current?.snapshot.file.name, current?.saved.file);
  return current?.clip ?? null;
}

function publish(directory: Directory, revision: number, saved: Manifest) {
  const snapshot = commitDraftManifest(directory, revision, saved);
  prune(directory, snapshot, saved.file);
}

export async function importSingleClipDraft(
  asset: PickedVideo,
  media: ClipMetadata,
  isCurrent: () => boolean,
): Promise<SingleClip | null> {
  if (!isCurrent()) return null;
  if (!asset.name.trim()) throw new Error("The selected video is missing its name.");
  const selection = getClipFrameRange(media);
  const directory = new Directory(Paths.document, folder);
  const target = allocateDraftMedia(directory, asset.draftFileName);
  staged.add(target.uri);
  let committed = false;
  try {
    const file = new File(asset.uri);
    const bytes = file.size;
    if (isPickerCacheFile(file)) await file.move(target);
    else await file.copy(target);
    if (!staged.has(target.uri) || !isCurrent()) return null;
    if (readableSize(target) !== bytes) throw new Error("The imported video is incomplete.");
    const edits = { name: asset.name, media, selection, fit: "contain", volumePercent: 100 } as const;
    const imported = { ...edits, uri: target.uri };
    const clip = { ...imported, source: createSingleClipSource(imported) };
    const current = readSnapshot(directory);
    publish(directory, current?.snapshot.revision ?? 0, { version: 1, file: target.name, bytes, ...edits });
    committed = true;
    return clip;
  } finally {
    staged.delete(target.uri);
    if (!committed) discardFile(target);
  }
}

export function trimSingleClipDraft(clip: SingleClip, selection: ClipFrameRange): SingleClip {
  return saveSingleClipEdits(clip, { selection });
}

export function setSingleClipFit(clip: SingleClip, fit: SingleClipFit): SingleClip {
  if (!isSingleClipFit(fit)) throw new RangeError("Invalid single-clip fit.");
  return saveSingleClipEdits(clip, { fit });
}

export function setSingleClipReframe(clip: SingleClip, reframe: ClipReframe): SingleClip {
  const normalized = normalizeClipReframe(clip.media, canvas, reframe);
  return saveSingleClipEdits(clip, { reframe: normalized });
}

export function setSingleClipVolume(clip: SingleClip, volumePercent: number): SingleClip {
  return saveSingleClipEdits(clip, { volumePercent });
}

function sameReframe(a: ClipReframe | undefined, b: ClipReframe | undefined) {
  return a?.zoom === b?.zoom && a?.x === b?.x && a?.y === b?.y;
}

function saveSingleClipEdits(clip: SingleClip, changes: Partial<SingleClipEdits>): SingleClip {
  const directory = new Directory(Paths.document, folder);
  const current = readSnapshot(directory);
  // Fit can hide a remembered Fill crop, and multiple levels can resolve to the mute floor.
  if (
    !current ||
    current.clip.source !== clip.source ||
    current.clip.volumePercent !== clip.volumePercent ||
    !sameReframe(current.clip.reframe, clip.reframe)
  )
    throw new Error("The saved draft changed. Reopen it before editing.");
  const updated = { ...current.clip, ...changes };
  const { selection, fit, reframe, volumePercent } = updated;
  const source = createSingleClipSource(updated);
  if (
    source === clip.source &&
    volumePercent === clip.volumePercent &&
    (fit === "cover" || sameReframe(clip.reframe, reframe))
  )
    return clip;

  const edits = { selection, fit, volumePercent, ...(reframe && { reframe }) };
  const { reframe: _oldReframe, ...previous } = current.clip;
  const { reframe: _savedReframe, ...saved } = current.saved;
  publish(directory, current.snapshot.revision, { ...saved, ...edits });
  return { ...previous, ...edits, source };
}

export function deleteSingleClipDraft(): void {
  const directory = draftEntry();
  if (!directory) return;
  if (directory instanceof File) {
    // Preserve unexpected contents while freeing the reserved draft path.
    directory.moveSync(new File(Paths.document, `${folder}-recovered-${randomUUID()}`));
    staged.clear();
    return;
  }
  staged.clear();
  // Removing snapshots oldest first prevents an interrupted deletion from reviving an older edit.
  for (const { file } of draftSnapshots(directory)) file.delete();
  // Once the last manifest is gone the UI can discard the draft. Retry orphan cleanup on the next load.
  prune(directory);
}
