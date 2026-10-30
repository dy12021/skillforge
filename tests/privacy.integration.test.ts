import { beforeAll, afterAll, test, expect } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool, OWNER_ID, WORKSPACE_ID } from "../packages/core/src/db";
import {
  workspaces,
  feedbackEvents,
  documentVersions,
  privacyErasures,
  skillBuilds,
  ruleHistory,
  commandReceipts,
} from "../packages/core/src/schema";
import { GET, POST, PATCH, DELETE } from "../apps/web/app/api/[...path]/route";
import { and, eq, sql } from "drizzle-orm";
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db
    .insert(workspaces)
    .values({ id: WORKSPACE_ID, owner_id: OWNER_ID, name: "test" })
    .onConflictDoNothing();
});
afterAll(() => pool.end());
async function call(
  path: string,
  body?: unknown,
  method = "POST",
  key = crypto.randomUUID(),
) {
  const r = await (
    body === undefined
      ? GET
      : method === "PATCH"
        ? PATCH
        : method === "DELETE"
          ? DELETE
          : POST
  )(
    new Request("http://localhost/api/" + path, {
      method: body === undefined ? "GET" : method,
      headers: { "Idempotency-Key": key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: r.status, ...(await r.json()) };
}
async function setup() {
  const p = (
      await call("projects", { name: "隐私清除 fixture", domain: "writing" })
    ).data,
    nonce = "PRIVATE_FIXTURE_" + crypto.randomUUID(),
    s = (
      await call("sessions", {
        project_id: p.id,
        mode: "writing",
        candidate_count: 2,
        source: "manual",
        prompt: "私密测试任务 " + nonce,
      })
    ).data,
    output = {
      topic: {
        title: "privacy fixture",
        prompt: "私密测试任务 " + nonce,
        genre: "narrative",
        target_dimension: "具体",
        difficulty: "normal",
        constraints: [],
        generation_id: crypto.randomUUID(),
      },
      candidates: ["私密原文 " + nonce, "另一个私密候选 " + nonce],
      model_details: { agent_name: "test fixture, not real AI" },
    };
  await call(`jobs/${s.job_id}/complete`, output);
  const snapshot = (await call(`sessions/${s.session.id}`)).data;
  const feedback = {
      session_id: s.session.id,
      task_id: snapshot.tasks[0].id,
      candidate_ids: snapshot.candidates.map((c: { id: string }) => c.id),
      displayed_order: snapshot.candidate_sets[0].shuffled_order_json,
      feedback_mode: "reject_all",
      comments: [
        { candidate_id: snapshot.candidates[0].id, text: "私密评语 " + nonce },
      ],
    },
    feedbackKey = crypto.randomUUID();
  await call("feedback", feedback, "POST", feedbackKey);
  return { p, s, snapshot, nonce, feedback, feedbackKey };
}
test("explicit session erasure removes raw feedback/versions/caches, redacts evidence histories and leaves independent immutable builds", async () => {
  const { p, s, snapshot, nonce, feedback, feedbackKey } = await setup(),
    v = snapshot.document_versions.find((v: { content_text: string }) =>
      v.content_text.startsWith("私密原文"),
    );
  await call("annotations", {
    document_version_id: v.id,
    start_utf16: 0,
    end_utf16: 4,
    exact_quote: "私密原文",
    label: "ai_like",
    comment: nonce,
  });
  await call("revisions", {
    document_version_id: v.id,
    operation: "manual_edit",
    content_text: "人工版本 " + nonce,
  });
  const proposal = (await call("preferences/propose", { project_id: p.id }))
    .data;
  await call(`jobs/${proposal.job_id}/complete`, {
    proposals: [
      {
        config: {
          title: "测试隐私来源规则",
          instruction: "仅本项目采用具体细节",
          family: "private-rule",
          scope: { level: "project", project_id: p.id, domain: "writing" },
          match_spec: { kind: "guidance" },
          positive_examples: [nonce],
        },
        evidence_ids: proposal.job.payload.evidence.map(
          (e: { id: string }) => e.id,
        ),
        counter_evidence_ids: [],
        rationale: "来自测试证据 " + nonce,
        confidence_summary: "自动化测试证据",
      },
    ],
    model_details: { agent_name: "test fixture" },
  });
  const rule = (await call(`preferences?project_id=${p.id}`)).data.rules.find(
    (r: { project_id: string }) => r.project_id === p.id,
  );
  await call(
    `preferences/${rule.id}`,
    { action: "confirm", expected_version: 1 },
    "PATCH",
  );
  const build = (
    await call("skills/builds", {
      project_id: p.id,
      type: "personalized-writing",
    })
  ).data.build;
  const retained = (
    await call("sessions", {
      project_id: p.id,
      mode: "writing",
      candidate_count: 2,
      source: "manual",
      prompt: "独立保留的新任务",
    })
  ).data;
  let current = (await call(`sessions/${s.session.id}`)).data;
  expect(
    (
      await call(
        `sessions/${s.session.id}`,
        { confirm: false, expected_version: current.session.version },
        "DELETE",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        `sessions/${s.session.id}`,
        { confirm: true, expected_version: 1 },
        "DELETE",
      )
    ).status,
  ).toBe(409);
  const key = crypto.randomUUID(),
    body = { confirm: true, expected_version: current.session.version },
    erased = await call(`sessions/${s.session.id}`, body, "DELETE", key);
  expect(erased.status, JSON.stringify(erased.error)).toBe(200);
  expect(erased.data.counts.feedback_events).toBeGreaterThan(1);
  expect(erased.data.counts.annotations).toBe(1);
  expect(erased.data.counts.historical_builds_retained).toBeGreaterThan(0);
  expect(
    (await call(`sessions/${s.session.id}`, body, "DELETE", key)).data
      .erasure_id,
  ).toBe(erased.data.erasure_id);
  expect((await call(`sessions/${s.session.id}`)).status).toBe(404);
  expect(
    await db
      .select()
      .from(feedbackEvents)
      .where(eq(feedbackEvents.session_id, s.session.id)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.session_id, s.session.id)),
  ).toHaveLength(0);
  expect((await call("feedback", feedback, "POST", feedbackKey)).status).toBe(
    410,
  );
  const job = (await call(`jobs/${s.job_id}`)).data;
  expect(job.payload.redacted_after_session_erasure).toBe(true);
  expect(JSON.stringify(job)).not.toContain(nonce);
  expect((await call(`jobs/${s.job_id}/retry`, {})).status).toBe(410);
  const rules = (await call(`preferences?project_id=${p.id}`)).data.rules,
    tombstone = rules.find((r: { id: string }) => r.id === rule.id);
  expect(tombstone.evidence_erased).toBe(true);
  expect(JSON.stringify(tombstone)).not.toContain(nonce);
  expect(
    (
      await call(
        `preferences/${rule.id}`,
        { action: "reopen", expected_version: tombstone.version },
        "PATCH",
      )
    ).status,
  ).toBe(410);
  const history = await db
    .select()
    .from(ruleHistory)
    .where(eq(ruleHistory.rule_id, rule.id));
  expect(history).toHaveLength(1);
  expect(JSON.stringify(history)).not.toContain(nonce);
  current = (await call(`sessions/${retained.session.id}`)).data;
  expect(current.session.id).toBe(retained.session.id);
  expect(JSON.stringify(current.jobs[0].payload)).not.toContain(nonce);
  expect((await call(`jobs/${retained.job_id}/retry`, {})).status).toBe(200);
  const old = (await call(`skills/builds/${build.id}`)).data;
  expect(old.content_hash).toBe(build.content_hash);
  await expect(
    db
      .update(privacyErasures)
      .set({ content_digest: "tamper" })
      .where(eq(privacyErasures.id, erased.data.erasure_id)),
  ).rejects.toThrow();
  await expect(
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('skillforge.erasure_owner',${OWNER_ID},true)`,
      );
      await tx.delete(skillBuilds).where(eq(skillBuilds.id, build.id));
    }),
  ).rejects.toThrow();
  const receipt = await db
    .select()
    .from(commandReceipts)
    .where(eq(commandReceipts.key, feedbackKey));
  expect(JSON.stringify(receipt)).not.toContain(nonce);
  expect(
    (await call("privacy/erasures")).data.some(
      (r: { id: string }) => r.id === erased.data.erasure_id,
    ),
  ).toBe(true);
});
test("review privacy deletion redacts derived rule history while ordinary audit deletes stay forbidden", async () => {
  const { p, s } = await setup(),
    input = {
      text: "真正的努力不是拼时间，而是找对方法。",
      context: { domain: "writing", project_id: p.id },
    },
    findings = (await call("patterns/check", input)).data.findings,
    f = findings.find((f: { family: string }) => f.family === "contrast"),
    review = (
      await call("patterns/review", {
        ...input,
        rule_id: f.rule_id,
        start_utf16: f.start_utf16,
        end_utf16: f.end_utf16,
        decision: "false_positive",
        comment: "待清除的测试误报说明",
      })
    ).data;
  const job = (await call("preferences/propose", { project_id: p.id })).data,
    other = job.job.payload.evidence.find(
      (e: { id: string }) => e.id !== review.id,
    );
  await call(`jobs/${job.job_id}/complete`, {
    proposals: [
      {
        config: {
          title: "与复核相关的测试规则",
          instruction: "必要逻辑转折保留",
          family: "review-private",
          scope: { level: "project", project_id: p.id, domain: "writing" },
          match_spec: { kind: "contrast_family" },
        },
        evidence_ids: [review.id, other.id],
        counter_evidence_ids: [],
        rationale: "待清除的测试误报说明",
        confidence_summary: "测试",
      },
    ],
    model_details: { agent_name: "test fixture" },
  });
  const row = (await call(`preferences?project_id=${p.id}`)).data.rules.find(
    (r: { project_id: string }) => r.project_id === p.id,
  );
  expect(
    (await call(`patterns/reviews/${review.id}`, { confirm: true }, "DELETE"))
      .status,
  ).toBe(200);
  expect(
    (await call("patterns")).data.reviews.some(
      (r: { id: string }) => r.id === review.id,
    ),
  ).toBe(false);
  expect(
    JSON.stringify((await call(`preferences/${row.id}/history`)).data),
  ).not.toContain("待清除的测试误报说明");
  const event = await db.query.feedbackEvents.findFirst({
    where: and(
      eq(feedbackEvents.owner_id, OWNER_ID),
      eq(feedbackEvents.session_id, s.session.id),
    ),
  });
  await expect(
    db.delete(feedbackEvents).where(eq(feedbackEvents.id, event!.id)),
  ).rejects.toThrow();
});
