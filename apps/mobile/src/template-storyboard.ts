import type { TemplateClip, TemplateVideoSlot } from "./template-editor";

export type StoryboardShot = {
  slot: TemplateVideoSlot;
  number: number;
  clip: TemplateClip | undefined;
  status: "Ready" | "Empty" | "Missing";
  thumbnailTimeUs: number | undefined;
};

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
