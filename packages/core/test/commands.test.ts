import { describe, expect, it } from "vitest";
import {
  CommandError,
  applyCommand,
  canRedo,
  canUndo,
  createHistory,
  createProject,
  redo,
  undo,
  validateProject,
  type Command,
  type History,
  type Project,
} from "../src/index.js";
import { testTemplate } from "./helpers.js";

const fresh = (limit?: number): History =>
  createHistory(createProject(testTemplate()), limit === undefined ? {} : { limit });

const replace = (slotId: string, assetUri = `file:///${slotId}.mp4`): Command => ({
  type: "ReplaceSlotAsset",
  slotId,
  assetUri,
  trimInUs: 0,
  trimOutUs: 3_000_000,
});

const applyAll = (history: History, commands: Command[]) => commands.reduce(applyCommand, history);

/** A sequence that uses every command. */
const everyCommand: Command[] = [
  replace("clip1"),
  { type: "SetTrim", slotId: "clip1", trimInUs: 1_000_000, trimOutUs: 4_000_000 },
  { type: "SetCrop", slotId: "clip1", crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } },
  replace("photo", "ph://1"),
  { type: "EditText", target: "title", text: "Hi" },
  { type: "EditText", target: "captions/0", text: "Look" },
  { type: "SetTextStyle", target: "captions/0", style: { color: "#00FF00" } },
  { type: "SetTextStyle", target: "captions/0", style: { sizePx: 50 } },
  { type: "ClearSlot", slotId: "photo" },
  { type: "SetCrop", slotId: "clip1", crop: null },
  { type: "EditText", target: "title", text: null },
  { type: "SetTextStyle", target: "captions/0", style: null },
  replace("music", "file:///song.m4a"),
];

describe("commands", () => {
  it("apply each edit to the project", () => {
    let h = fresh();
    h = applyAll(h, everyCommand.slice(0, 8));
    expect(h.project.bindings).toEqual({
      clip1: {
        assetUri: "file:///clip1.mp4",
        trimInUs: 1_000_000,
        trimOutUs: 4_000_000,
        crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      },
      photo: { assetUri: "ph://1", trimInUs: 0, trimOutUs: 3_000_000 },
    });
    expect(h.project.overrides).toEqual({
      text: { title: "Hi", "captions/0": "Look" },
      style: { "captions/0": { color: "#00FF00", sizePx: 50 } },
    });

    h = applyAll(h, everyCommand.slice(8));
    expect(h.project.bindings).toEqual({
      clip1: { assetUri: "file:///clip1.mp4", trimInUs: 1_000_000, trimOutUs: 4_000_000 },
      music: { assetUri: "file:///song.m4a", trimInUs: 0, trimOutUs: 3_000_000 },
    });
    expect(h.project.overrides).toEqual({ text: { "captions/0": "Look" }, style: {} });
    expect(validateProject(h.project).ok).toBe(true);
  });

  it("keep the project frozen and never mutate earlier states", () => {
    const start = fresh();
    const next = applyCommand(start, replace("clip1"));
    expect(Object.isFrozen(start.project)).toBe(true);
    expect(Object.isFrozen(next.project.bindings["clip1"])).toBe(true);
    expect(start.project.bindings).toEqual({});
    expect(next.project.template).toBe(start.project.template); // unchanged parts are shared
  });

  it.each<[Command, string]>([
    [replace("ghost"), 'ReplaceSlotAsset: Unknown slot "ghost"'],
    [replace("title"), 'ReplaceSlotAsset: Slot "title" is a text slot; set its text with an override'],
    [replace("clip1", ""), "ReplaceSlotAsset: /assetUri: Too small: expected string to have >=1 characters"],
    [{ ...replace("clip1"), trimInUs: 5, trimOutUs: 5 } as Command, "ReplaceSlotAsset: trimOutUs (5) must be after"],
    [{ ...replace("clip1"), trimInUs: -5 } as Command, "ReplaceSlotAsset: /trimInUs:"],
    [
      { ...replace("clip1"), crop: { x: 0.9, y: 0, width: 0.2, height: 1 } } as Command,
      "ReplaceSlotAsset: Crop extends past the right edge",
    ],
    [{ type: "SetTrim", slotId: "clip1", trimInUs: 0, trimOutUs: 1 }, 'SetTrim: Slot "clip1" has no media'],
    [{ type: "SetCrop", slotId: "photo", crop: null }, 'SetCrop: Slot "photo" has no media'],
    [{ type: "ClearSlot", slotId: "ghost" }, 'ClearSlot: Unknown slot "ghost"'],
    [{ type: "EditText", target: "captions/2", text: "x" }, 'EditText: Text item "captions/2" is not editable'],
    [{ type: "EditText", target: "title", text: "Way too long" }, "EditText: Text is longer than maxChars (10)"],
    [{ type: "SetTextStyle", target: "title", style: {} }, 'SetTextStyle: No text item at "title"'],
    [{ type: "SetTextStyle", target: "captions/0", style: { sizePx: 0 } }, "SetTextStyle: /sizePx:"],
  ])("reject invalid edits without changing anything: %o", (command, message) => {
    const start = fresh();
    expect(() => applyCommand(start, command)).toThrow(CommandError);
    expect(() => applyCommand(start, command)).toThrow(message);
    expect(start.project.bindings).toEqual({});
  });

  it("reject bad trims and crops on a bound slot", () => {
    const h = applyCommand(fresh(), replace("clip1"));
    const badTrim: Command = { type: "SetTrim", slotId: "clip1", trimInUs: 2, trimOutUs: 1 };
    expect(() => applyCommand(h, badTrim)).toThrow("SetTrim: trimOutUs (1) must be after trimInUs (2)");
    const badCrop: Command = { type: "SetCrop", slotId: "clip1", crop: { x: 0, y: 0.5, width: 1, height: 0.6 } };
    expect(() => applyCommand(h, badCrop)).toThrow("SetCrop: Crop extends past the bottom edge");
    const zeroCrop: Command = { type: "SetCrop", slotId: "clip1", crop: { x: 0, y: 0, width: 1, height: 0 } };
    expect(() => applyCommand(h, zeroCrop)).toThrow("SetCrop: /height:");
    try {
      applyCommand(h, badTrim);
    } catch (error) {
      expect((error as CommandError).command).toBe(badTrim);
    }
  });
});

describe("undo / redo", () => {
  it("starts with nothing to undo or redo", () => {
    const h = fresh();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("walks back through every state in order, then forward again", () => {
    const states: Project[] = [];
    let h = fresh();
    states.push(h.project);
    for (const command of everyCommand) {
      h = applyCommand(h, command);
      states.push(h.project);
    }
    expect(h.past).toHaveLength(everyCommand.length);

    for (let i = states.length - 2; i >= 0; i--) {
      h = undo(h);
      expect(h.project).toEqual(states[i]);
    }
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(true);

    for (let i = 1; i < states.length; i++) {
      h = redo(h);
      expect(h.project).toEqual(states[i]);
    }
    expect(canRedo(h)).toBe(false);
    expect(h.past.map((e) => e.command)).toEqual(everyCommand);
  });

  it("gives back the same project after undo then redo, at every step", () => {
    let h = fresh();
    for (const command of everyCommand) {
      h = applyCommand(h, command);
      const before = h.project;
      h = redo(undo(h));
      expect(h.project).toEqual(before);
      expect(canRedo(h)).toBe(false);
    }
  });

  it("undoes a replace back to the previous asset, not to empty", () => {
    let h = applyAll(fresh(), [replace("clip1", "a"), replace("clip1", "b")]);
    h = undo(h);
    expect(h.project.bindings["clip1"]?.assetUri).toBe("a");
    h = undo(h);
    expect(h.project.bindings["clip1"]).toBeUndefined();
  });

  it("clears the redo stack when a new command is applied", () => {
    let h = applyAll(fresh(), [replace("clip1", "a"), replace("clip1", "b")]);
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = applyCommand(h, replace("photo"));
    expect(canRedo(h)).toBe(false);
    expect(redo(h)).toBe(h);
    expect(h.project.bindings["clip1"]?.assetUri).toBe("a");
    h = undo(undo(h));
    expect(h.project.bindings).toEqual({});
  });

  it("interleaves undo and redo correctly", () => {
    let h = applyAll(fresh(), [
      { type: "EditText", target: "title", text: "One" },
      { type: "EditText", target: "title", text: "Two" },
      { type: "EditText", target: "title", text: "Three" },
    ]);
    const title = () => h.project.overrides.text["title"];
    h = undo(h);
    expect(title()).toBe("Two");
    h = undo(h);
    expect(title()).toBe("One");
    h = redo(h);
    expect(title()).toBe("Two");
    h = undo(undo(h));
    expect(title()).toBeUndefined();
    h = redo(redo(redo(h)));
    expect(title()).toBe("Three");
    expect(canRedo(h)).toBe(false);
  });

  it("doesn't record commands that change nothing", () => {
    const h = applyCommand(fresh(), { type: "EditText", target: "title", text: "Hi" });
    expect(applyCommand(h, { type: "EditText", target: "title", text: "Hi" })).toBe(h);
    expect(applyCommand(h, { type: "ClearSlot", slotId: "clip1" })).toBe(h);
    const undone = undo(h);
    expect(applyCommand(undone, { type: "EditText", target: "captions/0", text: null })).toBe(undone);
    expect(canRedo(undone)).toBe(true);
  });

  it("projects stay valid through any undo and redo", () => {
    let h = applyAll(fresh(), everyCommand);
    for (let i = 0; i < everyCommand.length; i++) {
      h = undo(h);
      expect(validateProject(h.project).ok).toBe(true);
    }
  });
});

describe("history limit", () => {
  it("keeps only the newest steps", () => {
    let h = fresh(2);
    h = applyAll(h, [replace("clip1", "a"), replace("clip1", "b"), replace("clip1", "c")]);
    expect(h.past).toHaveLength(2);
    h = undo(undo(h));
    expect(canUndo(h)).toBe(false);
    expect(h.project.bindings["clip1"]?.assetUri).toBe("a");
    h = redo(redo(h));
    expect(h.project.bindings["clip1"]?.assetUri).toBe("c");
  });

  it("is kept across edits", () => {
    const h = applyCommand(fresh(1), replace("clip1"));
    expect(h.limit).toBe(1);
    expect(fresh().limit).toBeUndefined();
    expect("limit" in fresh()).toBe(false);
  });

  it("must be a positive integer", () => {
    const project = createProject(testTemplate());
    expect(() => createHistory(project, { limit: 0 })).toThrow(RangeError);
    expect(() => createHistory(project, { limit: 1.5 })).toThrow(/positive integer/);
  });
});
