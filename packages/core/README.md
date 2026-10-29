# @stackreel/core

Platform-independent TypeScript logic:

- Time math (integer microseconds), frame snapping, and time ranges
- The `Project` model and its save format
- Undo/redo command stack
- Slot fitting: which part of each clip plays, and what happens when a clip is too short
- The resolver: turns a project into a flat, sorted [RenderPlan](#renderplan-format-v1) for the render engines

Holds no UI code and no platform media APIs. Templates and their types come from
[`@stackreel/template-schema`](../template-schema/README.md).

```ts
import {
  applyCommand,
  createHistory,
  createProject,
  parseProject,
  serializeProject,
  snapToFrame,
  undo,
} from "@stackreel/core";

let history = createHistory(createProject(template), { limit: 100 });
history = applyCommand(history, {
  type: "ReplaceSlotAsset",
  slotId: "clip1",
  assetUri: "file:///clips/beach.mp4",
  trimInUs: 0,
  trimOutUs: snapToFrame(3_200_000, template.canvas.fps),
});
history = applyCommand(history, { type: "EditText", target: "text/0", text: "Wait for it…" });
history = undo(history);

const saved = serializeProject(history.project);
const loaded = parseProject(saved); // { ok: true, project } or { ok: false, errors }
```

## Time

Every time is an integer number of microseconds (`1 s = 1_000_000`). Frame helpers accept any integer fps from 1
to 240; templates normally use 24, 25, 30 or 60.

| Function                                     | What it does                                                   |
| -------------------------------------------- | -------------------------------------------------------------- |
| `frameToUs(frame, fps)`                      | Start time of a frame                                          |
| `usToFrame(us, fps, rounding = "floor")`     | Frame at a time                                                |
| `snapToFrame(us, fps, rounding = "round")`   | Moves a time onto a frame start                                |
| `isOnFrame(us, fps)`                         | True if a time is exactly a frame start                        |
| `timeRange(start, end)`, `rangeFromDuration` | Build a checked `TimeRange`                                    |
| `rangeDuration`, `isEmptyRange`              | Length of a range                                              |
| `rangesOverlap`, `intersectRanges`           | Shared time between two ranges (`null` if none)                |
| `rangeContains`, `rangeContainsRange`        | Is a time, or a whole range, inside a range                    |
| `clampToRange(us, range)`                    | Moves a time into a range (the end is allowed, for a playhead) |
| `snapRangeToFrames(range, fps)`              | Moves both ends of a range to their nearest frame starts       |

### Rounding rules

- **Frame starts round to the nearest microsecond; an exact half rounds up.** `frameToUs(n, fps)` is
  `round(n * 1_000_000 / fps)`, computed from `n` each time and never by adding frame lengths, so the error stays under
  1 us however long the video is.
  - 25 fps: frames are exactly 40000 us apart. No rounding happens.
  - 24, 30 and 60 fps: exact starts are multiples of 1/3 us, so frames are 1 us longer or shorter in a repeating
    pattern. At 30 fps they start at 0, 33333, 66667, 100000, … At 24 fps: 0, 41667, 83333, 125000, … At 60 fps: 0,
    16667, 33333, 50000, … Every whole second lands exactly on `n * 1_000_000`.
- **Frame boundaries are those rounded starts.** Frame `n` covers `[frameToUs(n), frameToUs(n + 1))`, so
  `usToFrame(frameToUs(n, fps), fps) === n` for every frame and every rounding mode.
- **`usToFrame` rounding modes:** `floor` (default) is the frame showing at that time. `ceil` is the first frame
  starting at or after it. `round` is the frame whose start is nearest; a tie goes to the later frame.
- **`snapToFrame` defaults to `round`**, for snapping edits and trims to the frame grid.

Ranges are half-open, `[startUs, endUs)`. Ranges that only touch don't overlap, and an empty range overlaps and
contains nothing. Invalid input (negative or fractional times, unsupported fps) throws a `RangeError`, as do times
beyond the frame math's limit (about 217 days at 240 fps). `resolve()` and `fitClip()` clamp those times to it.

## Project

```ts
interface Project {
  schemaVersion: 1; // the project file version, separate from the template's
  template: Template;
  bindings: Record<SlotId, { assetUri: string; trimInUs: number; trimOutUs: number; crop?: Crop }>;
  overrides: {
    text: Record<SlotId | ItemKey, string>;
    style: Record<ItemKey, Partial<Style>>;
  };
}
```

- A **binding** fills a video, image or audio slot. `trimInUs` and `trimOutUs` are source times with
  `0 <= trimInUs < trimOutUs`. `crop` is in normalized source coordinates and must stay inside the frame. Text slots
  can't be bound; their text is an override.
- An **item key** such as `"captions/0"` (`itemKey(trackId, index)`) points to one item. Template ids can't contain
  `/`, so it never clashes with a slot id.
- **Text overrides** are keyed by a text slot id or by the item key of a text item with `editable: true`, and must fit
  `maxChars` (counted in code points).
- **Style overrides** are keyed by the item key of a text item, and merge over its template style.

| Function                    | What it does                                                               |
| --------------------------- | -------------------------------------------------------------------------- |
| `createProject(template)`   | An empty project with a copy of the template                               |
| `validateProject(json)`     | `{ ok, project }` or `{ ok: false, errors }` with JSON Pointer paths       |
| `serializeProject(project)` | Validated, pretty-printed JSON. Throws `ProjectValidationError` if invalid |
| `parseProject(text)`        | Parses, runs the template through `migrate()`, validates. Never throws     |

`serializeProject` writes keys in schema order, so loading and saving a project gives back the same text.

## Commands and history

Every edit is a command. `applyCommand` checks it against the project and throws `CommandError` (changing nothing)
if it doesn't fit.

| Command            | Fields                                                       |
| ------------------ | ------------------------------------------------------------ |
| `ReplaceSlotAsset` | `slotId`, `assetUri`, `trimInUs`, `trimOutUs`, `crop?`       |
| `SetTrim`          | `slotId`, `trimInUs`, `trimOutUs` (the slot must have media) |
| `SetCrop`          | `slotId`, `crop` or `null` (the slot must have media)        |
| `ClearSlot`        | `slotId`                                                     |
| `EditText`         | `target` (slot id or item key), `text` or `null` to reset    |
| `SetTextStyle`     | `target` (item key), `style` to merge, or `null` to reset    |

`History` is an immutable value (`{ project, past, future, limit? }`), so it fits a React reducer. Each step stores
the command and the [Immer](https://immerjs.github.io/immer/patches) patches that redo and undo it.

- `createHistory(project, { limit? })`: `limit` is the most undo steps kept; older ones are dropped. The project is
  frozen.
- `applyCommand(history, command)`: applies and records it, and clears the redo stack. A command that changes nothing
  isn't recorded.
- `undo`, `redo`: return the history unchanged when there's nothing to do. `canUndo`, `canRedo` say whether there is.

## Slot fitting

`fitClip(request)` works out which part of a bound clip plays in a layer. The input is the layer's length on the
timeline (`durationUs`), the template's `speed`, the user's trim (`trimInUs`, `trimOutUs`), the source length if
known, and the canvas `fps`. The trim is first clamped to the source and shrunk to whole canvas frames, so the result
never reaches outside it.

| Case                                           | Result                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Enough footage (`available >= duration*speed`) | `trim`: the window starts where `pickWindow` says (default: the trim start), at `speed` |
| Short clip, policy `freeze` (default)          | The whole window at `speed`, then the last frame is held                                |
| Short clip, policy `slow`                      | The whole window, slowed to fill the layer; never below `minSpeed` (0.25), then hold    |
| Short clip, policy `loop`                      | The whole window at `speed`, restarting each time it ends                               |
| The trim holds no whole frame                  | `{ status: "empty-window" }`                                                            |

Every source time in the result is a frame start at the canvas fps. `pickWindow` is the hook for a later "smart"
picker (motion, faces): it gets the frame-aligned window and the needed length, and its answer is clamped and snapped.

`fitSlot(slot, binding, request)` adds empty slots: an unbound optional slot is `{ status: "skipped" }`, an unbound
required one is `{ status: "missing-slot" }`.

The template format has no `shortClipPolicy` field yet, so the policy is a resolver option.

## Resolving a project

```ts
import { checkPlanInvariants, resolve } from "@stackreel/core";

const plan = resolve(project, {
  assets: { "file:///clips/beach.mp4": { width: 1920, height: 1080, durationUs: 12_400_000 } },
  shortClipPolicy: "freeze", // or "slow" | "loop"
});
checkPlanInvariants(plan); // [] for every plan resolve() returns
```

`resolve(project, options)` expects a project that passed `validateProject()`, and for such a project it never
throws. Problems with the user's media come back in `plan.warnings`, and the plan renders without the affected layers.

| Option            | Default    | What it does                                                                      |
| ----------------- | ---------- | --------------------------------------------------------------------------------- |
| `assets`          | `{}`       | Size (`width`, `height`, display orientation) and `durationUs` of each bound file |
| `shortClipPolicy` | `freeze`   | What to do with clips shorter than their slot. Audio treats `slow` as `freeze`    |
| `minSpeed`        | `0.25`     | Slowest speed `slow` uses                                                         |
| `pickTrimWindow`  | trim start | Chooses where long clips start                                                    |
| `duckGainDb`      | template   | Gain added to music inside ducking regions. Overrides `audio.music.duckGainDb`    |
| `duckRampUs`      | template   | Ramp length at each ducking region edge. Overrides `audio.music.duckRampUs`       |

## RenderPlan format (v1)

The RenderPlan is the contract between `@stackreel/core` and the Swift, Kotlin and Web engines. It is plain JSON:
every default is applied, every time is absolute integer microseconds on a canvas frame start, and every list is
sorted, so the same project always gives byte-identical JSON. The TypeScript types in
[`src/render-plan.ts`](src/render-plan.ts) are the reference; this section explains them.

```ts
interface RenderPlan {
  renderPlanVersion: 1; // engines reject versions they don't know
  templateId: string;
  canvas: { width; height; fps; background }; // background defaults to #000000
  durationUs: number; // everything lies in [0, durationUs)
  layers: Layer[]; // sorted by startUs, then z, then itemIndex
  transitions: TransitionPlan[]; // sorted by startUs, then z
  audio: AudioEntry[]; // sorted by startUs, then id
  warnings: PlanWarning[];
}
```

### Layers

Every layer has `id` (the item key `"<trackId>/<itemIndex>"`), `trackId`, `itemIndex`, `z` (the track's index, bottom
0 to top; higher draws on top), `startUs`, `endUs` (exclusive, always after `startUs`) and `opacity` (1 in v1). Audio
tracks make no layers. `kind` is one of:

- **`video`**: `slotId`, `fit`, `sourceSize`, `cropPx`, `transform`, `fadeInUs`, `fadeOutUs`, `gainDb`, and `source`:

  ```ts
  { assetUri, sourceStartUs, sourceEndUs, rate, afterEnd: "hold" | "loop", fitMode: "trim" | "freeze" | "slow" | "loop" }
  ```

  At timeline time `t` the source time is `sourceStartUs + (t - startUs) * rate`. Once it reaches `sourceEndUs`,
  `hold` shows the last frame and `loop` wraps back to `sourceStartUs`.

- **`image`**: like `video` without `source` and `gainDb`, plus `assetUri`.
- **`text`**: `text` (project override, or the template default), `style` (template style with the project's tweaks
  merged over it, `align` always set), `placement`, and `animation`.
- **`sticker`**: `asset`, `widthPx` (height follows the sticker's aspect ratio), `placement`, `animation`.

**Media transform.** `transform` is a row-major 3×3 affine matrix `[a, b, c, d, e, f, 0, 0, 1]` that maps source
pixels `(x, y)` to canvas pixels `(a*x + b*y + c, d*x + e*y + f)`, origin top-left, y down. Engines draw only the
`cropPx` rectangle of the source through it and clip to the canvas. `cropPx` is the binding's crop in source pixels
(the whole frame without one), at least 1 px a side and inside the source. `sourceSize` is the displayed size, after
the file's rotation metadata, so engines apply that rotation first. The crop rectangle is centered on the canvas:

| `fit`     | Scale                                                         |
| --------- | ------------------------------------------------------------- |
| `cover`   | `max(W / cropW, H / cropH)` on both axes; the overflow is cut |
| `contain` | `min(W / cropW, H / cropH)` on both axes; background shows    |
| `fill`    | `W / cropW` across, `H / cropH` down                          |

For example a 1920×1080 clip on a 1080×1920 canvas with `cover` gets `[1.7778, 0, -1166.67, 0, 1.7778, 0, 0, 0, 1]`.

**Overlay placement.** Text and sticker sizes are only known after an engine lays them out, so overlays carry
`placement: { xPx, yPx, anchor, rotationDeg }`: the overlay's anchor point sits at `(xPx, yPx)` and it rotates
clockwise around that point. `placementMatrix(contentSize, placement)` builds the matrix; engines port it as is.
Missing positions default to the canvas center.

**Fades and animations.** `fadeInUs` and `fadeOutUs` ramp a media layer's opacity (and, for video, its sound) from and
to zero at its ends. `animation` is `{ in, out, inDurationUs, outDurationUs }`; `none` has duration 0, other
animations default to 300 ms, and the two never add up to more than the layer. All of these are snapped so they end
on a frame.

### Transitions

A transition plays across a cut on one video track. Its window starts at the cut, `[startUs, endUs)`, and lies inside
the incoming layer (the schema keeps a transition no longer than its item). The outgoing layer is **extended** to
`endUs`, and plays its source on through the window, so both are on screen during it.

```ts
{ id, trackId, z, type, direction?, startUs, endUs, fromLayerId: string | null, toLayerId }
```

- `type` is any template transition except `cut`. Cuts and zero-length transitions make no entry.
- `direction` is only set for `slide` and `whip-pan` (default `left`).
- `fromLayerId` is `null` when nothing plays just before (the first item, a gap, or an empty or unplayable slot): the
  layer transitions in from the background.
- Windows on one track never overlap, so **at most two layers of a video track are visible at once**, and only
  during a transition that pairs them. Layers on different tracks stack by `z`.

### Audio

Each entry is `{ id, kind, slotId, startUs, endUs, source, gainDb, fadeInUs, fadeOutUs, ducking? }`, with `source`
as for video layers (`hold` means silence after the end):

- `kind: "video"`: the sound of a video layer, with the layer's id and times (including any transition extension).
- `kind: "audio"`: an item on an audio track, such as a voice-over.
- `kind: "music"`: the template's music, `id: "music"`, from `music.startUs` to the end of the video.

When the template sets `duckMusicUnderVoice`, the music carries `ducking: { gainDb, rampUs, regions }`. `gainDb` and
`rampUs` come from the options, then the template's `music.duckGainDb` and `music.duckRampUs`, then -12 dB and
200 ms. Regions are the merged times of the voice entries with a gain above -60 dB (treated as muted), clipped to the
music. Voice entries are those of items marked `voice: true` or, when the template marks none, every other entry.
Ramps are centered on each region edge. Until on-device speech detection arrives (Phase 6), regions cover whole
clips.

### Warnings

Warnings never stop resolving. Each has a `type`, the ids it concerns, and a `message` a UI can show as is:

| `type`               | Meaning                                                              | Effect                     |
| -------------------- | -------------------------------------------------------------------- | -------------------------- |
| `missing-slot`       | A required media slot has nothing bound                              | Its layers are left out    |
| `asset-info-missing` | No details (or no valid size) in `options.assets` for a bound file   | Canvas size is assumed     |
| `empty-trim`         | The trim holds no whole frame of the source                          | The layer is left out      |
| `clip-too-short`     | The clip is shorter than its slot; carries `neededUs`, `availableUs` | The short-clip policy runs |
| `min-speed-reached`  | `slow` couldn't slow down enough                                     | The last frame is held     |
| `item-too-short`     | A template item is shorter than one frame after snapping             | The item is left out       |

### Invariants

`checkPlanInvariants(plan)` returns the broken rules (empty for a sound plan): positive lengths inside
`[0, durationUs)` on frame starts, non-empty source ranges with positive rates, finite transforms, unique ids, sorted
lists, transitions that match their layers, and at most two visible layers per video track, only inside a transition.
Tests run it on every built-in template with each short-clip policy, and engines can run it on plans they receive.

### Example

An excerpt of the plan for [`hook-and-reveal`](../../templates/examples/hook-and-reveal.json) with 1920×1080 clips
bound. The first clip is extended by the 250 ms `whip-pan` (rounded to 8 frames at 30 fps):

```json
{
  "renderPlanVersion": 1,
  "templateId": "hook-and-reveal",
  "canvas": { "width": 1080, "height": 1920, "fps": 30, "background": "#000000" },
  "durationUs": 9000000,
  "layers": [
    {
      "id": "main/0",
      "trackId": "main",
      "itemIndex": 0,
      "z": 0,
      "startUs": 0,
      "endUs": 3266667,
      "opacity": 1,
      "slotId": "clip1",
      "fit": "cover",
      "fadeInUs": 0,
      "fadeOutUs": 0,
      "kind": "video",
      "sourceSize": { "width": 1920, "height": 1080 },
      "cropPx": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
      "transform": [1.7777777777777777, 0, -1166.6666666666665, 0, 1.7777777777777777, 0, 0, 0, 1],
      "source": {
        "assetUri": "file:///clips/clip1.mp4",
        "sourceStartUs": 0,
        "sourceEndUs": 3266667,
        "rate": 1,
        "afterEnd": "hold",
        "fitMode": "trim"
      },
      "gainDb": 0
    },
    {
      "id": "text/0",
      "trackId": "text",
      "itemIndex": 0,
      "z": 1,
      "startUs": 200000,
      "endUs": 2800000,
      "opacity": 1,
      "kind": "text",
      "text": "Wait for it…",
      "style": {
        "font": "Inter-Black",
        "sizePx": 96,
        "color": "#FFFFFF",
        "align": "center",
        "stroke": { "color": "#000000", "widthPx": 6 }
      },
      "placement": { "xPx": 540, "yPx": 422.4, "anchor": "center", "rotationDeg": 0 },
      "animation": { "in": "pop", "out": "fade", "inDurationUs": 300000, "outDurationUs": 300000 }
    }
  ],
  "transitions": [
    {
      "id": "main/1",
      "trackId": "main",
      "z": 0,
      "type": "whip-pan",
      "direction": "left",
      "startUs": 3000000,
      "endUs": 3266667,
      "fromLayerId": "main/0",
      "toLayerId": "main/1"
    }
  ],
  "audio": [
    {
      "id": "music",
      "kind": "music",
      "slotId": "music",
      "startUs": 0,
      "endUs": 9000000,
      "source": {
        "assetUri": "file:///clips/music.m4a",
        "sourceStartUs": 0,
        "sourceEndUs": 9000000,
        "rate": 1,
        "afterEnd": "hold",
        "fitMode": "trim"
      },
      "gainDb": -6,
      "fadeInUs": 0,
      "fadeOutUs": 500000,
      "ducking": { "gainDb": -12, "rampUs": 200000, "regions": [{ "startUs": 0, "endUs": 9000000 }] }
    }
  ],
  "warnings": []
}
```

### Defaults the template format doesn't define yet

The resolver fills in one default of its own until the template format has a field for it: short-clip policy
`freeze`. Every other default (text style, position, animation lengths, canvas background, ducking and so on) is the
template format's, from `TEMPLATE_DEFAULTS` in
[`@stackreel/template-schema`](../template-schema/README.md#defaults), and `PLAN_DEFAULTS` reuses those values.

## Testing

`pnpm test` runs every suite with coverage (90% minimum).

**Render plan snapshots.** [`test/resolve.snapshot.test.ts`](test/resolve.snapshot.test.ts) binds fixed fake media
(`fake://<template-id>/<slot-id>.mp4`, long enough for every slot, in 16:9, 9:16 and 4:5 sizes) to each template in
[`templates/examples/`](../../templates/examples/). It checks that the template validates, resolves with no warnings
and keeps every invariant, then compares the full plan with
[`test/__snapshots__/<template-id>.renderplan.json`](test/__snapshots__/). The files are formatted like the rest of the
repo, so a resolver change shows up in a review as a plain JSON diff.

After an intended change to the resolver or a template, update the snapshots and review the diff before committing:

```sh
pnpm --filter @stackreel/core test -- -u
```

In CI a missing or different snapshot fails the test; snapshots are only written when you pass `-u` locally.

## Scripts

| Script           | What it does                              |
| ---------------- | ----------------------------------------- |
| `pnpm build`     | Compile to `dist/`                        |
| `pnpm test`      | Run the tests with coverage (90% minimum) |
| `pnpm typecheck` | `tsc --noEmit`                            |
| `pnpm lint`      | ESLint with no warnings allowed           |

See **Phase 1** in the [root README](../../README.md#phase-1-template-format--core-model).
