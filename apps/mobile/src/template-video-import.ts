import { probeVideo } from "@stackreel/engine";
import { File, Paths } from "expo-file-system";
import { createDraftMediaFile, removeDraftFile } from "./template-drafts";
import { createTemplateClip } from "./template-editor";
import type { MobileTemplate, TemplateClip, TemplateVideoSlot } from "./template-editor";
import { pickOrderedVideos, pickVideo } from "./video-picker";
import type { PickedVideo, VideoPickerSource } from "./video-picker";

function isCachedFile(uri: string) {
  return uri.startsWith(`${Paths.cache.uri.replace(/\/$/, "")}/`);
}

export function removeCachedFile(uri: string | null | undefined) {
  try {
    if (uri && isCachedFile(uri)) new File(uri).delete();
  } catch {
    // The system may have already evicted the file from the cache.
  }
}

export class SlotImportError extends Error {
  constructor(
    readonly slot: TemplateVideoSlot,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : cause;
    super(`Couldn’t import the video for ${slot.label}.${typeof detail === "string" ? ` ${detail}` : ""}`);
  }
}

export async function importTemplateVideos({
  template,
  slots,
  source,
  isCurrent,
  commit,
}: {
  template: MobileTemplate;
  slots: readonly TemplateVideoSlot[];
  source: VideoPickerSource;
  isCurrent: () => boolean;
  commit: (clips: Record<string, TemplateClip>) => void;
}) {
  let videos: PickedVideo[] | null;
  if (slots.length > 1) {
    videos = await pickOrderedVideos(slots.length);
  } else {
    const video = await pickVideo(source);
    videos = video ? [video] : null;
  }
  if (!videos) return;

  const staged: File[] = [];
  try {
    if (!isCurrent()) return;
    if (!videos.length || videos.length > slots.length) {
      throw new Error(`${source} returned an unexpected number of videos.`);
    }
    const clips: Record<string, TemplateClip> = {};
    for (const [index, asset] of videos.entries()) {
      const slot = slots[index]!;
      try {
        if (!asset.uri) throw new Error(`${source} did not return a video file.`);
        const metadata = await probeVideo(asset.uri);
        if (!isCurrent()) return;
        const clip = createTemplateClip(slot, asset.uri, asset.name, metadata);
        const target = createDraftMediaFile(template, asset.draftFileName);
        staged.push(target);
        const file = new File(asset.uri);
        if (isCachedFile(asset.uri)) await file.move(target);
        else await file.copy(target);
        if (!isCurrent()) return;
        clips[slot.id] = { ...clip, uri: target.uri };
      } catch (cause) {
        throw new SlotImportError(slot, cause);
      }
    }
    commit(clips);
    staged.length = 0;
  } finally {
    for (const file of staged) removeDraftFile(file);
    for (const { uri } of videos) removeCachedFile(uri);
  }
}
