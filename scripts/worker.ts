import { setTimeout } from "node:timers/promises";
import { runOneJob } from "../packages/core/src/jobs";
import { pool } from "../packages/core/src/db";
let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});
console.log(
  "SkillForge provider worker ready (agent jobs are handled by the host Agent)",
);
try {
  do {
    const didWork = await runOneJob();
    if (!didWork) await setTimeout(800);
  } while (running && !process.argv.includes("--once"));
} finally {
  await pool.end();
}
