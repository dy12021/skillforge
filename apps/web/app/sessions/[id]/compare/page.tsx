"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "../../../../lib/api";
import type { sessionSnapshot } from "@skillforge/core/training";
type Snapshot = Awaited<ReturnType<typeof sessionSnapshot>>;
const modeLabels: Record<string, string> = {
  none: "只评语 / 人工改写",
  best_one: "选一个最优",
  approve_many: "认可多个（不排序）",
  full_ranking: "完整排序（允许并列）",
  tie: "全部平手",
  reject_all: "全部不满意",
};
export default function Compare({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params),
    [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [mode, setMode] = useState("best_one"),
    [historySet, setHistorySet] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [comments, setComments] = useState<Record<string, string>>({}),
    [edits, setEdits] = useState<Record<string, string>>({}),
    [ranks, setRanks] = useState<Record<string, number>>({});
  const operation = useRef<{ body: string; key: string } | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<Snapshot>(`sessions/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    api<Snapshot>(`sessions/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
    const interval = setInterval(() => {
      void load();
    }, 2000);
    return () => clearInterval(interval);
  }, [id, load]);
  const set =
      data?.candidate_sets.find((s) => s.id === historySet) ??
      data?.candidate_sets.at(-1),
    task = data?.tasks.find((t) => t.id === set?.task_id),
    job = data?.jobs.filter((j) => j.job_type === "training").at(-1);
  const rows = set
    ? set.shuffled_order_json
        .map((candidateId) =>
          data!.candidates.find((c) => c.id === candidateId)!,
        )
        .filter(Boolean)
    : [];
  function toggle(candidateId: string) {
    setSelected(
      mode === "best_one"
        ? [candidateId]
        : selected.includes(candidateId)
          ? selected.filter((x) => x !== candidateId)
          : [...selected, candidateId],
    );
  }
  async function save() {
    if (!set || !task) return;
    setError("");
    setBusy(true);
    setStatus("保存中…");
    try {
      const groups =
        mode === "full_ranking"
          ? Object.entries(
              rows.reduce<Record<number, string[]>>((acc, c, i) => {
                const rank = ranks[c.id] ?? i + 1;
                (acc[rank] ??= []).push(c.id);
                return acc;
              }, {}),
            )
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([, ids]) => ids)
          : null;
      const body = {
        session_id: id,
        task_id: task.id,
        candidate_ids: data!.candidates
          .filter((c) => c.set_id === set.id)
          .map((c) => c.id),
        displayed_order: set.shuffled_order_json,
        feedback_mode: mode === "none" ? null : mode,
        approved_ids: ["best_one", "approve_many"].includes(mode)
          ? selected
          : [],
        ranking_groups: groups,
        comments: rows
          .filter((c) => comments[c.id]?.trim())
          .map((c) => ({ candidate_id: c.id, text: comments[c.id] })),
        human_edits: rows
          .filter((c) => edits[c.id]?.trim())
          .map((c) => ({
            candidate_id: c.id,
            original: c.text,
            replacement: edits[c.id],
          })),
      };
      const serialized = JSON.stringify(body);
      if (operation.current?.body !== serialized)
        operation.current = { body: serialized, key: crypto.randomUUID() };
      await api("feedback", "POST", body, operation.current.key);
      setStatus("已保存到数据库；Agent 可读取本轮反馈");
      setComments({});
      setEdits({});
      await load();
    } catch (e) {
      setError((e as Error).message);
      setStatus("保存失败，输入已保留，可重试");
    } finally {
      setBusy(false);
    }
  }
  async function jobAction(action: string) {
    try {
      await api(`jobs/${job!.id}/${action}`, "POST", {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function next(strategy = "diverse") {
    try {
      const p = job!.payload;
      await api(`sessions/${id}/candidates`, "POST", {
        source: p.source,
        prompt: p.prompt,
        granularity: p.granularity,
        target_dimension: p.target_dimension,
        candidate_count: p.candidate_count,
        generation_source: p.generation_source,
        expected_version: data!.session.version,
        strategy,
        ...(p.source === "corpus-derived"
          ? {
              corpus_asset_id: p.corpus_asset_id,
              corpus_segment_id: p.corpus_segment_id,
              data_transfer_confirmed: p.data_transfer_confirmed,
            }
          : {}),
      });
      setSelected([]);
      setHistorySet("");
      setStatus("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function finish() {
    try {
      await api(`sessions/${id}/finish`, "POST", {
        expected_version: data!.session.version,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function undo(event_id: string) {
    try {
      const result = await api<{ cancelled_generation: boolean }>(
        "feedback/undo",
        "POST",
        { event_id },
      );
      setStatus(
        result.cancelled_generation
          ? "反馈已撤销，使用旧反馈的待处理任务已取消；请重新创建下一轮。"
          : "反馈已撤销；后续任务不会引用该事件。",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="eyebrow">TRAINING SESSION / {id.slice(0, 8)}</div>
      <div className="row spread">
        <h1>{task?.title ?? "准备训练任务"}</h1>
        <span className="badge">{data?.session.state ?? "载入中"}</span>
      </div>
      {data && (
        <Link href={`/preferences?project_id=${data.session.project_id}`}>
          从真实反馈生成偏好提议 →
        </Link>
      )}
      <div className="actions">
        <Link href={`/sessions/${id}/privacy`}>导出或永久清除本会话数据</Link>
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {data && (
        <>
          <Link className="muted" href={`/projects/${data.session.project_id}`}>
            ← 返回项目
          </Link>
          {job &&
            [
              "awaiting_agent",
              "queued",
              "running",
              "failed",
              "cancelled",
            ].includes(job.status) && (
              <section className="panel">
                <h2>
                  {job.status === "awaiting_agent"
                    ? "等待宿主 Agent 提交"
                    : job.status === "failed"
                      ? "生成失败"
                      : job.status === "cancelled"
                        ? "生成已取消"
                        : "provider 生成任务进行中"}
                </h2>
                {job.status === "awaiting_agent" ? (
                  <>
                    <p>
                      在 OpenCode / Codex 中使用 skillforge。Agent
                      用自己的模型生成题目和候选，再提交到此任务；页面将自动恢复。
                    </p>
                    <pre className="mono">
                      pnpm skillforge job get {job.id}
                      {"\n"}pnpm skillforge job submit {job.id} --file
                      generated.json
                    </pre>
                    <details>
                      <summary>查看生成要求</summary>
                      <pre className="mono">
                        {JSON.stringify(job.payload, null, 2)}
                      </pre>
                    </details>
                  </>
                ) : (
                  <p>
                    {job.payload.feedback_snapshot_invalidated
                      ? "反馈已撤销，旧任务不能重试；请重新创建下一轮。"
                      : (job.error_code ??
                        "请确保已启动 pnpm worker。默认 mock 仅为模拟样例。")}{" "}
                    · 尝试次数 {job.attempts}
                  </p>
                )}
                <div className="actions">
                  {["failed", "cancelled"].includes(job.status) &&
                  !job.payload.feedback_snapshot_invalidated ? (
                    <button onClick={() => jobAction("retry")}>重试任务</button>
                  ) : !["failed", "cancelled"].includes(job.status) ? (
                    <button
                      className="secondary"
                      onClick={() => jobAction("cancel")}
                    >
                      取消生成
                    </button>
                  ) : null}
                </div>
              </section>
            )}
          {set && (
            <>
              <label htmlFor="history-round">查看历史轮次</label>
              <select
                id="history-round"
                value={set.id}
                onChange={(e) => {
                  setHistorySet(e.target.value);
                  setSelected([]);
                  setComments({});
                  setEdits({});
                }}
              >
                {data.candidate_sets.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    第 {i + 1} 轮 · {s.generation_strategy} · {s.model_provider}
                  </option>
                ))}
              </select>
              <div
                className={
                  set.model_provider === "mock" ? "notice" : "notice success"
                }
              >
                {set.model_provider === "mock"
                  ? "演示模式：固定模拟候选，不是真实 AI 生成"
                  : set.model_provider === "agent"
                    ? "Agent 提交：模型来源为宿主自述，未经供应商验证"
                    : `模型接口响应：${set.model_provider}`}
              </div>
              <section className="panel">
                <div className="row spread">
                  <h2>本轮任务 · {rows.length} 个候选</h2>
                  <Link
                    className="button secondary"
                    href={`/sessions/${id}/annotate`}
                  >
                    进入圈选与版本 →
                  </Link>
                </div>
                <p>{task?.prompt}</p>
                <p className="muted">
                  训练维度：{task?.target_dimension} · {task?.granularity} ·
                  题目来源：{task?.source}
                </p>
                <label htmlFor="feedback-mode">反馈方式</label>
                <select
                  id="feedback-mode"
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value);
                    setSelected([]);
                  }}
                >
                  {Object.entries(modeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </section>
              <div className="grid">
                {rows.map((c, i) => (
                  <article
                    className={`candidate-card ${selected.includes(c.id) ? "selected" : ""}`}
                    key={c.id}
                    data-testid="candidate"
                  >
                    <div className="row spread">
                      <h3>候选 {String.fromCharCode(65 + i)}</h3>
                      <span className="badge">随机展示顺序</span>
                    </div>
                    <div className="candidate-text">{c.text}</div>
                    {["best_one", "approve_many"].includes(mode) && (
                      <label className="row">
                        <input
                          type="checkbox"
                          checked={selected.includes(c.id)}
                          onChange={() => toggle(c.id)}
                        />
                        认可候选 {String.fromCharCode(65 + i)}
                      </label>
                    )}
                    {mode === "full_ranking" && (
                      <>
                        <label htmlFor={`rank-${c.id}`}>
                          名次（相同数字为并列）
                        </label>
                        <input
                          id={`rank-${c.id}`}
                          type="number"
                          min={1}
                          max={8}
                          value={ranks[c.id] ?? i + 1}
                          onChange={(e) =>
                            setRanks({
                              ...ranks,
                              [c.id]: Number(e.target.value),
                            })
                          }
                        />
                      </>
                    )}
                    <label htmlFor={`comment-${c.id}`}>
                      候选 {String.fromCharCode(65 + i)} 评语
                    </label>
                    <textarea
                      id={`comment-${c.id}`}
                      value={comments[c.id] ?? ""}
                      onChange={(e) =>
                        setComments({ ...comments, [c.id]: e.target.value })
                      }
                      placeholder="可独立留下评语，无需选出胜者"
                    />
                    <label htmlFor={`edit-${c.id}`}>
                      候选 {String.fromCharCode(65 + i)} 人工改写
                    </label>
                    <textarea
                      id={`edit-${c.id}`}
                      value={edits[c.id] ?? ""}
                      onChange={(e) =>
                        setEdits({ ...edits, [c.id]: e.target.value })
                      }
                      placeholder="填写新版本；原文将保留"
                    />
                  </article>
                ))}
              </div>
              <div className="actions">
                <button
                  disabled={busy || data.session.state === "completed"}
                  onClick={save}
                >
                  {busy ? "保存中…" : "保存本轮反馈"}
                </button>
                <button
                  className="secondary"
                  onClick={() => next()}
                  disabled={
                    data.session.state === "awaiting_generation" ||
                    data.session.state === "completed"
                  }
                >
                  继续探索下一轮
                </button>
                <button
                  className="secondary"
                  onClick={() => next("challenger")}
                  disabled={
                    data.session.state === "awaiting_generation" ||
                    data.session.state === "completed"
                  }
                >
                  挑战当前最佳
                </button>
                <button
                  className="secondary"
                  onClick={finish}
                  disabled={
                    !["comparing", "feedback_saved"].includes(
                      data.session.state,
                    )
                  }
                >
                  完成会话
                </button>
              </div>
              <p role="status">{status}</p>
              <p className="muted">
                下一轮任务包含创建时最近 20
                条未撤销反馈及对应候选的短摘录，按原始比较语义供所选生成端参考；不会自动升级为长期全局规则。撤销已进入待处理任务的反馈会取消该任务，请重新创建。
              </p>
            </>
          )}
          <section className="panel">
            <h2>已保存的原始反馈（{data.feedback_events.length}）</h2>
            {data.feedback_events.length === 0 ? (
              <p className="muted">等待人类反馈，不推断满意度。</p>
            ) : (
              data.feedback_events.map((event) => (
                <div className="history-event" key={event.id}>
                  <div className="row spread">
                    <strong>{event.event_type}</strong>
                    {event.event_type !== "feedback_undone" && (
                      <button
                        className="secondary"
                        onClick={() => undo(event.id)}
                      >
                        记录撤销
                      </button>
                    )}
                  </div>
                  {typeof event.payload_json.text === "string" && (
                    <p>{event.payload_json.text}</p>
                  )}
                  {typeof event.payload_json.replacement === "string" && (
                    <p>人工改写：{event.payload_json.replacement}</p>
                  )}
                  <details>
                    <summary>查看原始证据</summary>
                    <pre className="mono">
                      {JSON.stringify(event.payload_json, null, 2)}
                    </pre>
                  </details>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </>
  );
}
