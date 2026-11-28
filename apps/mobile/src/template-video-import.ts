import { probeVideo } from "@stackreel/engine";
import { File, Paths } from "expo-file-system";
import { discardPickerCopy, isPickerCacheFile, readableSize } from "./draft-files";
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
  draftId = template.id,
  slots,
  source,
  isCurrent,
  validateClip,
  onInvalidVideo,
  commit,
}: {
  template: MobileTemplate;
  draftId?: string;
  slots: readonly TemplateVideoSlot[];
  source: VideoPickerSource;
  isCurrent: () => boolean;
  validateClip?: (clip: TemplateClip) => void;
  onInvalidVideo?: (error: SlotImportError) => Promise<boolean>;
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
  const pickedUris = new Set(videos.map(({ uri }) => uri));
  const retry = slots.length > 1 && source === "Photos" ? onInvalidVideo : undefined;
  try {
    if (!isCurrent()) return;
    if (!videos.length || videos.length > slots.length) {
      throw new Error(`${source} returned an unexpected number of videos.`);
    }
    const clips: Record<string, TemplateClip> = {};
    for (const [index, selected] of videos.entries()) {
      const slot = slots[index]!;
      // A replacement can refer to the same picker file as a later selection.
      const laterUris = new Set(videos.slice(index + 1).map(({ uri }) => uri));
      let asset: PickedVideo | null = selected;
      let clip: TemplateClip;
      while (true) {
        try {
          if (!asset) {
            asset = await pickVideo("Photos");
            if (!asset) return;
            pickedUris.add(asset.uri);
            if (!isCurrent()) return;
          }
          if (!asset.uri) throw new Error(`${source} did not return a video file.`);
          const metadata = await probeVideo(asset.uri);
          if (!isCurrent()) return;
          clip = createTemplateClip(slot, asset.uri, asset.name, metadata);
          validateClip?.(clip);
          break;
        } catch (cause) {
          if (!isCurrent()) return;
          const error = new SlotImportError(slot, cause);
          if (!retry) throw error;
          if (asset && !laterUris.has(asset.uri)) discardPickerCopy(asset.uri);
          asset = null;
          if (!(await retry(error)) || !isCurrent()) return;
        }
      }

      try {
        const target = createDraftMediaFile(template, asset.draftFileName, draftId);
        staged.push(target);
        const file = new File(asset.uri);
        const bytes = file.size;
        if (isPickerCacheFile(file) && !laterUris.has(asset.uri)) await file.move(target);
        else await file.copy(target);
        if (!isCurrent()) return;
        if (readableSize(target) !== bytes) throw new Error("The imported video is incomplete.");
        clips[slot.id] = { ...clip, uri: target.uri };
      } catch (cause) {
        throw new SlotImportError(slot, cause);
      }
    }
    commit(clips);
    staged.length = 0;
  } finally {
    for (const file of staged) removeDraftFile(file);
    for (const uri of pickedUris) discardPickerCopy(uri);
  }
}
