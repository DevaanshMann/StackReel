import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expo } from "../app.json";

const app = new URL("../", import.meta.url);
const brand = new URL("../../assets/brand/", app);

it.each([
  [expo.icon, "ios/icon-1024.png"],
  [expo.android.adaptiveIcon.foregroundImage, "android/mipmap-xxxhdpi/ic_launcher_foreground.png"],
])("ships the brand export at %s", (appPath, brandPath) => {
  expect(readFileSync(new URL(appPath, app))).toEqual(readFileSync(new URL(brandPath, brand)));
});
