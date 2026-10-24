import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const fixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));
export const examplesDir = fileURLToPath(new URL("../../../templates/examples/", import.meta.url));

export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

export const jsonFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
