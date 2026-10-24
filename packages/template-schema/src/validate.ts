import type { z } from "zod";
import { Template } from "./schema.js";

/** One problem found in a document. `path` is a JSON Pointer (RFC 6901), "" for the document itself. */
export interface ValidationError {
  path: string;
  message: string;
}

export type ValidateResult = { ok: true; template: Template } | { ok: false; errors: ValidationError[] };

/** Builds a JSON Pointer such as `/tracks/0/items/1/slot`. */
export function toJsonPointer(path: readonly PropertyKey[]): string {
  return path.map((key) => "/" + String(key).replaceAll("~", "~0").replaceAll("/", "~1")).join("");
}

export function toValidationErrors(issues: readonly z.core.$ZodIssue[]): ValidationError[] {
  return issues.map((issue) => ({ path: toJsonPointer(issue.path), message: issue.message }));
}

/**
 * Checks a parsed JSON value against the current template format, including the cross-field rules.
 * Older documents should go through `migrate()` first.
 */
export function validate(json: unknown): ValidateResult {
  const result = Template.safeParse(json);
  if (result.success) return { ok: true, template: result.data };
  return { ok: false, errors: toValidationErrors(result.error.issues) };
}
