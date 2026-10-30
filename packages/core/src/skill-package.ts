import { zipSync, strToU8 } from "fflate";
import { inflateRawSync } from "node:zlib";
import { parseDocument } from "yaml";
import { createHash } from "node:crypto";
import {
  lstat,
  readdir,
  readFile,
  mkdir,
  writeFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  resolve,
  relative,
  isAbsolute,
  sep,
  posix,
  basename,
  dirname,
} from "node:path";
import { homedir } from "node:os";
export type PackageFiles = Record<string, Uint8Array>;
export type ValidationReport = {
  valid: boolean;
  name: string | null;
  errors: string[];
  warnings: string[];
  files: number;
  content_hash: string;
  validator_version: string;
};
const MAX_FILE = 1_000_000,
  MAX_TOTAL = 5_000_000,
  MAX_FILES = 100;
export function safePackagePath(name: string) {
  if (
    !name ||
    name.length > 240 ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /[\x00-\x1f:]/u.test(name)
  )
    return false;
  const parts = name.replace(/\/$/u, "").split("/");
  return parts.every(
    (p) =>
      p &&
      p !== "." &&
      p !== ".." &&
      !/[. ]$/u.test(p) &&
      !/[<>"|?*]/u.test(p) &&
      !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(p) &&
      !["__proto__", "constructor", "prototype"].includes(p),
  );
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function readSkillZip(bytes: Uint8Array): PackageFiles {
  if (bytes.length > MAX_TOTAL || bytes.length < 22)
    throw new Error("ZIP 大小无效或超过 5MB");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("ZIP 缺少有效目录");
  const count = view.getUint16(eocd + 10, true),
    directory = view.getUint32(eocd + 16, true),
    directorySize = view.getUint32(eocd + 12, true);
  if (
    !count ||
    count > MAX_FILES ||
    directory + directorySize !== eocd ||
    view.getUint16(eocd + 4, true) !== 0 ||
    view.getUint16(eocd + 6, true) !== 0 ||
    view.getUint16(eocd + 8, true) !== count
  )
    throw new Error("拒绝多卷、ZIP64 或超限 ZIP");
  let offset = directory,
    total = 0;
  const entries = new Map<
      string,
      {
        size: number;
        crc: number;
        start: number;
        compressed: number;
        compression: number;
      }
    >(),
    names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("ZIP 目录损坏");
    const nameLength = view.getUint16(offset + 28, true),
      extra = view.getUint16(offset + 30, true),
      comment = view.getUint16(offset + 32, true),
      length = 46 + nameLength + extra + comment;
    if (offset + length > eocd) throw new Error("ZIP 目录越界");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (!safePackagePath(name) || names.has(name.toLowerCase()))
      throw new Error("ZIP 路径穿越、非法文件名或重复条目");
    names.add(name.toLowerCase());
    const flags = view.getUint16(offset + 8, true),
      compression = view.getUint16(offset + 10, true),
      compressed = view.getUint32(offset + 20, true),
      size = view.getUint32(offset + 24, true),
      attributes = view.getUint32(offset + 38, true),
      local = view.getUint32(offset + 42, true);
    if (
      flags & 1 ||
      ![0, 8].includes(compression) ||
      ((attributes >>> 16) & 0xf000) === 0xa000 ||
      size > MAX_FILE ||
      (total += size) > MAX_TOTAL ||
      compressed > MAX_TOTAL ||
      local + 30 > directory ||
      view.getUint32(local, true) !== 0x04034b50
    )
      throw new Error("ZIP 含加密、符号链接、超限文件或无效条目");
    const localNameLength = view.getUint16(local + 26, true),
      localExtra = view.getUint16(local + 28, true),
      start = local + 30 + localNameLength + localExtra;
    if (
      start + compressed > directory ||
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(local + 30, local + 30 + localNameLength),
      ) !== name
    )
      throw new Error("ZIP 本地路径与目录不一致");
    entries.set(name, {
      size,
      crc: view.getUint32(offset + 16, true),
      start,
      compressed,
      compression,
    });
    offset += length;
  }
  if (offset !== eocd) throw new Error("ZIP 目录长度不一致");
  const files: PackageFiles = Object.create(null);
  for (const [name, entry] of entries) {
    if (name.endsWith("/")) {
      if (entry.size) throw new Error("ZIP 目录不得包含数据");
      continue;
    }
    const compressed = bytes.subarray(
      entry.start,
      entry.start + entry.compressed,
    );
    const value =
      entry.compression === 0
        ? compressed.slice()
        : new Uint8Array(
            inflateRawSync(compressed, {
              maxOutputLength: Math.max(1, entry.size),
            }),
          );
    if (value.length !== entry.size || crc32(value) !== entry.crc)
      throw new Error("ZIP 长度或 CRC 完整性检查失败");
    files[name] = value;
  }
  if (
    Object.keys(files).length !==
    [...entries].filter(([name]) => !name.endsWith("/")).length
  )
    throw new Error("ZIP 文件条目不完整");
  return files;
}
export function packageHash(files: PackageFiles) {
  const hash = createHash("sha256");
  for (const [name, bytes] of Object.entries(files).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    hash.update(name);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}
export function validateSkillFiles(files: PackageFiles): ValidationReport {
  const errors: string[] = [],
    warnings: string[] = [],
    names = Object.keys(files),
    roots = [...new Set(names.map((n) => n.split("/")[0]))];
  let name: string | null = null,
    total = 0;
  if (!names.length || names.length > MAX_FILES || roots.length !== 1)
    errors.push("包必须只含一个 Skill 根目录且不超过 100 个文件");
  for (const path of names) {
    if (!safePackagePath(path)) errors.push(`不安全路径：${path}`);
    total += files[path].length;
    if (files[path].length > MAX_FILE) errors.push(`文件超过 1MB：${path}`);
  }
  if (total > MAX_TOTAL) errors.push("解压总大小超过 5MB");
  const manifests = names.filter(
      (n) => n.split("/").at(-1)?.toLowerCase() === "skill.md",
    ),
    root = roots[0];
  if (manifests.length !== 1 || manifests[0] !== `${root}/SKILL.md`)
    errors.push("必须恰好有根目录下的 SKILL.md，名称大小写应准确");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const textFiles: Record<string, string> = Object.create(null);
  for (const path of names) {
    if (/\.(?:md|json|mjs|js|txt|yaml|yml)$/iu.test(path))
      try {
        textFiles[path] = decoder.decode(files[path]);
      } catch {
        errors.push(`不是 UTF-8 文本：${path}`);
      }
  }
  if (textFiles[`${root}/SKILL.md`]) {
    const text = textFiles[`${root}/SKILL.md`],
      match = text.match(/^---\r?\n([\s\S]{1,4096}?)\r?\n---(?:\r?\n|$)/u);
    if (!match) errors.push("缺少有效且小于 4KB 的 YAML frontmatter");
    else
      try {
        const doc = parseDocument(match[1], { uniqueKeys: true, strict: true });
        if (doc.errors.length) throw new Error("invalid YAML");
        const meta = doc.toJS({ maxAliasCount: 10 }) as Record<string, unknown>;
        if (!meta || typeof meta !== "object" || Array.isArray(meta))
          throw new Error("invalid metadata");
        name = typeof meta.name === "string" ? meta.name : null;
        if (
          !name ||
          name.length > 64 ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) ||
          name !== root
        )
          errors.push("name 无效或与根目录不一致");
        if (
          typeof meta.description !== "string" ||
          !meta.description.trim() ||
          meta.description.length > 1024
        )
          errors.push("description 必须为 1～1024 字符");
        if (
          meta.compatibility !== undefined &&
          (typeof meta.compatibility !== "string" ||
            meta.compatibility.length > 500)
        )
          errors.push("compatibility 无效");
        if (
          meta.metadata !== undefined &&
          (!meta.metadata ||
            typeof meta.metadata !== "object" ||
            Object.values(meta.metadata).some((v) => typeof v !== "string"))
        )
          errors.push("metadata 必须为字符串映射");
        if (!text.slice(match[0].length).trim())
          errors.push("Skill 缺少正文指导");
      } catch {
        errors.push("YAML frontmatter 解析失败");
      }
  }
  for (const [path, text] of Object.entries(textFiles)) {
    if (
      /(?:sk-[A-Za-z0-9_-]{12,}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY)|(?:api[_ -]?key|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_/-]{12,}/iu.test(
        text,
      )
    )
      errors.push(`潜在秘密：${path}`);
    if (path.endsWith(".md"))
      for (const link of text.matchAll(/\]\(([^\s)]{1,300})\)/gu)) {
        const target = link[1].split("#")[0];
        if (!target) continue;
        if (/^https?:\/\//iu.test(target)) {
          warnings.push(`外部链接未抓取：${target}`);
          continue;
        }
        if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) {
          errors.push(`不允许的引用协议：${path}`);
          continue;
        }
        let decoded: string;
        try {
          decoded = decodeURIComponent(target);
        } catch {
          errors.push(`无效引用：${target}`);
          continue;
        }
        const resolved = posix.normalize(
          posix.join(posix.dirname(path), decoded),
        );
        if (
          !safePackagePath(resolved) ||
          !resolved.startsWith(root + "/") ||
          !files[resolved]
        )
          errors.push(`引用缺失或越界：${path} -> ${target}`);
      }
  }
  return {
    valid: !errors.length,
    name,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    files: names.length,
    content_hash: packageHash(files),
    validator_version: "skillforge-validator-v1",
  };
}
export function packSkill(files: PackageFiles) {
  const report = validateSkillFiles(files);
  if (!report.valid) throw new Error(report.errors.join("；"));
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [
        name,
        [bytes, { mtime: new Date(2020, 0, 1), level: 6 }],
      ]),
    ),
    { level: 6 },
  );
}
export async function readSkillDirectory(directory: string) {
  const root = resolve(directory),
    files: PackageFiles = Object.create(null);
  if ((await lstat(root)).isSymbolicLink())
    throw new Error("拒绝符号链接根目录");
  const realRoot = await realpath(root);
  let total = 0;
  async function visit(path: string) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const full = resolve(path, item.name),
        stat = await lstat(full),
        rel = relative(realRoot, full);
      if (
        stat.isSymbolicLink() ||
        isAbsolute(rel) ||
        rel.startsWith(".." + sep)
      )
        throw new Error("目录含符号链接或越界");
      if (stat.isDirectory()) await visit(full);
      else if (stat.isFile()) {
        if (
          stat.size > MAX_FILE ||
          (total += stat.size) > MAX_TOTAL ||
          Object.keys(files).length >= MAX_FILES
        )
          throw new Error("Skill 目录超限");
        const name = basename(root) + "/" + rel.split(sep).join("/");
        if (!safePackagePath(name)) throw new Error("目录含不安全路径");
        files[name] = new Uint8Array(await readFile(full));
      } else throw new Error("拒绝特殊文件");
    }
  }
  await visit(realRoot);
  return files;
}
export async function loadSkillPackage(path: string) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error("拒绝符号链接输入");
  if (stat.isDirectory()) return readSkillDirectory(path);
  if (!stat.isFile() || stat.size > MAX_TOTAL)
    throw new Error("ZIP 文件无效或超限");
  return readSkillZip(new Uint8Array(await readFile(path)));
}
async function ensureRealDirectory(target: string) {
  if (target.startsWith("\\\\"))
    throw new Error("安装只支持本机目录，不访问网络共享");
  const absolute = resolve(target),
    parsed = absolute.split(sep);
  let current = parsed.shift()! + sep;
  for (const part of parsed.filter(Boolean)) {
    current = resolve(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error("安装路径含符号链接或非目录");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      await mkdir(current);
    }
  }
  return realpath(absolute);
}
export type SkillHost = "minimax" | "codex" | "agents" | "project";

/**
 * 把宿主名解析成该宿主的用户级 Skill 目录。
 * 只认已知宿主，未知值直接报错，不猜路径。
 */
export function resolveSkillHost(host: string, cwd: string = process.cwd()) {
  const key = host.trim().toLowerCase();
  const home = homedir();
  switch (key) {
    case "minimax":
      return resolve(home, ".minimax", "skills");
    case "codex":
      return resolve(home, ".codex", "skills");
    case "agents":
    case "opencode":
      return resolve(home, ".agents", "skills");
    case "project":
    case "local":
      return resolve(cwd, ".agents", "skills");
    default:
      throw new Error(
        `未知 host：${host}。可用值：minimax、codex、agents、project`,
      );
  }
}

export async function installSkillPackage(
  input: string,
  target: string,
  newName?: string,
) {
  let files = await loadSkillPackage(input);
  const original = validateSkillFiles(files);
  if (!original.valid || !original.name)
    throw new Error(original.errors.join("；"));
  let name = original.name;
  if (newName) {
    if (newName.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(newName))
      throw new Error("新名称必须符合 Skill name 规范");
    name = newName;
    files = Object.fromEntries(
      Object.entries(files).map(([path, value]) => {
        const dest = name + path.slice(original.name!.length);
        return [
          dest,
          path === original.name + "/SKILL.md"
            ? strToU8(
                new TextDecoder()
                  .decode(value)
                  .replace(/^name:\s*.+$/mu, `name: ${JSON.stringify(name)}`),
              )
            : value,
        ];
      }),
    );
  }
  const report = validateSkillFiles(files);
  if (!report.valid) throw new Error(report.errors.join("；"));
  const root = await ensureRealDirectory(target),
    dest = resolve(root, name),
    rel = relative(root, dest);
  if (isAbsolute(rel) || rel.includes(sep) || rel.startsWith(".."))
    throw new Error("安装目标越界");
  try {
    await lstat(dest);
    throw new Error(
      "目标已存在；选择 --name 新名称或其他 --target。原安装保留，可用于回退。",
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const stage = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(resolve(root, ".skillforge-install-")),
  );
  let installed = false;
  try {
    for (const [path, bytes] of Object.entries(files)) {
      const local = resolve(stage, ...path.split("/").slice(1)),
        r = relative(stage, local);
      if (isAbsolute(r) || r.startsWith(".." + sep))
        throw new Error("解压越界");
      await mkdir(dirname(local), { recursive: true });
      await writeFile(local, bytes, { flag: "wx", mode: 0o600 });
    }
    const staged = await readSkillDirectory(stage);
    const renamed = Object.fromEntries(
      Object.entries(staged).map(([path, value]) => [
        name + path.slice(basename(stage).length),
        value,
      ]),
    );
    if (!validateSkillFiles(renamed).valid) throw new Error("安装暂存验证失败");
    try {
      await lstat(dest);
      throw new Error("目标在安装期间出现，未覆盖");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await rename(stage, dest);
    installed = true;
    return {
      installed: true,
      path: dest,
      name,
      content_hash: report.content_hash,
      notice:
        "未执行包内脚本；旧安装未覆盖。回退可重新选择历史构建并安装到新名称。",
    };
  } finally {
    if (!installed) {
      const check = relative(root, stage);
      if (check.startsWith(".skillforge-install-") && !check.includes(sep))
        await rm(stage, { recursive: true, force: true });
    }
  }
}
