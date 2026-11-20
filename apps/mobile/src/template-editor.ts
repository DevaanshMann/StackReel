import { checkTrim, createProject, frameToUs, itemKey, resolve, US_PER_SECOND, usToFrame } from "@stackreel/core";
import type { AssetInfo, AudioEntry, Crop, Project, Size, SlotBinding, VideoLayer } from "@stackreel/core";
import { validate } from "@stackreel/template-schema";
import type { Transition } from "@stackreel/template-schema";
import beforeAfter from "../../../templates/examples/before-after.json";
import hookAndReveal from "../../../templates/examples/hook-and-reveal.json";

export type MobileTemplate = Project["template"];
export type TemplateVideoSlot = { id: string; label: string; minDurationUs: number };
export type TemplateTextField = { id: string; label: string; defaultText: string; maxChars?: number };
export type TemplateTextOverrides = Readonly<Record<string, string>>;
export type TemplateReframe = { zoom: number; x: number; y: number };
export type TemplateClip = {
  uri: string;
  name: string;
  readonly sourceStartUs: number;
  readonly sourceEndUs: number;
  trimInUs: number;
  trimOutUs: number;
  width: number;
  height: number;
  reframe?: TemplateReframe;
};
export type TemplateMusic = {
  uri: string;
  name: string;
  readonly sourceStartUs: number;
  readonly sourceEndUs: number;
};

export const defaultTemplateReframe: Readonly<TemplateReframe> = Object.freeze({ zoom: 1, x: 0.5, y: 0.5 });
export const maxTemplateReframeZoom = 3;

const fps = 30;
const invalidVideo = "This video has invalid dimensions or timing.";
const invalidMusic = "This audio has invalid timing or no playable frames.";

function isValidSize({ width, height }: Size): boolean {
  return [width, height].every(
    (dimension) => Number.isFinite(dimension) && dimension >= 1 && dimension <= Number.MAX_SAFE_INTEGER,
  );
}

/** The visible part of the oriented source. Zoom is relative to cover and x/y are fractions of the available travel. */
export function getTemplateCrop(
  clip: TemplateClip,
  canvas: Size,
  { zoom, x, y }: TemplateReframe = clip.reframe ?? defaultTemplateReframe,
): Crop {
  if (!isValidSize(clip) || !isValidSize(canvas)) throw new RangeError("Invalid video or canvas dimensions.");
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > maxTemplateReframeZoom) {
    throw new RangeError(`Reframe zoom must be between 1 and ${maxTemplateReframeZoom}.`);
  }
  if (![x, y].every((position) => Number.isFinite(position) && position >= 0 && position <= 1)) {
    throw new RangeError("Reframe positions must be between 0 and 1.");
  }

  const scaleX = canvas.width / clip.width;
  const scaleY = canvas.height / clip.height;
  const coverScale = Math.max(scaleX, scaleY);
  const width = scaleX / coverScale / zoom;
  const height = scaleY / coverScale / zoom;
  return { x: x === 0 ? 0 : (1 - width) * x, y: y === 0 ? 0 : (1 - height) * y, width, height };
}

function sameCrop(a: Crop, b: Crop): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function setTemplateClipReframe(clip: TemplateClip, canvas: Size, reframe: TemplateReframe): TemplateClip {
  const crop = getTemplateCrop(clip, canvas, reframe);
  const defaultCrop = getTemplateCrop(clip, canvas, defaultTemplateReframe);
  if (sameCrop(crop, clip.reframe ? getTemplateCrop(clip, canvas) : defaultCrop)) return clip;
  if (sameCrop(crop, defaultCrop)) {
    const { reframe: _reframe, ...reset } = clip;
    return reset;
  }

  return {
    ...clip,
    reframe: {
      zoom: reframe.zoom,
      x: crop.width === 1 ? defaultTemplateReframe.x : reframe.x,
      y: crop.height === 1 ? defaultTemplateReframe.y : reframe.y,
    },
  };
}

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

const textFieldLabels: Readonly<Record<string, string>> = {
  "before-after/labels/0": "Before label",
  "before-after/labels/1": "After label",
  "hook-and-reveal/text/0": "Hook text",
};

export function getTemplateTextFields(template: MobileTemplate): TemplateTextField[] {
  const textSlots = template.slots.filter((slot) => slot.kind === "text");
  const fields: TemplateTextField[] = [];
  for (const track of template.tracks) {
    if (track.type !== "overlay") continue;
    track.items.forEach((item, index) => {
      if (item.kind !== "text" || item.text.editable !== true) return;
      const id = itemKey(track.id, index);
      const slot = textSlots.find((slot) => slot.id === item.slot);
      const maxChars = Math.min(item.text.maxChars ?? Infinity, slot?.maxChars ?? Infinity);
      fields.push({
        id,
        label: slot?.label ?? textFieldLabels[`${template.id}/${id}`] ?? "Text",
        defaultText: item.text.default,
        ...(maxChars !== Infinity && { maxChars }),
      });
    });
  }
  return fields;
}

function normalizeTemplateText({ label, maxChars }: TemplateTextField, value: string): string {
  if (typeof value !== "string") throw new TypeError(`"${label}" must be text.`);
  if (maxChars !== undefined && [...value].length > maxChars) {
    throw new RangeError(`"${label}" must be ${maxChars} characters or fewer.`);
  }
  return value.trim() === "" ? "" : value;
}

export function setTemplateText(
  field: TemplateTextField,
  overrides: TemplateTextOverrides,
  value: string,
): TemplateTextOverrides {
  const text = value === field.defaultText ? value : normalizeTemplateText(field, value);
  const hasOverride = Object.hasOwn(overrides, field.id);
  if (text === field.defaultText) {
    if (!hasOverride) return overrides;
    const { [field.id]: _previous, ...remaining } = overrides;
    return remaining;
  }
  if (hasOverride && overrides[field.id] === text) return overrides;
  return { ...overrides, [field.id]: text };
}

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

export function getEmptyVideoSlots(
  slots: readonly TemplateVideoSlot[],
  clips: Readonly<Record<string, TemplateClip>>,
  missingSlots: readonly string[],
) {
  return slots.filter(({ id }) => !Object.hasOwn(clips, id) && !missingSlots.includes(id));
}

function shortClipError(slot: TemplateVideoSlot): Error {
  return new Error(
    `"${slot.label}" needs at least ${(slot.minDurationUs / US_PER_SECOND).toFixed(2)} seconds of playable video.`,
  );
}

function getTrimBounds(slot: TemplateVideoSlot, clip: Omit<TemplateClip, "trimInUs" | "trimOutUs">) {
  const { uri, sourceStartUs, sourceEndUs } = clip;
  // A video track can begin before the asset timeline. Keep the probe value, but trim from zero or later.
  const playableStartUs = Math.max(0, sourceStartUs);
  if (!uri || !isValidSize(clip) || !Number.isSafeInteger(sourceStartUs) || checkTrim(playableStartUs, sourceEndUs)) {
    throw new Error(invalidVideo);
  }

  const firstFrame = usToFrame(playableStartUs, fps, "ceil");
  const sourceEndFrame = usToFrame(sourceEndUs, fps, "floor");
  const durationFrames = Math.max(1, usToFrame(slot.minDurationUs, fps, "ceil"));
  const lastStartFrame = sourceEndFrame - durationFrames;
  if (lastStartFrame < firstFrame) throw shortClipError(slot);
  return { firstFrame, lastStartFrame, sourceEndFrame, durationFrames };
}

/** Absolute positions on the 30 fps source grid. The source and selected ends are exclusive. */
export function getTemplateTrimWindow(
  slot: TemplateVideoSlot,
  clip: TemplateClip,
): { firstFrame: number; lastStartFrame: number; sourceEndFrame: number; startFrame: number; durationFrames: number } {
  const bounds = getTrimBounds(slot, clip);
  const { trimInUs, trimOutUs } = clip;
  if (checkTrim(trimInUs, trimOutUs) || trimInUs < clip.sourceStartUs || trimOutUs > clip.sourceEndUs) {
    throw new Error(invalidVideo);
  }

  const startFrame = usToFrame(trimInUs, fps, "ceil");
  const endFrame = usToFrame(trimOutUs, fps, "floor");
  if (endFrame - startFrame < bounds.durationFrames) throw shortClipError(slot);
  if (
    endFrame - startFrame !== bounds.durationFrames ||
    trimInUs !== frameToUs(startFrame, fps) ||
    trimOutUs !== frameToUs(endFrame, fps)
  ) {
    throw new Error(invalidVideo);
  }
  return { ...bounds, startFrame };
}

export function setTemplateClipTrim(slot: TemplateVideoSlot, clip: TemplateClip, startFrame: number): TemplateClip {
  const window = getTemplateTrimWindow(slot, clip);
  if (!Number.isInteger(startFrame) || startFrame < window.firstFrame || startFrame > window.lastStartFrame) {
    throw new RangeError(`Trim start must be a whole frame from ${window.firstFrame} to ${window.lastStartFrame}.`);
  }
  if (startFrame === window.startFrame) return clip;
  return {
    ...clip,
    trimInUs: frameToUs(startFrame, fps),
    trimOutUs: frameToUs(startFrame + window.durationFrames, fps),
  };
}

export function createTemplateClip(
  slot: TemplateVideoSlot,
  uri: string,
  name: string,
  { width, height, startUs, durationUs }: { width: number; height: number; startUs: number; durationUs: number },
): TemplateClip {
  if (!Number.isSafeInteger(startUs) || !Number.isSafeInteger(durationUs) || durationUs <= 0) {
    throw new Error(invalidVideo);
  }
  const source = { uri, name, sourceStartUs: startUs, sourceEndUs: startUs + durationUs, width, height };
  const { firstFrame, durationFrames } = getTrimBounds(slot, source);
  return { ...source, trimInUs: frameToUs(firstFrame, fps), trimOutUs: frameToUs(firstFrame + durationFrames, fps) };
}

function validateTemplateMusic({ uri, sourceStartUs, sourceEndUs }: TemplateMusic): void {
  if (!uri || checkTrim(sourceStartUs, sourceEndUs)) throw new Error(invalidMusic);
  if (usToFrame(sourceStartUs, fps, "ceil") >= usToFrame(sourceEndUs, fps, "floor")) {
    throw new Error(invalidMusic);
  }
}

/** Absolute playable track bounds, with an exclusive end. The resolver fits whole frames within this range. */
export function createTemplateMusic(
  uri: string,
  name: string,
  { startUs, durationUs }: { startUs: number; durationUs: number },
): TemplateMusic {
  if (!Number.isSafeInteger(startUs) || !Number.isSafeInteger(durationUs) || durationUs <= 0) {
    throw new Error(invalidMusic);
  }
  const music = { uri, name, sourceStartUs: Math.max(0, startUs), sourceEndUs: startUs + durationUs };
  validateTemplateMusic(music);
  return music;
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
  textOverrides: TemplateTextOverrides = {},
  music?: TemplateMusic | null,
): string | null {
  const text: Project["overrides"]["text"] = {};
  const entries = Object.entries(textOverrides);
  if (entries.length > 0) {
    const fields = getTemplateTextFields(template);
    for (const [id, value] of entries) {
      const field = fields.find((field) => field.id === id);
      if (!field) throw new Error(`No editable text field at "${id}".`);
      text[id] = normalizeTemplateText(field, value);
    }
  }
  if (music) validateTemplateMusic(music);

  const clipFor = (id: string) => (Object.hasOwn(clips, id) ? clips[id] : undefined);
  if (template.slots.some((slot) => slot.kind === "video" && slot.optional !== true && !clipFor(slot.id))) return null;

  const musicSlotId = music ? template.audio?.music?.slot : undefined;
  // Keep the editor's freeze policy for other slots while allowing the resolver to loop music.
  const project = createProject({
    ...template,
    slots: template.slots.map((slot) => {
      if (slot.kind !== "audio" && slot.kind !== "video") return slot;
      return { ...slot, shortClipPolicy: slot.id === musicSlotId ? "loop" : "freeze" };
    }),
  });
  project.overrides.text = text;
  const assets: Record<string, string> = {};
  const assetInfo: Record<string, AssetInfo> = {};
  for (const slot of getVideoSlots(template)) {
    const clip = clipFor(slot.id);
    if (!clip) continue;
    getTemplateTrimWindow(slot, clip);
    const assetUri = `slot:${slot.id}`;
    const binding: SlotBinding = { assetUri, trimInUs: clip.trimInUs, trimOutUs: clip.trimOutUs };
    if (clip.reframe) {
      const crop = getTemplateCrop(clip, template.canvas);
      if (!sameCrop(crop, getTemplateCrop(clip, template.canvas, defaultTemplateReframe))) binding.crop = crop;
    }
    project.bindings[slot.id] = binding;
    assets[assetUri] = clip.uri;
    assetInfo[assetUri] = { width: clip.width, height: clip.height };
  }
  if (music && musicSlotId !== undefined) {
    const assetUri = `slot:${musicSlotId}`;
    project.bindings[musicSlotId] = { assetUri, trimInUs: music.sourceStartUs, trimOutUs: music.sourceEndUs };
    assets[assetUri] = music.uri;
    assetInfo[assetUri] = { durationUs: music.sourceEndUs };
  }

  // Clip validation rejects short media in frames. Check the resolver for genuine frame shortfalls
  // too, since its microsecond calculation can differ slightly with frame position and speed.
  const plan = resolve(project, { assets: assetInfo });
  const issue = plan.warnings.find((warning) => {
    if (warning.type !== "clip-too-short") return true;
    if (warning.layerId === "music" && warning.slotId === musicSlotId && warning.policy === "loop") return false;
    return usToFrame(warning.neededUs, fps, "round") !== usToFrame(warning.availableUs, fps, "round");
  });
  if (issue) throw new Error(issue.message);
  plan.warnings = [];
  plan.layers = plan.layers.map((layer) => (layer.kind === "video" ? alignSourceRate(layer) : layer));
  plan.audio = plan.audio.map((entry) => (entry.kind === "music" ? entry : alignSourceRate(entry)));
  return JSON.stringify({ plan, assets });
}
