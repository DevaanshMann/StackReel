import { randomUUID } from "expo-crypto";
import { Directory, File, FileMode, Paths } from "expo-file-system";

export const snapshotName = /^draft-(\d{1,15})\.json$/;
export const pendingName = "pending.json";
export const mediaName = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?:\.[a-z0-9]{1,10})?$/i;

export function draftSnapshots(directory: Directory) {
  const snapshots = directory.list().flatMap((entry) => {
    if (!(entry instanceof File)) return [];
    const revision = snapshotName.exec(entry.name)?.[1];
    return revision === undefined ? [] : [{ file: entry, revision: Number(revision) }];
  });
  return snapshots.sort((a, b) => a.revision - b.revision);
}

export function allocateDraftMedia(directory: Directory, importedName: string) {
  directory.create({ intermediates: true, idempotent: true });
  const extension = /\.[a-z0-9]{1,10}$/i.exec(importedName)?.[0] ?? "";
  let file: File;
  do {
    file = new File(directory, `${randomUUID()}${extension.toLowerCase()}`);
  } while (file.exists);
  return file;
}

export function readableSize(file: File) {
  const handle = file.open(FileMode.ReadOnly);
  try {
    const bytes = handle.size;
    if (bytes === null || !Number.isSafeInteger(bytes) || bytes <= 0)
      throw new Error("The file is empty or unreadable.");
    return bytes;
  } finally {
    handle.close();
  }
}

export function discardFile(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    // A later load or save can retry cleanup.
  }
}

export function isPickerCacheFile(file: File) {
  const parent = file.parentDirectory.uri;
  return ["ImagePicker", "DocumentPicker"].some((picker) => parent === new Directory(Paths.cache, picker).uri);
}

export function discardPickerCopy(uri: string | undefined) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (isPickerCacheFile(file)) discardFile(file);
  } catch {
    // An unavailable picker URL must not prevent the editor from finishing the import.
  }
}

export function commitDraftManifest(directory: Directory, revision: number, manifest: unknown) {
  if (revision >= 999_999_999_999_999) throw new Error("The draft revision limit was reached.");
  const next = new File(directory, `draft-${revision + 1}.json`);
  // Publish by renaming to a new path so the last committed snapshot survives a failed write.
  const pending = new File(directory, pendingName);
  try {
    pending.writeSync(JSON.stringify(manifest));
    pending.moveSync(next);
  } catch (cause) {
    discardFile(pending);
    throw cause;
  }
  return next.name;
}
