import type { RenderPlan } from "./render-plan.js";
import { isOnFrame, rangeContains, type TimeRange } from "./time.js";

/**
 * Checks the rules every RenderPlan must follow and returns one message per broken rule (empty when the plan is
 * sound). Tests run it on every resolved plan, and engines can run it on plans they receive.
 *
 * - Every layer, transition and audio entry has a positive length inside `[0, durationUs)`, on frame starts.
 * - Source ranges are non-empty and play at a positive rate.
 * - Video and image transforms hold only finite numbers.
 * - Ids are unique, and `layers`, `transitions` and `audio` are sorted as documented.
 * - On a video track at most two layers are visible at once, and only inside a transition that pairs them.
 */
export function checkPlanInvariants(plan: RenderPlan): string[] {
  const problems: string[] = [];
  const { fps } = plan.canvas;

  const checkRange = (what: string, r: TimeRange) => {
    if (!(r.startUs < r.endUs)) problems.push(`${what}: length is not positive (${r.startUs}..${r.endUs})`);
    if (r.startUs < 0 || r.endUs > plan.durationUs) problems.push(`${what}: outside [0, ${plan.durationUs})`);
    if (!isOnFrame(Math.max(r.startUs, 0), fps) || !isOnFrame(Math.max(r.endUs, 0), fps)) {
      problems.push(`${what}: not on frame starts`);
    }
  };
  const checkSource = (what: string, s: { sourceStartUs: number; sourceEndUs: number; rate: number }) => {
    if (!(s.sourceStartUs >= 0 && s.sourceStartUs < s.sourceEndUs)) problems.push(`${what}: empty source range`);
    if (!(s.rate > 0)) problems.push(`${what}: rate is not positive`);
  };
  const checkSorted = <T>(what: string, list: T[], compare: (a: T, b: T) => number) => {
    for (let i = 1; i < list.length; i++) {
      if (compare(list[i - 1]!, list[i]!) > 0) problems.push(`${what}: not sorted at index ${i}`);
    }
  };
  const checkUnique = (what: string, ids: string[]) => {
    if (new Set(ids).size !== ids.length) problems.push(`${what}: duplicate ids`);
  };

  for (const layer of plan.layers) {
    checkRange(`layer ${layer.id}`, layer);
    if (layer.kind === "video") checkSource(`layer ${layer.id}`, layer.source);
    if ((layer.kind === "video" || layer.kind === "image") && !layer.transform.every(Number.isFinite)) {
      problems.push(`layer ${layer.id}: transform is not finite`);
    }
  }
  for (const t of plan.transitions) checkRange(`transition ${t.id}`, t);
  for (const a of plan.audio) {
    checkRange(`audio ${a.id}`, a);
    checkSource(`audio ${a.id}`, a.source);
  }

  checkSorted("layers", plan.layers, (a, b) => a.startUs - b.startUs || a.z - b.z || a.itemIndex - b.itemIndex);
  checkSorted("transitions", plan.transitions, (a, b) => a.startUs - b.startUs || a.z - b.z);
  checkSorted("audio", plan.audio, (a, b) => a.startUs - b.startUs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  checkUnique(
    "layers",
    plan.layers.map((l) => l.id),
  );
  checkUnique(
    "transitions",
    plan.transitions.map((t) => t.id),
  );
  checkUnique(
    "audio",
    plan.audio.map((a) => a.id),
  );

  const layerById = new Map(plan.layers.map((l) => [l.id, l]));
  for (const t of plan.transitions) {
    const to = layerById.get(t.toLayerId);
    const from = t.fromLayerId === null ? null : layerById.get(t.fromLayerId);
    if (!to || to.startUs !== t.startUs || to.trackId !== t.trackId) {
      problems.push(`transition ${t.id}: incoming layer doesn't start at the window`);
    }
    if (from === undefined || (from && (from.endUs !== t.endUs || from.trackId !== t.trackId))) {
      problems.push(`transition ${t.id}: outgoing layer doesn't end with the window`);
    }
  }

  // Overlap on video tracks. Visibility only grows at a layer start, so checking each start is enough.
  const media = plan.layers.filter((l) => l.kind === "video" || l.kind === "image");
  for (const layer of media) {
    const at = layer.startUs;
    const visible = media.filter((l) => l.trackId === layer.trackId && rangeContains(l, at));
    if (visible.length > 2) problems.push(`track ${layer.trackId}: ${visible.length} layers visible at ${at}us`);
    if (visible.length === 2) {
      const ids = new Set(visible.map((l) => l.id));
      const paired = plan.transitions.some(
        (t) => rangeContains(t, at) && t.fromLayerId !== null && ids.has(t.fromLayerId) && ids.has(t.toLayerId),
      );
      if (!paired) problems.push(`track ${layer.trackId}: two layers overlap at ${at}us outside a transition`);
    }
  }

  return problems;
}
