# StackReel brand assets

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./wordmark-dark.svg">
  <img alt="StackReel" src="./wordmark-light.svg" width="244">
</picture>

The two halves of the S represent stacked clips. Use [the light-background wordmark](wordmark-light.svg) on white
and [the dark-background wordmark](wordmark-dark.svg) on dark surfaces. The lettering uses outlines from the
bundled Inter Bold font. [Inter license](../../modules/stackreel-engine/ios/Sources/StackReelComposition/Resources/Fonts/Inter-OFL.txt)

## App icons

[icon.svg](icon.svg) is the master. Keep its square canvas and full-bleed background when exporting the
[1024 px iOS icon](ios/icon-1024.png), the [512 px Google Play icon](android/google-play-512.png), and the
Android launcher icons. Use an opaque RGB PNG for iOS and an opaque 32-bit sRGB PNG for Google Play.

The Android exports in `android/mipmap-*` use these square canvas sizes in pixels.

| Asset                        | mdpi | hdpi | xhdpi | xxhdpi | xxxhdpi |
| ---------------------------- | ---: | ---: | ----: | -----: | ------: |
| `ic_launcher.png`            |   48 |   72 |    96 |    144 |     192 |
| `ic_launcher_foreground.png` |  108 |  162 |   216 |    324 |     432 |

To export the adaptive foreground, hide the background rectangle in the master and set the SVG viewBox to
`-256 -256 1536 1536`. This centers both clips inside Android’s mask safe zone. The gap between the clips is
transparent so the mark also works as a single-color themed icon.

The [Expo config](../../apps/mobile/app.json) uses the 1024 px icon for iOS and Android fallback launchers.
For adaptive icons it pairs the 432 px foreground with the `#111115` background and reuses the foreground’s
alpha channel for themed launchers. Expo generates the native asset catalogs and resources during prebuild.

After changing the exports, copy the 1024 px icon to `apps/mobile/assets/icon.png` and the 432 px foreground to
`apps/mobile/assets/icon-foreground.png`. Keeping these two files inside the Expo project lets Metro serve them
to the development client. The mobile tests check that they match the brand exports.
