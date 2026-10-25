import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OVERLAY_PRESETS, OVERLAYS_DIR, overlayFileName, renderOverlayFile } from "./render-overlays.js";

await mkdir(OVERLAYS_DIR, { recursive: true });
for (const preset of OVERLAY_PRESETS) {
  const file = join(OVERLAYS_DIR, overlayFileName(preset));
  await writeFile(file, renderOverlayFile(preset));
  console.log(`Wrote ${file}`);
}
