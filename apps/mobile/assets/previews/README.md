# Gallery example movies

The ten scenes are original illustrations created for this gallery and cleared for distribution with Stack Reel. Each shot uses camera motion, with local foliage or water movement where appropriate.

The editable **Balcony in bloom** sample uses the same two balcony illustrations. The separate silent H.264 sources
in `../samples/` run for six and seven seconds at 720×1280 and 30 fps, leaving room to move each trim window.
The editor adds the labels, caption, and crossfade when it renders the reel.

| Movie           | Source shots in slot order                                                | Editable captions                                                                                   |
| --------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Before / After  | An empty balcony, then the same balcony in bloom                          | BEFORE · AFTER · Three pots, one summer                                                             |
| Hook & Reveal   | A basalt passage, its sunlit opening, and the hidden beach                | Follow the light                                                                                    |
| Top 5 Countdown | A fern forest, slot canyon, lupine meadow, coastal ridge, and alpine lake | 5 trails worth the hike · Fern Hollow · Sandstone Narrows · Lupine Pass · Coast Ridge · Mirror Lake |

To make a new edition, prepare silent 9:16 source clips at 30 fps covering the full duration returned by `getVideoSlots` for each slot, including transition overlap. Bind them and the captions above with `createTemplateSource` in `apps/mobile/src/template-editor.ts`. Render the resolved plan at 1080×1920 through `VideoCompositionBuilder.build` and `makeRenderComposition()` in the Swift engine. Read the 1080×1920 composited frames with AVFoundation, resize them to 540×960 using Lanczos resampling, and encode at 30 fps with libx264 High Profile, the slow preset, CRF 26, yuv420p, square pixels, and MP4 fast start. Include only the video stream.

| File                  | Duration |     Bytes |
| --------------------- | -------: | --------: |
| `before-after.mp4`    |      8 s |   784,940 |
| `hook-and-reveal.mp4` |      9 s |   822,919 |
| `top-5-countdown.mp4` |     25 s | 2,226,467 |

To check a replacement, decode all frames, verify a single H.264 video stream, and inspect the midpoint of each crossfade or slide alongside the settled captions.
