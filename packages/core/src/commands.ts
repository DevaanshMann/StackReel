import { toJsonPointer } from "@stackreel/template-schema";
import { applyPatches, enablePatches, freeze, produceWithPatches, type Draft, type Patch } from "immer";
import type { z } from "zod";
import {
  Crop,
  SlotBinding,
  StyleOverride,
  checkBinding,
  checkCrop,
  checkStyleOverride,
  checkTextOverride,
  checkTrim,
  type Project,
} from "./project.js";

enablePatches();

/** Puts new media in a slot, replacing whatever was there. */
export interface ReplaceSlotAsset {
  type: "ReplaceSlotAsset";
  slotId: string;
  assetUri: string;
  trimInUs: number;
  trimOutUs: number;
  crop?: Crop;
}

/** Changes the part of a slot's media that plays. The slot must already have media. */
export interface SetTrim {
  type: "SetTrim";
  slotId: string;
  trimInUs: number;
  trimOutUs: number;
}

/** Sets or removes (`null`) the crop of a slot's media. The slot must already have media. */
export interface SetCrop {
  type: "SetCrop";
  slotId: string;
  crop: Crop | null;
}

/** Removes the media from a slot. */
export interface ClearSlot {
  type: "ClearSlot";
  slotId: string;
}

/** Replaces the text of a text slot or editable text item. `null` goes back to the template's text. */
export interface EditText {
  type: "EditText";
  /** A text slot id, or an item key such as `"captions/0"` (see `itemKey`). */
  target: string;
  text: string | null;
}

/** Sets style fields on a text item, merged over the template's style. `null` removes every tweak. */
export interface SetTextStyle {
  type: "SetTextStyle";
  /** An item key such as `"captions/0"`. */
  target: string;
  style: StyleOverride | null;
}

/** Every edit to a project. Each one can be undone. */
export type Command = ReplaceSlotAsset | SetTrim | SetCrop | ClearSlot | EditText | SetTextStyle;

/** Thrown when a command doesn't fit the project, such as a trim that ends before it starts. Nothing is changed. */
export class CommandError extends Error {
  readonly command: Command;

  constructor(command: Command, message: string) {
    super(`${command.type}: ${message}`);
    this.name = "CommandError";
    this.command = command;
  }
}

function parseOrThrow<T>(command: Command, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0]!;
  throw new CommandError(command, `${toJsonPointer(issue.path) || "/"}: ${issue.message}`);
}

function boundSlot(command: Command, draft: Draft<Project>, slotId: string): Draft<SlotBinding> {
  const binding = draft.bindings[slotId];
  if (!binding) throw new CommandError(command, `Slot "${slotId}" has no media`);
  return binding;
}

/** Applies one command to a draft. Throws `CommandError` before changing anything if the command is invalid. */
function run(draft: Draft<Project>, command: Command): void {
  const fail = (message: string | null) => {
    if (message !== null) throw new CommandError(command, message);
  };
  const template = draft.template;

  switch (command.type) {
    case "ReplaceSlotAsset": {
      const { slotId, assetUri, trimInUs, trimOutUs, crop } = command;
      const input = { assetUri, trimInUs, trimOutUs, ...(crop !== undefined && { crop }) };
      const binding = parseOrThrow(command, SlotBinding, input);
      fail(checkBinding(template, slotId, binding));
      draft.bindings[slotId] = binding;
      return;
    }
    case "SetTrim": {
      const binding = boundSlot(command, draft, command.slotId);
      fail(checkTrim(command.trimInUs, command.trimOutUs));
      binding.trimInUs = command.trimInUs;
      binding.trimOutUs = command.trimOutUs;
      return;
    }
    case "SetCrop": {
      const binding = boundSlot(command, draft, command.slotId);
      if (command.crop === null) {
        delete binding.crop;
        return;
      }
      const crop = parseOrThrow(command, Crop, command.crop);
      fail(checkCrop(crop));
      binding.crop = crop;
      return;
    }
    case "ClearSlot":
      if (!template.slots.some((s) => s.id === command.slotId)) fail(`Unknown slot "${command.slotId}"`);
      delete draft.bindings[command.slotId];
      return;
    case "EditText":
      if (command.text === null) {
        delete draft.overrides.text[command.target];
        return;
      }
      fail(checkTextOverride(template, command.target, command.text));
      draft.overrides.text[command.target] = command.text;
      return;
    case "SetTextStyle": {
      if (command.style === null) {
        delete draft.overrides.style[command.target];
        return;
      }
      fail(checkStyleOverride(template, command.target));
      const style = parseOrThrow(command, StyleOverride, command.style);
      draft.overrides.style[command.target] = { ...draft.overrides.style[command.target], ...style };
      return;
    }
  }
}

/** One undoable step: the command, and the patches that redo and undo it. */
export interface HistoryEntry {
  command: Command;
  patches: Patch[];
  inversePatches: Patch[];
}

/**
 * A project plus its undo and redo stacks. It is immutable: every function returns a new `History`. The project
 * is frozen, so edits can only happen through commands.
 */
export interface History {
  readonly project: Project;
  /** Oldest first. `undo` takes from the end. */
  readonly past: readonly HistoryEntry[];
  /** Most recently undone last. `redo` takes from the end. */
  readonly future: readonly HistoryEntry[];
  /** The most undo steps kept. Older ones are dropped. Unlimited if not set. */
  readonly limit?: number;
}

export interface HistoryOptions {
  limit?: number;
}

/** Starts a history with nothing to undo. Freezes `project`. */
export function createHistory(project: Project, options: HistoryOptions = {}): History {
  const { limit } = options;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new RangeError(`limit must be a positive integer, got ${limit}`);
  }
  return { project: freeze(project, true), past: [], future: [], ...(limit !== undefined && { limit }) };
}

/**
 * Applies a command and records it so it can be undone. This clears the redo stack. A command that changes
 * nothing (setting text to what it already is) isn't recorded and leaves the history as it was.
 * Throws `CommandError` if the command doesn't fit the project.
 */
export function applyCommand(history: History, command: Command): History {
  const [project, patches, inversePatches] = produceWithPatches(history.project, (draft) => run(draft, command));
  if (patches.length === 0) return history;
  const past = [...history.past, { command, patches, inversePatches }];
  if (history.limit !== undefined && past.length > history.limit) past.splice(0, past.length - history.limit);
  return { ...history, project, past, future: [] };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/** Reverts the most recent command. Returns the history unchanged if there is nothing to undo. */
export function undo(history: History): History {
  const entry = history.past.at(-1);
  if (!entry) return history;
  return {
    ...history,
    project: applyPatches(history.project, entry.inversePatches),
    past: history.past.slice(0, -1),
    future: [...history.future, entry],
  };
}

/** Re-applies the most recently undone command. Returns the history unchanged if there is nothing to redo. */
export function redo(history: History): History {
  const entry = history.future.at(-1);
  if (!entry) return history;
  return {
    ...history,
    project: applyPatches(history.project, entry.patches),
    past: [...history.past, entry],
    future: history.future.slice(0, -1),
  };
}
