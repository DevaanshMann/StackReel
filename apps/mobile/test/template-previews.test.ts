import { expect, it } from "vitest";
import { mobileTemplates } from "../src/template-editor";
import { templatePreviews } from "../src/template-previews";

it.each(mobileTemplates)("bundles the matching gallery movie for $name", ({ id }) => {
  // Vite resolves the same static import to a URL that Metro resolves to a native asset ID.
  expect(templatePreviews[id]).toEqual(expect.stringContaining(`/assets/previews/${id}.mp4`));
});
