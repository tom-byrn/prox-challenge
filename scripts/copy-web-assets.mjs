import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const webDist = fileURLToPath(new URL("../apps/web/dist/", import.meta.url));

for (const directory of ["knowledge", "files"]) {
  await rm(`${webDist}${directory}`, { recursive: true, force: true });
  await cp(`${root}${directory}`, `${webDist}${directory}`, { recursive: true });
}
