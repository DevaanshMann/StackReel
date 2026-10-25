import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FIXTURES_DIR, GENERATED_DIRS, renderFixtures } from "../src/fixtures.js";

const files = await renderFixtures();

// Remove generated files whose case no longer exists, such as a renamed template.
for (const dir of GENERATED_DIRS) {
  const names = await readdir(join(FIXTURES_DIR, dir)).catch(() => [] as string[]);
  for (const name of names) {
    if (name.endsWith(".json") && !files.has(`${dir}/${name}`)) await rm(join(FIXTURES_DIR, dir, name));
  }
}

for (const [path, text] of files) {
  await mkdir(dirname(join(FIXTURES_DIR, path)), { recursive: true });
  await writeFile(join(FIXTURES_DIR, path), text);
}
console.log(`Wrote ${files.size} files to ${FIXTURES_DIR}`);
