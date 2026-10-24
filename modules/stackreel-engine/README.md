# stackreel-engine (Expo native module)

The hardware-accelerated render engine, exposed to React Native through the **Expo Modules API**.

| Platform | Composition | Effects / compositing | Encode |
|---|---|---|---|
| iOS (`ios/`) | `AVMutableComposition` | Custom `AVVideoCompositing` + Metal | `AVAssetWriter` (VideoToolbox HEVC/H.264) |
| Android (`android/`) | Media3 `Composition` | Media3 `Effect` / `OverlayEffect` (GL) | Media3 `Transformer` (MediaCodec) |

Both engines take the same **render plan** (from `@stackreel/core`) and must pass the same golden-frame tests.

Not set up yet. See **Phases 2 and 3** in the [root README](../../README.md).
