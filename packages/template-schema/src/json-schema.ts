import { z } from "zod";
import { Template } from "./schema.js";

export const JSON_SCHEMA_ID =
  "https://raw.githubusercontent.com/DevaanshMann/StackReel/main/packages/template-schema/schema/stackreel-template.v1.json";

/**
 * The template format as JSON Schema (draft 2020-12), for code generators on other platforms.
 * Cross-field rules (slot references, ranges, unique ids) are not expressible here; see validate().
 */
export function templateJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(Template, { target: "draft-2020-12", unrepresentable: "throw" });
  return { $schema: schema.$schema, $id: JSON_SCHEMA_ID, ...schema };
}
