# StackReel mobile

StackReel opens to the iOS template gallery. **Before / After** takes two videos, and **Hook & Reveal** takes three.
Each required slot shows its minimum clip duration. Select or replace videos from Files, then play, scrub, export,
and share the assembled H.264 MP4 once every required slot is filled. Each template supplies its own canvas,
timing, and captions.

Tap **Edit text** to change a template’s captions and labels, even before adding videos. The editor shows the current
wording, the template defaults, and character counts for fields with limits. Clear a field to hide that overlay.
Tap **Apply text** to save the wording, **Cancel** to discard your changes, or **Reset** followed by **Apply text**
to restore the template defaults. The wording stays with that template’s draft as you replace, trim, or reframe its
clips. Applied changes update preview and require a new export before sharing.

Each filled slot shows its current start and end times within the source video. Tap **Trim** to move the fixed-length
window in whole-frame steps and play the selected segment with its audio. You can trim as soon as a slot has a video.
Tap **Apply trim** to save the window, or **Cancel** to keep the current selection. If you change the window, export
the template again before sharing.

Tap **Reframe** on any filled slot to see its selected segment in the template’s vertical canvas. Drag the video or
pinch to zoom up to 3×. The **Zoom**, **Horizontal position**, and **Vertical position** sliders make the same adjustments.
**Reset** restores the centered framing. Tap **Apply** to save the framing for that slot, or **Cancel** to discard your
changes. If you apply a different framing, export the template again before sharing.

Choose **Single-clip editor** from the gallery to preview and export one local video at 720 × 1280 and 30 fps.
The video fits inside the vertical frame without cropping, and the export includes the clip’s audio when present.
You can return to the gallery and reopen a draft during the same app session.

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

1. On the Simulator, use `xcrun simctl addmedia booted /path/to/clip.mp4` to seed Photos. In Photos, share the videos and
   use **Save to Files**. Prepare clips long enough for all slots and a clip shorter than the minimum.
2. Open **Before / After**. Check the **Before** and **After** duration guidance and verify **Export MP4** is disabled
   until both videos are added. Open **Edit text** and check that all three fields show their defaults and limits.
   Use emoji to reach a field’s limit, then go one character past it and verify that **Apply text** is disabled.
   Enter a new **Before label** and **Caption**, clear the **After label**, and apply.
   Fill **Before**, open **Trim**, and move the slider. Play the selected segment and check
   its audio, then apply and confirm the slot shows the new source times. Fill **After** and confirm that **Play**,
   **Pause**, and **Video position** preview the edit across the cut.
3. Tap **Export MP4** and check the progress indicator. Tap **Share MP4** and save the video from the share sheet. Return
   to the draft and cancel a replacement in Files, then try replacing a slot with the short clip. Confirm the previous
   selection and export are still available after both attempts. Replace the slot with a valid clip and verify that
   the preview starts over and sharing requires a new export.
4. Export the draft and reopen **Trim**. Move the slider and cancel, then reopen and apply the existing window. Check
   that **Share MP4** is still available after each action. Apply a different window and confirm the template preview
   returns to the beginning and sharing requires another export. Try **Trim** on a video that has exactly the required
   number of frames and check the disabled slider and its explanation.
5. In a draft with one filled slot, open **Reframe** on a landscape video. Use a silent clip with visible detail on both
   sides. Drag horizontally, pinch to zoom, and try the three sliders. Apply the framing, add the remaining videos,
   and compare the template preview and exported MP4 with the framing you chose. Reopen **Reframe** to check that the
   values persisted. Make a change and cancel, then reopen and apply the current framing. Check that **Share MP4** is
   still available. Reset and apply, then check that the preview is centered and sharing requires a new export.
6. In **Before / After**, check that the edited overlays and the hidden **After label** match in the preview and in
   an MP4 exported from silent clips. Edit a field and cancel, then reopen and apply the current wording. Check that
   **Share MP4** is still available both times. Tap **Back to templates**, reopen **Before / After**, and verify that
   the edits are still there. Reset and apply, then verify that the original text returns and sharing requires a new export.
7. Open **Hook & Reveal** and edit **Hook text**. Fill all three slots, check the canvas metadata and preview,
   then export and share. Open the saved MP4s to check picture and audio.
8. Open **Single-clip editor** and select a landscape video. Check for bars above and below it. To test cancellation,
   start exporting a longer video and tap **Cancel export** while it is encoding. Confirm cancellation is reported
   and another export is available. Imported and exported copies are kept in the app cache. Use **Save to Files**
   in the share sheet to keep an MP4 outside the app.

Run the app’s checks from the root with `pnpm exec turbo run lint typecheck test --filter=@stackreel/mobile`.
