import { frameToUs, usToFrame } from "@stackreel/core";
import type { MobileTemplate, TemplateClip, TemplateVideoSlot } from "./template-editor";

export type StoryboardShot = {
  slot: TemplateVideoSlot;
  number: number;
  clip: TemplateClip | undefined;
  status: "Ready" | "Empty" | "Missing";
  thumbnailTimeUs: number | undefined;
};

/** Reel time for previewing each shot, independent of the trim within its source video. */
export function getStoryboardCueTimes(template: MobileTemplate): Readonly<Record<string, number>> {
  const cues: Record<string, number> = Object.create(null);
  const videoSlots = new Set(template.slots.filter((slot) => slot.kind === "video").map((slot) => slot.id));
  const fps = template.canvas.fps;
  for (const track of template.tracks) {
    if (track.type !== "video") continue;
    for (const item of track.items) {
      if (!videoSlots.has(item.slot)) continue;
      const start = usToFrame(item.startUs, fps, "round");
      const end = usToFrame(item.startUs + item.durationUs, fps, "round");
      if (end <= start) continue;

      // Match the renderer's snapped transition boundary. An item that transitions
      // for its entire duration can only be cued as far as its last visible frame.
      const transition = item.transitionIn;
      const cueFrame =
        transition && transition.type !== "cut"
          ? Math.min(usToFrame(item.startUs + transition.durationUs, fps, "round"), end - 1)
          : start;
      const cueUs = frameToUs(cueFrame, fps);
      cues[item.slot] = Math.min(cues[item.slot] ?? cueUs, cueUs);
    }
  }
  return cues;
}

export function getStoryboardShots(
  slots: readonly TemplateVideoSlot[],
  clips: Readonly<Record<string, TemplateClip>>,
  missingSlots: readonly string[],
): StoryboardShot[] {
  return slots.map((slot, index) => {
    const clip = Object.hasOwn(clips, slot.id) ? clips[slot.id] : undefined;
    const status = missingSlots.includes(slot.id) ? "Missing" : clip ? "Ready" : "Empty";
    // The native extractor takes absolute source times. trimOutUs is exclusive.
    const thumbnailTimeUs =
      clip && status === "Ready" ? clip.trimInUs + Math.floor((clip.trimOutUs - clip.trimInUs) / 2) : undefined;
    return { slot, number: index + 1, clip, status, thumbnailTimeUs };
  });
}

export function getSelectedShot(shots: readonly StoryboardShot[], selectedSlotId: string | undefined) {
  return (
    shots.find(({ slot }) => slot.id === selectedSlotId) ?? shots.find(({ status }) => status !== "Ready") ?? shots[0]
  );
}
