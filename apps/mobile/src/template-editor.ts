import { checkTrim, createProject, frameToUs, resolve, US_PER_SECOND, usToFrame } from "@stackreel/core";
import type { AssetInfo, AudioEntry, Project, VideoLayer } from "@stackreel/core";
import { validate } from "@stackreel/template-schema";
import type { Transition } from "@stackreel/template-schema";
import beforeAfter from "../../../templates/examples/before-after.json";
import hookAndReveal from "../../../templates/examples/hook-and-reveal.json";

export type MobileTemplate = Project["template"];
export type TemplateVideoSlot = { id: string; label: string; minDurationUs: number };
export type TemplateClip = {
  uri: string;
  name: string;
  trimInUs: number;
  trimOutUs: number;
  width: number;
  height: number;
};

const fps = 30;

function iosTransition(transition: Transition | undefined): Transition | undefined {
  if (transition?.type === "whip-pan") return { type: "crossfade", durationUs: transition.durationUs };
  if (transition?.type === "zoom-punch") return { type: "slide", durationUs: transition.durationUs, direction: "left" };
  return transition;
}

function loadTemplate(document: { id: string }): MobileTemplate {
  const result = validate(document);
  if (!result.ok) throw new Error(`Invalid mobile template "${document.id}" at ${result.errors[0]?.path || "/"}`);
  const { template } = result;
  return {
    ...template,
    ...(template.id === "before-after" && {
      description: "Compare two clips with a crossfade, corner labels, and a caption.",
    }),
    tracks: template.tracks.map((track) => {
      if (track.type === "overlay") {
        // The example's arrow sticker has no asset bundled with the app.
        return { ...track, items: track.items.filter((item) => item.kind === "text") };
      }
      if (track.type !== "video") return track;
      return {
        ...track,
        items: track.items.map((item) => {
          const transitionIn = iosTransition(item.transitionIn);
          return transitionIn ? { ...item, transitionIn } : item;
        }),
      };
    }),
  };
}

export const mobileTemplates: readonly MobileTemplate[] = [loadTemplate(beforeAfter), loadTemplate(hookAndReveal)];

export function getVideoSlots(template: MobileTemplate): TemplateVideoSlot[] {
  if (template.canvas.fps !== fps) throw new Error(`Mobile templates must use ${fps} fps.`);

  const requiredFramesBySlot = new Map<string, number>();
  const frame = (us: number) => usToFrame(us, fps, "round");
  for (const track of template.tracks) {
    if (track.type !== "video") continue;
    const items = [...track.items].sort((a, b) => a.startUs - b.startUs);
    items.forEach((item, index) => {
      const start = frame(item.startUs);
      let end = frame(item.startUs + item.durationUs);
      const next = items[index + 1];
      const transition = next?.transitionIn;
      // The outgoing clip keeps playing under the incoming clip through the transition.
      if (next && transition && transition.type !== "cut" && end === frame(next.startUs)) {
        end = frame(next.startUs + transition.durationUs);
      }
      const requiredFrames = Math.ceil((end - start) * (item.speed ?? 1));
      requiredFramesBySlot.set(item.slot, Math.max(requiredFramesBySlot.get(item.slot) ?? 0, requiredFrames));
    });
  }

  return template.slots
    .filter((slot) => slot.kind === "video")
    .map(({ id, label, minDurationUs }) => {
      const frames = Math.max(usToFrame(minDurationUs ?? 0, fps, "ceil"), requiredFramesBySlot.get(id) ?? 0);
      return { id, label, minDurationUs: frameToUs(frames, fps) };
    });
}

function validateClip(slot: TemplateVideoSlot, clip: TemplateClip): void {
  const { uri, width, height, trimInUs, trimOutUs } = clip;
  if (
    !uri ||
    !(width >= 1 && width <= Number.MAX_SAFE_INTEGER && height >= 1 && height <= Number.MAX_SAFE_INTEGER) ||
    checkTrim(trimInUs, trimOutUs)
  ) {
    throw new Error("This video has invalid dimensions or timing.");
  }

  const firstFrame = usToFrame(trimInUs, fps, "ceil");
  const endFrame = usToFrame(trimOutUs, fps, "floor");
  const requiredFrames = Math.max(1, usToFrame(slot.minDurationUs, fps, "ceil"));
  if (endFrame - firstFrame < requiredFrames) {
    throw new Error(
      `"${slot.label}" needs at least ${(slot.minDurationUs / US_PER_SECOND).toFixed(2)} seconds of playable video.`,
    );
  }
}

export function createTemplateClip(
  slot: TemplateVideoSlot,
  uri: string,
  name: string,
  { width, height, startUs, durationUs }: { width: number; height: number; startUs: number; durationUs: number },
): TemplateClip {
  if (!Number.isSafeInteger(startUs) || !Number.isSafeInteger(durationUs) || durationUs <= 0) {
    throw new Error("This video has invalid dimensions or timing.");
  }
  const clip = { uri, name, trimInUs: Math.max(0, startUs), trimOutUs: startUs + durationUs, width, height };
  validateClip(slot, clip);
  return clip;
}

function alignSourceRate<T extends VideoLayer | AudioEntry>(entry: T): T {
  const { source } = entry;
  // Two equal frame counts can differ by one microsecond depending on the start frame.
  // Scale picture and sound to the same timeline span so iOS never inserts a held tail.
  const rate = (source.sourceEndUs - source.sourceStartUs) / (entry.endUs - entry.startUs);
  return { ...entry, source: { ...source, rate, fitMode: "trim", afterEnd: "hold" } };
}

export function createTemplateSource(
  template: MobileTemplate,
  clips: Readonly<Record<string, TemplateClip>>,
): string | null {
  const clipFor = (id: string) => (Object.hasOwn(clips, id) ? clips[id] : undefined);
  if (template.slots.some((slot) => slot.kind === "video" && slot.optional !== true && !clipFor(slot.id))) return null;

  const project = createProject(template);
  const assets: Record<string, string> = {};
  const assetInfo: Record<string, AssetInfo> = {};
  for (const slot of getVideoSlots(template)) {
    const clip = clipFor(slot.id);
    if (!clip) continue;
    validateClip(slot, clip);
    const assetUri = `slot:${slot.id}`;
    project.bindings[slot.id] = { assetUri, trimInUs: clip.trimInUs, trimOutUs: clip.trimOutUs };
    assets[assetUri] = clip.uri;
    assetInfo[assetUri] = { width: clip.width, height: clip.height };
  }

  const plan = resolve(project, { assets: assetInfo });
  // Clip validation counts whole frames. The resolver compares durations in microseconds and
  // can report a one-microsecond shortfall even when the clip has every required frame.
  const issue = plan.warnings.find(
    (warning) => warning.type !== "clip-too-short" || warning.neededUs - warning.availableUs !== 1,
  );
  if (issue) throw new Error(issue.message);
  plan.warnings = [];
  plan.layers = plan.layers.map((layer) => (layer.kind === "video" ? alignSourceRate(layer) : layer));
  plan.audio = plan.audio.map(alignSourceRate);
  return JSON.stringify({ plan, assets });
}
