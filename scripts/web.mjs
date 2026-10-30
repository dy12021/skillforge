import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
// Load environment without putting --env-file in execArgv: Next's workers forward execArgv through NODE_OPTIONS.
if (existsSync(".env")) process.loadEnvFile(".env");
process.env.RAYON_NUM_THREADS ??= "1";
process.env.UV_THREADPOOL_SIZE ??= "1";
process.env.NEXT_TELEMETRY_DISABLED ??= "1";
const [mode, ...extra] = process.argv.slice(2);
if (!["dev", "build", "start"].includes(mode))
  throw new Error("Expected dev, build, or start");
const next = resolve("apps/web/node_modules/next/dist/bin/next");
process.argv = [
  process.execPath,
  next,
  mode,
  "apps/web",
  ...(mode === "build"
    ? ["--webpack"]
    : mode === "dev"
      ? ["--webpack", "--hostname", "127.0.0.1"]
      : ["--hostname", "127.0.0.1"]),
  ...extra,
];
await import(pathToFileURL(next).href);
