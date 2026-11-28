import { probeAudio } from "@stackreel/engine";
import { Asset } from "expo-asset";
import { getDocumentAsync } from "expo-document-picker";
import { File } from "expo-file-system";
import daybreak from "../assets/music/daybreak.m4a";
import { discardPickerCopy, isPickerCacheFile, readableSize } from "./draft-files";
import { createDraftMediaFile, removeDraftFile } from "./template-drafts";
import { createTemplateMusic } from "./template-editor";
import type { MobileTemplate, TemplateMusic } from "./template-editor";

export type MusicSource = "files" | "daybreak";

async function selectTrack(source: MusicSource) {
  if (source === "daybreak") {
    const { localUri } = await Asset.fromModule(daybreak).downloadAsync();
    if (!localUri) throw new Error("Couldn’t locate Daybreak.");
    return { uri: localUri, name: "Daybreak", filename: "daybreak.m4a" };
  }
  const result = await getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.uri) throw new Error("Files did not return an audio file.");
  return { uri: asset.uri, name: asset.name, filename: asset.name };
}

export async function importTemplateMusic({
  template,
  draftId,
  source,
  currentMusic,
  isCurrent,
  validateMusic,
  commit,
}: {
  template: MobileTemplate;
  draftId: string;
  source: MusicSource;
  currentMusic: TemplateMusic | null;
  isCurrent: () => boolean;
  validateMusic?: (music: TemplateMusic) => void;
  commit: (music: TemplateMusic) => void;
}) {
  if (!isCurrent() || (source === "daybreak" && currentMusic?.starterId === source)) return;
  const track = await selectTrack(source);
  if (!track) return;
  let target: File | undefined;
  try {
    if (!isCurrent()) return;
    const metadata = await probeAudio(track.uri);
    if (!isCurrent()) return;
    const music = createTemplateMusic(track.uri, track.name, metadata);
    if (source === "daybreak") music.starterId = source;
    validateMusic?.(music);
    target = createDraftMediaFile(template, track.filename, draftId);
    const original = new File(track.uri);
    const bytes = original.size;
    if (source === "files" && isPickerCacheFile(original)) await original.move(target);
    else await original.copy(target);
    if (!isCurrent()) return;
    if (readableSize(target) !== bytes) throw new Error("The imported audio file is incomplete.");
    commit({ ...music, uri: target.uri });
    target = undefined;
  } finally {
    if (target) removeDraftFile(target);
    if (source === "files") discardPickerCopy(track.uri);
  }
}
