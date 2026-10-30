import { beforeAll, afterAll, describe, test, expect } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool, OWNER_ID, WORKSPACE_ID } from "../packages/core/src/db";
import { workspaces } from "../packages/core/src/schema";
import { GET, POST } from "../apps/web/app/api/[...path]/route";
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
  const r = await (body === undefined ? GET : POST)(
    new Request("http://localhost/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Idempotency-Key": key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: r.status, ...(await r.json()) };
}
const details = {
  agent_name: "isolated test harness, not real AI",
  model: null,
};
function output(
  prompt = "保留原句。计划成本为30元，不允许修改引语：“周六见”。",
) {
  return {
    topic: {
      title: "修订测试",
      prompt,
      genre: "narrative",
      target_dimension: "明确具体",
      difficulty: "normal",
      constraints: ["保持事实"],
      generation_id: crypto.randomUUID(),
    },
    candidates: [prompt, "保留原句。另一候选，费用30元。"],
    model_details: details,
  };
}
async function setup() {
  const project = await call("projects", {
      name: "Revision test " + crypto.randomUUID(),
      domain: "writing",
    }),
    session = await call("sessions", {
      project_id: project.data.id,
      mode: "writing",
      candidate_count: 2,
    }),
    raw = output();
  expect((await call(`jobs/${session.data.job_id}/complete`, raw)).status).toBe(
    200,
  );
  return {
    project: project.data,
    snapshot: (await call(`sessions/${session.data.session.id}`)).data,
  };
}
describe("AI revision proposals and actual state transitions", () => {
  test("protected text, immutable parent, explicit semantic confirmation and optimistic decisions", async () => {
    const { snapshot: s } = await setup(),
      parent = s.document_versions[0];
    expect(
      (
        await call("annotations", {
          document_version_id: parent.id,
          start_utf16: 0,
          end_utf16: 5,
          exact_quote: "保留原句。",
          label: "excellent",
        })
      ).status,
    ).toBe(200);
    const blocked = await call("revisions", {
      document_version_id: parent.id,
      operation: "revise_selection",
      instruction: "修改",
      generation_source: "agent",
      start_utf16: 0,
      end_utf16: 5,
      exact_quote: "保留原句。",
    });
    expect(blocked.status).toBe(409);
    const request = await call("revisions", {
      document_version_id: parent.id,
      operation: "revise_document",
      instruction: "使表达自然，保持事实",
      generation_source: "agent",
    });
    expect(request.status).toBe(200);
    expect(
      (
        await call(`jobs/${request.data.job_id}/complete`, {
          replacement: "删掉了保护区。",
          rationale: "错误示例",
          model_details: details,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(`jobs/${request.data.job_id}/complete`, {
          replacement: "保留原句。计划成本为40元，允许修改引语：“改天见”。",
          rationale: "故意产生需复核变化的测试建议",
          model_details: details,
        })
      ).status,
    ).toBe(200);
    let row = (await call(`revisions?session_id=${s.session.id}`)).data[0];
    expect(row.semantic_warnings.some((v: string) => v.includes("数字"))).toBe(
      true,
    );
    expect(row.status).toBe("pending");
    expect(
      (await call(`sessions/${s.session.id}`)).data.document_versions,
    ).toHaveLength(2);
    expect(
      (
        await call(`revisions/${row.id}/decision`, {
          decision: "accept",
          expected_version: row.version,
        })
      ).error.code,
    ).toBe("SEMANTIC_CONFIRMATION_REQUIRED");
    const accepted = await call(`revisions/${row.id}/decision`, {
      decision: "accept",
      expected_version: row.version,
      semantic_confirmed: true,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.data.version.parent_version_id).toBe(parent.id);
    const snapshot = (await call(`sessions/${s.session.id}`)).data;
    expect(
      snapshot.document_versions.find((v: { id: string }) => v.id === parent.id)
        .content_text,
    ).toBe(parent.content_text);
    expect(snapshot.document_versions).toHaveLength(3);
    expect(
      (
        await call(`revisions/${row.id}/decision`, {
          decision: "reject",
          expected_version: row.version,
        })
      ).status,
    ).toBe(409);
    row = (await call(`revisions?session_id=${s.session.id}`)).data[0];
    expect(row.status).toBe("accepted");
    const select = await call("annotations", {
      document_version_id: accepted.data.version.id,
      start_utf16: 0,
      end_utf16: 5,
      exact_quote: "保留原句。",
      label: "excellent",
      reanchored_from_id: snapshot.annotations[0].id,
    });
    expect(select.status).toBe(200);
    expect(select.data.annotation.reanchored_from_id).toBe(
      snapshot.annotations[0].id,
    );
  });
  test("rejection, edit_again and provider mock do not silently create accepted text", async () => {
    const { snapshot: s } = await setup(),
      parent = s.document_versions[0];
    const request = await call("revisions", {
      document_version_id: parent.id,
      operation: "revise_document",
      instruction: "测试建议",
      generation_source: "provider",
    });
    expect(request.status).toBe(200);
    for (let i = 0; i < 6; i++) {
      await runOneJob();
      const job = (await call(`jobs/${request.data.job_id}`)).data;
      if (job.status === "succeeded") break;
    }
    let row = (await call(`revisions?session_id=${s.session.id}`)).data[0];
    expect(row.status).toBe("pending");
    expect(row.model_details_json.simulated).toBe(true);
    const again = await call(`revisions/${row.id}/decision`, {
      decision: "edit_again",
      expected_version: row.version,
      instruction: "新要求",
    });
    expect(again.status).toBe(200);
    const snapshot = (await call(`sessions/${s.session.id}`)).data;
    expect(snapshot.document_versions).toHaveLength(2);
    expect(snapshot.revisions).toHaveLength(2);
    expect(snapshot.revisions[0].status).toBe("rejected");
    await call(`jobs/${again.data.job_id}/cancel`, {});
    row = (await call(`revisions?session_id=${s.session.id}`)).data.find(
      (r: { id: string }) => r.id === request.data.revision.id,
    );
    expect(row.status).toBe("rejected");
  });
  test("standalone topics validate source, deduplicate and remain fixed during candidate generation", async () => {
    const { project } = await setup(),
      topic = output("独立新题：描写早晨市场里的具体动作。").topic;
    const created = await call("topics/generate", { project_id: project.id });
    expect(created.status).toBe(200);
    const submitted = await call(`jobs/${created.data.job_id}/complete`, {
      topic,
      model_details: details,
    });
    expect(submitted.status).toBe(200);
    const duplicate = await call("topics/generate", { project_id: project.id });
    expect(
      (
        await call(`jobs/${duplicate.data.job_id}/complete`, {
          topic,
          model_details: details,
        })
      ).status,
    ).toBe(409);
    const round = await call("sessions", {
      project_id: project.id,
      mode: "writing",
      candidate_count: 2,
      topic_id: submitted.data.topic_id,
    });
    expect(
      (
        await call(`jobs/${round.data.job_id}/complete`, {
          ...output(),
          topic: { ...topic, prompt: "擅自修改" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await call(`jobs/${round.data.job_id}/complete`, { ...output(), topic }))
        .status,
    ).toBe(200);
    expect((await call(`topics?project_id=${project.id}`)).data).toHaveLength(
      1,
    );
  });
  test("challenger retains selected champion and accepts no fabricated winner from reject_all", async () => {
    const { snapshot: s } = await setup(),
      set = s.candidate_sets[0],
      ids = s.candidates.map((c: { id: string }) => c.id),
      base = {
        session_id: s.session.id,
        task_id: s.tasks[0].id,
        candidate_ids: ids,
        displayed_order: set.shuffled_order_json,
      };
    await call("feedback", { ...base, feedback_mode: "reject_all" });
    let snapshot = (await call(`sessions/${s.session.id}`)).data;
    expect(
      (
        await call(`sessions/${s.session.id}/candidates`, {
          source: "auto",
          candidate_count: 2,
          strategy: "challenger",
          expected_version: snapshot.session.version,
        })
      ).status,
    ).toBe(409);
    await call("feedback", {
      ...base,
      feedback_mode: "best_one",
      approved_ids: [ids[0]],
    });
    snapshot = (await call(`sessions/${s.session.id}`)).data;
    const next = await call(`sessions/${s.session.id}/candidates`, {
      source: "auto",
      candidate_count: 2,
      strategy: "challenger",
      expected_version: snapshot.session.version,
    });
    expect(next.status).toBe(200);
    expect(next.data.job.payload.champion.text).toBe(s.candidates[0].text);
    const raw = output();
    expect(
      (
        await call(`jobs/${next.data.job_id}/complete`, {
          ...raw,
          candidates: ["修改了优胜者", "新挑战者"],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(`jobs/${next.data.job_id}/complete`, {
          ...raw,
          candidates: [s.candidates[0].text, "另一种新的挑战版本。"],
        })
      ).status,
    ).toBe(200);
    snapshot = (await call(`sessions/${s.session.id}`)).data;
    expect(snapshot.candidate_sets).toHaveLength(2);
    expect(
      snapshot.candidates.find(
        (c: { set_id: string; position: number }) =>
          c.set_id === snapshot.candidate_sets[1].id && c.position === 0,
      ).text,
    ).toBe(s.candidates[0].text);
  });
});
