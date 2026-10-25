# @stackreel/core

Platform-independent TypeScript logic:

- Time math (integer microseconds), frame snapping, and time ranges
- The `Project` model and its save format
- Undo/redo command stack
- Timeline resolution (not built yet): turns a template plus the user's clips into a flat, ordered render plan

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
contains nothing. Invalid input (negative or fractional times, unsupported fps) throws a `RangeError`.

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

## Scripts

| Script           | What it does                              |
| ---------------- | ----------------------------------------- |
| `pnpm build`     | Compile to `dist/`                        |
| `pnpm test`      | Run the tests with coverage (90% minimum) |
| `pnpm typecheck` | `tsc --noEmit`                            |
| `pnpm lint`      | ESLint with no warnings allowed           |

See **Phase 1** in the [root README](../../README.md#phase-1-template-format--core-model).
