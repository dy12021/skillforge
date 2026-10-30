import "dotenv/config";
import { resolve, relative, sep } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
if (!process.argv.includes("--test"))
  throw new Error(
    "Use --test for isolated acceptance artifacts; this script does not install into user skills",
  );
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://skillforge:skillforge_test@localhost:55433/skillforge_test";
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
  throw new Error("Refusing non-test database");
const { pool } = await import("../packages/core/src/db"),
  { listSkillBuilds, downloadSkillBuild } =
    await import("../packages/core/src/skill-compiler"),
  { readSkillZip, validateSkillFiles, installSkillPackage } =
    await import("../packages/core/src/skill-package");
const root = resolve(".local/skill-smoke", randomUUID()),
  rel = relative(resolve("."), root);
if (rel.startsWith(".." + sep))
  throw new Error("Artifact path escaped repository");
await mkdir(root, { recursive: true });
try {
  const rows = await listSkillBuilds();
  for (const type of [
    "personalized-writing",
    "personalized-dialogue",
    "language-naturalizer",
  ]) {
    const row = rows.find((r) => r.skill_type === type);
    if (!row)
      throw new Error(
        `No persisted ${type} build; run compiler integration tests first`,
      );
    const { bytes } = await downloadSkillBuild(row.id),
      report = validateSkillFiles(readSkillZip(bytes));
    if (!report.valid) throw new Error(report.errors.join("; "));
    const path = resolve(root, type + ".zip");
    await writeFile(path, bytes, { flag: "wx" });
    const installed = await installSkillPackage(
      path,
      resolve(root, ".agents/skills"),
    );
    let external = "not configured";
    if (process.env.SKILL_VALIDATOR_SCRIPT) {
      const result = spawnSync(
        process.env.PYTHON ?? "python",
        [process.env.SKILL_VALIDATOR_SCRIPT, installed.path],
        { encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } },
      );
      external = (result.stdout + result.stderr).trim();
      if (result.status !== 0) throw new Error(external);
    }
    console.log(
      JSON.stringify({
        type,
        path: installed.path,
        content_hash: report.content_hash,
        external_validation: external,
      }),
    );
  }
  console.log(
    JSON.stringify({
      artifact_root: root,
      notice:
        "Isolated test builds; not real personal preference or proof of quality improvement",
    }),
  );
} finally {
  await pool.end();
}
