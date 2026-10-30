#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  resolveBaseUrl,
  serviceStart,
  serviceStatus,
  serviceStop,
} from "./service.mjs";
const args = process.argv.slice(2),
  [entity, action, id] = args;
const options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const key = args[i].slice(2);
    options[key] =
      args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
  }
}
let baseNotice = null;
async function resolveBase() {
  const candidate = await resolveBaseUrl();
  try {
    return new URL(candidate);
  } catch {
    baseNotice = `SKILLFORGE_URL/状态文件中的地址不合法：${candidate}，已回退到 http://localhost:3000`;
    return new URL("http://localhost:3000");
  }
}
const base = await resolveBase();
function print(value) {
  console.log(JSON.stringify(value, null, 2));
}
async function api(path, method = "GET", body) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
    throw new Error("当前 CLI 仅访问本机 SkillForge URL");
  const response = await fetch(new URL(`/api/${path}`, base), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET"
        ? { "Idempotency-Key": options.key ?? randomUUID() }
        : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  const result = await response.json();
  if (!response.ok || result.error)
    throw new Error(
      `${result.error?.code ?? response.status}: ${result.error?.message ?? "请求失败"} (request_id=${result.request_id})`,
    );
  return result;
}
function required(key) {
  if (typeof options[key] !== "string" || !options[key])
    throw new Error(`需要 --${key}`);
  return options[key];
}
async function file() {
  const value = await readFile(required("file"), "utf8");
  const limit = entity === "job" && action === "submit" ? 2_500_000 : 256000;
  if (Buffer.byteLength(value) > limit)
    throw new Error(`JSON 文件超过 ${limit} 字节上限`);
  return JSON.parse(value);
}
try {
  if (entity === "service") {
    const operation = action ?? "status";
    if (!["status", "start", "stop"].includes(operation))
      throw new Error("未知 service 操作：service status|start|stop");
    const result =
      operation === "status"
        ? await serviceStatus()
        : operation === "start"
          ? await serviceStart()
          : await serviceStop();
    if (result.error) {
      print({ data: null, error: result.error });
      process.exitCode = 1;
    } else {
      print({ data: result.data, error: null, request_id: null });
      if (operation === "status" && !result.data.reachable) process.exitCode = 1;
    }
  } else if (entity === "serve") {
    let result;
    try {
      result = await api("health");
    } catch {
      print({
        data: { running: false },
        url: base.href,
        opened: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message:
            "本地服务未就绪。运行 `skillforge service start` 由本 Skill 拉起数据库与 Web（需本机已装 pnpm 与 Python），或在 SkillForge 仓库按 README 手动启动数据库、迁移并运行 pnpm dev / pnpm build && pnpm start；已有进程勿覆盖。PORT/BASE_URL 与实际端口应一致。CLI 未声称已启动或打开服务。",
        },
      });
      process.exitCode = 1;
      process.exit(1);
    }
    print({
      ...result,
      url: base.href,
      note: baseNotice ?? "服务已响应；浏览器可复制此 URL。CLI 不声称已自动打开浏览器。",
    });
  } else if (entity === "evaluation" && action === "create") {
    const result = await api("evaluations", "POST", {
      build_id: required("build"),
      generation_source: options.source ?? "agent",
      test_run: options.test === true,
    });
    print({ ...result, url: new URL(result.data.url, base).href });
  } else if (entity === "evaluation" && ["get", "results"].includes(action)) {
    if (!id) throw new Error("需要 evaluation id");
    print(
      await api(`evaluations/${id}${action === "results" ? "/results" : ""}`),
    );
  } else if (entity === "project" && action === "list")
    print(await api("projects"));
  else if (entity === "project" && action === "create")
    print(
      await api("projects", "POST", {
        name: required("name"),
        domain: options.mode ?? "writing",
      }),
    );
  else if (entity === "session" && action === "create") {
    const topic = options.topic ?? "auto",
      mode = options.mode ?? "writing";
    const result = await api("sessions", "POST", {
      project_id: required("project"),
      mode,
      source: topic === "auto" ? "auto" : "manual",
      prompt: topic === "auto" ? "" : topic,
      candidate_count: Number(options.candidates ?? 3),
      generation_source: options.source ?? "agent",
      granularity:
        options.granularity ??
        (mode === "dialogue" ? "single-turn" : "paragraph"),
      target_dimension: options.dimension ?? "具体、自然，保持事实",
    });
    print({ ...result, url: new URL(result.data.url, base).href });
  } else if (entity === "session" && action === "get") {
    if (!id) throw new Error("需要 session id");
    print(await api(`sessions/${id}`));
  } else if (entity === "session" && action === "feedback") {
    if (!id) throw new Error("需要 session id");
    const result = await api(`sessions/${id}`);
    print({
      ...result,
      data: {
        session: result.data.session,
        feedback_events: result.data.feedback_events,
        document_versions: result.data.document_versions,
        annotations: result.data.annotations,
      },
    });
  } else if (entity === "session" && action === "open") {
    if (!id) throw new Error("需要 session id");
    await api(`sessions/${id}`);
    print({
      url: new URL(`/sessions/${id}/compare`, base).href,
      opened: false,
      note: "请在浏览器打开此 URL",
    });
  } else if (entity === "session" && action === "next") {
    if (!id) throw new Error("需要 session id");
    const current = await api(`sessions/${id}`),
      last = current.data.jobs
        .filter((job) => job.job_type === "training")
        .at(-1).payload;
    print(
      await api(`sessions/${id}/candidates`, "POST", {
        source: last.source,
        prompt: last.prompt,
        granularity: last.granularity,
        target_dimension: last.target_dimension,
        candidate_count: Number(options.candidates ?? last.candidate_count),
        generation_source: options.source ?? "agent",
        strategy: options.strategy ?? last.strategy,
        ...(last.source === "corpus-derived"
          ? {
              corpus_asset_id: last.corpus_asset_id,
              corpus_segment_id: last.corpus_segment_id,
              data_transfer_confirmed: last.data_transfer_confirmed,
            }
          : {}),
        ...(options.champion
          ? { champion_candidate_id: options.champion }
          : {}),
        expected_version: current.data.session.version,
      }),
    );
  } else if (entity === "job" && action === "list") print(await api("jobs"));
  else if (entity === "job" && action === "get") {
    if (!id) throw new Error("需要 job id");
    print(await api(`jobs/${id}`));
  } else if (entity === "job" && action === "submit") {
    if (!id) throw new Error("需要 job id");
    print(await api(`jobs/${id}/complete`, "POST", await file()));
  } else if (entity === "job" && ["retry", "cancel"].includes(action)) {
    if (!id) throw new Error("需要 job id");
    print(await api(`jobs/${id}/${action}`, "POST", {}));
  } else if (entity === "feedback" && action === "submit")
    print(await api("feedback", "POST", await file()));
  else if (entity === "skill" && action === "build") {
    const result = await api("skills/builds", "POST", {
      project_id: required("project"),
      type: required("type"),
    });
    const url = new URL(
      `/api/skills/builds/${result.data.build_id}/download`,
      base,
    ).href;
    if (options.out) {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`构建下载失败：${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { readSkillZip, validateSkillFiles } =
        await import("./package-tools.mjs");
      const report = validateSkillFiles(readSkillZip(bytes));
      if (!report.valid) throw new Error(report.errors.join("；"));
      await writeFile(resolve(required("out")), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      print({
        data: {
          build_id: result.data.build_id,
          version: result.data.build.semantic_version,
          path: resolve(required("out")),
          validation: report,
        },
        url,
        error: null,
        request_id: result.request_id,
      });
    } else print({ ...result, download_url: url });
  } else if (entity === "skill" && action === "validate") {
    if (!id) throw new Error("需要 ZIP 文件或 Skill 目录路径");
    const { loadSkillPackage, validateSkillFiles } =
      await import("./package-tools.mjs");
    const report = validateSkillFiles(await loadSkillPackage(resolve(id)));
    print({ data: report, error: null });
    if (!report.valid) process.exitCode = 1;
  } else if (entity === "skill" && action === "install") {
    if (!id) throw new Error("需要 ZIP 文件或 Skill 目录路径");
    const { installSkillPackage, resolveSkillHost } =
      await import("./package-tools.mjs");
    const host = typeof options.host === "string" ? options.host : null;
    const target = host
      ? resolveSkillHost(host)
      : typeof options.target === "string"
        ? options.target
        : null;
    if (!target)
      throw new Error(
        "需要 --target <安装目录> 或 --host <minimax|codex|agents|project>",
      );
    print({
      data: await installSkillPackage(
        resolve(id),
        resolve(target),
        typeof options.name === "string" ? options.name : undefined,
      ),
      error: null,
    });
  } else if (entity && !["--help", "-h"].includes(entity))
    throw new Error(
      `未知命令：${entity} ${action ?? ""}。运行 --help 查看可用命令。`,
    );
  else
    print({
      usage: [
        "service status",
        "service start",
        "service stop",
        "project list",
        "project create --name NAME --mode writing|dialogue",
        "session create --project UUID --mode writing|dialogue --topic auto|TEXT --candidates 2..8 [--source agent|provider]",
        "session get|feedback|open UUID",
        "session next UUID [--candidates N]",
        "job list",
        "job get UUID",
        "job submit UUID --file generated.json [--key STABLE_IDEMPOTENCY_KEY]",
        "job retry|cancel UUID",
        "feedback submit --file feedback.json",
        "skill build --project UUID --type personalized-writing|personalized-dialogue|language-naturalizer [--out FILE.zip]",
        "skill validate ZIP_OR_DIRECTORY (offline)",
        "skill install ZIP_OR_DIRECTORY --target DIR [--name NEW_NAME] (offline; no overwrite)",
        "skill install ZIP_OR_DIRECTORY --host minimax|codex|agents|project (offline; no overwrite)",
        "evaluation create --build BUILD_UUID [--source agent|provider] [--test]",
        "evaluation get|results UUID (never fabricate human votes)",
      ],
      note: "安装不会执行包内脚本，已有安装保留。build 使用本机服务；validate/install 仅需 Node，离线可用。service start 需要本机 pnpm 与 Python。",
    });
} catch (error) {
  print({
    data: null,
    error: {
      code: "CLI_ERROR",
      message: error instanceof Error ? error.message : "操作失败",
    },
  });
  process.exitCode = 1;
}
