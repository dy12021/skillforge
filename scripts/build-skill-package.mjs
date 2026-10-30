// 把 .agents/skills/skillforge 打成可分发 ZIP，并装到本机宿主目录。
//
// 用法：
//   node scripts/build-skill-package.mjs [--no-install] [--out-dir dist]
//
// 产物：dist/skillforge-<version>.zip、dist/skillforge-<version>.zip.sha256
// 安装：~/.minimax/skills/skillforge/（可用 --host 换目标宿主）
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(repoRoot, ".agents", "skills", "skillforge");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const EXCLUDED_NAMES = new Set([
  "service-config.json",
  "node_modules",
  "__pycache__",
  ".DS_Store",
]);

async function collect(dir, base = dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (EXCLUDED_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full, base)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function copyInto(source, target, targetRoot) {
  const relativePath = relative(targetRoot, target);
  if (!relativePath || isAbsolute(relativePath) || relativePath.startsWith(".."))
    throw new Error(`目标越界：${target}`);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { force: true });
}

async function main() {
  if (!(await stat(sourceDir).catch(() => null)))
    throw new Error(`找不到 Skill 源目录：${sourceDir}`);

  const packageTools = await import(
    pathToFileURL(join(sourceDir, "scripts", "package-tools.mjs")).href
  ).catch(() => {
    throw new Error(
      "缺少 scripts/package-tools.mjs。先运行 `pnpm skill:tools` 生成后再打包。",
    );
  });

  const files = await collect(sourceDir);
  const packageFiles = Object.create(null);
  for (const file of files) {
    packageFiles[`skillforge/${relative(sourceDir, file).split(sep).join("/")}`] =
      new Uint8Array(await readFile(file));
  }
  const report = packageTools.validateSkillFiles(packageFiles);
  if (!report.valid) throw new Error(`包校验失败：${report.errors.join("；")}`);
  if (report.name !== "skillforge")
    throw new Error(`包名应为 skillforge，实际为 ${report.name}`);

  const version = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  ).version;
  const outDir = resolve(repoRoot, option("--out-dir", "dist"));
  await mkdir(outDir, { recursive: true });
  const zipName = `skillforge-${version}.zip`;
  const zipPath = join(outDir, zipName);
  const bytes = packageTools.packSkill(packageFiles);
  await writeFile(zipPath, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  await writeFile(`${zipPath}.sha256`, `${digest}  ${zipName}\n`, "utf8");

  const result = {
    zip: zipPath,
    sha256: digest,
    files: report.files,
    content_hash: report.content_hash,
    warnings: report.warnings,
    installed: null,
  };

  if (!flag("--no-install")) {
    const host = option("--host", "minimax");
    const targetRoot =
      host === "minimax"
        ? join(homedir(), ".minimax", "skills")
        : host === "codex"
          ? join(homedir(), ".codex", "skills")
          : host === "agents"
            ? join(homedir(), ".agents", "skills")
            : null;
    if (!targetRoot)
      throw new Error(`未知 --host：${host}。可用值：minimax、codex、agents`);
    const target = join(targetRoot, "skillforge");
    await mkdir(target, { recursive: true });
    for (const file of files) {
      await copyInto(file, join(target, relative(sourceDir, file)), target);
    }
    // 清掉上一次安装遗留、本次已不存在的文件，并逐条报告，不静默删除。
    const current = new Set(
      files.map((file) => relative(sourceDir, file).split(sep).join("/")),
    );
    const removed = [];
    for (const file of await collect(target)) {
      const key = relative(target, file).split(sep).join("/");
      if (!current.has(key)) {
        await rm(file, { force: true });
        removed.push(key);
      }
    }
    await writeFile(
      join(target, "service-config.json"),
      JSON.stringify({ repo: repoRoot }, null, 2),
      "utf8",
    );
    result.installed = { path: target, removed };
  }

  console.log(JSON.stringify(result, null, 2));
}

await main();
