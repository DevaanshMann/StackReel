import type { PlanCanvas, TextLayer } from "@stackreel/core";

export const captionLimit = 80;

// Let the renderer wrap one paragraph to the canvas, including text pasted from other apps.
export function captionParagraph(value: string) {
  // U+0085 (NEXT LINE) also starts a new line in Core Text.
  return value.replace(/[\s\u0085]+/gu, " ").trim();
}

export function readSingleClipCaption(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError("The caption must be text.");
  const text = captionParagraph(value);
  if ([...text].length > captionLimit) throw new RangeError(`Use ${captionLimit} characters or fewer.`);
  return text || undefined;
}

export function singleClipCaptionLayer(text: string, canvas: PlanCanvas, endUs: number): TextLayer {
  return {
    id: "caption/0",
    trackId: "caption",
    itemIndex: 0,
    kind: "text",
    z: 1,
    startUs: 0,
    endUs,
    opacity: 1,
    text,
    style: {
      font: "Inter-Bold",
      sizePx: 38,
      align: "center",
      color: "#FFFFFF",
      background: { color: "#000000BF", paddingPx: 20, cornerRadiusPx: 16 },
    },
    placement: { anchor: "bottom", xPx: canvas.width / 2, yPx: canvas.height * 0.75, rotationDeg: 0 },
    animation: { in: "none", out: "none", inDurationUs: 0, outDurationUs: 0 },
  };
}
