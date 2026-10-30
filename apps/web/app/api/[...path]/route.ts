import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@skillforge/core/db";
import { command } from "@skillforge/core/commands";
import { AppError, safeLog } from "@skillforge/core/errors";
import { publicConfig } from "@skillforge/core/config";
import {
  projectInput,
  projectUpdate,
  workspaceUpdate,
  listProjects,
  getProject,
  createProject,
  changeProject,
  getWorkspace,
  updateWorkspace,
} from "@skillforge/core/projects";
import {
  sessionInput,
  generationInput,
  createSession,
  nextRound,
  getJob,
  pendingAgentJobs,
  sessionSnapshot,
  listSessions,
  finishSession,
} from "@skillforge/core/training";
import {
  feedbackInput,
  saveFeedback,
  undoInput,
  undoFeedback,
} from "@skillforge/core/feedback";
import {
  annotationInput,
  addAnnotation,
  manualRevisionInput,
  manualRevision,
} from "@skillforge/core/annotations";
import { changeJob } from "@skillforge/core/jobs";
import { completeModelOutput } from "@skillforge/core/model-dispatch";
import {
  requestRevision,
  revisionRequest,
  decideRevision,
  revisionDecision,
  listRevisions,
} from "@skillforge/core/revisions";
import {
  requestTopic,
  topicRequest,
  listTopics,
} from "@skillforge/core/topics";
import {
  listPatterns,
  createPattern,
  patternInput,
  changePattern,
  patternUpdate,
  checkPatterns,
  patternCheckInput,
  reviewPattern,
  patternReviewInput,
  requestContext,
  contextRequest,
} from "@skillforge/core/patterns";
import {
  listPreferences,
  createPreference,
  manualPreference,
  changePreference,
  preferenceUpdate,
  preferenceHistory,
  requestPreferences,
  preferenceRequest,
  activeFeedbackEvidence,
} from "@skillforge/core/preferences";
import {
  importCorpus,
  corpusInput,
  listCorpora,
  corpusDetail,
  downloadCorpus,
  changeSegment,
  segmentUpdate,
  extractCorpus,
  corpusExtract,
  decideDiscovery,
  discoveryDecision,
  deleteCorpus,
  corpusDelete,
} from "@skillforge/core/corpus";
import {
  compileSkill,
  skillBuildInput,
  listSkillBuilds,
  getSkillBuild,
  downloadSkillBuild,
} from "@skillforge/core/skill-compiler";
import { exportWorkspace } from "@skillforge/core/export";
import { defaultHoldouts } from "@skillforge/core/holdouts";
import {
  eraseSession,
  eraseSessionInput,
  erasePatternReview,
  eraseReviewInput,
  listPrivacyErasures,
} from "@skillforge/core/privacy";
import {
  createEvaluation,
  evaluationInput,
  listEvaluations,
  getEvaluation,
  saveEvaluationVote,
  evaluationVoteInput,
  evaluationResults,
} from "@skillforge/core/evaluations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    const url = new URL(req.url);
    // Next may canonicalize req.url to localhost; the validated Host is the browser's origin.
    const incoming = new URL(
      `${url.protocol}//${req.headers.get("host") ?? url.host}`,
    );
    if (!["localhost", "127.0.0.1", "[::1]"].includes(incoming.hostname))
      throw new AppError(403, "LOCAL_ONLY", "当前仅支持本机单用户访问");
    const origin = req.headers.get("origin");
    if (origin && origin !== incoming.origin)
      throw new AppError(403, "ORIGIN_REJECTED", "不允许跨站调用本地 API");
    const path = url.pathname.replace(/^\/api\//, "").split("/");
    const method = req.method;
    let body: unknown = {};
    if (["POST", "PATCH", "DELETE"].includes(method)) {
      const raw = await req.text();
      const maxBody =
        path[0] === "jobs" && path[2] === "complete"
          ? 2_500_000
          : path[0] === "corpora" && !path[1]
            ? 1_450_000
            : 256000;
      if (Buffer.byteLength(raw) > maxBody)
        throw new AppError(
          413,
          "BODY_TOO_LARGE",
          `请求内容超过 ${maxBody} 字节上限`,
        );
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw new AppError(400, "INVALID_JSON", "请求不是有效 JSON");
      }
    }
    let data: unknown;
    if (method === "GET" && path[0] === "sessions" && path[2] === "export")
      return Response.json(await sessionSnapshot(z.uuid().parse(path[1])), {
        headers: {
          "Content-Disposition": `attachment; filename="skillforge-session-${z.uuid().parse(path[1])}.json"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    if (method === "GET" && path[0] === "privacy" && path[1] === "erasures")
      data = await listPrivacyErasures();
    else if (method === "DELETE" && path[0] === "sessions" && path[1])
      data = await command(
        req.headers.get("Idempotency-Key"),
        `privacy:session:${path[1]}`,
        body,
        (tx) =>
          eraseSession(
            tx,
            z.uuid().parse(path[1]),
            eraseSessionInput.parse(body),
          ),
      );
    else if (
      method === "DELETE" &&
      path[0] === "patterns" &&
      path[1] === "reviews" &&
      path[2]
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        `privacy:review:${path[2]}`,
        body,
        (tx) => {
          eraseReviewInput.parse(body);
          return erasePatternReview(tx, z.uuid().parse(path[2]));
        },
      );
    else if (method === "POST" && path[0] === "evaluations" && !path[1])
      data = await command(
        req.headers.get("Idempotency-Key"),
        "evaluations:create",
        body,
        (tx) => createEvaluation(tx, evaluationInput.parse(body)),
      );
    else if (
      method === "POST" &&
      path[0] === "evaluations" &&
      path[2] === "votes"
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        `evaluations:vote:${path[1]}`,
        body,
        (tx) =>
          saveEvaluationVote(
            tx,
            z.uuid().parse(path[1]),
            evaluationVoteInput.parse(body),
          ),
      );
    else if (
      method === "GET" &&
      path[0] === "evaluations" &&
      path[2] === "results"
    )
      data = await evaluationResults(z.uuid().parse(path[1]));
    else if (
      method === "GET" &&
      path[0] === "evaluations" &&
      path[1] === "templates"
    )
      data = defaultHoldouts(
        z.enum(["writing", "dialogue"]).parse(url.searchParams.get("domain")),
      );
    else if (method === "GET" && path[0] === "evaluations" && path[1])
      data = await getEvaluation(z.uuid().parse(path[1]));
    else if (method === "GET" && path[0] === "evaluations")
      data = await listEvaluations();
    else if (method === "GET" && path[0] === "export")
      return Response.json(await exportWorkspace(), {
        headers: {
          "Content-Disposition": "attachment; filename=skillforge-backup.json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    else if (method === "POST" && path[0] === "skills" && path[1] === "builds")
      data = await command(
        req.headers.get("Idempotency-Key"),
        "skills:build",
        body,
        (tx) => compileSkill(tx, skillBuildInput.parse(body)),
      );
    else if (
      method === "GET" &&
      path[0] === "skills" &&
      path[1] === "builds" &&
      path[3] === "download"
    ) {
      const file = await downloadSkillBuild(z.uuid().parse(path[2]));
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Length": String(file.bytes.length),
          "Content-Disposition": `attachment; filename="${file.build.skill_type}-${file.build.semantic_version}.zip"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Content-SHA256": file.build.zip_hash,
        },
      });
    } else if (
      method === "GET" &&
      path[0] === "skills" &&
      path[1] === "builds" &&
      path[2]
    )
      data = await getSkillBuild(z.uuid().parse(path[2]));
    else if (method === "GET" && path[0] === "skills" && path[1] === "builds")
      data = await listSkillBuilds(
        url.searchParams.has("project_id")
          ? z.uuid().parse(url.searchParams.get("project_id"))
          : undefined,
      );
    else if (
      method === "GET" &&
      path[0] === "corpora" &&
      path[2] === "download"
    ) {
      const file = await downloadCorpus(z.uuid().parse(path[1]));
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(file.bytes.length),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.asset.filename)}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    } else if (method === "GET" && path[0] === "corpora" && path[1])
      data = await corpusDetail(z.uuid().parse(path[1]));
    else if (method === "GET" && path[0] === "corpora")
      data = await listCorpora(
        url.searchParams.has("project_id")
          ? z.uuid().parse(url.searchParams.get("project_id"))
          : undefined,
      );
    else if (method === "POST" && path[0] === "corpora" && !path[1])
      data = await command(
        req.headers.get("Idempotency-Key"),
        "corpora:import",
        body,
        (tx) => importCorpus(tx, corpusInput.parse(body)),
      );
    else if (
      method === "POST" &&
      path[0] === "corpora" &&
      path[2] === "extract"
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        `corpora:extract:${path[1]}`,
        body,
        (tx) =>
          extractCorpus(tx, z.uuid().parse(path[1]), corpusExtract.parse(body)),
      );
    else if (
      method === "PATCH" &&
      path[0] === "corpora" &&
      path[2] === "segments" &&
      path[3]
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        `corpora:segment:${path[3]}`,
        body,
        (tx) =>
          changeSegment(
            tx,
            z.uuid().parse(path[1]),
            z.uuid().parse(path[3]),
            segmentUpdate.parse(body),
          ),
      );
    else if (
      method === "POST" &&
      path[0] === "corpora" &&
      path[2] === "discoveries" &&
      path[3]
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        `corpora:discovery:${path[3]}`,
        body,
        (tx) =>
          decideDiscovery(
            tx,
            z.uuid().parse(path[1]),
            z.uuid().parse(path[3]),
            discoveryDecision.parse(body),
          ),
      );
    else if (method === "DELETE" && path[0] === "corpora" && path[1])
      data = await command(
        req.headers.get("Idempotency-Key"),
        `corpora:delete:${path[1]}`,
        body,
        (tx) =>
          deleteCorpus(tx, z.uuid().parse(path[1]), corpusDelete.parse(body)),
      );
    else if (method === "GET" && path[0] === "patterns")
      data = await listPatterns();
    else if (method === "POST" && path[0] === "patterns" && path[1] === "check")
      data = await command(
        req.headers.get("Idempotency-Key"),
        "patterns:check",
        body,
        (tx) => checkPatterns(patternCheckInput.parse(body), tx),
      );
    else if (
      method === "POST" &&
      path[0] === "patterns" &&
      path[1] === "review"
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        "patterns:review",
        body,
        (tx) => reviewPattern(tx, patternReviewInput.parse(body)),
      );
    else if (
      method === "POST" &&
      path[0] === "patterns" &&
      path[1] === "context"
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        "patterns:context",
        body,
        (tx) => requestContext(tx, contextRequest.parse(body)),
      );
    else if (method === "POST" && path[0] === "patterns" && !path[1])
      data = await command(
        req.headers.get("Idempotency-Key"),
        "patterns:create",
        body,
        (tx) => createPattern(tx, patternInput.parse(body)),
      );
    else if (method === "PATCH" && path[0] === "patterns" && path[1])
      data = await command(
        req.headers.get("Idempotency-Key"),
        `patterns:update:${path[1]}`,
        body,
        (tx) =>
          changePattern(tx, z.uuid().parse(path[1]), patternUpdate.parse(body)),
      );
    else if (
      method === "GET" &&
      path[0] === "preferences" &&
      path[1] === "evidence"
    )
      data = await db.transaction((tx) =>
        activeFeedbackEvidence(
          tx,
          z.uuid().parse(url.searchParams.get("project_id")),
        ),
      );
    else if (
      method === "GET" &&
      path[0] === "preferences" &&
      path[2] === "history"
    )
      data = await preferenceHistory(z.uuid().parse(path[1]));
    else if (method === "GET" && path[0] === "preferences")
      data = await listPreferences(
        url.searchParams.has("project_id")
          ? z.uuid().parse(url.searchParams.get("project_id"))
          : undefined,
      );
    else if (
      method === "POST" &&
      path[0] === "preferences" &&
      path[1] === "propose"
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        "preferences:propose",
        body,
        (tx) => requestPreferences(tx, preferenceRequest.parse(body)),
      );
    else if (method === "POST" && path[0] === "preferences" && !path[1])
      data = await command(
        req.headers.get("Idempotency-Key"),
        "preferences:create",
        body,
        (tx) => createPreference(tx, manualPreference.parse(body)),
      );
    else if (method === "PATCH" && path[0] === "preferences" && path[1])
      data = await command(
        req.headers.get("Idempotency-Key"),
        `preferences:update:${path[1]}`,
        body,
        (tx) =>
          changePreference(
            tx,
            z.uuid().parse(path[1]),
            preferenceUpdate.parse(body),
          ),
      );
    else if (
      method === "POST" &&
      path[0] === "topics" &&
      path[1] === "generate"
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        "topics:generate",
        body,
        (tx) => requestTopic(tx, topicRequest.parse(body)),
      );
    else if (method === "GET" && path[0] === "topics")
      data = await listTopics(
        z.uuid().parse(url.searchParams.get("project_id")),
      );
    else if (method === "GET" && path[0] === "health") {
      await db.execute(sql`SELECT 1`);
      data = { database: "connected", ...publicConfig() };
    } else if (method === "GET" && path[0] === "settings")
      data = publicConfig();
    else if (method === "GET" && path[0] === "workspace")
      data = await getWorkspace();
    else if (method === "PATCH" && path[0] === "workspace")
      data = await command(
        req.headers.get("Idempotency-Key"),
        "workspace:update",
        body,
        (tx) => updateWorkspace(tx, workspaceUpdate.parse(body)),
      );
    else if (method === "GET" && path[0] === "projects" && !path[1])
      data = await listProjects();
    else if (
      method === "GET" &&
      path[0] === "projects" &&
      path[1] &&
      path[2] === "sessions"
    )
      data = await listSessions(z.uuid().parse(path[1]));
    else if (method === "GET" && path[0] === "projects" && path[1])
      data = await getProject(z.uuid().parse(path[1]));
    else if (method === "POST" && path[0] === "projects" && !path[1])
      data = await command(
        req.headers.get("Idempotency-Key"),
        "projects:create",
        body,
        (tx) => createProject(tx, projectInput.parse(body)),
      );
    else if (
      ["PATCH", "DELETE"].includes(method) &&
      path[0] === "projects" &&
      path[1]
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        `projects:${method}:${path[1]}`,
        body,
        (tx) =>
          changeProject(
            tx,
            z.uuid().parse(path[1]),
            projectUpdate.parse(body),
            method === "DELETE",
          ),
      );
    else if (method === "POST" && path[0] === "sessions" && !path[1])
      data = await command(
        req.headers.get("Idempotency-Key"),
        "sessions:create",
        body,
        (tx) => createSession(tx, sessionInput.parse(body)),
      );
    else if (method === "GET" && path[0] === "sessions" && path[1])
      data = await sessionSnapshot(z.uuid().parse(path[1]));
    else if (
      method === "POST" &&
      path[0] === "sessions" &&
      path[2] === "candidates"
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        `sessions:round:${path[1]}`,
        body,
        (tx) =>
          nextRound(
            tx,
            z.uuid().parse(path[1]),
            generationInput
              .safeExtend({ expected_version: z.number().int().positive() })
              .parse(body),
          ),
      );
    else if (
      method === "POST" &&
      path[0] === "sessions" &&
      path[2] === "finish"
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        `sessions:finish:${path[1]}`,
        body,
        (tx) =>
          finishSession(
            tx,
            z.uuid().parse(path[1]),
            z
              .object({ expected_version: z.number().int().positive() })
              .strict()
              .parse(body).expected_version,
          ),
      );
    else if (method === "GET" && path[0] === "jobs" && !path[1])
      data = await pendingAgentJobs();
    else if (method === "GET" && path[0] === "jobs" && path[1])
      data = await getJob(z.uuid().parse(path[1]));
    else if (method === "POST" && path[0] === "jobs" && path[2] === "complete")
      data = await command(
        req.headers.get("Idempotency-Key"),
        `jobs:complete:${path[1]}`,
        body,
        (tx) => completeModelOutput(tx, z.uuid().parse(path[1]), body),
      );
    else if (
      method === "POST" &&
      path[0] === "jobs" &&
      ["retry", "cancel"].includes(path[2])
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        `jobs:${path[2]}:${path[1]}`,
        body,
        (tx) =>
          changeJob(tx, z.uuid().parse(path[1]), path[2] as "retry" | "cancel"),
      );
    else if (method === "POST" && path[0] === "feedback" && !path[1])
      data = await command(
        req.headers.get("Idempotency-Key"),
        "feedback:create",
        body,
        (tx) =>
          saveFeedback(
            tx,
            feedbackInput.parse(body),
            req.headers.get("Idempotency-Key")!,
          ),
      );
    else if (method === "POST" && path[0] === "feedback" && path[1] === "undo")
      data = await command(
        req.headers.get("Idempotency-Key"),
        "feedback:undo",
        body,
        (tx) =>
          undoFeedback(
            tx,
            undoInput.parse(body),
            req.headers.get("Idempotency-Key")!,
          ),
      );
    else if (method === "POST" && path[0] === "annotations")
      data = await command(
        req.headers.get("Idempotency-Key"),
        "annotations:create",
        body,
        (tx) =>
          addAnnotation(
            tx,
            annotationInput.parse(body),
            req.headers.get("Idempotency-Key")!,
          ),
      );
    else if (method === "GET" && path[0] === "revisions")
      data = await listRevisions(
        z.uuid().parse(url.searchParams.get("session_id")),
      );
    else if (
      method === "POST" &&
      path[0] === "revisions" &&
      path[2] === "decision"
    )
      data = await command(
        req.headers.get("Idempotency-Key"),
        `revisions:decision:${path[1]}`,
        body,
        (tx) =>
          decideRevision(
            tx,
            z.uuid().parse(path[1]),
            revisionDecision.parse(body),
            req.headers.get("Idempotency-Key")!,
          ),
      );
    else if (method === "POST" && path[0] === "revisions" && !path[1])
      data = await command<unknown>(
        req.headers.get("Idempotency-Key"),
        "revisions:manual",
        body,
        (tx) =>
          "generation_source" in (body as Record<string, unknown>)
            ? requestRevision(tx, revisionRequest.parse(body))
            : manualRevision(
                tx,
                manualRevisionInput.parse(body),
                req.headers.get("Idempotency-Key")!,
              ),
      );
    else throw new AppError(404, "NOT_FOUND", "此 API 尚不存在");
    return Response.json(
      { data, error: null, request_id: requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    let status = 503,
      code = "DATABASE_UNAVAILABLE",
      message = "数据库不可用，请启动 Docker 并运行迁移和 seed";
    if (error instanceof AppError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof z.ZodError) {
      status = 400;
      code = "VALIDATION_ERROR";
      message = error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    }
    safeLog(requestId, code);
    return Response.json(
      { data: null, error: { code, message }, request_id: requestId },
      { status },
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
