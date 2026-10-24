import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { templateJsonSchema } from "../src/json-schema.js";

export const JSON_SCHEMA_PATH = fileURLToPath(new URL("../schema/stackreel-template.v1.json", import.meta.url));

/** The committed JSON Schema file's exact contents, formatted the way `pnpm format` would leave it. */
export async function renderJsonSchema(): Promise<string> {
  const config = await resolveConfig(JSON_SCHEMA_PATH);
  return format(JSON.stringify(templateJsonSchema()), { ...config, filepath: JSON_SCHEMA_PATH });
}
