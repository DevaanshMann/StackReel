import type { Template } from "@stackreel/template-schema";

/** A small template with one slot of each kind, an editable text item, and a slot-backed text item. */
export const testTemplate = (): Template => ({
  schemaVersion: 1,
  id: "test",
  name: "Test",
  canvas: { width: 1080, height: 1920, fps: 30 },
  durationUs: 6_000_000,
  audio: { music: { slot: "music" } },
  slots: [
    { id: "clip1", kind: "video", label: "First clip", minDurationUs: 3_000_000 },
    { id: "photo", kind: "image", label: "Photo" },
    { id: "music", kind: "audio", label: "Music", optional: true },
    { id: "title", kind: "text", label: "Title", maxChars: 10 },
  ],
  tracks: [
    {
      id: "main",
      type: "video",
      items: [
        { slot: "clip1", startUs: 0, durationUs: 3_000_000 },
        { slot: "photo", startUs: 3_000_000, durationUs: 3_000_000 },
      ],
    },
    {
      id: "captions",
      type: "overlay",
      items: [
        {
          kind: "text",
          startUs: 0,
          durationUs: 2_000_000,
          text: { default: "Wait for it", editable: true, maxChars: 20 },
          style: { font: "Inter-Black", sizePx: 96, color: "#FFFFFF" },
        },
        { kind: "text", startUs: 2_000_000, durationUs: 2_000_000, slot: "title", text: { default: "Title" } },
        { kind: "text", startUs: 4_000_000, durationUs: 1_000_000, text: { default: "Fixed" } },
        { kind: "sticker", startUs: 0, durationUs: 1_000_000, asset: "star", widthNorm: 0.2 },
      ],
    },
  ],
});
