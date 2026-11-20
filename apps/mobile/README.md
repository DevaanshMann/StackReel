# StackReel mobile

StackReel opens to the iOS template gallery. **Before / After** takes two videos, and **Hook & Reveal** takes three.
Each required slot shows its minimum clip duration. Tap **Choose from Photos** or **Choose from Files** to add a
video. Use **Replace from Photos** or **Replace from Files** to swap it. The iOS Photos picker gives StackReel access
to the videos you select. Once every required slot is filled, you can play, scrub, export, and share the assembled H.264
MP4. Each template supplies its own canvas, timing, and captions.

When at least two video slots are empty, tap **Choose videos from Photos**. Pick videos in the numbered slot order
shown above the button. You can choose fewer videos and fill the remaining slots later. Slots with a saved video
or a missing-media warning are skipped. Once Photos returns the videos, StackReel checks each one against its
slot. If a video is too short or fails to import, the error names that slot. If Photos can’t return the selection,
you’ll see an error for the group. StackReel saves the videos together only after every selected video is ready.

Under **Background music**, tap **Choose music from Files** to add an optional audio file, even before adding videos.
The selected filename stays with that template’s draft. Use **Replace music** to choose another file or **Remove music**
to clear it. StackReel trims longer music to fit or loops shorter music and applies the template’s volume, fades, and
ducking where specified. Preview and export use the same mix. After adding, replacing, or removing music in a completed
draft, export a new MP4 before sharing.

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

Choose **Single-clip editor** from the gallery to select or replace a video from Photos or Files, then preview and
export it at 720 × 1280 and 30 fps. The video fits inside the vertical frame without cropping, and the export includes
the clip’s audio when present.

After exporting a single clip or a template, tap **Save to Photos** to add the MP4 to your photo library.
iOS asks for permission to add videos to Photos. You can still use **Share MP4** if you decline.

StackReel automatically saves a separate draft for each template. Open the **Projects** tab to see saved drafts and
how many videos each one has. Tap a draft to resume with its videos, trims, framing, edited text, and music.
Tap **Rename** to give a saved draft a name you can recognize in Projects. The template name is shown below it.
Tap **Delete** beside a draft and confirm to remove its edits and imported media copies. Your original files stay in
place, and the next time you open that template it starts fresh.
If an imported copy is missing, choose a replacement from Photos or Files. Export again after relaunch, or use
**Save to Files** in the share sheet to keep a finished MP4.
If StackReel can’t reopen a draft, the recovery screen preserves its saved edits and media copies. To start fresh,
delete the draft from **Projects** and open the template again.

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

1. On the Simulator, use `xcrun simctl addmedia booted /path/to/clip.mp4` to seed Photos. Prepare videos long enough
   for all slots and a video shorter than the minimum. Use **Save to Files** from the Photos share sheet to make a
   video available in Files too.
2. Open **Before / After**. Check the **Before** and **After** duration guidance and verify **Export MP4** is disabled
   until both videos are added. Open **Edit text** and check that all three fields show their defaults and limits.
   Use emoji to reach a field’s limit, then go one character past it and verify that **Apply text** is disabled.
   Enter a new **Before label** and **Caption**, clear the **After label**, and apply.
   Fill **Before** using **Choose from Photos**. Check that the picker offers videos and iOS does not request library
   access. Open **Trim** and move the slider. Play the selected segment and check its audio, then apply and confirm that
   the slot shows the new source times. Fill **After** using **Choose from Files** and confirm that **Play**, **Pause**,
   and **Video position** preview the edit across the cut.
3. Tap **Export MP4** and check the progress indicator. Tap **Save to Photos**, grant add-only access, and play the
   exported video in Photos. Repeat with Photos access denied and confirm **Share MP4** still opens the share sheet.
   Return to the draft and cancel **Replace from Files**. Use **Replace from Photos** to select the short video. Confirm
   that the previous selection and export are still available after both attempts. Replace the slot with a valid video
   from Photos and verify that the preview starts over and sharing requires a new export.
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
7. Open an empty **Hook & Reveal** draft and edit **Hook text**. Tap **Choose videos from Photos** and select a
   recognizable video for **Your hook shot**, then a short video for **B-roll**. Confirm the error names **B-roll**
   and both slots are still empty. Retry and cancel. Then pick just the hook video and check the next order is
   **B-roll**, **The reveal**. Pick two distinguishable videos in that order and verify their positions in preview.
   Relaunch, reopen the draft from **Projects**, and check the same sequence and edited text. Export and share.
8. Open **Before / After** or **Hook & Reveal** with no videos selected and choose a short audio file under
   **Background music**. Fill the video slots, check that the track loops in the preview, then listen to the exported
   MP4. Cancel **Replace music** in Files, then try a damaged audio file and check that the previous filename and
   **Share MP4** are still available. Replace the track with a longer file and check that the preview starts over and
   sharing requires a new export. Switch templates to check that their music choices are independent. Remove the music,
   check that the preview plays the clips’ own audio, and export again before sharing.
9. Open **Single-clip editor** and select a landscape video from Photos. Check for bars above and below it and export
   an MP4. Cancel **Replace from Photos** and confirm that the clip and export are still available. Use **Replace from Files**
   to select another video and confirm that sharing requires a new export. Start exporting a longer video and tap
   **Cancel export** while it is encoding. Confirm cancellation is reported and another export is available. Imported
   and exported copies are kept in the app cache. Use **Save to Files** in the share sheet to keep an MP4 outside the app.
10. On a fresh installation, open **Projects** and check that **Browse templates** opens **Templates**. Make
    different edits in each template, including a video from Photos in one draft and text only in the other. Quit and
    relaunch StackReel. Reopen both drafts from **Projects** and verify that their videos and edits are restored
    independently. Check that **Back to projects**
    returns to the list. Preview and export a restored template. In a test installation, remove one imported copy
    from the app’s `StackReelDrafts` documents folder. Relaunch, check that **Projects** marks the draft as missing
    media, and confirm the editor prompts for a replacement while the other edits remain available.
11. In **Projects**, tap **Delete** beside a draft. Cancel and check that the draft still opens. Confirm deletion,
    relaunch, and verify that the draft is gone, the other draft still opens, and the deleted template starts fresh
    from **Templates**. Check that the original files are still available in Files.

Run the app’s checks from the root with `pnpm exec turbo run lint typecheck test --filter=@stackreel/mobile`.
