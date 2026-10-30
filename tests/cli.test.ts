import { expect, test } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const cli = resolve(".agents/skills/skillforge/scripts/skillforge.mjs");
/** 异步运行 CLI：mock HTTP server 与子进程同进程时，spawnSync 会阻塞事件循环导致死锁。 */
async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
  cwd?: string,
) {
  const child = spawn(process.execPath, [cli, ...args], {
    env: { ...process.env, ...env },
    cwd,
    windowsHide: true,
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const status = await new Promise<number>((closed) =>
    child.on("close", (code) => closed(code ?? 0)),
  );
  return { status, stdout, stderr };
}
test("trainer help works standalone without dependencies or a model service", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).usage.length).toBeGreaterThan(0);
});
test("serve returns a reproducible URL and truthful startup instructions when no service is reachable", () => {
  const result = spawnSync(process.execPath, [cli, "serve"], {
    encoding: "utf8",
    env: { ...process.env, SKILLFORGE_URL: "http://127.0.0.1:1" },
  });
  expect(result.status).toBe(1);
  const body = JSON.parse(result.stdout);
  expect(body.data.running).toBe(false);
  expect(body.url).toBe("http://127.0.0.1:1/");
  expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  expect(body.error.message).toContain("pnpm start");
});
test("Skill compilation requires a concrete project instead of reporting empty success", () => {
  const result = spawnSync(process.execPath, [cli, "skill", "build"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout).error.message).toContain("--project");
});
test("service status reports the real state and exits non-zero when nothing is reachable", async () => {
  const stateDir = await mkdtemp(resolve(tmpdir(), "skillforge-state-"));
  try {
    const result = spawnSync(process.execPath, [cli, "service", "status"], {
      encoding: "utf8",
      env: {
        ...process.env,
        SKILLFORGE_URL: "http://127.0.0.1:1",
        SKILLFORGE_STATE_DIR: stateDir,
      },
    });
    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout);
    expect(body.data.reachable).toBe(false);
    expect(body.data.http_status).toBeNull();
    expect(body.data.url).toBe("http://127.0.0.1:1/");
    expect(body.error).toBeNull();
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
test("service start is idempotent and starts no process when the service already answers", async () => {
  const stateDir = await mkdtemp(resolve(tmpdir(), "skillforge-state-"));
  const server = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        data: { database: "connected", base_url: "http://127.0.0.1" },
        error: null,
        request_id: "test",
      }),
    );
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const result = await runCli(["service", "start"], {
      SKILLFORGE_URL: `http://127.0.0.1:${port}`,
      SKILLFORGE_STATE_DIR: stateDir,
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.data.already_running).toBe(true);
    expect(body.data.started).toBe(false);
    expect(body.data.database).toBe("connected");
  } finally {
    await new Promise<void>((closed) => server.close(() => closed()));
    await rm(stateDir, { recursive: true, force: true });
  }
});
test("service stop reports honestly and kills nothing when no process is recorded", async () => {
  const stateDir = await mkdtemp(resolve(tmpdir(), "skillforge-state-"));
  try {
    const result = spawnSync(process.execPath, [cli, "service", "stop"], {
      encoding: "utf8",
      env: {
        ...process.env,
        SKILLFORGE_URL: "http://127.0.0.1:1",
        SKILLFORGE_STATE_DIR: stateDir,
      },
    });
    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.data.stopped).toBe(false);
    expect(body.error).toBeNull();
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
test("skill install accepts --host and refuses to overwrite an existing installation", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "skillforge-host-"));
  try {
    const packageDir = resolve(directory, "sample-skill");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(resolve(packageDir, "references"), { recursive: true });
    await writeFile(
      resolve(packageDir, "SKILL.md"),
      '---\nname: sample-skill\ndescription: "Test: a valid skill"\n---\nRead [rules](references/rules.md).\n',
    );
    await writeFile(resolve(packageDir, "references", "rules.md"), "Keep facts.\n");
    const first = spawnSync(
      process.execPath,
      [cli, "skill", "install", packageDir, "--host", "project"],
      { cwd: directory, encoding: "utf8" },
    );
    expect(first.status, first.stderr + first.stdout).toBe(0);
    const body = JSON.parse(first.stdout);
    expect(body.data.installed).toBe(true);
    expect(body.data.path).toBe(
      resolve(directory, ".agents", "skills", "sample-skill"),
    );
    const second = spawnSync(
      process.execPath,
      [cli, "skill", "install", packageDir, "--host", "project"],
      { cwd: directory, encoding: "utf8" },
    );
    expect(second.status).toBe(1);
    expect(JSON.parse(second.stdout).error.message).toContain("目标已存在");
    const unknown = spawnSync(
      process.execPath,
      [cli, "skill", "install", packageDir, "--host", "nope"],
      { cwd: directory, encoding: "utf8" },
    );
    expect(unknown.status).toBe(1);
    expect(JSON.parse(unknown.stdout).error.message).toContain("未知 host");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
