# @stackreel/ui

Shared design tokens for the StackReel apps: color, type, spacing, radii, elevation, z-index, motion, layout and
safe zones. Every platform reads from this one source.

For now the package is tokens only: plain typed TypeScript constants (`as const`), a generated CSS file and
safe-zone overlay SVGs. It has no React dependency. Cross-platform UI primitives come later.

## Usage

```ts
import { themes, DEFAULT_THEME, space, radius, fontSize, motionFor, safeZones, MIN_HIT_TARGET } from "@stackreel/ui";

const colors = themes[DEFAULT_THEME]; // "dark"

const buttonStyle = {
  backgroundColor: colors.accent,
  color: colors.onAccent,
  paddingHorizontal: space[4],
  borderRadius: radius.md,
  minHeight: MIN_HIT_TARGET,
  fontSize: fontSize.md,
};

// Respect the OS reduced-motion setting (AccessibilityInfo.isReduceMotionEnabled() in React Native).
const { duration, easing } = motionFor(prefersReducedMotion);
```

On the web and desktop, import the generated stylesheet and use the custom properties:

```ts
import "@stackreel/ui/tokens.css";
```

```css
.panel {
  background: var(--sr-color-surface);
  color: var(--sr-color-text);
  padding: var(--sr-space-4);
  border-radius: var(--sr-radius-lg);
  transition: opacity var(--sr-duration-normal) var(--sr-easing-standard);
}
```

`:root` holds the dark theme. Set `data-theme="light"` on `<html>` (or any element) to switch to light. Under
`prefers-reduced-motion: reduce`, every duration becomes `0ms`. `cssVar("color", "textMuted")` returns a property
name (`--sr-color-text-muted`) if you need one in code.

## Color

The editor is dark-first, so `dark` is the default theme. Values come from two scales, `neutral` (cool gray) and
`accent` (a warm pink-red), plus short `red`, `green` and `amber` scales for status colors. All are exported as
`palette`.

| Role        | Use                                    | Dark      | Light     |
| ----------- | -------------------------------------- | --------- | --------- |
| `bg`        | App background                         | `#111115` | `#FFFFFF` |
| `surface`   | Panels, sheets, the timeline           | `#1C1C22` | `#F7F7F8` |
| `elevated`  | Menus, popovers, cards above a surface | `#2B2B33` | `#FFFFFF` |
| `text`      | Body text                              | `#F7F7F8` | `#111115` |
| `textMuted` | Secondary text                         | `#9A9AA8` | `#5C5C6A` |
| `border`    | Dividers and outlines (decorative)     | `#42424D` | `#DCDCE2` |
| `accent`    | Primary actions, selection, focus      | `#FF5C99` | `#D61A63` |
| `onAccent`  | Text and icons on an `accent` fill     | `#111115` | `#FFFFFF` |
| `danger`    | Errors and destructive actions         | `#FF6B63` | `#D92D20` |
| `success`   | Success states                         | `#3DD68C` | `#13824A` |
| `warning`   | Warnings                               | `#FFC53D` | `#934D00` |

| Scale     | 50        | 100       | 200       | 300       | 400       | 500       | 600       | 700       | 800       | 900       | 950       |
| --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- |
| `neutral` | `#F7F7F8` | `#EEEEF1` | `#DCDCE2` | `#BDBDC7` | `#9A9AA8` | `#787887` | `#5C5C6A` | `#42424D` | `#2B2B33` | `#1C1C22` | `#111115` |
| `accent`  | `#FFF0F5` | `#FFE0EC` | `#FFC2D9` | `#FF94BC` | `#FF5C99` | `#F2337A` | `#D61A63` | `#B0104F` | `#8A0D3F` | `#660A2F` | `#3D0519` |

`neutral[0]` is `#FFFFFF`.

### Contrast

[`test/contrast.test.ts`](test/contrast.test.ts) computes the WCAG 2.x contrast ratio of every foreground role on
`bg`, `surface` and `elevated`, in both themes. `text` and `textMuted` need at least 4.5:1 (body text). `accent` and
the status colors need at least 3:1 (large text and UI components), and `onAccent` on `accent` needs 4.5:1.
Current ratios (on `bg` / `surface` / `elevated`):

| Foreground         | Dark                  | Light                 |
| ------------------ | --------------------- | --------------------- |
| `text`             | 17.59 / 15.84 / 13.11 | 18.84 / 17.59 / 18.84 |
| `textMuted`        | 6.78 / 6.11 / 5.05    | 6.57 / 6.14 / 6.57    |
| `accent`           | 6.50 / 5.85 / 4.84    | 5.02 / 4.68 / 5.02    |
| `danger`           | 6.76 / 6.08 / 5.04    | 4.83 / 4.51 / 4.83    |
| `success`          | 10.04 / 9.04 / 7.48   | 4.86 / 4.54 / 4.86    |
| `warning`          | 11.94 / 10.74 / 8.89  | 6.36 / 5.94 / 6.36    |
| `onAccent` on fill | 6.50                  | 5.02                  |

`border` is decorative and isn't checked. Don't use it as the only way to show a control's edge.

## Typography

Inter is the UI font (`fontFamily.ui`). Template fonts belong to templates, not the UI. `fontStack` has CSS fallback
stacks.

| `fontSize` | `xs` | `sm` | `md` | `lg` | `xl` | `2xl` | `3xl` | `4xl` |
| ---------- | ---- | ---- | ---- | ---- | ---- | ----- | ----- | ----- |
| points     | 12   | 14   | 16   | 18   | 20   | 24    | 30    | 36    |

| `fontWeight` | `regular` | `medium` | `semibold` | `bold` |
| ------------ | --------- | -------- | ---------- | ------ |
|              | 400       | 500      | 600        | 700    |

`lineHeight` is unitless: `tight` 1.2, `snug` 1.35, `normal` 1.5. React Native needs absolute line heights, so
multiply by the font size there.

## Spacing, radii, elevation and layers

`space[n]` is `n × 4` points: `0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16` → `0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

| `radius` | `none` | `sm` | `md` | `lg` | `xl` | `full` |
| -------- | ------ | ---- | ---- | ---- | ---- | ------ |
| points   | 0      | 4    | 8    | 12   | 16   | 9999   |

`elevation[0–3]` gives `offsetY`, `blur`, `opacity` (of black) and `androidElevation`. Shadows barely show on the dark
theme, so pair each level with the `elevated` color.

`zIndex`, lowest first: `base` 0, `canvasOverlay` 10, `sticky` 100, `dropdown` 200, `sheet` 300, `modal` 400,
`toast` 500, `tooltip` 600.

## Motion

| `duration` | `instant` | `fast` | `normal` | `slow` |
| ---------- | --------- | ------ | -------- | ------ |
| ms         | 0         | 120    | 200      | 320    |

`easing` curves are `[x1, y1, x2, y2]`, the same as CSS `cubic-bezier()`: `standard` (most transitions),
`decelerate` (entering), `accelerate` (leaving) and `linear`. `reducedMotion` has the same shape with every
duration at 0 and linear easing. `motionFor(prefersReducedMotion)` picks one.

## Layout

- `MIN_HIT_TARGET`: 44 points, the smallest tap target.
- `canvas`: 1080×1920, `aspectRatio` 9 / 16.

## Safe zones

`safeZones` gives normalized insets (fractions of the canvas edge, 0–1) for the areas each platform's UI covers.
Keys match the template schema's `safeZones.preset` enum, and a test fails if they drift apart.
`safeZoneInsetsPx(insets, width, height)` converts to pixels.

| Preset                | Top  | Bottom | Left | Right |
| --------------------- | ---- | ------ | ---- | ----- |
| `none`                | 0    | 0      | 0    | 0     |
| `tiktok`              | 0.08 | 0.20   | 0.06 | 0.13  |
| `instagram-reels`     | 0.10 | 0.22   | 0.05 | 0.11  |
| `youtube-shorts`      | 0.07 | 0.20   | 0.05 | 0.15  |
| `tiktok-reels-shorts` | 0.10 | 0.22   | 0.06 | 0.15  |

`tiktok-reels-shorts` is the largest inset on each side, so it's safe on all three. The values are approximate,
taken from public creator guidance, and need checking on real devices. Platforms change their UI often.

### Safe-zone overlays

[`overlays/`](overlays/) has a 1080×1920 SVG for every preset except `none`: `tiktok.svg`, `instagram-reels.svg`,
`youtube-shorts.svg` and `tiktok-reels-shorts.svg`. The top and bottom bands and the left and right strips (the right
one is the button column) are shaded, and a dashed line runs just outside the safe area. Import one as
`@stackreel/ui/overlays/tiktok.svg`. `pnpm build` regenerates them with `renderSafeZoneOverlaySvg(preset)`, so change
`safeZones` rather than the files. A test fails if a committed file is out of date.

In the editor, draw the overlay over the preview, between the video and the editing handles (`zIndex.canvasOverlay`).
`safeZoneRegions(insets, width, height)` gives the shaded bands and the safe area as pixel rects for any size, so it
also works with a template's `safeZones.insets` override. `safeZoneOverlayStyle` has the colors, or render the SVG
with `renderSafeZoneOverlaySvg(preset, width, height)`.

```ts
import { safeZoneRegions, safeZones } from "@stackreel/ui";

const { top, bottom, left, right, safe } = safeZoneRegions(safeZones.tiktok, previewWidth, previewHeight);
```

When designing a template, put the SVG on top of a 1080×1920 frame in Figma (or similar) and lock it. Keep text,
faces and anything else important out of the shaded areas. Use `tiktok-reels-shorts.svg` unless the template is for
one platform only. The overlays use the same approximate values as the table above, so check on real devices too.

## Scripts

- `pnpm build`: compiles `dist/`, writes `dist/tokens.css` and regenerates `overlays/*.svg`
- `pnpm test`: runs the tests with coverage
- `pnpm typecheck`, `pnpm lint`
