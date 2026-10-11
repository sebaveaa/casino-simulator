import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const { dependencies } = JSON.parse(readFileSync(here("./package.json"), "utf8"));

// Real npm dependencies stay external and are installed in the image. Workspace
// packages such as @casino/shared export TypeScript source, so they are bundled.
const external = Object.keys(dependencies).filter((name) => name !== "@casino/shared");

await build({
  entryPoints: [here("./main.ts")],
  outfile: here("./dist/main.js"),
  platform: "node",
  target: "node22",
  format: "esm",
  bundle: true,
  sourcemap: true,
  external,
});
