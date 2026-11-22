# stackreel-engine (Expo native module)

The hardware-accelerated render engine, exposed to React Native through the **Expo Modules API**.

| Platform             | Composition            | Effects / compositing                  | Encode                               |
| -------------------- | ---------------------- | -------------------------------------- | ------------------------------------ |
| iOS (`ios/`)         | `AVMutableComposition` | Custom `AVVideoCompositing` + Metal    | `AVAssetWriter` (VideoToolbox H.264) |
| Android (`android/`) | Media3 `Composition`   | Media3 `Effect` / `OverlayEffect` (GL) | Media3 `Transformer` (MediaCodec)    |

Both engines take the same **render plan** (from `@stackreel/core`) and must pass the same golden-frame tests.

## Expo integration on iOS

Add `@stackreel/engine` as a workspace dependency and use an iOS native build with Expo SDK 58. Expo
autolinks the bridge, plan, and composition pods and bundles the composition fonts. Rebuild the native
app after changing the module. Import the package from iOS entry points.

Pass the same source string to preview and export. Use the asset identifiers from the RenderPlan v1
object as keys, including sticker assets and audio sources. Each value must be an absolute local
`file:` URL readable by the app.

```ts
import { addExportProgressListener, exportMP4, probeVideo } from "@stackreel/engine";

const metadata = await probeVideo(uri);
const source = JSON.stringify({ plan, assets: { [assetId]: uri } });
const subscription = addExportProgressListener(({ exportId: id, progress }) => {
  if (id === exportId) updateProgress(progress);
});

try {
  const { uri: outputUri } = await exportMP4(source, exportId);
  await shareVideo(outputUri);
} finally {
  subscription.remove();
}
```

`probeVideo` returns width and height in pixels after applying the first video track's preferred
transform. `startUs` and `durationUs` describe that track's time range in microseconds.

`probeAudio(uri)` accepts an absolute local `file:` URL and returns `AudioMetadata` with `startUs`
and `durationUs` for the first audio track. Use `startUs` and `startUs + durationUs` as the source trim
bounds. They are safe integer microseconds rounded inward, and `startUs` can be greater than zero.
The promise rejects if the file cannot be opened or its first audio track is missing or unusable.

`StackReelPreviewView` accepts React Native view props, `source`, `playing`, and optional `looping`.
`onReady` reports `nativeEvent.durationSeconds` when the player is available. `onPositionChange`
reports `nativeEvent.positionSeconds`. `onError` reports `nativeEvent.message` for source or playback
failures. After `onReady`, call `seekTo(seconds)` on the `StackReelPreviewViewRef`. Seeking clamps the
position to the timeline. Changing `source` or removing the view releases the active preview and
interrupts pending seeks.

Use a fresh `exportId` for each job. Progress events carry that ID and a fraction from 0 to 1.
`cancelExport` requests cancellation and the export promise rejects with `ERR_EXPORT_CANCELLED` if
cancellation takes effect. A successful export returns a temporary `file:` URI in the app cache.
The caller may delete the MP4 after using it. The iOS engine clears temporary exports from previous app
processes at startup. Copy the MP4 to a persistent destination before relying on it across launches.

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

On the main actor, create a `StackReelPreviewPlayer` from the composition result. It plays the render
asset with the custom video composition and the plan's audio mix. On iOS, attach it to a
`StackReelPreviewView` and add the view to your UIKit layout:

```swift
let preview = try StackReelPreviewPlayer(composition: result)
let view = StackReelPreviewView(frame: .zero)
view.preview = preview
preview.isLooping = true
preview.onPositionChange = { time in updateScrubber(seconds: time.seconds) }
preview.play()
```

Use `pause()` to stop playback and `seek(to:completion:)` to scrub within `0...duration`.
Seeking to the end pauses playback. If a seek supersedes an earlier request, the earlier completion
receives `false`. Use `currentTime` for a position snapshot and set `onPositionChange` to `nil` to stop
receiving updates. The UIKit view displays the video. The surrounding UI supplies the controls.

The custom compositor uses Metal-backed Core Image when available. It applies source orientation, the plan's
crop and transform, clip fades, and linear-light crossfades. See the [sampled test frames](../../docs/ios-crossfade.png).
Slides move both clips together by one canvas width or height over the transition interval. The direction
defaults to left. A slide from the background moves only the incoming clip, and other tracks stay in place.
See [sampled frames for all four directions](../../docs/ios-slide.png).

Core Text draws multiline and wrapped text with alignment, stroke, shadow, and rounded backgrounds.
The compositor caches the rendered text by content and style, then applies its anchor, rotation, and
fade, pop, scale, slide, or bounce animation on each frame. The Swift package bundles the Inter,
Playfair Display, and Space Mono faces used by the sample templates and loads them by PostScript name.
Core Text uses the system font when the requested face is unavailable. See
[font sources and licenses](ios/Sources/StackReelComposition/Resources/Fonts/) and
[sampled text frames](../../docs/ios-text.png).
The typewriter animation reveals grapheme clusters in text order on entry and removes them in reverse on
exit. Whitespace and line breaks count toward progress. The final wrapping, alignment, anchor, and
background stay fixed throughout. See [sampled typewriter frames](../../docs/ios-typewriter.png).

In video-backed plans, the asset resolver loads local still images and sticker assets with alpha and
orientation preserved. Stills use the plan's crop, transform, and fades. Stickers use their resolved
width, anchor, rotation, and overlay animations. Rendering requires a video track. Multi-image files,
sticker typewriter animation, held frames, whip-pans, zoom punches, and spins are unsupported.
See the [sampled still-image and sticker frames](../../docs/ios-image-overlays.png).

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

### MP4 export

Export a built video composition to a local H.264 MP4. The exporter renders the plan at its canvas
size and frame rate with the custom compositor. It writes one stereo AAC track when the plan has
audio tracks to mix.

```swift
let result = try await VideoCompositionBuilder.build(plan) { assetURI in
  try localFileURL(for: assetURI)
}
let exportTask = Task {
  try await result.exportMP4(to: outputURL) { fraction in
    // Runs on a background queue. Dispatch UI updates to the main actor.
    print(fraction)
  }
}
try await exportTask.value
```

Pass an unused file URL in an existing directory. An export publishes the finished MP4 at that
URL and then reports progress of `1`. Call `exportTask.cancel()` to cancel an in-progress encode.
Failure or cancellation removes the staged output. Existing files at the destination are preserved.
The same plan features supported by the custom compositor are available for export.
