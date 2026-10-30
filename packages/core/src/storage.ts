import {
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
  realpath,
} from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
function root() {
  const workspace = resolve(
    process.cwd(),
    process.cwd().endsWith(sep + "web") ? "../.." : ".",
  );
  const value = resolve(workspace, process.env.STORAGE_DIR ?? "storage");
  if (
    relative(resolve(workspace, "apps/web/public"), value).split(sep)[0] !==
    ".."
  )
    throw new AppError(500, "UNSAFE_STORAGE", "私密存储不能放在 public 中");
  return value;
}
function target(key: string) {
  if (!/^(?:corpus|builds)\/[a-f0-9-]+\.(?:bin|zip)$/u.test(key))
    throw new AppError(400, "UNSAFE_STORAGE_KEY", "存储键无效");
  const base = root(),
    path = resolve(base, key),
    rel = relative(base, path);
  if (isAbsolute(rel) || rel.startsWith(".." + sep))
    throw new AppError(400, "UNSAFE_STORAGE_KEY", "存储路径越界");
  return { base, path };
}
async function guard(key: string) {
  const value = target(key);
  await mkdir(value.base, { recursive: true });
  const group = resolve(value.base, key.split("/")[0]);
  await mkdir(group, { recursive: true });
  const realBase = await realpath(value.base),
    realGroup = await realpath(group),
    rel = relative(realBase, realGroup);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(".." + sep) ||
    (await lstat(group)).isSymbolicLink()
  )
    throw new AppError(400, "STORAGE_SYMLINK", "存储子目录不能链接到其他位置");
  return value.path;
}
export async function storeBytes(kind: "corpus" | "builds", bytes: Uint8Array) {
  const key = `${kind}/${randomUUID()}.${kind === "corpus" ? "bin" : "zip"}`;
  await writeFile(await guard(key), bytes, { flag: "wx", mode: 0o600 });
  return key;
}
export async function readStored(key: string) {
  const path = await guard(key);
  if ((await lstat(path)).isSymbolicLink())
    throw new AppError(400, "STORAGE_SYMLINK", "拒绝符号链接文件");
  return readFile(path);
}
export async function removeStored(key: string) {
  const path = await guard(key);
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new AppError(400, "STORAGE_SYMLINK", "拒绝符号链接文件");
    await rm(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
