import { describe, expect, it } from "vitest";
import { nextDraftName } from "../src/draft-names";

describe("draft names", () => {
  it("uses the saved name and numbers repeat copies across case differences", () => {
    const siblings = { original: { name: "First cut" }, other: { name: "FIRST CUT COPY 2" } };
    expect(nextDraftName("Before / After", siblings, "First cut")).toBe("First cut copy");
    expect(nextDraftName("Before / After", { ...siblings, copy: { name: "First cut copy" } }, "First cut")).toBe(
      "First cut copy 3",
    );
  });

  it("keeps the template's numbering for new blank drafts and uses its name for an unnamed original", () => {
    expect(nextDraftName("Travel", {})).toBe("Travel");
    expect(nextDraftName("Travel", { renamed: { name: "Summer" } })).toBe("Travel 2");
    expect(nextDraftName("Travel", { legacy: {} }, "Travel")).toBe("Travel copy");
  });
});
