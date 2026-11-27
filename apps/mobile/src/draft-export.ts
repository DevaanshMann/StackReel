import { Directory, File, Paths } from "expo-file-system";
import { discardFile } from "./draft-files";

export type DraftExportKey =
  { kind: "single"; draftId: string } | { kind: "template"; template: { id: string }; draftId: string };

function directoryFor(key: DraftExportKey) {
  const ids = key.kind === "template" ? [key.template.id, key.draftId] : [key.draftId];
  // Preserve case on case-insensitive volumes and never interpolate path separators.
  const parts = ids.map((id) => {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) throw new Error("Invalid draft ID.");
    return id.replace(/[A-Z]/g, (letter) => "~" + letter.toLowerCase());
  });
  return new Directory(Paths.cache, "StackReelDraftExports", key.kind, ...parts);
}

function sourceIdentity(source: string) {
  const { plan, assets } = JSON.parse(source);
  if (!plan || typeof plan !== "object" || !assets || typeof assets !== "object" || Array.isArray(assets)) {
    throw new Error("Invalid render source.");
  }
  const documentRoot = Paths.document.uri.replace(/\/$/, "") + "/";
  const bindings = Object.keys(assets)
    .sort()
    .map((id) => {
      const uri = assets[id];
      if (typeof uri !== "string") throw new Error("Invalid asset URI.");
      // Imports are immutable, uniquely named draft media. Only the container prefix may change.
      const location = uri.startsWith(documentRoot) ? ["document", uri.slice(documentRoot.length)] : ["uri", uri];
      return [id, location, positiveSize(new File(uri))];
    });
  return JSON.stringify([plan, bindings]);
}

function positiveSize(file: File) {
  const size = file.size;
  if (!file.exists || !Number.isSafeInteger(size) || size <= 0) throw new Error("Missing export media.");
  return size;
}

const ownedName = /^export-([1-9]\d{0,14})\.(json|mp4)$/;

function removeFiles(entries: (File | Directory)[], keep: string[] = []) {
  for (const entry of entries) {
    if (!(entry instanceof File) || !ownedName.test(entry.name) || keep.includes(entry.name)) continue;
    try {
      entry.delete();
    } catch {
      // Cleanup is retried on the next restore or replacement.
    }
  }
}

export function restoreDraftExport(key: DraftExportKey, exportSource: string | null): string | null {
  if (!exportSource) return null;
  try {
    const directory = directoryFor(key);
    if (!directory.exists) return null;
    const identity = sourceIdentity(exportSource);
    const entries = directory.list();
    const manifests = entries
      .filter(
        (entry): entry is File => entry instanceof File && ownedName.test(entry.name) && entry.name.endsWith(".json"),
      )
      .sort((a, b) => Number(b.name.slice(7, -5)) - Number(a.name.slice(7, -5)));
    for (const manifest of manifests) {
      const video = new File(directory, manifest.name.replace(/\.json$/, ".mp4"));
      try {
        const saved = JSON.parse(manifest.textSync());
        if (saved?.version !== 1 || typeof saved.identity !== "string" || saved.bytes !== positiveSize(video)) continue;
        removeFiles(entries, [manifest.name, video.name]);
        return saved.identity === identity ? video.uri : null;
      } catch {
        // A replacement interrupted before its final move leaves an incomplete generation.
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function retainDraftExport(
  key: DraftExportKey,
  exportSource: string,
  nativeUri: string,
  previousUri: string | null = null,
): string {
  try {
    const native = new File(nativeUri);
    const bytes = positiveSize(native);
    // A previous fallback lives beside the new native output and can be retired immediately.
    // Retained copies live in the draft cache and survive until replacement succeeds.
    if (previousUri && previousUri !== nativeUri) {
      const previous = new File(previousUri);
      if (previous.parentDirectory.uri === native.parentDirectory.uri) discardFile(previous);
    }
    const identity = sourceIdentity(exportSource);
    const directory = directoryFor(key);
    directory.create({ intermediates: true, idempotent: true });
    const entries = directory.list();
    const generation =
      entries.reduce((max, entry) => Math.max(max, Number(ownedName.exec(entry.name)?.[1] ?? 0)), 0) + 1;
    if (generation >= 1e15) return nativeUri;
    const manifest = new File(directory, `export-${generation}.json`);
    const video = new File(directory, `export-${generation}.mp4`);
    if (manifest.exists || video.exists) return nativeUri;
    // Metadata first; the same-volume move publishes the completed pair without copying the movie.
    // No fallible publication steps remain after the native session relinquishes its file.
    try {
      manifest.writeSync(JSON.stringify({ version: 1, identity, bytes }));
      native.moveSync(video);
    } catch {
      removeFiles([manifest]);
      return nativeUri;
    }
    removeFiles(entries);
    return video.uri;
  } catch {
    return nativeUri;
  }
}

export function clearDraftExport(key: DraftExportKey): void {
  try {
    const directory = directoryFor(key);
    if (!directory.exists) return;
    removeFiles(directory.list());
    if (!directory.list().length) directory.delete();
  } catch {
    // Purged or inaccessible cache files must not prevent a draft operation.
  }
}
