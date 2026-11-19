# StackReel template format v1

## v1 feature set

The v1 format adopts the feature set already used by `schemaVersion: 1` and the ten built-in templates. This gives the
iOS and Android engines the same inputs and render plans to implement. See [issue #13](https://github.com/DevaanshMann/StackReel/issues/13).

| Feature              | v1 scope                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slots and tracks     | Required or optional `video`, `image`, `audio`, and `text` slots. Video tracks sequence video and images, overlay tracks stack text and bundled stickers, and audio tracks mix audio clips. Tracks are ordered from bottom to top for compositing.                                                                  |
| Canvas and placement | Output size in pixels, frame rate, and background color. Text and stickers use normalized canvas coordinates, anchors, and rotation. Safe-zone presets or custom insets guide placement in the editor.                                                                                                              |
| Fit and playback     | `cover` scales proportionally and crops to fill the canvas, `contain` scales proportionally to show the whole source, and `fill` scales each axis independently. Timed media plays at 0.25×–4×, with 1× as the default. Short video can hold its last frame, slow down, or loop. Short audio can go silent or loop. |
| Transitions          | Six choices on video tracks: `cut`, `crossfade`, `whip-pan`, `zoom-punch`, `slide`, and `spin`. `slide` and `whip-pan` accept `left`, `right`, `up`, and `down`.                                                                                                                                                    |
| Text and stickers    | Text can be fixed, edited per item, or supplied by a text slot. Styles support font, pixel size, color, alignment, stroke, shadow, and a background. Sticker items reference bundled assets and specify a width relative to the canvas.                                                                             |
| Overlay animations   | Nine active animations: `fade`, `pop`, `slide-up`, `slide-down`, `slide-left`, `slide-right`, `scale`, `typewriter`, and `bounce`. Entry and exit are configured independently, with `none` selecting an immediate entry or exit.                                                                                   |
| Sound and music      | Clip and music gain in dB, fade-in and fade-out, and one optional music bed backed by an audio slot. Music can duck under voice with configurable attenuation and ramp duration.                                                                                                                                    |

## Reading a template

The [JSON Schema](../packages/template-schema/schema/stackreel-template.v1.json) describes the document shape.
Use [`validate()`](../packages/template-schema/README.md) for cross-field checks such as slot references and
overlapping video items. Objects reject unknown keys. Optional fields can be omitted, and validation returns them
as omitted. The tables give the effective values used when resolving a template with the standard
[`TEMPLATE_DEFAULTS`](../packages/template-schema/src/defaults.ts).

- IDs contain 1–64 ASCII letters, digits, underscores, or hyphens and start with a letter or digit.
- Colors use `#RRGGBB` or `#RRGGBBAA` hex notation, with alpha last.
- Fields ending in `Us` use non-negative integer microseconds within the JavaScript safe integer range. Item and
  template lengths must be positive.
  Item `startUs` is measured from the start of the template. A span includes its start and excludes its end, so
  `startUs: 1000000, durationUs: 500000` describes `[1000000, 1500000)`. See [ADR 0002](adr/0002-integer-microseconds.md).
- Normalized placement and inset values are fractions from 0 to 1. Coordinates start at the top-left of the canvas.
  See [ADR 0003](adr/0003-normalized-coordinates-and-anchors.md).

## Template and canvas

| Field           | Type, units, and meaning                                              | When omitted                |
| --------------- | --------------------------------------------------------------------- | --------------------------- |
| `schemaVersion` | Integer literal `1`. Identifies the format understood by the reader.  | Required                    |
| `id`            | Template ID, for example `quick-reveal`.                              | Required                    |
| `name`          | Display name, 1–80 characters.                                        | Required                    |
| `description`   | Description, up to 500 characters.                                    | No description              |
| `canvas`        | Output settings listed below.                                         | Required                    |
| `durationUs`    | Total template length in µs.                                          | Required                    |
| `slots`         | Array of [slot definitions](#slots). May be empty.                    | Required                    |
| `tracks`        | Array of [tracks](#tracks) in bottom-to-top draw order. May be empty. | Required                    |
| `audio`         | [Music and ducking settings](#music-and-ducking).                     | No music or ducking         |
| `safeZones`     | [Editor placement guides](#safe-zones).                               | No template-specified guide |

| Canvas field      | Type, units, and meaning                            | When omitted |
| ----------------- | --------------------------------------------------- | ------------ |
| `width`, `height` | Integer output dimensions in pixels, each 16–8192.  | Required     |
| `fps`             | Integer output frame rate, 1–240 frames per second. | Required     |
| `background`      | Fill color behind all tracks.                       | `#000000`    |

## Slots

A slot names an input the project can supply. Multiple items can reference the same slot ID. Slot IDs must be
unique within the template. An unfilled media slot produces no layer or audio entry. An unfilled required media
slot also produces a resolver warning. A text item can supply its own fallback even when its text slot is empty.

| Field             | Applies to      | Type, units, and meaning                                                                                                                                                                                                                                                | When omitted         |
| ----------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `id`              | All slots       | ID referenced by items or music.                                                                                                                                                                                                                                        | Required             |
| `kind`            | All slots       | One of `video`, `image`, `audio`, or `text`.                                                                                                                                                                                                                            | Required             |
| `label`           | All slots       | Prompt shown to the user, 1–80 characters.                                                                                                                                                                                                                              | Required             |
| `optional`        | All slots       | Boolean indicating that the slot may be left empty.                                                                                                                                                                                                                     | `false`              |
| `minDurationUs`   | Video and audio | Suggested minimum source length in µs. Core fits media using the item's timeline length, the trim window, and the playback rate.                                                                                                                                        | No minimum specified |
| `shortClipPolicy` | Video and audio | `freeze` holds the last video frame or goes silent for audio. `loop` restarts from the beginning of the chosen source range. Video also supports `slow`, which reduces the playback rate as needed down to `minSpeed`, then holds the last frame if there is time left. | `freeze`             |
| `minSpeed`        | Video           | Rate multiplier from 0.25 to 4. Used with the slot's `slow` policy.                                                                                                                                                                                                     | `0.25`               |
| `maxChars`        | Text            | Positive integer limit on editable slot text, counted in Unicode code points.                                                                                                                                                                                           | No slot limit        |

See [ADR 0004](adr/0004-short-clip-policy-on-slots.md) for the precedence of slot settings and resolver options.

## Tracks

| Field   | Type and meaning                                                 | When omitted |
| ------- | ---------------------------------------------------------------- | ------------ |
| `id`    | ID unique among tracks in the template.                          | Required     |
| `type`  | `video`, `overlay`, or `audio`. Selects the permitted item kind. | Required     |
| `items` | Array of items. May be empty.                                    | Required     |

- A `video` track contains [media items](#media-items) referencing video or image slots. Authored intervals on
  the same video track may touch and must be disjoint. Gaps are allowed.
- An `overlay` track contains [text](#text-items) and [sticker](#sticker-items) items. Items may overlap.
- An `audio` track contains [media items](#media-items) referencing audio slots. Items may overlap and mix.
  Audio tracks produce audio entries and have no visual layers.

Every item has `startUs` (required, non-negative) and `durationUs` (required, positive). Their sum must be
at most the template's `durationUs`. The resolver snaps timeline boundaries to the output frame grid. Items whose
boundaries snap to the same frame are omitted.

### Media items

| Field                   | Type, units, and meaning                                                                                                                                                                                                       | When omitted       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `slot`                  | ID of the video, image, or audio slot for this track type.                                                                                                                                                                     | Required           |
| `startUs`, `durationUs` | Timeline start and length in µs, as defined under [Tracks](#tracks).                                                                                                                                                           | Required           |
| `fit`                   | For visual media, `cover` scales proportionally to fill the canvas and crops overflow, `contain` scales proportionally to show the whole source, and `fill` stretches the two axes independently. The fitted crop is centered. | `cover`            |
| `speed`                 | Playback rate multiplier from 0.25 to 4 for video or audio. At `2`, one timeline second uses two source seconds before short-clip fitting.                                                                                     | `1`                |
| `gainDb`                | Gain for video or audio sound, −60 to +12 dB.                                                                                                                                                                                  | `0` dB, unity gain |
| `fadeInUs`, `fadeOutUs` | Fade lengths in µs at the start and end of the resolved layer or audio entry. Fades apply to opacity for visual layers and level for sound. Core snaps and caps each fade at the layer or entry length.                        | `0` µs             |
| `transitionIn`          | [Transition](#transitions) at the start of an item on a video track.                                                                                                                                                           | Immediate cut      |
| `voice`                 | Boolean marking a video or audio item as speech for [ducking](#music-and-ducking). `true` is invalid for image slots.                                                                                                          | Unmarked           |

Video and audio tracks share the same item shape. Core uses `fit` and `transitionIn` on video tracks, and
`speed` and `gainDb` for timed sources with playback and sound. A still image can use fades and transitions.

#### Transitions

| Field        | Type, units, and meaning                                          | When omitted                       |
| ------------ | ----------------------------------------------------------------- | ---------------------------------- |
| `type`       | `cut`, `crossfade`, `whip-pan`, `zoom-punch`, `slide`, or `spin`. | Required                           |
| `durationUs` | Window length in µs, at most the incoming item's length.          | Required                           |
| `direction`  | `left`, `right`, `up`, or `down`. Used by `slide` and `whip-pan`. | `left` for directional transitions |

The transition starts at the incoming item's cut and runs inside that item. Core extends the adjacent outgoing
layer on the same track to the end of the window and fits its source to the extended interval. For a missing or unplayable
predecessor, the plan uses `fromLayerId: null` and the incoming layer transitions from the background. A `cut`
or a window whose boundaries snap to the same frame produces no transition entry.

### Text items

| Field                   | Type, units, and meaning                                   | When omitted                       |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------- |
| `kind`                  | String literal `text`.                                     | Required                           |
| `startUs`, `durationUs` | Timeline start and length in µs.                           | Required                           |
| `slot`                  | ID of a text slot whose value can replace `text.default`.  | No slot                            |
| `text`                  | Text settings listed below.                                | Required                           |
| `style`                 | [Typography and decoration](#text-style).                  | Inter-Bold, 64 px, white, centered |
| `position`              | [Overlay placement](#overlay-position).                    | Centered, with zero rotation       |
| `animation`             | [Overlay animation](#overlay-animation) at entry and exit. | No animation                       |

| Text settings field | Type and meaning                                                                          | When omitted  |
| ------------------- | ----------------------------------------------------------------------------------------- | ------------- |
| `default`           | Fallback string. May be empty and must fit `maxChars` when supplied.                      | Required      |
| `editable`          | Boolean enabling a per-item text edit.                                                    | `false`       |
| `maxChars`          | Positive integer limit on the default and per-item edits, counted in Unicode code points. | No item limit |

Core takes the per-item edit when `editable` is true and an edit exists, then the text slot value if supplied,
then `text.default`.

#### Text style

When `style` is supplied, it requires `font`, `sizePx`, and `color`. Pixel values refer to the authored
output canvas. Each optional decoration requires all of its listed members when supplied.

| Field        | Type, units, and meaning                                                                                                                           | When omitted       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `font`       | Nonempty PostScript name of a bundled font, for example `Inter-Bold`.                                                                              | Required           |
| `sizePx`     | Positive number, font size in pixels.                                                                                                              | Required           |
| `color`      | Text fill color.                                                                                                                                   | Required           |
| `align`      | `left`, `center`, or `right` within the text block.                                                                                                | `center`           |
| `stroke`     | Object with `color` and non-negative `widthPx` in pixels.                                                                                          | No stroke          |
| `shadow`     | Object with `color`, non-negative `blurPx`, and signed `offsetXPx` and `offsetYPx`, all distances in pixels. Positive offsets move right and down. | No shadow          |
| `background` | Object with `color`, non-negative `paddingPx`, and non-negative `cornerRadiusPx`, both distances in pixels.                                        | No text background |

### Sticker items

| Field                   | Type, units, and meaning                                                         | When omitted                 |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------- |
| `kind`                  | String literal `sticker`.                                                        | Required                     |
| `startUs`, `durationUs` | Timeline start and length in µs.                                                 | Required                     |
| `asset`                 | Nonempty ID of a sticker bundled with the app or template.                       | Required                     |
| `widthNorm`             | Fraction of canvas width in `(0, 1]`. Height follows the sticker's aspect ratio. | Required                     |
| `position`              | [Overlay placement](#overlay-position).                                          | Centered, with zero rotation |
| `animation`             | [Overlay animation](#overlay-animation) at entry and exit.                       | No animation                 |

### Overlay position

| Field         | Type, units, and meaning                                                                                                                                      | When omitted               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `anchor`      | Point in the element that sits at `(x, y)`. Names are `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, and `bottom-right`. | Required within `position` |
| `x`, `y`      | Number from 0 to 1. Fractions of the canvas width and height, respectively.                                                                                   | Required within `position` |
| `rotationDeg` | Rotation around the anchor, from −360 to +360 degrees. Positive turns clockwise on screen.                                                                    | `0` degrees                |

The default when the whole object is omitted is `{ "anchor": "center", "x": 0.5, "y": 0.5, "rotationDeg": 0 }`.
For example, `{ "anchor": "top-left", "x": 0.1, "y": 0.2 }` puts the overlay's top-left point at
`(108, 384)` pixels on a 1080×1920 canvas.

### Overlay animation

| Field                           | Type, units, and meaning                                                                                                                          | When omitted                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `in`, `out`                     | Effect at entry or exit. One of `none`, `fade`, `pop`, `slide-up`, `slide-down`, `slide-left`, `slide-right`, `scale`, `typewriter`, or `bounce`. | `none`                           |
| `inDurationUs`, `outDurationUs` | Length of the corresponding effect in µs. `none` always resolves to zero duration.                                                                | `300000` µs for an active effect |

The resolver snaps the effect boundaries to the frame grid and fits them inside the item. Entry takes precedence
when both effects would run into each other.

## Music and ducking

| Audio field           | Type and meaning                                         | When omitted |
| --------------------- | -------------------------------------------------------- | ------------ |
| `music`               | Single music bed, with settings listed below.            | No music bed |
| `duckMusicUnderVoice` | Boolean enabling music attenuation during voice regions. | `false`      |

| Music field             | Type, units, and meaning                                                                                                                    | When omitted       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `slot`                  | ID of the audio slot providing the bed. When filled, it plays from `startUs` to the template end according to the slot's short-clip policy. | Required           |
| `startUs`               | Timeline start in µs, strictly before the template ends.                                                                                    | `0` µs             |
| `gainDb`                | Base gain, −60 to +12 dB.                                                                                                                   | `0` dB, unity gain |
| `fadeInUs`, `fadeOutUs` | Fade lengths in µs at the start and end of the bed. Core snaps and caps each fade at the bed length.                                        | `0` µs             |
| `duckGainDb`            | Additional gain during voice, −30 to 0 dB. Applies when ducking is enabled.                                                                 | `-12` dB           |
| `duckRampUs`            | Length in µs of the ramp centered on each voice region edge. Applies when ducking is enabled.                                               | `200000` µs        |

If any item is marked `voice: true`, core uses only marked audio entries with gain above −60 dB. With no
marked items, all video and audio clip entries above −60 dB count. Core merges their resolved intervals, clipped
to the music bed.

## Safe zones

| Field    | Type, units, and meaning                                                                                                                                         | When omitted                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `preset` | Editor guide selection. One of `none`, `tiktok-reels-shorts`, `tiktok`, `instagram-reels`, or `youtube-shorts`.                                                  | Required within `safeZones` |
| `insets` | Custom guide overriding the preset. Requires `top` and `bottom` as fractions of height, and `left` and `right` as fractions of width. Each value is from 0 to 1. | Use the selected preset     |

Safe zones guide placement in the editor. Core resolves overlays in full-canvas coordinates.

## Example

This two-shot template displays editable text through the first clip. The second clip starts at 2 s with a
200 ms crossfade. Omitted background, rotation, fit, and playback speed use their defaults.

```json
{
  "schemaVersion": 1,
  "id": "quick-reveal",
  "name": "Quick Reveal",
  "description": "Two shots, an opening title, and optional music.",
  "canvas": { "width": 1080, "height": 1920, "fps": 30 },
  "durationUs": 4000000,
  "slots": [
    { "id": "intro", "kind": "video", "label": "First shot", "minDurationUs": 2200000 },
    { "id": "reveal", "kind": "video", "label": "Reveal", "shortClipPolicy": "slow", "minSpeed": 0.5 },
    { "id": "title", "kind": "text", "label": "Title", "optional": true, "maxChars": 40 },
    { "id": "bed", "kind": "audio", "label": "Music", "optional": true, "shortClipPolicy": "loop" }
  ],
  "tracks": [
    {
      "id": "shots",
      "type": "video",
      "items": [
        { "slot": "intro", "startUs": 0, "durationUs": 2000000, "voice": true },
        {
          "slot": "reveal",
          "startUs": 2000000,
          "durationUs": 2000000,
          "transitionIn": { "type": "crossfade", "durationUs": 200000 }
        }
      ]
    },
    {
      "id": "overlays",
      "type": "overlay",
      "items": [
        {
          "kind": "text",
          "slot": "title",
          "startUs": 0,
          "durationUs": 2000000,
          "text": { "default": "Wait for it…", "editable": true, "maxChars": 40 },
          "position": { "anchor": "top", "x": 0.5, "y": 0.15 },
          "style": { "font": "Inter-Bold", "sizePx": 72, "color": "#FFFFFF" },
          "animation": { "in": "fade", "inDurationUs": 200000 }
        }
      ]
    }
  ],
  "audio": {
    "music": { "slot": "bed", "gainDb": -6, "fadeOutUs": 300000 },
    "duckMusicUnderVoice": true
  },
  "safeZones": { "preset": "tiktok-reels-shorts" }
}
```

See the [ten built-in examples](../templates/examples/README.md) for additional combinations of slots, styles,
transitions, and audio.

## Renderer decisions to document

The [render plan](../packages/core/README.md#renderplan-format-v1) carries effect names, direction, and timing.
The engine spec needs shared easing curves, motion and scale parameters, and a definition of `typewriter`
behavior on stickers, which share the text animation enum. Golden-frame tests can check those decisions against
the same plans on each platform.
