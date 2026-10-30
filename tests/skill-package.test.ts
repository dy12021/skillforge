import { test, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  cp,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { resolve, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import {
  validateSkillFiles,
  readSkillZip,
  packSkill,
  installSkillPackage,
  safePackagePath,
  loadSkillPackage,
  resolveSkillHost,
} from "../packages/core/src/skill-package";
function valid() {
  return {
    "sample-skill/SKILL.md": strToU8(
      '---\nname: sample-skill\ndescription: "Test: a valid skill"\n---\nRead [rules](references/rules.md) for the requested writing task.\n',
    ),
    "sample-skill/references/rules.md": strToU8(
      "Use confirmed scope and preserve facts.\n",
    ),
  };
}
test("actual ZIP roundtrip validates YAML and links; missing references and false metadata fail", () => {
  const files = valid(),
    report = validateSkillFiles(files);
  expect(report.valid).toBe(true);
  expect(validateSkillFiles(readSkillZip(packSkill(files))).content_hash).toBe(
    report.content_hash,
  );
  delete (files as Record<string, Uint8Array>)[
    "sample-skill/references/rules.md"
  ];
  expect(
    validateSkillFiles(files).errors.some((e) => e.includes("引用缺失")),
  ).toBe(true);
  const invalid = valid();
  invalid["sample-skill/SKILL.md"] = strToU8(
    "---\nname: wrong\ndescription: true\n---\nText.",
  );
  expect(validateSkillFiles(invalid).valid).toBe(false);
});
test("ZIP paths, case collisions, symlinks, oversize and tampering are rejected before filesystem writes", () => {
  for (const name of [
    "../secrets.txt",
    "/absolute/file",
    "sample-skill/../secret",
    "sample-skill/C:file",
    "sample-skill/CON.txt",
    "sample-skill\\bad.txt",
  ]) {
    expect(safePackagePath(name)).toBe(false);
    expect(() =>
      readSkillZip(zipSync({ [name]: strToU8("not written") })),
    ).toThrow();
  }
  expect(() =>
    readSkillZip(
      zipSync({ ...valid(), "sample-skill/skill.md": strToU8("duplicate") }),
    ),
  ).toThrow(/重复/u);
  expect(() =>
    readSkillZip(
      zipSync({
        "sample-skill/link": [
          strToU8("outside"),
          { os: 3, attrs: 0xa000 << 16 },
        ],
      }),
    ),
  ).toThrow(/符号/u);
  expect(() =>
    readSkillZip(
      zipSync({ "sample-skill/big.txt": new Uint8Array(1_000_001) }),
    ),
  ).toThrow(/超限/u);
  const bytes = packSkill(valid()),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length),
    end = bytes.length - 22,
    central = view.getUint32(end + 16, true);
  view.setUint32(central + 16, 0, true);
  expect(() => readSkillZip(bytes)).toThrow(/CRC/u);
  const bomb = zipSync({ "sample-skill/SKILL.md": new Uint8Array(20000) }),
    v = new DataView(bomb.buffer, bomb.byteOffset, bomb.length),
    directory = v.getUint32(bomb.length - 22 + 16, true);
  v.setUint32(directory + 24, 1, true);
  expect(() => readSkillZip(bomb)).toThrow();
});
test("offline CLI installs actual files, refuses overwrite and symlink targets, supports new name without service or dependencies", async () => {
  const directory = await mkdtemp(
      resolve(tmpdir(), "skillforge-package-test-"),
    ),
    archive = resolve(directory, "valid.zip");
  try {
    await writeFile(archive, packSkill(valid()));
    const target = resolve(directory, ".agents/skills"),
      installed = await installSkillPackage(archive, target);
    expect(installed.installed).toBe(true);
    expect(
      await readFile(resolve(installed.path, "references/rules.md"), "utf8"),
    ).toContain("preserve facts");
    await expect(installSkillPackage(archive, target)).rejects.toThrow(
      /已存在/u,
    );
    const renamed = await installSkillPackage(
      archive,
      target,
      "sample-skill-v2",
    );
    expect(validateSkillFiles(await loadSkillPackage(renamed.path)).name).toBe(
      "sample-skill-v2",
    );
    const actual = resolve(directory, "actual");
    await mkdir(actual);
    const link = resolve(directory, "link");
    await symlink(
      actual,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(installSkillPackage(archive, link)).rejects.toThrow(/符号/u);
    const standalone = resolve(directory, "standalone");
    await mkdir(standalone);
    for (const name of [
      "skillforge.mjs",
      "package-tools.mjs",
      "service.mjs",
    ])
      await cp(
        resolve(".agents/skills/skillforge/scripts", name),
        resolve(standalone, name),
      );
    const result = spawnSync(
      process.execPath,
      [resolve(standalone, "skillforge.mjs"), "skill", "validate", archive],
      { cwd: standalone, encoding: "utf8" },
    );
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout).data.valid).toBe(true);
    const fail = spawnSync(
      process.execPath,
      [
        resolve(standalone, "skillforge.mjs"),
        "skill",
        "install",
        archive,
        "--target",
        target,
      ],
      { cwd: standalone, encoding: "utf8" },
    );
    expect(fail.status).toBe(1);
    expect(JSON.parse(fail.stdout).error.message).toContain("目标已存在");
  } finally {
    const rel = relative(tmpdir(), directory);
    if (rel.startsWith("skillforge-package-test-") && !rel.includes(sep))
      await rm(directory, { recursive: true, force: true });
  }
});
test("host 名称解析到各宿主的用户级目录，未知值直接报错而不是猜路径", () => {
  expect(resolveSkillHost("minimax")).toBe(
    resolve(homedir(), ".minimax", "skills"),
  );
  expect(resolveSkillHost("codex")).toBe(
    resolve(homedir(), ".codex", "skills"),
  );
  expect(resolveSkillHost("agents")).toBe(
    resolve(homedir(), ".agents", "skills"),
  );
  expect(resolveSkillHost("opencode")).toBe(
    resolve(homedir(), ".agents", "skills"),
  );
  expect(resolveSkillHost("project", resolve("/tmp", "demo"))).toBe(
    resolve("/tmp", "demo", ".agents", "skills"),
  );
  expect(() => resolveSkillHost("unknown-host")).toThrow(/未知 host/u);
});
