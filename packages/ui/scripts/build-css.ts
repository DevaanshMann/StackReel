import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderTokensCss } from "../src/css.js";

const outFile = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/tokens.css");

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, renderTokensCss());
console.log(`Wrote ${outFile}`);
