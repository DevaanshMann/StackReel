import { probeVideo } from "@stackreel/engine";
import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import balconyBefore from "../assets/samples/balcony-before.mp4";
import balconyAfter from "../assets/samples/balcony-after.mp4";
import { allocateDraftMedia } from "./draft-files";
import { saveTemplateDraft, withNewTemplateDraft } from "./template-drafts";
import { createTemplateClip, createTemplateSource, getVideoSlots } from "./template-editor";
import type { MobileTemplate, TemplateClip } from "./template-editor";

const sampleVideos = [
  { slotId: "before", asset: balconyBefore, name: "balcony-before.mp4" },
  { slotId: "after", asset: balconyAfter, name: "balcony-after.mp4" },
];

export async function createBeforeAfterSample(
  template: MobileTemplate,
  draftId: string,
  name: string,
  isCurrent: () => boolean,
) {
  if (!isCurrent()) return null;
  if (template.id !== "before-after") throw new Error("The sample needs the Before / After template.");
  const slots = getVideoSlots(template);
  return withNewTemplateDraft(template, draftId, async (directory) => {
    const clips: Record<string, TemplateClip> = {};
    for (const video of sampleVideos) {
      const slot = slots.find(({ id }) => id === video.slotId);
      if (!slot) throw new Error("The sample video slot is unavailable.");
      const { localUri } = await Asset.fromModule(video.asset).downloadAsync();
      if (!isCurrent()) return null;
      if (!localUri) throw new Error(`Couldn’t locate ${video.name}.`);
      const target = allocateDraftMedia(directory, video.name);
      // The same bundled or Metro-cached source can supply any number of independent projects.
      await new File(localUri).copy(target);
      if (!isCurrent()) return null;
      const metadata = await probeVideo(target.uri);
      if (!isCurrent()) return null;
      clips[slot.id] = createTemplateClip(slot, target.uri, video.name, metadata);
    }

    const draft = {
      name,
      clips,
      textOverrides: { "labels/2": "Three pots, one summer" },
      music: null,
      missingSlots: [],
      recoverableSlots: {},
      missingMusic: false,
      recoverableMusic: null,
    };
    const source = createTemplateSource(template, clips, draft.textOverrides, draft.music);
    if (!source) throw new Error("The sample is missing a required video.");
    saveTemplateDraft(template, draft, draftId);
    return { draft, source };
  }).catch((cause: unknown) => {
    if (!isCurrent()) return null;
    throw cause;
  });
}
