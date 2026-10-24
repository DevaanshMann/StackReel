import { writeFile } from "node:fs/promises";
import { JSON_SCHEMA_PATH, renderJsonSchema } from "./render-json-schema.js";

await writeFile(JSON_SCHEMA_PATH, await renderJsonSchema());
console.log(`Wrote ${JSON_SCHEMA_PATH}`);
