# stackreel-engine (Expo native module)

The hardware-accelerated render engine, exposed to React Native through the **Expo Modules API**.

| Platform             | Composition            | Effects / compositing                  | Encode                                    |
| -------------------- | ---------------------- | -------------------------------------- | ----------------------------------------- |
| iOS (`ios/`)         | `AVMutableComposition` | Custom `AVVideoCompositing` + Metal    | `AVAssetWriter` (VideoToolbox HEVC/H.264) |
| Android (`android/`) | Media3 `Composition`   | Media3 `Effect` / `OverlayEffect` (GL) | Media3 `Transformer` (MediaCodec)         |

Both engines take the same **render plan** (from `@stackreel/core`) and must pass the same golden-frame tests.

## Swift render plan and composition

The Swift package in [`ios/`](ios/) exposes `StackReelPlan`. The
[RenderPlan v1 contract](../../packages/core/README.md#renderplan-format-v1) defines the JSON fields.
Use `JSONDecoder().decode(RenderPlan.self, from: data)` to load a plan.
The `StackReelComposition` library uses that plan to build an `AVMutableComposition` from local media files:

```swift
let result = try await VideoCompositionBuilder.build(plan) { assetURI in
  try localFileURL(for: assetURI)
}
let instructions = try result.makeVideoInstructions()
```

`result.clipsByLayerID` maps each video layer to a composition track and carries the source rotation and
playable time range. Overlapping clips have separate track IDs, and loop segments repeat at their resolved rate.
Use `result.timelineDuration` for the full timeline, which may extend past the last video sample.
The instructions cover the full timeline and carry layers in draw order, active transitions, and the track
IDs that supply source frames. Held inputs identify the clip whose last playable frame the compositor needs.

For a video plan with cuts, crossfades, slides, and styled text, create the paired asset and video composition:

```swift
let render = try result.makeRenderComposition()
let item = AVPlayerItem(asset: render.asset)
item.videoComposition = render.videoComposition
item.audioMix = result.audioMix
```

The custom compositor uses Metal-backed Core Image when available. It applies source orientation, the plan's
crop and transform, clip fades, and linear-light crossfades. See the [sampled test frames](../../docs/ios-crossfade.png).
Slides move both clips together by one canvas width or height over the transition interval. The direction
defaults to left. A slide from the background moves only the incoming clip, and other tracks stay in place.
See [sampled frames for all four directions](../../docs/ios-slide.png).

Core Text draws multiline and wrapped text with alignment, stroke, shadow, and rounded backgrounds.
The compositor caches the rendered text by content and style, then applies its anchor, rotation, and
fade, pop, scale, slide, or bounce animation on each frame. If the requested PostScript font is unavailable,
Core Text uses the system font. See [sampled text frames](../../docs/ios-text.png).
Still images, stickers, held frames, typewriter animations, whip-pans, zoom punches, and spins return an
unsupported-feature error. Rendering requires a video track.

`result.audioMix` applies the plan's gain, fades, and music ducking to embedded clip sound, standalone audio,
and music. Audio uses the resolved trims, playback rates, and loops. A video without an audio track and
the unused tail of a held audio entry contribute silence. To read mixed samples, pass the render asset's
audio tracks and the same mix to `AVAssetReaderAudioMixOutput`.

Run the Swift tests on macOS with Xcode 16 or newer:

```bash
swift test --package-path modules/stackreel-engine/ios
```

The tests read the plans from the [shared fixture manifest](../../fixtures/README.md), verify their hashes,
and check that encoding the decoded plans preserves the JSON values. The composition tests verify source and
timeline ranges using local videos and check the rendered pixels through `AVAssetReader`. See **Phases 2 and 3**
in the [root README](../../README.md) for the remaining engine milestones.
