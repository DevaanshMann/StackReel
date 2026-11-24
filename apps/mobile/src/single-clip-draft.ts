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

export type SingleClip = {
  name: string;
  uri: string;
  media: ClipMetadata;
  selection: ClipFrameRange;
  fit: SingleClipFit;
  reframe?: ClipReframe;
  source: string;
};
type SingleClipEdits = Pick<SingleClip, "selection" | "fit" | "reframe">;
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
    (saved.fit !== undefined && !isSingleClipFit(saved.fit)) ||
    (saved.reframe !== undefined && (saved.reframe === null || typeof saved.reframe !== "object"))
  ) {
    throw new Error("The saved single-clip draft has an invalid format.");
  }
  const file = new File(directory, saved.file);
  if (!file.exists || readableSize(file) !== saved.bytes) throw new Error("The saved video is missing or damaged.");
  const { name, media, selection, fit = "contain" } = saved;
  const reframe = saved.reframe === undefined ? undefined : normalizeClipReframe(media, canvas, saved.reframe);
  const clip: SingleClip = {
    name,
    media,
    selection,
    fit,
    ...(reframe && { reframe }),
    uri: file.uri,
    source: createTrimmedClipSource(file.uri, media, selection, fit, reframe),
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
  return saveSingleClipEdits(clip, selection, clip.fit, clip.reframe);
}

export function setSingleClipFit(clip: SingleClip, fit: SingleClipFit): SingleClip {
  if (!isSingleClipFit(fit)) throw new RangeError("Invalid single-clip fit.");
  return saveSingleClipEdits(clip, clip.selection, fit, clip.reframe);
}

export function setSingleClipReframe(clip: SingleClip, reframe: ClipReframe): SingleClip {
  const normalized = normalizeClipReframe(clip.media, canvas, reframe);
  return saveSingleClipEdits(clip, clip.selection, clip.fit, normalized);
}

function sameReframe(a: ClipReframe | undefined, b: ClipReframe | undefined) {
  return a?.zoom === b?.zoom && a?.x === b?.x && a?.y === b?.y;
}

function saveSingleClipEdits(
  clip: SingleClip,
  selection: ClipFrameRange,
  fit: SingleClipFit,
  reframe: ClipReframe | undefined,
): SingleClip {
  const directory = new Directory(Paths.document, folder);
  const current = readSnapshot(directory);
  // Two revisions can produce the same Fit plan while remembering different Fill crops.
  if (!current || current.clip.source !== clip.source || !sameReframe(current.clip.reframe, clip.reframe))
    throw new Error("The saved draft changed. Reopen it before editing.");
  const source = createTrimmedClipSource(current.clip.uri, current.clip.media, selection, fit, reframe);
  if (source === clip.source && (fit === "cover" || sameReframe(clip.reframe, reframe))) return clip;

  const edits = { selection, fit, ...(reframe && { reframe }) };
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
