import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { db, pool, WORKSPACE_ID, OWNER_ID } from "../packages/core/src/db";
import { workspaces } from "../packages/core/src/schema";
import { GET, POST } from "../apps/web/app/api/[...path]/route";
import { MockProvider, writingFixtures } from "../packages/core/src/models";
import { runOneJob } from "../packages/core/src/jobs";
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db
    .insert(workspaces)
    .values({ id: WORKSPACE_ID, owner_id: OWNER_ID, name: "Test workspace" })
    .onConflictDoNothing();
});
afterAll(async () => {
  await pool.end();
});
async function call(path: string, body?: unknown, key = crypto.randomUUID()) {
  const response = await (body === undefined ? GET : POST)(
    new Request("http://localhost/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: response.status, ...(await response.json()) };
}
async function round(count = 5) {
  const project = await call("projects", {
    name: "训练集成-" + crypto.randomUUID(),
    domain: "writing",
  });
  const created = await call("sessions", {
    project_id: project.data.id,
    mode: "writing",
    candidate_count: count,
  });
  expect(created.status).toBe(200);
  expect(created.data.job.status).toBe("awaiting_agent");
  const output = {
    topic: {
      title: "测试任务",
      prompt: "描写城市深夜。",
      genre: "narrative",
      target_dimension: "具体细节",
      difficulty: "normal",
      constraints: ["保持事实"],
      generation_id: crypto.randomUUID(),
    },
    candidates: writingFixtures.slice(0, count),
    model_details: { agent_name: "test-harness (not real AI)", model: null },
  };
  const key = crypto.randomUUID();
  const [a, b] = await Promise.all([
    call(`jobs/${created.data.job_id}/complete`, output, key),
    call(`jobs/${created.data.job_id}/complete`, output, key),
  ]);
  expect(a.status).toBe(200);
  expect(b.data.set_id).toBe(a.data.set_id);
  return (await call(`sessions/${created.data.session.id}`)).data;
}
describe("actual PostgreSQL training workflow", () => {
  test("next generation receives active feedback with its original semantics; undo invalidates pending snapshots", async () => {
    const s = await round(3),
      ids = s.candidates.map((c: { id: string }) => c.id);
    const saved = await call("feedback", {
      session_id: s.session.id,
      task_id: s.tasks[0].id,
      candidate_ids: ids,
      displayed_order: s.candidate_sets[0].shuffled_order_json,
      feedback_mode: "approve_many",
      approved_ids: [ids[0], ids[1]],
      comments: [{ candidate_id: ids[0], text: "撤销的测试评论" }],
      human_edits: [
        {
          candidate_id: ids[2],
          original: s.candidates[2].text,
          replacement: "保留的测试改写",
        },
      ],
    });
    const approval = saved.data.events.find(
        (e: { event_type: string }) => e.event_type === "candidates_approved",
      ),
      comment = saved.data.events.find(
        (e: { event_type: string }) => e.event_type === "candidate_commented",
      ),
      edit = saved.data.events.find(
        (e: { event_type: string }) => e.event_type === "human_rewrite",
      );
    await call("feedback/undo", { event_id: comment.id });
    let current = (await call(`sessions/${s.session.id}`)).data;
    const queued = await call(`sessions/${s.session.id}/candidates`, {
      expected_version: current.session.version,
      candidate_count: 3,
      generation_source: "provider",
    });
    expect(queued.status, JSON.stringify(queued.error)).toBe(200);
    const context = queued.data.job.payload.feedback_context;
    expect(context.events.map((e: { id: string }) => e.id)).toEqual(
      expect.arrayContaining([approval.id, edit.id]),
    );
    expect(JSON.stringify(context)).not.toContain("撤销的测试评论");
    expect(
      context.events.find((e: { id: string }) => e.id === approval.id).payload
        .approved_ids,
    ).toEqual([ids[0], ids[1]]);
    expect(context.candidates.map((c: { id: string }) => c.id)).toEqual(
      expect.arrayContaining(ids),
    );
    const spy = vi.spyOn(MockProvider.prototype, "generateStructured");
    try {
      for (let i = 0; i < 10; i++) {
        await runOneJob();
        if (
          (await call(`jobs/${queued.data.job_id}`)).data.status === "succeeded"
        )
          break;
      }
      expect((await call(`jobs/${queued.data.job_id}`)).data.status).toBe(
        "succeeded",
      );
      const candidateCall = spy.mock.calls.find(
        (c) => c[2].kind === "candidates",
      );
      expect(candidateCall?.[1]).toContain("保留的测试改写");
      expect(candidateCall?.[1]).not.toContain("撤销的测试评论");
    } finally {
      spy.mockRestore();
    }
    current = (await call(`sessions/${s.session.id}`)).data;
    const pending = await call(`sessions/${s.session.id}/candidates`, {
      expected_version: current.session.version,
      candidate_count: 3,
    });
    expect(
      pending.data.job.payload.feedback_context.events.some(
        (e: { id: string }) => e.id === approval.id,
      ),
    ).toBe(true);
    const undone = await call("feedback/undo", { event_id: approval.id });
    expect(undone.data.cancelled_generation).toBe(true);
    expect((await call(`jobs/${pending.data.job_id}`)).data.status).toBe(
      "cancelled",
    );
    expect(
      (await call(`jobs/${pending.data.job_id}/retry`, {})).error.code,
    ).toBe("FEEDBACK_CHANGED");
    current = (await call(`sessions/${s.session.id}`)).data;
    const fresh = await call(`sessions/${s.session.id}/candidates`, {
      expected_version: current.session.version,
      candidate_count: 3,
    });
    expect(fresh.status).toBe(200);
    expect(
      fresh.data.job.payload.feedback_context.events.map(
        (e: { id: string }) => e.id,
      ),
    ).toEqual([edit.id]);
  });
  test("corpus-derived tasks require explicit consent and project-owned source; no raw segment is sent automatically", async () => {
    const project = (
      await call("projects", {
        name: "语料来源训练 fixture",
        domain: "writing",
      })
    ).data;
    const other = (
      await call("projects", { name: "另一项目 fixture", domain: "writing" })
    ).data;
    const secret =
      "自动化语料原句，不应自动进入模型任务 " + crypto.randomUUID();
    const asset = (
      await call("corpora", {
        project_id: project.id,
        filename: "fixture.txt",
        mime: "text/plain",
        content: secret,
        source_name: "测试作者",
        license_confirmed: true,
        purpose: "observational",
      })
    ).data.asset;
    const detail = (await call(`corpora/${asset.id}`)).data;
    const base = {
      project_id: project.id,
      mode: "writing",
      source: "corpus-derived",
      prompt: "根据观察，写一个关门的动作。",
      candidate_count: 2,
      corpus_asset_id: asset.id,
      corpus_segment_id: detail.segments[0].id,
    };
    expect((await call("sessions", base)).status).toBe(400);
    expect(
      (
        await call("sessions", {
          ...base,
          project_id: other.id,
          data_transfer_confirmed: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("sessions", {
          ...base,
          corpus_segment_id: crypto.randomUUID(),
          data_transfer_confirmed: true,
        })
      ).status,
    ).toBe(404);
    const created = await call("sessions", {
      ...base,
      data_transfer_confirmed: true,
    });
    expect(created.status).toBe(200);
    expect(JSON.stringify(created.data.job.payload)).not.toContain(secret);
    expect(created.data.job.payload.corpus_segment_id).toBe(
      detail.segments[0].id,
    );
    const output = {
      topic: {
        title: "语料衍生",
        prompt: "模型擅自改题",
        genre: "narrative",
        target_dimension: "动作",
        difficulty: "normal",
        constraints: [],
        generation_id: crypto.randomUUID(),
      },
      candidates: ["甲", "乙"],
      model_details: { agent_name: "test fixture" },
    };
    expect(
      (await call(`jobs/${created.data.job_id}/complete`, output)).error.code,
    ).toBe("PROMPT_CHANGED");
    output.topic.prompt = base.prompt;
    expect(
      (await call(`jobs/${created.data.job_id}/complete`, output)).status,
    ).toBe(200);
    const saved = (await call(`sessions/${created.data.session.id}`)).data;
    expect(saved.tasks[0].source).toBe("corpus-derived");
    expect(saved.tasks[0].prompt).toBe(base.prompt);
  });
  test.each([2, 3, 5, 8])(
    "N=%i persisted and restored with provenance and shuffled display order",
    async (count) => {
      const s = await round(count);
      expect(s.candidates).toHaveLength(count);
      expect(new Set(s.candidate_sets[0].shuffled_order_json).size).toBe(count);
      expect(s.candidates[0].model_details_json.provenance).toBe(
        "agent-self-reported",
      );
    },
  );
  test("atomic mixed feedback, concurrency-safe idempotency, rollback, immutable DB events", async () => {
    const s = await round(),
      ids = s.candidates.map((c: { id: string }) => c.id),
      base = {
        session_id: s.session.id,
        task_id: s.tasks[0].id,
        candidate_ids: ids,
        displayed_order: s.candidate_sets[0].shuffled_order_json,
      };
    const invalid = {
      ...base,
      feedback_mode: null,
      comments: [{ candidate_id: ids[1], text: "不得部分写入" }],
      human_edits: [
        { candidate_id: ids[2], original: "过期原文", replacement: "新文" },
      ],
    };
    expect((await call("feedback", invalid)).status).toBe(409);
    expect(
      (await call(`sessions/${s.session.id}`)).data.feedback_events,
    ).toHaveLength(0);
    const valid = {
        ...invalid,
        human_edits: [
          {
            candidate_id: ids[2],
            original: s.candidates[2].text,
            replacement: "他渐渐学会直接说出自己的感受。",
          },
        ],
      },
      key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      call("feedback", valid, key),
      call("feedback", valid, key),
    ]);
    expect(a.status).toBe(200);
    expect(a.data.events[0].id).toBe(b.data.events[0].id);
    const restored = (await call(`sessions/${s.session.id}`)).data;
    expect(restored.feedback_events).toHaveLength(2);
    expect(restored.document_versions).toHaveLength(6);
    expect(
      restored.feedback_events.map((e: { event_type: string }) => e.event_type),
    ).toEqual(["candidate_commented", "human_rewrite"]);
    await expect(
      db.execute(
        sql`UPDATE feedback_events SET event_type='fake' WHERE id=${restored.feedback_events[0].id}`,
      ),
    ).rejects.toThrow();
    const undo = await call("feedback/undo", {
      event_id: restored.feedback_events[0].id,
    });
    expect(undo.status).toBe(200);
    expect(
      (await call(`sessions/${s.session.id}`)).data.feedback_events,
    ).toHaveLength(3);
  });
  test("approve/ranking/tie/reject remain different raw events", async () => {
    const s = await round(),
      ids = s.candidates.map((c: { id: string }) => c.id),
      base = {
        session_id: s.session.id,
        task_id: s.tasks[0].id,
        candidate_ids: ids,
        displayed_order: s.candidate_sets[0].shuffled_order_json,
      };
    for (const input of [
      { feedback_mode: "best_one", approved_ids: [ids[1]] },
      { feedback_mode: "approve_many", approved_ids: [ids[1], ids[2], ids[4]] },
      {
        feedback_mode: "full_ranking",
        ranking_groups: [[ids[1], ids[4]], [ids[2]], [ids[0], ids[3]]],
      },
      { feedback_mode: "tie" },
      { feedback_mode: "reject_all" },
    ])
      expect((await call("feedback", { ...base, ...input })).status).toBe(200);
    const restored = (await call(`sessions/${s.session.id}`)).data,
      events = restored.feedback_events;
    expect(events).toHaveLength(5);
    expect(events[1].payload_json.ranking_groups).toBeNull();
    expect(events[4].payload_json.approved_ids).toEqual([]);
  });
  test("overlapping annotations and manual revision preserve parent and require reanchoring", async () => {
    const s = await round(2),
      parent = s.document_versions[0],
      text = parent.content_text;
    const first = await call("annotations", {
      document_version_id: parent.id,
      start_utf16: 0,
      end_utf16: 6,
      exact_quote: text.slice(0, 6),
      label: "excellent",
    });
    expect(first.status).toBe(200);
    expect(
      (
        await call("annotations", {
          document_version_id: parent.id,
          start_utf16: 2,
          end_utf16: 5,
          exact_quote: text.slice(2, 5),
          label: "other",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("annotations", {
          document_version_id: parent.id,
          start_utf16: 0,
          end_utf16: 6,
          exact_quote: "不匹配原文",
          label: "ai_like",
        })
      ).status,
    ).toBe(409);
    const revision = await call("revisions", {
      document_version_id: parent.id,
      content_text: "新的人工文本。🙂",
    });
    expect(revision.status).toBe(200);
    expect(revision.data.annotation_reanchoring).toHaveLength(2);
    expect(revision.data.annotation_reanchoring[0].status).toBe(
      "needs_reanchor",
    );
    const restored = (await call(`sessions/${s.session.id}`)).data;
    expect(restored.annotations).toHaveLength(2);
    expect(
      restored.document_versions.find((v: { id: string }) => v.id === parent.id)
        .content_text,
    ).toBe(text);
    await expect(
      db.execute(
        sql`UPDATE document_versions SET content_text='覆盖' WHERE id=${parent.id}`,
      ),
    ).rejects.toThrow();
  });
  test("provider worker runs mock jobs without claiming real generation", async () => {
    const project = await call("projects", {
        name: "mock worker",
        domain: "dialogue",
      }),
      s = await call("sessions", {
        project_id: project.data.id,
        mode: "dialogue",
        candidate_count: 3,
        generation_source: "provider",
        granularity: "single-turn",
      });
    expect(s.data.job.status).toBe("queued");
    expect(await runOneJob()).toBe(true);
    const job = (await call(`jobs/${s.data.job_id}`)).data;
    expect(job.status).toBe("succeeded");
    expect(job.result.provider).toBe("mock");
  });
});
