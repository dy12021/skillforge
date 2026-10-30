import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
await mkdir("packages/core/generated", { recursive: true });
await build({
  entryPoints: ["packages/core/src/skill-package.ts"],
  outfile: ".agents/skills/skillforge/scripts/package-tools.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  legalComments: "eof",
  banner: {
    js: 'import { createRequire as skillforgeCreateRequire } from "node:module"; const require = skillforgeCreateRequire(import.meta.url);',
  },
});
await build({
  entryPoints: ["scripts/offline-check.ts"],
  outfile: "packages/core/generated/offline-check.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  legalComments: "eof",
});
console.log(
  "Portable validator/installer and offline checker bundled from source",
);
const licenses = (
  await Promise.all(
    ["fflate", "yaml", "zod"].map(
      async (name) =>
        `${name}\n${await readFile(`packages/core/node_modules/${name}/LICENSE`, "utf8")}`,
    ),
  )
).join("\n\n---\n\n");
await writeFile("packages/core/generated/third-party-licenses.txt", licenses);
await writeFile(
  ".agents/skills/skillforge/references/third-party-licenses.txt",
  licenses,
);
