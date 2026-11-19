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

### Playback rules already defined by core

- Timeline values are integer microseconds. Core snaps render-plan boundaries to the canvas frame grid.
- A transition starts at the incoming clip's cut and occupies the first part of that clip. Core extends an adjacent
  playable outgoing clip through the window. If the incoming clip has no playable predecessor at the cut, it
  transitions from the background. The alignment diagram and trim and speed examples belong in the
  [transition alignment work](https://github.com/DevaanshMann/StackReel/issues/41).
- Music ducking is off by default. When enabled, it applies `-12` dB over voice regions by default with a `200000` µs
  ramp centered on each region edge. If any item is marked `voice: true`, only marked, unmuted audio entries count.
  Otherwise, core uses all unmuted clip audio entries. Regions cover the resolved clip intervals.

### Renderer decisions to document

The render plan carries the names, direction, and timing of effects. The engine spec needs shared easing curves,
motion and scale parameters, and a definition of `typewriter` behavior on sticker items, which currently share the
text animation enum. Golden-frame tests can then check those decisions against the same plans on each platform.

See the [schema and defaults](../packages/template-schema/README.md), [render-plan contract](../packages/core/README.md#renderplan-format-v1),
and [built-in examples](../templates/examples/README.md). The [field reference and time and placement ADRs](https://github.com/DevaanshMann/StackReel/issues/14)
build on this scope.
