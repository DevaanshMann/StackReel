# StackReel mobile

Choose one local video from Files, preview and scrub it, then export and share a 720 × 1280 H.264 MP4 at 30 fps.
The video fits inside the vertical frame without cropping, and the export includes the clip’s audio when present.

## Run on iOS

Use macOS with Xcode, an iOS Simulator or a connected device, CocoaPods, and the repository’s Node and pnpm versions.
Run these commands from the repository root with the [Expo bridge workspace](../../modules/stackreel-engine) present.

```sh
pnpm install --frozen-lockfile
pnpm --filter @stackreel/mobile ios
```

Add `--device` to select a specific simulator or connected device. The command builds the shared TypeScript packages,
generates the iOS project, compiles the native development build, and starts Metro. After the first install, use
`pnpm --filter @stackreel/mobile start` for JavaScript and TypeScript development. Rebuild after changing native dependencies.

Expo Go cannot load the StackReel engine. Android and web display an unsupported-platform screen. The generated
`apps/mobile/ios` and `apps/mobile/android` projects are ignored. To generate iOS project files without building, run
`pnpm --filter @stackreel/mobile exec expo prebuild --platform ios --no-install`.

## Smoke test

1. On the Simulator, use `xcrun simctl addmedia booted /path/to/clip.mp4` to seed Photos. In Photos, share the video and use **Save to Files**.
2. In StackReel, tap **Choose video** and select the clip. Check that **Play** and **Pause** work, the playhead advances,
   and dragging or tapping **Video position** seeks the preview. A landscape clip should show bars above and below the image.
3. Tap **Export MP4** and check that progress appears. For cancellation, use a longer clip and tap **Cancel export**
   while it is encoding. The screen should report cancellation and allow another export.
4. Export again, tap **Share MP4**, then use **Save to Files** in the native share sheet. Open the saved MP4 and verify
   the picture and audio. Use **Replace video** to choose another clip and repeat the flow. Imported and exported
   files live in app storage until shared or saved elsewhere.

Run the app’s checks from the root with `pnpm exec turbo run lint typecheck test --filter=@stackreel/mobile`.
