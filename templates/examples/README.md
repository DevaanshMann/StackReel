# Built-in sample templates

These ten templates are StackReel's built-in library. They are also the shared fixtures for engine and resolver tests,
so together they use every feature of template format v1. All are 1080×1920.

| id                                          | Name             | Category          | Duration | Slots | Features it shows                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ---------------- | ----------------- | -------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`hook-and-reveal`](hook-and-reveal.json)   | Hook & Reveal    | Talking head      | 9 s      | 4     | `whip-pan` and `zoom-punch` transitions, `pop`/`fade` text, stroked text, music ducked under voice, `tiktok-reels-shorts` safe zone                                                                                                                                        |
| [`travel-postcard`](travel-postcard.json)   | Travel Postcard  | Travel            | 15 s     | 7     | 25 fps, optional image slot with `contain` fit over a colored canvas, `slide` right and `crossfade`, `slide-right`/`slide-up`/`bounce`, `top-left` and `bottom-left` anchors, text shadow and background, sticker, music fade-in and fade-out, `instagram-reels` safe zone |
| [`recipe-in-30`](recipe-in-30.json)         | 30-Second Recipe | Food              | 30 s     | 8     | Speed 1.5×, 2× and 0.5×, clip gain, explicit `cut`, `whip-pan` left, audio track with a voice-over clip (gain, fades), `typewriter`/`slide-left`/`slide-right`/`scale`, non-editable labels, `left` anchor, multi-line left-aligned text, ducking, `tiktok` safe zone      |
| [`hiit-circuit`](hiit-circuit.json)         | HIIT Circuit     | Fitness           | 45 s     | 11    | 60 fps, required music slot, `slide` up and down, two overlay tracks, text slots for each move, `bounce`/`scale`/`pop`, `top-right` anchor, custom animation durations, `youtube-shorts` safe zone                                                                         |
| [`product-drop`](product-drop.json)         | Product Drop     | Product showcase  | 12 s     | 8     | Two video tracks, image backdrop with `fill` fit under `contain` photos, `spin` and `slide` left, 0.75× speed, rotated sticker on a `top-right` anchor, price tag with a rounded background, `bottom` anchor                                                               |
| [`before-after`](before-after.json)         | Before / After   | Before/after      | 8 s      | 4     | `whip-pan` right, `slide-down` labels with `none` out, `top-left`/`top-right` anchors, left- and right-aligned text, rotated sticker, optional text slot                                                                                                                   |
| [`top-5-countdown`](top-5-countdown.json)   | Top 5 Countdown  | List or countdown | 25 s     | 12    | Ten text slots, `left` and `right` anchors, right-aligned text, heavy stroke, `scale` in and `slide-left` out, `typewriter` title, `bounce` sticker, `zoom-punch` on the winner                                                                                            |
| [`day-in-my-life`](day-in-my-life.json)     | Day in My Life   | Day in the life   | 60 s     | 13    | 24 fps, ten clips, speed 1.25× to 2×, voice-over on an audio track, music ducked with 2 s fades, `typewriter` timestamps on a `bottom-right` anchor, semi-transparent text color, custom safe-zone insets                                                                  |
| [`quote-card`](quote-card.json)             | Quote Card       | Quote / text-only | 6 s      | 4     | Text-only layout with an optional image background (fade-in and fade-out), `none` and `typewriter` animations, translucent decorative glyph, `none` safe-zone preset                                                                                                       |
| [`beat-cut-montage`](beat-cut-montage.json) | Beat-Cut Montage | Beat-cut montage  | 15 s     | 14    | One-second cuts on a 120 BPM beat, every transition (`cut`, `crossfade`, `whip-pan` in all four directions, `zoom-punch`, `spin`), speed 0.25× to 4×, muted clips (−60 dB), required music without ducking                                                                 |

## Coverage check

[`packages/template-schema/test/examples.test.ts`](../../packages/template-schema/test/examples.test.ts) validates every
file here and fails if any value the schema allows (slot kinds, track types, item kinds, transitions and directions,
text animations, fit modes, anchors, text alignment, safe-zone presets) is used by none of them. It reads those values
from the Zod schema, so adding a value to the schema means adding it to an example too. It also checks features that
have no enum, such as speed, gain and fades, music ducking, text styles, rotation and safe-zone insets.

## Not here yet

Each template will also ship a `.thumb.jpg` and a short `.preview.mp4`. Both are rendered by an engine, so they arrive
with the render engines (Phase 4).

Sticker ids (`map-pin`, `sparkle`, `fire`, `badge-new`, `arrow-curved`, `trophy`, `flash`) and font names refer to
assets the app will bundle. They don't exist in the repo yet.
