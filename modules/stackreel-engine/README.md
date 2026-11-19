# stackreel-engine (Expo native module)

The hardware-accelerated render engine, exposed to React Native through the **Expo Modules API**.

| Platform             | Composition            | Effects / compositing                  | Encode                                    |
| -------------------- | ---------------------- | -------------------------------------- | ----------------------------------------- |
| iOS (`ios/`)         | `AVMutableComposition` | Custom `AVVideoCompositing` + Metal    | `AVAssetWriter` (VideoToolbox HEVC/H.264) |
| Android (`android/`) | Media3 `Composition`   | Media3 `Effect` / `OverlayEffect` (GL) | Media3 `Transformer` (MediaCodec)         |

Both engines take the same **render plan** (from `@stackreel/core`) and must pass the same golden-frame tests.

## Swift render plan

The Swift package in [`ios/`](ios/) exposes `StackReelPlan`. The
[RenderPlan v1 contract](../../packages/core/README.md#renderplan-format-v1) defines the JSON fields.
Use `JSONDecoder().decode(RenderPlan.self, from: data)` to load a plan.

Run the Swift tests on macOS with Xcode 16 or newer:

```bash
swift test --package-path modules/stackreel-engine/ios
```

The tests read the plans from the [shared fixture manifest](../../fixtures/README.md), verify their hashes,
and check that encoding the decoded plans preserves the JSON values. See **Phases 2 and 3** in the
[root README](../../README.md) for composition, preview and export milestones.
