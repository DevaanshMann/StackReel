import type { Animation, MediaItem, Slot, StickerItem, TextItem, Track } from "@stackreel/template-schema";
import { DEFAULT_SHORT_CLIP_POLICY, fitSlot, type Fitted, type ShortClipPolicy, type TrimWindowPicker } from "./fit.js";
import { itemKey, type Project, type SlotBinding } from "./project.js";
import {
  PLAN_DEFAULTS,
  RENDER_PLAN_VERSION,
  type AudioEntry,
  type Layer,
  type PlanWarning,
  type RenderPlan,
  type ResolvedAnimation,
  type ResolvedStyle,
  type SourceTiming,
  type TransitionPlan,
} from "./render-plan.js";
import { frameToUs, snapToFrame, type TimeRange } from "./time.js";
import { cropRect, fitMatrix, type Placement, type Size } from "./transform.js";

/** What the app knows about a media file. Engines read it from the file before resolving. */
export interface AssetInfo {
  /** Display size in pixels (after rotation metadata). Required for video and image assets. */
  width?: number;
  height?: number;
  /** Length of a video or audio file. When unknown, the binding's trim is trusted. */
  durationUs?: number;
}

export interface ResolveOptions {
  /** Facts about each bound file, keyed by `assetUri`. */
  assets?: Record<string, AssetInfo>;
  /**
   * What to do with clips that are too short for their slot. Defaults to `freeze`. Audio never slows down: `slow`
   * acts as `freeze` (silence after the end) for audio-track items and music.
   */
  shortClipPolicy?: ShortClipPolicy;
  /** Lowest speed `slow` may use. Defaults to 0.25. */
  minSpeed?: number;
  /** Chooses where long clips start. Defaults to the start of the user's trim. */
  pickTrimWindow?: TrimWindowPicker;
  /** Gain added to music while voice plays, when the template ducks. Defaults to -12 dB. */
  duckGainDb?: number;
  /** Length of the ramp into and out of each ducking region. Defaults to 200 ms. */
  duckRampUs?: number;
}

/** Clip gain at or below this is treated as muted, so it doesn't duck the music. */
const MUTED_DB = -60;

const own = <T>(record: Record<string, T> | undefined, key: string): T | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;

const isPositiveFinite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

const byStart = (a: TimeRange, b: TimeRange) => a.startUs - b.startUs || a.endUs - b.endUs;

/** Merges ranges that overlap or touch. */
function unionRanges(ranges: TimeRange[]): TimeRange[] {
  const out: TimeRange[] = [];
  for (const r of [...ranges].sort(byStart)) {
    const last = out[out.length - 1];
    if (last && r.startUs <= last.endUs) last.endUs = Math.max(last.endUs, r.endUs);
    else out.push({ ...r });
  }
  return out;
}

/** A video-track or audio-track item placed on the frame grid. */
interface PlacedItem {
  item: MediaItem;
  itemIndex: number;
  id: string;
  startUs: number;
  /** End before any extension for a following transition. */
  baseEndUs: number;
  endUs: number;
}

/**
 * Turns a project into a RenderPlan: a flat, sorted, engine-ready description of the video. It expects a project
 * that passed `validateProject()`; for such a project it never throws. Problems with the user's media come back as
 * `warnings`, and the plan renders without the affected layers.
 */
export function resolve(project: Project, options: ResolveOptions = {}): RenderPlan {
  const { template, bindings, overrides } = project;
  const { canvas } = template;
  const fps = canvas.fps;
  const canvasSize: Size = { width: canvas.width, height: canvas.height };
  const policy = options.shortClipPolicy ?? DEFAULT_SHORT_CLIP_POLICY;
  const snap = (us: number) => snapToFrame(us, fps);
  const durationUs = Math.max(snap(template.durationUs), frameToUs(1, fps));

  const warnings: PlanWarning[] = [];
  const layers: Layer[] = [];
  const transitions: TransitionPlan[] = [];
  const audio: AudioEntry[] = [];
  const slots = new Map<string, Slot>(template.slots.map((s) => [s.id, s]));

  for (const slot of template.slots) {
    if (slot.kind !== "text" && slot.optional !== true && !own(bindings, slot.id)) {
      warnings.push({ type: "missing-slot", slotId: slot.id, message: `"${slot.label}" needs media` });
    }
  }

  // Asset facts, checked once per slot.
  const assetChecked = new Set<string>();
  const assetFor = (slot: Slot, binding: SlotBinding): { size: Size; durationUs?: number } => {
    const info = own(options.assets, binding.assetUri);
    const sized = info !== undefined && isPositiveFinite(info.width) && isPositiveFinite(info.height);
    const needsSize = slot.kind === "video" || slot.kind === "image";
    if ((info === undefined || (needsSize && !sized)) && !assetChecked.has(slot.id)) {
      warnings.push({
        type: "asset-info-missing",
        slotId: slot.id,
        assetUri: binding.assetUri,
        message: `No ${info === undefined ? "details" : "size"} for the media in "${slot.label}"; assuming the canvas size`,
      });
    }
    assetChecked.add(slot.id);
    const size = sized ? { width: info.width!, height: info.height! } : canvasSize;
    const d = info?.durationUs;
    return Number.isSafeInteger(d) && d! > 0 ? { size, durationUs: d! } : { size };
  };

  /** Length of a ramp at one end of `[startUs, endUs)`, ending on a frame and never longer than the range. */
  const rampIn = (startUs: number, endUs: number, us: number) => Math.min(snap(startUs + us), endUs) - startUs;
  const rampOut = (startUs: number, endUs: number, us: number) =>
    endUs - Math.max(snap(Math.max(endUs - us, 0)), startUs);

  /** Fits a bound slot into a layer and records any warnings. Returns `null` when the layer should be left out. */
  const fitLayer = (slot: Slot, binding: SlotBinding, placed: PlacedItem, slotPolicy: ShortClipPolicy) => {
    const asset = assetFor(slot, binding);
    const fit = fitSlot(slot, binding, {
      durationUs: placed.endUs - placed.startUs,
      speed: placed.item.speed ?? PLAN_DEFAULTS.speed,
      fps,
      policy: slotPolicy,
      ...(asset.durationUs !== undefined && { sourceDurationUs: asset.durationUs }),
      ...(options.minSpeed !== undefined && { minSpeed: options.minSpeed }),
      ...(options.pickTrimWindow !== undefined && { pickWindow: options.pickTrimWindow }),
    });
    if (fit.status !== "fitted") {
      warnings.push({
        type: "empty-trim",
        slotId: slot.id,
        layerId: placed.id,
        message: `The trimmed media in "${slot.label}" has no frames to play`,
      });
      return null;
    }
    fitWarnings(slot, placed.id, fit, slotPolicy);
    return { asset, fit };
  };

  const fitWarnings = (slot: Slot, layerId: string, fit: Fitted, slotPolicy: ShortClipPolicy) => {
    if (fit.mode === "trim") return;
    warnings.push({
      type: "clip-too-short",
      slotId: slot.id,
      layerId,
      neededUs: fit.neededUs,
      availableUs: fit.availableUs,
      policy: slotPolicy,
      message: `The media in "${slot.label}" is shorter than its slot (${slotPolicy})`,
    });
    if (fit.minSpeedReached) {
      warnings.push({
        type: "min-speed-reached",
        slotId: slot.id,
        layerId,
        minSpeed: fit.rate,
        message: `The media in "${slot.label}" can't slow down enough to fill its slot; its last frame is held`,
      });
    }
  };

  const timing = (binding: SlotBinding, fit: Fitted): SourceTiming => ({
    assetUri: binding.assetUri,
    sourceStartUs: fit.sourceStartUs,
    sourceEndUs: fit.sourceEndUs,
    rate: fit.rate,
    afterEnd: fit.afterEnd,
    fitMode: fit.mode,
  });

  /** Puts a track's media items on the frame grid, leaving out unbound slots and items shorter than a frame. */
  const placeMediaItems = (track: Track & { items: MediaItem[] }): PlacedItem[] => {
    const placed: PlacedItem[] = [];
    track.items.forEach((item, itemIndex) => {
      const startUs = snap(item.startUs);
      const endUs = snap(item.startUs + item.durationUs);
      if (endUs <= startUs) {
        warnings.push({
          type: "item-too-short",
          trackId: track.id,
          itemIndex,
          message: `Item ${itemIndex} on track "${track.id}" is shorter than one frame`,
        });
        return;
      }
      if (!own(bindings, item.slot)) return;
      placed.push({ item, itemIndex, id: itemKey(track.id, itemIndex), startUs, baseEndUs: endUs, endUs });
    });
    return placed.sort(byStart);
  };

  const resolveVideoTrack = (track: Track & { type: "video" }, z: number) => {
    const placed = placeMediaItems(track);

    // Transitions: the window starts at the cut and lies inside the incoming item (the schema keeps it no longer than
    // the item), and the outgoing item is extended to the end of the window.
    const pending: TransitionPlan[] = [];
    placed.forEach((p, i) => {
      const t = p.item.transitionIn;
      if (!t || t.type === "cut") return;
      const endUs = Math.min(snap(p.item.startUs + t.durationUs), p.endUs);
      if (endUs <= p.startUs) return;
      const prev = placed[i - 1];
      const from = prev && prev.baseEndUs === p.startUs ? prev : undefined;
      if (from) from.endUs = endUs;
      pending.push({
        id: p.id,
        trackId: track.id,
        z,
        type: t.type,
        ...((t.type === "slide" || t.type === "whip-pan") && { direction: t.direction ?? PLAN_DEFAULTS.direction }),
        startUs: p.startUs,
        endUs,
        fromLayerId: from ? from.id : null,
        toLayerId: p.id,
      });
    });

    const made = new Set<string>();
    for (const p of placed) {
      const slot = slots.get(p.item.slot)!;
      const binding = own(bindings, p.item.slot)!;
      const fit = p.item.fit ?? PLAN_DEFAULTS.fit;
      const base = {
        id: p.id,
        trackId: track.id,
        itemIndex: p.itemIndex,
        z,
        startUs: p.startUs,
        endUs: p.endUs,
        opacity: 1,
        slotId: slot.id,
        fit,
        fadeInUs: rampIn(p.startUs, p.endUs, p.item.fadeInUs ?? 0),
        fadeOutUs: rampOut(p.startUs, p.endUs, p.item.fadeOutUs ?? 0),
      };
      if (slot.kind === "image") {
        const { size } = assetFor(slot, binding);
        const cropPx = cropRect(size, binding.crop);
        layers.push({
          ...base,
          kind: "image",
          assetUri: binding.assetUri,
          sourceSize: size,
          cropPx,
          transform: fitMatrix(size, canvasSize, fit, cropPx),
        });
        made.add(p.id);
        continue;
      }
      const fitted = fitLayer(slot, binding, p, policy);
      if (!fitted) continue;
      const cropPx = cropRect(fitted.asset.size, binding.crop);
      const source = timing(binding, fitted.fit);
      const gainDb = p.item.gainDb ?? PLAN_DEFAULTS.gainDb;
      layers.push({
        ...base,
        kind: "video",
        sourceSize: fitted.asset.size,
        cropPx,
        transform: fitMatrix(fitted.asset.size, canvasSize, fit, cropPx),
        source,
        gainDb,
      });
      audio.push({
        id: p.id,
        kind: "video",
        slotId: slot.id,
        startUs: p.startUs,
        endUs: p.endUs,
        source: { ...source },
        gainDb,
        fadeInUs: base.fadeInUs,
        fadeOutUs: base.fadeOutUs,
      });
      made.add(p.id);
    }

    for (const t of pending) {
      if (!made.has(t.toLayerId)) continue;
      transitions.push(t.fromLayerId !== null && !made.has(t.fromLayerId) ? { ...t, fromLayerId: null } : t);
    }
  };

  /** Audio never slows down to fit; it goes silent after the end instead. */
  const audioPolicy: ShortClipPolicy = policy === "slow" ? "freeze" : policy;

  const resolveAudioTrack = (track: Track & { type: "audio" }) => {
    for (const p of placeMediaItems(track)) {
      const slot = slots.get(p.item.slot)!;
      const binding = own(bindings, p.item.slot)!;
      const fitted = fitLayer(slot, binding, p, audioPolicy);
      if (!fitted) continue;
      audio.push({
        id: p.id,
        kind: "audio",
        slotId: slot.id,
        startUs: p.startUs,
        endUs: p.endUs,
        source: timing(binding, fitted.fit),
        gainDb: p.item.gainDb ?? PLAN_DEFAULTS.gainDb,
        fadeInUs: rampIn(p.startUs, p.endUs, p.item.fadeInUs ?? 0),
        fadeOutUs: rampOut(p.startUs, p.endUs, p.item.fadeOutUs ?? 0),
      });
    }
  };

  const resolveAnimation = (animation: Animation | undefined, startUs: number, endUs: number): ResolvedAnimation => {
    const inName = animation?.in ?? "none";
    const outName = animation?.out ?? "none";
    const inUs = inName === "none" ? 0 : (animation?.inDurationUs ?? PLAN_DEFAULTS.animationDurationUs);
    const outUs = outName === "none" ? 0 : (animation?.outDurationUs ?? PLAN_DEFAULTS.animationDurationUs);
    const inDurationUs = rampIn(startUs, endUs, inUs);
    return {
      in: inName,
      out: outName,
      inDurationUs,
      outDurationUs: rampOut(startUs + inDurationUs, endUs, outUs),
    };
  };

  const placement = (item: TextItem | StickerItem): Placement => {
    const pos = item.position ?? PLAN_DEFAULTS.position;
    return {
      xPx: pos.x * canvas.width,
      yPx: pos.y * canvas.height,
      anchor: pos.anchor,
      rotationDeg: pos.rotationDeg ?? 0,
    };
  };

  const resolveOverlayTrack = (track: Track & { type: "overlay" }, z: number) => {
    track.items.forEach((item, itemIndex) => {
      const startUs = snap(item.startUs);
      const endUs = snap(item.startUs + item.durationUs);
      if (endUs <= startUs) {
        warnings.push({
          type: "item-too-short",
          trackId: track.id,
          itemIndex,
          message: `Item ${itemIndex} on track "${track.id}" is shorter than one frame`,
        });
        return;
      }
      const id = itemKey(track.id, itemIndex);
      const base = { id, trackId: track.id, itemIndex, z, startUs, endUs, opacity: 1 };
      const animation = resolveAnimation(item.animation, startUs, endUs);
      if (item.kind === "sticker") {
        layers.push({
          ...base,
          kind: "sticker",
          asset: item.asset,
          widthPx: item.widthNorm * canvas.width,
          placement: placement(item),
          animation,
        });
        return;
      }
      const text =
        (item.text.editable === true ? own(overrides.text, id) : undefined) ??
        (item.slot !== undefined ? own(overrides.text, item.slot) : undefined) ??
        item.text.default;
      // Overrides are partial; a key set to undefined keeps the template's value.
      const tweaks = Object.entries(own(overrides.style, id) ?? {}).filter(([, value]) => value !== undefined);
      // A JSON copy, so the plan shares no objects (stroke, shadow, background) with the project.
      const style = JSON.parse(
        JSON.stringify({ ...PLAN_DEFAULTS.style, ...item.style, ...Object.fromEntries(tweaks) }),
      ) as ResolvedStyle;
      layers.push({ ...base, kind: "text", text, style, placement: placement(item), animation });
    });
  };

  template.tracks.forEach((track, z) => {
    if (track.type === "video") resolveVideoTrack(track, z);
    else if (track.type === "audio") resolveAudioTrack(track);
    else resolveOverlayTrack(track, z);
  });

  const music = template.audio?.music;
  const musicBinding = music ? own(bindings, music.slot) : undefined;
  if (music && musicBinding) {
    const slot = slots.get(music.slot)!;
    const startUs = Math.min(snap(music.startUs ?? PLAN_DEFAULTS.musicStartUs), durationUs - frameToUs(1, fps));
    const placed: PlacedItem = {
      item: { slot: music.slot, startUs, durationUs: durationUs - startUs },
      itemIndex: 0,
      id: "music",
      startUs,
      baseEndUs: durationUs,
      endUs: durationUs,
    };
    const fitted = fitLayer(slot, musicBinding, placed, audioPolicy);
    if (fitted) {
      const voice = audio.filter((a) => a.gainDb > MUTED_DB);
      const regions = unionRanges(
        voice.map((a) => ({ startUs: Math.max(a.startUs, startUs), endUs: Math.min(a.endUs, durationUs) })),
      ).filter((r) => r.endUs > r.startUs);
      audio.push({
        id: "music",
        kind: "music",
        slotId: slot.id,
        startUs,
        endUs: durationUs,
        source: timing(musicBinding, fitted.fit),
        gainDb: music.gainDb ?? PLAN_DEFAULTS.gainDb,
        fadeInUs: rampIn(startUs, durationUs, music.fadeInUs ?? 0),
        fadeOutUs: rampOut(startUs, durationUs, music.fadeOutUs ?? 0),
        ...(template.audio?.duckMusicUnderVoice === true && {
          ducking: {
            gainDb: options.duckGainDb ?? PLAN_DEFAULTS.duckGainDb,
            rampUs: options.duckRampUs ?? PLAN_DEFAULTS.duckRampUs,
            regions,
          },
        }),
      });
    }
  }

  layers.sort((a, b) => a.startUs - b.startUs || a.z - b.z || a.itemIndex - b.itemIndex);
  transitions.sort((a, b) => a.startUs - b.startUs || a.z - b.z);
  audio.sort((a, b) => a.startUs - b.startUs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    renderPlanVersion: RENDER_PLAN_VERSION,
    templateId: template.id,
    canvas: {
      width: canvas.width,
      height: canvas.height,
      fps,
      background: canvas.background ?? PLAN_DEFAULTS.background,
    },
    durationUs,
    layers,
    transitions,
    audio,
    warnings,
  };
}
