import { describe, expect, it } from "vitest";
import { getDraftProjects, nextDraftName } from "../src/draft-names";

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

describe("project delete labels", () => {
  const choices = [
    { template: { id: "before", name: "Before / After" } },
    { template: { id: "travel", name: "Travel" } },
  ];

  it("uses the full library for filtered projects and updates after renames and deletes", () => {
    const before = { saved: { name: "Launch" } };
    const original = { before, travel: { saved: { name: "launch" } } };
    const renamed = { before, travel: { saved: { name: "Travel" } } };
    const deleted = { before };
    expect(getDraftProjects(choices, original, "before").map((project) => project.deleteTarget)).toEqual([
      "“Launch” from Before / After",
    ]);
    expect(getDraftProjects(choices, original, "travel")[0]?.deleteTarget).toBe("“launch” from Travel");
    for (const library of [renamed, deleted]) {
      expect(getDraftProjects(choices, library, "before")[0]?.deleteTarget).toBe("Launch draft");
    }
  });

  it("numbers same-template names by stable ID and includes fallback names in collisions", () => {
    const drafts = { travel: { z: {}, a: { name: "TRAVEL" } } };
    const projects = getDraftProjects(choices, drafts);
    expect(projects.map(({ draftId, deleteTarget }) => [draftId, deleteTarget])).toEqual([
      ["z", "“Travel (2 of 2)” from Travel"],
      ["a", "“TRAVEL (1 of 2)” from Travel"],
    ]);
    const remaining = { before: { b: { name: "travel" } }, travel: { z: {} } };
    expect(getDraftProjects(choices, remaining).map((project) => project.deleteTarget)).toEqual([
      "“travel” from Before / After",
      "“Travel” from Travel",
    ]);
  });
});
