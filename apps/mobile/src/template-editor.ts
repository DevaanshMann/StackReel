import { checkTrim, createProject, frameToUs, itemKey, resolve, US_PER_SECOND, usToFrame } from "@stackreel/core";
import type { AssetInfo, AudioEntry, Crop, Project, Size, SlotBinding, VideoLayer } from "@stackreel/core";
import { validate } from "@stackreel/template-schema";
import type { TextItem, Transition } from "@stackreel/template-schema";
import beforeAfter from "../../../templates/examples/before-after.json";
import hookAndReveal from "../../../templates/examples/hook-and-reveal.json";
import top5Countdown from "../../../templates/examples/top-5-countdown.json";
import { defaultClipReframe, getClipCrop, isValidSize, normalizeClipReframe, sameCrop } from "./clip-reframe";
import type { ClipReframe } from "./clip-reframe";
import { getVolumeGainDb as getTemplateGainDb, validateVolumePercent } from "./volume";

export { getTemplateGainDb };
export { maxClipReframeZoom as maxTemplateReframeZoom } from "./clip-reframe";
export type MobileTemplate = Project["template"];
export type TemplateVideoSlot = { id: string; label: string; minDurationUs: number; trimDurationUs: number };
export type TemplateTextField = { id: string; label: string; defaultText: string; maxChars?: number };
export type TemplateTextOverrides = Readonly<Record<string, string>>;
export type TemplateReframe = ClipReframe;
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
  volumePercent?: number;
};
export type TemplateMusic = {
  uri: string;
  name: string;
  readonly sourceStartUs: number;
  readonly sourceEndUs: number;
  /** Offset in whole frames from the first playable source frame. */
  startFrame?: number;
  volumePercent?: number;
};

export const defaultTemplateReframe = defaultClipReframe;

const fps = 30;
const invalidVideo = "This video has invalid dimensions or timing.";
const invalidMusic = "This audio has invalid timing or no playable frames.";
function setVolumePercent<T extends { volumePercent?: number }>(media: T, percent: number): T {
  validateVolumePercent(percent);
  if ((media.volumePercent ?? 100) === percent) return media;
  const updated = { ...media };
  if (percent === 100) delete updated.volumePercent;
  else updated.volumePercent = percent;
  return updated;
}

export const setTemplateClipVolume = setVolumePercent<TemplateClip>;
export const setTemplateMusicVolume = setVolumePercent<TemplateMusic>;

export function getTemplateCrop(
  clip: TemplateClip,
  canvas: Size,
  reframe = clip.reframe ?? defaultTemplateReframe,
): Crop {
  return getClipCrop(clip, canvas, reframe);
}

export function setTemplateClipReframe(clip: TemplateClip, canvas: Size, reframe: TemplateReframe): TemplateClip {
  if (sameCrop(getTemplateCrop(clip, canvas, reframe), getTemplateCrop(clip, canvas))) return clip;
  const normalized = normalizeClipReframe(clip, canvas, reframe);
  if (normalized) return { ...clip, reframe: normalized };
  const { reframe: _reframe, ...reset } = clip;
  return reset;
}

function iosTransition(transition: Transition | undefined): Transition | undefined {
  if (transition?.type === "whip-pan") return { type: "crossfade", durationUs: transition.durationUs };
  if (transition?.type === "zoom-punch") return { type: "slide", durationUs: transition.durationUs, direction: "left" };
  return transition;
}

function fitCountdownName(item: TextItem): TextItem {
  if (!item.slot?.startsWith("name") || !item.style) return item;
  // iOS wraps text at the canvas width minus its background padding. Wrap names
  // inside the side margins and let additional lines grow down below the rank.
  return {
    ...item,
    style: { ...item.style, background: { color: "#00000000", paddingPx: 112, cornerRadiusPx: 0 } },
    position: { anchor: "top-right", x: 0.97, y: 0.56 },
  };
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
        // The example stickers have no assets bundled with the app.
        const items = track.items.filter((item) => item.kind === "text");
        return { ...track, items: template.id === top5Countdown.id ? items.map(fitCountdownName) : items };
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

export const mobileTemplates: readonly MobileTemplate[] = [beforeAfter, hookAndReveal, top5Countdown].map(loadTemplate);

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

export function normalizeTemplateText({ label, maxChars }: TemplateTextField, value: unknown): string {
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

export function applyTemplateTextEdits(
  fields: readonly TemplateTextField[],
  overrides: TemplateTextOverrides,
  values: TemplateTextOverrides,
): TemplateTextOverrides {
  let updated = overrides;
  for (const field of fields) {
    const value = values[field.id];
    // Reset removes the input key, even when the saved override already matches the default.
    if (value === overrides[field.id]) continue;
    updated = setTemplateText(field, updated, value ?? field.defaultText);
  }
  return updated;
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
      const timelineFrames = requiredFramesBySlot.get(id) ?? 1;
      const minimumFrames =
        minDurationUs === undefined ? timelineFrames : Math.max(1, usToFrame(minDurationUs, fps, "ceil"));
      return {
        id,
        label,
        minDurationUs: frameToUs(minimumFrames, fps),
        trimDurationUs: frameToUs(Math.max(timelineFrames, minimumFrames), fps),
      };
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
  const availableFrames = sourceEndFrame - firstFrame;
  if (availableFrames < usToFrame(slot.minDurationUs, fps, "ceil")) throw shortClipError(slot);
  const durationFrames = Math.min(availableFrames, usToFrame(slot.trimDurationUs, fps));
  const lastStartFrame = sourceEndFrame - durationFrames;
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
  if (endFrame - startFrame < usToFrame(slot.minDurationUs, fps, "ceil")) throw shortClipError(slot);
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

function fitClipToSlot(clip: TemplateClip, from: TemplateVideoSlot, to: TemplateVideoSlot): TemplateClip {
  const { startFrame } = getTemplateTrimWindow(from, clip);
  const { lastStartFrame, durationFrames } = getTrimBounds(to, clip);
  const newStartFrame = Math.min(startFrame, lastStartFrame);
  const trimInUs = frameToUs(newStartFrame, fps);
  const trimOutUs = frameToUs(newStartFrame + durationFrames, fps);
  if (trimInUs === clip.trimInUs && trimOutUs === clip.trimOutUs) return clip;
  return { ...clip, trimInUs, trimOutUs };
}

export function swapTemplateClips(
  clips: Readonly<Record<string, TemplateClip>>,
  first: TemplateVideoSlot,
  second: TemplateVideoSlot,
): Readonly<Record<string, TemplateClip>> {
  const firstClip = Object.hasOwn(clips, first.id) ? clips[first.id] : undefined;
  const secondClip = Object.hasOwn(clips, second.id) ? clips[second.id] : undefined;
  if (first.id === second.id || !firstClip || !secondClip) {
    throw new Error("Choose two filled video slots to swap.");
  }

  const firstDestination = fitClipToSlot(secondClip, second, first);
  const secondDestination = fitClipToSlot(firstClip, first, second);
  return { ...clips, [first.id]: firstDestination, [second.id]: secondDestination };
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

function getMusicFrameCount({ uri, sourceStartUs, sourceEndUs, volumePercent = 100 }: TemplateMusic): number {
  validateVolumePercent(volumePercent);
  if (!uri || checkTrim(sourceStartUs, sourceEndUs)) throw new Error(invalidMusic);
  const count = usToFrame(sourceEndUs, fps, "floor") - usToFrame(sourceStartUs, fps, "ceil");
  if (count < 1) throw new Error(invalidMusic);
  return count;
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
  getMusicFrameCount(music);
  return music;
}

function validateMusicStartFrame(startFrame: number, maxFrame: number): void {
  if (!Number.isSafeInteger(startFrame) || startFrame < 0 || startFrame > maxFrame) {
    throw new RangeError(`Music start must be a whole frame from 0 to ${maxFrame}.`);
  }
}

/** Relative start positions for a reel-length window. Short tracks loop from the beginning. */
export function getTemplateMusicStartRange(music: TemplateMusic, reelDurationUs: number) {
  if (!Number.isSafeInteger(reelDurationUs) || reelDurationUs <= 0) {
    throw new RangeError("Reel duration must be a positive integer number of microseconds.");
  }
  const reelFrames = Math.max(1, usToFrame(reelDurationUs, fps, "round"));
  const maxFrame = Math.max(0, getMusicFrameCount(music) - reelFrames);
  const { startFrame = 0 } = music;
  validateMusicStartFrame(startFrame, maxFrame);
  return { startFrame, maxFrame };
}

export function setTemplateMusicStart(music: TemplateMusic, startFrame: number, reelDurationUs: number): TemplateMusic {
  const { maxFrame } = getTemplateMusicStartRange(music, reelDurationUs);
  validateMusicStartFrame(startFrame, maxFrame);
  if (startFrame === (music.startFrame ?? 0)) return music;
  if (startFrame !== 0) return { ...music, startFrame };
  const { startFrame: _startFrame, ...reset } = music;
  return reset;
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
  const musicStartFrame = music ? getTemplateMusicStartRange(music, template.durationUs).startFrame : 0;

  const clipFor = (id: string) => (Object.hasOwn(clips, id) ? clips[id] : undefined);
  if (template.slots.some((slot) => slot.kind === "video" && slot.optional !== true && !clipFor(slot.id))) return null;

  const musicSlotId = music ? template.audio?.music?.slot : undefined;
  // Keep the editor's freeze policy for other slots while allowing the resolver to loop music.
  const project = createProject({
    ...template,
    tracks: template.tracks.map((track) => {
      if (track.type !== "video") return track;
      return {
        ...track,
        items: track.items.map((item) => {
          const percent = clipFor(item.slot)?.volumePercent;
          if (percent === undefined || percent === 100) return item;
          return { ...item, gainDb: getTemplateGainDb(percent, item.gainDb) };
        }),
      };
    }),
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

  const plan = resolve(project, { assets: assetInfo });
  const heldLayers = new Set<string>();
  for (const warning of plan.warnings) {
    if (warning.type !== "clip-too-short") throw new Error(warning.message);
    if (warning.layerId === "music" && warning.slotId === musicSlotId && warning.policy === "loop") continue;
    // Equal frame counts can differ by microseconds. Align those edits as before.
    if (usToFrame(warning.neededUs, fps, "round") === usToFrame(warning.availableUs, fps, "round")) continue;
    if (
      warning.policy !== "freeze" ||
      !plan.layers.some((layer) => layer.id === warning.layerId && layer.kind === "video")
    )
      throw new Error(warning.message);
    heldLayers.add(warning.layerId);
  }
  plan.warnings = [];
  plan.layers = plan.layers.map((layer) =>
    layer.kind === "video" && !heldLayers.has(layer.id) ? alignSourceRate(layer) : layer,
  );
  plan.audio = plan.audio.map((entry) => {
    if (entry.kind !== "music") return heldLayers.has(entry.id) ? entry : alignSourceRate(entry);
    const mixed = { ...entry, gainDb: getTemplateGainDb(music?.volumePercent, entry.gainDb) };
    if (musicStartFrame === 0) return mixed;
    // Move only the soundtrack source. The template can place it after the reel starts.
    const selectedFrame = usToFrame(entry.source.sourceStartUs, fps) + musicStartFrame;
    const durationFrames = usToFrame(entry.endUs, fps) - usToFrame(entry.startUs, fps);
    return alignSourceRate({
      ...mixed,
      source: {
        ...entry.source,
        sourceStartUs: frameToUs(selectedFrame, fps),
        sourceEndUs: frameToUs(selectedFrame + durationFrames, fps),
      },
    });
  });
  return JSON.stringify({ plan, assets });
}
