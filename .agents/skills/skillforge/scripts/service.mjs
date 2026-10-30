#!/usr/bin/env node
// SkillForge 本地服务引导：体检、幂等启动、停止。
//
// 约束：只操作本机；不下载模型；不覆盖已有进程；失败如实报告，不伪造成功。
import { spawn, spawnSync } from "node:child_process";
import { connect, createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const stateDir =
  process.env.SKILLFORGE_STATE_DIR ??
  join(process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"), "SkillForge");
export const stateFile = join(stateDir, "service.json");
export const logFile = join(stateDir, "web.log");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function readState() {
  try {
    const parsed = JSON.parse(await readFile(stateFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeState(state) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
}

async function clearState() {
  await rm(stateFile, { force: true });
}

function isRepo(dir) {
  return (
    !!dir &&
    existsSync(join(dir, "pnpm-workspace.yaml")) &&
    existsSync(join(dir, "apps", "web", "package.json"))
  );
}

function walkUp(start) {
  let dir = resolve(start);
  for (;;) {
    if (isRepo(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 定位 SkillForge 仓库。找不到就返回 null，绝不猜一个路径当真的。 */
export async function findRepo() {
  const candidates = [];
  if (process.env.SKILLFORGE_HOME)
    candidates.push(resolve(process.env.SKILLFORGE_HOME));
  try {
    const config = JSON.parse(
      await readFile(join(SKILL_DIR, "service-config.json"), "utf8"),
    );
    if (typeof config?.repo === "string") candidates.push(resolve(config.repo));
  } catch {
    /* 未安装配置文件时继续其他来源 */
  }
  const state = await readState();
  if (typeof state?.repo === "string") candidates.push(resolve(state.repo));
  candidates.push(walkUp(SKILL_DIR), walkUp(process.cwd()));
  for (const candidate of candidates)
    if (isRepo(candidate)) return candidate;
  return null;
}

/** 当前应访问的服务地址：显式环境变量优先，其次是本服务记录的运行地址。 */
export async function resolveBaseUrl() {
  const state = await readState();
  return (
    process.env.SKILLFORGE_URL ??
    (typeof state?.baseUrl === "string" ? state.baseUrl : null) ??
    process.env.BASE_URL ??
    "http://localhost:3000"
  );
}

/** 探测健康端点。只做只读 GET，不改任何状态。 */
export async function probe(baseUrl) {
  const target = new URL("/api/health", baseUrl);
  try {
    const response = await fetch(target, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    const body = await response.json().catch(() => null);
    return {
      reachable: response.ok && !body?.error,
      status: response.status,
      database: body?.data?.database ?? null,
      base_url: body?.data?.base_url ?? null,
      mock: body?.data?.mock ?? null,
      error: body?.error?.code ?? null,
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      database: null,
      base_url: null,
      mock: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function portFree(port) {
  return new Promise((resolveFree) => {
    const server = createServer();
    server.once("error", () => resolveFree(false));
    server.once("listening", () => server.close(() => resolveFree(true)));
    server.listen(port, "127.0.0.1");
  });
}

/** 选一个可用端口。优先用配置端口，其次 3000，被占用就顺延。 */
export async function pickPort(preferred) {
  const candidates = [];
  const push = (value) => {
    const port = Number(value);
    if (Number.isInteger(port) && port > 0 && port < 65536 && !candidates.includes(port))
      candidates.push(port);
  };
  push(preferred ?? process.env.SKILLFORGE_PORT);
  push(3000);
  for (let port = 3001; port <= 3099; port += 1) push(port);
  for (const port of candidates) if (await portFree(port)) return port;
  throw new Error("未找到 3000-3099 范围内的空闲端口，请先释放端口或设置 SKILLFORGE_PORT");
}

function runPowerShell(script, action, cwd) {
  return spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      action,
    ],
    { cwd, encoding: "utf8", windowsHide: true },
  );
}

function runPnpm(args, cwd) {
  return spawnSync(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/c", "pnpm.cmd", ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
}

function runCompose(args, cwd) {
  return spawnSync(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/c", "docker", "compose", ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
}

/** 目标数据库的地址：取 DATABASE_URL，默认本机便携库 55432。 */
export function databaseTarget() {
  const raw =
    process.env.DATABASE_URL ??
    "postgresql://skillforge:skillforge_local@localhost:55432/skillforge";
  try {
    const parsed = new URL(raw);
    return {
      host: parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname,
      port: Number(parsed.port || 5432),
    };
  } catch {
    return { host: "127.0.0.1", port: 55432 };
  }
}

/** 端口上是否已有进程在监听。只做 TCP 探测，不发协议数据。 */
export function portOpen(port, host = "127.0.0.1", timeout = 1500) {
  return new Promise((settle) => {
    const socket = connect({ host, port });
    const done = (value) => {
      socket.destroy();
      settle(value);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function failure(label, result) {
  const stderr = (result.stderr ?? "").trim();
  const stdout = (result.stdout ?? "").trim();
  return {
    error: {
      code: label,
      message:
        [
          `${label}（退出码 ${result.status}）。`,
          stderr ? `stderr: ${stderr}` : "",
          stdout ? `stdout: ${stdout.slice(-800)}` : "",
        ]
          .filter(Boolean)
          .join(" "),
    },
  };
}

async function tailLog(lines = 30) {
  try {
    const text = await readFile(logFile, "utf8");
    return text.split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe(baseUrl);
    if (result.reachable) return result;
    await sleep(1500);
  }
  return null;
}

/** 端口是否仍由我们记录的进程占用。 */
async function pidOwnsPort(port, pid) {
  if (!pid) return false;
  try {
    const { stdout } = await new Promise((resolveNet, rejectNet) => {
      const child = spawn("netstat", ["-ano", "-p", "tcp"], {
        windowsHide: true,
      });
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.on("error", rejectNet);
      child.on("close", () => resolveNet({ stdout: out }));
    });
    return stdout
      .split(/\r?\n/)
      .some(
        (line) =>
          line.includes(`:${port}`) &&
          line.includes("LISTENING") &&
          line.trim().endsWith(String(pid)),
      );
  } catch {
    return false;
  }
}

/** 服务体检：只读，不启动任何东西。 */
export async function serviceStatus() {
  const raw = await resolveBaseUrl();
  let baseUrl = raw;
  try {
    baseUrl = new URL(raw).href;
  } catch {
    /* 地址不合法时原样返回，由调用方看到真实输入 */
  }
  const health = await probe(baseUrl);
  const state = await readState();
  const repo = await findRepo();
  return {
    data: {
      url: baseUrl,
      reachable: health.reachable,
      http_status: health.status,
      database: health.database,
      mock: health.mock,
      error: health.error,
      repo,
      pid: state?.pid ?? null,
      port: state?.port ?? null,
      started_at: state?.startedAt ?? null,
      state_file: stateFile,
      log_file: logFile,
    },
  };
}

/**
 * 幂等启动。已运行就直接报告；否则按 数据库 → 迁移 → 构建 → Web 的顺序拉起。
 * 任一步失败立即返回真实错误，不留半启动状态的说法。
 */
export async function serviceStart() {
  const existingUrl = await resolveBaseUrl();
  const existing = await probe(existingUrl);
  if (existing.reachable)
    return {
      data: {
        started: false,
        already_running: true,
        url: existingUrl,
        database: existing.database,
        notice: "服务已在运行，未重复启动。",
      },
    };

  const repo = await findRepo();
  if (!repo)
    return {
      error: {
        code: "REPO_NOT_FOUND",
        message:
          "未找到 SkillForge 仓库。设置 SKILLFORGE_HOME 指向仓库根目录（含 pnpm-workspace.yaml 与 apps/web），或在 Skill 目录放 service-config.json 指向仓库后重试。未启动任何进程。",
      },
    };

  await mkdir(stateDir, { recursive: true });

  const state = await readState();
  const db = databaseTarget();
  let database;
  if (await portOpen(db.port, db.host)) {
    database = {
      started: false,
      via: "already-listening",
      port: db.port,
      note: `数据库端口 ${db.port} 已有进程在监听，未重复启动。`,
    };
  } else {
    const postgres = runPowerShell(
      join(repo, "scripts", "local-postgres.ps1"),
      "start",
      repo,
    );
    if (postgres.status === 0) {
      database = { started: true, via: "local-postgres.ps1", port: db.port };
    } else {
      const compose = runCompose(["up", "-d", "--wait", "db"], repo);
      if (compose.status !== 0)
        return failure("启动项目数据库失败", {
          status: postgres.status,
          stderr: `${postgres.stderr ?? ""}\n--- docker compose ---\n${compose.stderr ?? ""}`,
          stdout: `${postgres.stdout ?? ""}\n${compose.stdout ?? ""}`,
        });
      database = { started: true, via: "docker compose", port: db.port };
    }
  }

  const migrate = runPnpm(["db:migrate"], repo);
  if (migrate.status !== 0) return failure("数据库迁移失败", migrate);

  const seed = runPnpm(["db:seed"], repo);
  if (seed.status !== 0) return failure("初始化种子数据失败", seed);

  const buildId = join(repo, "apps", "web", ".next", "BUILD_ID");
  if (!existsSync(buildId)) {
    const build = runPnpm(["build"], repo);
    if (build.status !== 0) return failure("生产构建失败", build);
  }

  const port = await pickPort(state?.port ?? process.env.SKILLFORGE_PORT);
  const baseUrl = `http://127.0.0.1:${port}`;  const handle = await open(logFile, "a");
  const child = spawn(
    process.execPath,
    [join(repo, "scripts", "web.mjs"), "start", "-p", String(port)],
    {
      cwd: repo,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", handle.fd, handle.fd],
      env: {
        ...process.env,
        PORT: String(port),
        BASE_URL: baseUrl,
        NODE_ENV: "production",
      },
    },
  );
  child.unref();
  await handle.close();

  const health = await waitForHealth(baseUrl, 180000);
  if (!health) {
    return {
      error: {
        code: "WEB_START_TIMEOUT",
        message: `Web 服务在 180 秒内未通过 /api/health。日志尾部：\n${await tailLog()}`,
      },
    };
  }

  await writeState({
    baseUrl,
    port,
    pid: child.pid,
    repo,
    startedAt: new Date().toISOString(),
  });
  return {
    data: {
      started: true,
      already_running: false,
      url: baseUrl,
      port,
      pid: child.pid,
      database: health.database,
      database_start: database,
      repo,
      log_file: logFile,
    },
  };
}

/** 停止本服务启动的 Web 进程。不碰数据库，不碰其他进程。 */
export async function serviceStop() {
  const state = await readState();
  if (!state?.pid)
    return {
      data: {
        stopped: false,
        notice: "本服务没有记录运行中的进程，无需停止。",
      },
    };
  if (!(await pidOwnsPort(state.port, state.pid)))
    return {
      data: {
        stopped: false,
        pid: state.pid,
        notice:
          "记录的进程已不再占用该端口，未终止任何进程。请人工确认后再处理。",
      },
    };
  const result = spawnSync(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/c", "taskkill", "/PID", String(state.pid), "/T", "/F"],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) return failure("停止 Web 服务失败", result);
  await clearState();
  return {
    data: {
      stopped: true,
      pid: state.pid,
      notice: "已停止本服务启动的 Web 进程；项目数据库保持运行。",
    },
  };
}
