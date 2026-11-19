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
The `StackReelComposition` library uses that plan to build an `AVMutableComposition` from local video files:

```swift
let result = try await VideoCompositionBuilder.build(plan) { assetURI in
  try localFileURL(for: assetURI)
}
```

`result.clipsByLayerID` maps each video layer to a composition track and carries the source rotation and
playable time range. Overlapping clips have separate track IDs, and loop segments repeat at their resolved rate.
Use `result.timelineDuration` for the full timeline, which may extend past the last video sample.
The compositor uses `holdTimeRange` to draw the last frame during a freeze. Audio mixing, visual effects and
overlays are separate engine steps.

Run the Swift tests on macOS with Xcode 16 or newer:

```bash
swift test --package-path modules/stackreel-engine/ios
```

The tests read the plans from the [shared fixture manifest](../../fixtures/README.md), verify their hashes,
and check that encoding the decoded plans preserves the JSON values. The composition tests verify source and
timeline ranges using a local video. See **Phases 2 and 3** in the [root README](../../README.md) for the
remaining engine milestones.
