import { randomUUID } from "expo-crypto";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { createTrimmedClipSource, getClipFrameRange, isSingleClipFit } from "./clip-source";
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

export type SingleClip = {
  name: string;
  uri: string;
  media: ClipMetadata;
  selection: ClipFrameRange;
  fit: SingleClipFit;
  source: string;
};
type SingleClipEdits = Pick<SingleClip, "selection" | "fit">;
type Manifest = SingleClipEdits & Pick<SingleClip, "name" | "media"> & { version: 1; file: string; bytes: number };
type ReadableManifest = Omit<Manifest, "fit"> & { fit?: unknown };
const folder = "StackReelSingleClip";
const staged = new Set<string>();

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
    (saved.fit !== undefined && !isSingleClipFit(saved.fit))
  ) {
    throw new Error("The saved single-clip draft has an invalid format.");
  }
  const file = new File(directory, saved.file);
  if (!file.exists || readableSize(file) !== saved.bytes) throw new Error("The saved video is missing or damaged.");
  const { name, media, selection, fit = "contain" } = saved;
  const clip: SingleClip = {
    name,
    media,
    selection,
    fit,
    uri: file.uri,
    source: createTrimmedClipSource(file.uri, media, selection, fit),
  };
  return { snapshot, saved, clip };
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
    const { name } = asset;
    const fit = "contain";
    const clip: SingleClip = {
      name,
      media,
      selection,
      fit,
      uri: target.uri,
      source: createTrimmedClipSource(target.uri, media, selection, fit),
    };
    const current = readSnapshot(directory);
    publish(directory, current?.snapshot.revision ?? 0, {
      version: 1,
      file: target.name,
      bytes,
      name,
      media,
      selection,
      fit,
    });
    committed = true;
    return clip;
  } finally {
    staged.delete(target.uri);
    if (!committed) discardFile(target);
  }
}

export function trimSingleClipDraft(clip: SingleClip, selection: ClipFrameRange): SingleClip {
  if (selection.startFrame === clip.selection.startFrame && selection.endFrame === clip.selection.endFrame) return clip;
  return saveSingleClipEdits(clip, { selection, fit: clip.fit });
}

export function setSingleClipFit(clip: SingleClip, fit: SingleClipFit): SingleClip {
  if (!isSingleClipFit(fit)) throw new RangeError("Invalid single-clip fit.");
  if (fit === clip.fit) return clip;
  return saveSingleClipEdits(clip, { selection: clip.selection, fit });
}

function saveSingleClipEdits(clip: SingleClip, { selection, fit }: SingleClipEdits): SingleClip {
  const directory = new Directory(Paths.document, folder);
  const current = readSnapshot(directory);
  if (!current || current.clip.source !== clip.source)
    throw new Error("The saved draft changed. Reopen it before editing.");
  const next = {
    ...current.clip,
    selection,
    fit,
    source: createTrimmedClipSource(current.clip.uri, current.clip.media, selection, fit),
  };
  publish(directory, current.snapshot.revision, { ...current.saved, selection, fit });
  return next;
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
