"use client";
import { useEffect, useState, useCallback } from "react";
import { api } from "../../lib/api";
import RuleEditor, { type ProjectOption } from "../../components/rule-editor";
import { ruleConfig } from "@skillforge/core/rule-types";
import type {
  listPreferences,
  preferenceHistory,
} from "@skillforge/core/preferences";
type Data = Awaited<ReturnType<typeof listPreferences>>;
type Job = {
  id: string;
  status: string;
  error_code?: string;
  project_id?: string;
  job_type?: string;
};
export default function Preferences() {
  const [projects, setProjects] = useState<ProjectOption[]>([]),
    [projectId, setProjectId] = useState(""),
    [ready, setReady] = useState(false),
    [data, setData] = useState<Data>({ rules: [], conflicts: [] }),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [source, setSource] = useState("agent"),
    [job, setJob] = useState<Job | null>(null),
    [editing, setEditing] = useState(""),
    [history, setHistory] = useState<
      Awaited<ReturnType<typeof preferenceHistory>>
    >([]),
    [evidence, setEvidence] = useState<unknown[]>([]),
    [openEvidence, setOpenEvidence] = useState(""),
    [busy, setBusy] = useState(false),
    [resolve, setResolve] = useState<Record<string, string[]>>({});
  const read = useCallback(
    () =>
      api<Data>("preferences" + (projectId ? `?project_id=${projectId}` : "")),
    [projectId],
  );
  const load = useCallback(() => read().then(setData), [read]);
  useEffect(() => {
    api<ProjectOption[]>("projects")
      .then((rows) => {
        setProjects(rows);
        const id = new URLSearchParams(window.location.search).get(
          "project_id",
        );
        if (id && rows.some((p) => p.id === id)) setProjectId(id);
        setReady(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!ready) return;
    let current = true;
    read()
      .then((rows) => {
        if (current) setData(rows);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [read, ready]);
  useEffect(() => {
    if (!job || ["succeeded", "failed", "cancelled"].includes(job.status))
      return;
    const interval = setInterval(
      () =>
        api<Job>(`jobs/${job.id}`)
          .then((j) => {
            setJob(j);
            if (j.status === "succeeded")
              void load().catch((e) => setError(e.message));
          })
          .catch((e) => setError(e.message)),
      2000,
    );
    return () => clearInterval(interval);
  }, [job, load]);
  async function act(action: () => Promise<unknown>, message: string) {
    setError("");
    setBusy(true);
    try {
      await action();
      await load();
      setStatus(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function propose() {
    await act(async () => {
      const result = await api<{ job: Job }>("preferences/propose", "POST", {
        project_id: projectId,
        generation_source: source,
      });
      setJob(result.job);
    }, "规则提议任务已创建；输出仍需人工确认");
  }
  async function showEvidence(row: Data["rules"][number]) {
    setError("");
    try {
      setOpenEvidence(row.id);
      setHistory(await api(`preferences/${row.id}/history`));
      setEvidence(
        row.project_id
          ? (
              await api<{ id: string }[]>(
                `preferences/evidence?project_id=${row.project_id}`,
              )
            ).filter(
              (e) =>
                row.evidence_ids.includes(e.id) ||
                row.counter_evidence_ids.includes(e.id),
            )
          : [],
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="eyebrow">EVIDENCE & PREFERENCES</div>
      <h1>有证据的偏好规则</h1>
      <p>
        模型提出假设，用户确认范围。未确认规则不进入默认成品；用户手动添加也先保存为待确认。
      </p>
      <section className="panel">
        <label htmlFor="preferences-project">项目筛选与提议来源</label>
        <select
          id="preferences-project"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setJob(null);
          }}
        >
          <option value="">全部项目与用户级规则</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.domain}
            </option>
          ))}
        </select>
        <label htmlFor="preferences-source">提议模型来源</label>
        <select
          id="preferences-source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="agent">宿主 Agent</option>
          <option value="provider">应用内 provider（默认 mock）</option>
        </select>
        <div className="actions">
          <button
            disabled={
              !projectId ||
              busy ||
              (!!job &&
                ["awaiting_agent", "queued", "running"].includes(job.status))
            }
            onClick={propose}
          >
            从未撤销反馈生成偏好提议
          </button>
        </div>
        <p className="muted">
          需要至少两条证据；多选不产生内部排名，全拒绝不产生正例。
        </p>
        {job && (
          <div className="notice">
            {job.status} {job.error_code}
            <pre className="mono">pnpm skillforge job get {job.id}</pre>
            {["failed", "cancelled"].includes(job.status) && (
              <button
                className="secondary"
                onClick={() =>
                  act(
                    async () =>
                      setJob(await api(`jobs/${job.id}/retry`, "POST", {})),
                    "已重试",
                  )
                }
              >
                重试提议
              </button>
            )}
            {["awaiting_agent", "queued", "running"].includes(job.status) && (
              <button
                className="secondary"
                onClick={() =>
                  act(
                    async () =>
                      setJob(await api(`jobs/${job.id}/cancel`, "POST", {})),
                    "任务已取消",
                  )
                }
              >
                取消提议任务
              </button>
            )}
          </div>
        )}
      </section>
      {error && (
        <div role="alert" aria-label="偏好操作错误" className="notice error">
          {error}
        </div>
      )}
      <p role="status" aria-label="偏好保存状态">
        {status}
      </p>
      <details>
        <summary>手动添加规则</summary>
        <RuleEditor
          key={"new-" + projectId}
          projects={projects}
          projectId={projectId}
          onSave={async (config) => {
            await api("preferences", "POST", { config });
            await load();
            setStatus("已保存 proposed，等待确认");
          }}
        />
      </details>
      {data.conflicts.length > 0 && (
        <section className="notice">
          <h2>潜在冲突</h2>
          {data.conflicts.map((c) => (
            <p key={c.left + c.right}>
              {c.reason} ·{" "}
              {c.same_level
                ? "同层级，需明确处理"
                : "高优先级规则覆盖此语境的低优先级指导"}
            </p>
          ))}
        </section>
      )}
      {!data.rules.length && (
        <p>尚无规则。先在训练会话留下反馈，或手动提出规则。</p>
      )}
      {data.rules.map((row) => {
        const config = ruleConfig.parse(row.config_json),
          conflicts = data.conflicts
            .filter(
              (c) => c.same_level && (c.left === row.id || c.right === row.id),
            )
            .map((c) => (c.left === row.id ? c.right : c.left))
            .filter((id) =>
              data.rules.some((r) => r.id === id && r.status === "confirmed"),
            );
        return (
          <article className="panel" key={row.id} data-testid="preference-rule">
            <div className="row spread">
              <h2>{config.title}</h2>
              <span className="badge">
                {row.status} · v{row.version}
              </span>
            </div>
            <p>{config.instruction}</p>
            <p>
              {config.scope.domain} / {config.scope.level} /{" "}
              {config.scope.genre || "不限体裁"} · {config.strength}
            </p>
            <p>例外：{config.exceptions.join("、")}</p>
            <p>{row.rationale}</p>
            <p className="muted">
              {row.confidence_summary} · 支持证据 {row.evidence_ids.length}{" "}
              条，反证 {row.counter_evidence_ids.length} 条
            </p>
            <p className="muted">
              {row.model_details_json?.simulated
                ? "模拟提议，不代表真实学习"
                : row.source === "agent"
                  ? "宿主 Agent 提议，模型来源自述"
                  : row.source === "manual"
                    ? "用户手动规则"
                    : row.source}
            </p>
            {row.status === "proposed" && conflicts.length > 0 && (
              <fieldset>
                <legend>明确选择停用冲突规则</legend>
                {conflicts.map((id) => (
                  <label className="row" key={id}>
                    <input
                      style={{ width: 18 }}
                      type="checkbox"
                      checked={(resolve[row.id] ?? []).includes(id)}
                      onChange={(e) =>
                        setResolve({
                          ...resolve,
                          [row.id]: e.target.checked
                            ? [...(resolve[row.id] ?? []), id]
                            : (resolve[row.id] ?? []).filter((v) => v !== id),
                        })
                      }
                    />
                    {
                      ruleConfig.parse(
                        data.rules.find((r) => r.id === id)!.config_json,
                      ).title
                    }
                  </label>
                ))}
              </fieldset>
            )}
            <div className="actions">
              {row.status === "proposed" && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          api(`preferences/${row.id}`, "PATCH", {
                            action: "confirm",
                            expected_version: row.version,
                            resolve_conflict_ids: resolve[row.id] ?? [],
                          }),
                        "规则已确认；仅影响后续生成与构建",
                      )
                    }
                  >
                    确认规则
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          api(`preferences/${row.id}`, "PATCH", {
                            action: "reject",
                            expected_version: row.version,
                          }),
                        "规则已拒绝",
                      )
                    }
                  >
                    拒绝规则
                  </button>
                </>
              )}
              {row.status === "confirmed" && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () =>
                        api(`preferences/${row.id}`, "PATCH", {
                          action: "archive",
                          expected_version: row.version,
                        }),
                      "规则已停用；历史包保留",
                    )
                  }
                >
                  停用规则
                </button>
              )}
              {["archived", "rejected"].includes(row.status) &&
                !row.evidence_erased && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          api(`preferences/${row.id}`, "PATCH", {
                            action: "reopen",
                            expected_version: row.version,
                          }),
                        "已恢复为待确认",
                      )
                    }
                  >
                    恢复为待确认
                  </button>
                )}
              <button
                className="secondary"
                disabled={row.evidence_erased}
                onClick={() => setEditing(editing === row.id ? "" : row.id)}
              >
                编辑规则
              </button>
              <button className="secondary" onClick={() => showEvidence(row)}>
                查看证据与历史
              </button>
            </div>
            {editing === row.id && (
              <RuleEditor
                key={row.id + row.version}
                projects={projects}
                initial={config}
                projectId={row.project_id ?? ""}
                label="保存编辑并重新确认"
                onSave={async (config) => {
                  await api(`preferences/${row.id}`, "PATCH", {
                    action: "edit",
                    expected_version: row.version,
                    config,
                  });
                  setEditing("");
                  await load();
                  setStatus("编辑已保存为 proposed；请重新确认");
                }}
              />
            )}
            {openEvidence === row.id && (
              <details open>
                <summary>原始证据与规则历史</summary>
                <p>
                  证据 ID：
                  {row.evidence_ids.join("、") || "手动规则，无模型学习声明"}
                </p>
                <p className="muted">
                  撤销的证据不列为当前支持；原始事件仍保留在会话历史。
                </p>
                <pre className="mono">{JSON.stringify(evidence, null, 2)}</pre>
                <h3>不可变变更历史</h3>
                <pre className="mono">{JSON.stringify(history, null, 2)}</pre>
              </details>
            )}
          </article>
        );
      })}
    </>
  );
}
