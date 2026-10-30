"use client";
import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import type {
  getEvaluation,
  evaluationResults,
  preferenceMetrics,
} from "@skillforge/core/evaluations";
type Detail = Awaited<ReturnType<typeof getEvaluation>>;
type Results = Awaited<ReturnType<typeof evaluationResults>>;
function Metrics({
  metrics,
}: {
  metrics: ReturnType<typeof preferenceMetrics>;
}) {
  return (
    <>
      <p>
        样本 {metrics.sample_count} · 个性化胜 {metrics.personalized_wins} ·
        普通生成胜 {metrics.baseline_wins} · 平局 {metrics.ties} · 双拒{" "}
        {metrics.both_bad}
      </p>
      <p>
        偏好胜率：
        {metrics.preference_win_rate === null
          ? "暂无决定性票"
          : `${(metrics.preference_win_rate * 100).toFixed(1)}%`}
      </p>
      <p className="muted">{metrics.win_rate_definition}</p>
      <p>
        语义人工复核 {metrics.semantic_review_count} 票；通过率{" "}
        {metrics.semantic_pass_rate === null
          ? "未复核"
          : `${(metrics.semantic_pass_rate * 100).toFixed(1)}%`}
      </p>
    </>
  );
}
export default function EvaluationDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params),
    [data, setData] = useState<Detail | null>(null),
    [results, setResults] = useState<Results | null>(null),
    [selected, setSelected] = useState(""),
    [choice, setChoice] = useState(""),
    [comment, setComment] = useState(""),
    [semantic, setSemantic] = useState("not_reviewed"),
    [testVote, setTestVote] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      Promise.all([
        api<Detail>(`evaluations/${id}`),
        api<Results>(`evaluations/${id}/results`),
      ]).then(([d, r]) => {
        setData(d);
        setResults(r);
      }),
    [id],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  const active =
    data && ["queued", "running", "awaiting_agent"].includes(data.job.status);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(
      () => load().catch((e) => setError(e.message)),
      2000,
    );
    return () => clearInterval(interval);
  }, [active, load]);
  const current =
      data?.items.find((i) => i.item_id === selected) ??
      data?.items.find((i) => i.item_id && !i.vote) ??
      data?.items.find((i) => i.item_id),
    mapping = results?.mapping?.find((m) => m.item_id === current?.item_id);
  async function vote() {
    if (!current?.item_id) return;
    setBusy(true);
    setError("");
    try {
      await api(`evaluations/${id}/votes`, "POST", {
        item_id: current.item_id,
        vote: choice,
        origin: data?.run.test_run || testVote ? "test" : "human",
        comment,
        semantic_review: semantic,
      });
      setChoice("");
      setComment("");
      setSemantic("not_reviewed");
      setSelected("");
      await load();
      setStatus("已保存投票；测试票不会计为真人改善");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function jobAction(action: string) {
    if (!data) return;
    setError("");
    try {
      await api(`jobs/${data.job.id}/${action}`, "POST", {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="eyebrow">BLIND COMPARISON</div>
      <h1>固定版本保留题盲测</h1>
      <Link href="/evaluations">← 返回评测记录</Link>
      {error && (
        <div role="alert" aria-label="盲测操作错误" className="notice error">
          {error}
        </div>
      )}
      <p role="status" aria-label="盲测保存状态">
        {status}
      </p>
      {data && (
        <>
          <section className="panel">
            <span className="badge">
              {data.run.test_run
                ? "测试评测：不能作为真人改善证据"
                : "用户提交评测"}
            </span>
            <p>
              固定版本 {data.build.type} {data.build.version} ·{" "}
              {data.build.hash.slice(0, 16)}…
            </p>
            <p>
              {data.task_count} 个保留题 · 已投 {data.voted_count} 票 ·{" "}
              {data.job.status}
            </p>
            {data.simulated && (
              <div className="notice">
                模拟评测：固定样例只验证管线，不代表真实 AI 能力或风格改善。
              </div>
            )}
            {data.job.status === "awaiting_agent" && (
              <>
                <h2>等待宿主 Agent 生成同题双版本</h2>
                <pre className="mono">
                  pnpm skillforge job get {data.job.id}
                  {"\n"}pnpm skillforge job submit {data.job.id} --file
                  evaluation.json
                </pre>
                <p>
                  Agent 按固定保留题和构建快照生成
                  baseline/personalized，来源由服务端随机左右隐藏。
                </p>
              </>
            )}
            {["queued", "running"].includes(data.job.status) && (
              <p>
                等待 provider worker
                完成两套同题生成；长任务有租约续期，不使用模型自评作为投票。
              </p>
            )}
            {data.job.error_code && <p>{data.job.error_code}</p>}
            <div className="actions">
              {["failed", "cancelled"].includes(data.job.status) && (
                <button onClick={() => jobAction("retry")}>重试生成</button>
              )}
              {["queued", "running", "awaiting_agent"].includes(
                data.job.status,
              ) && (
                <button
                  className="secondary"
                  onClick={() => jobAction("cancel")}
                >
                  取消生成
                </button>
              )}
            </div>
          </section>
          {current?.item_id && (
            <section className="panel" data-testid="evaluation-pair">
              <label htmlFor="eval-task">保留题</label>
              <select
                id="eval-task"
                value={current.item_id}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setChoice("");
                  setComment("");
                  setSemantic("not_reviewed");
                }}
              >
                {data.items
                  .filter((i) => i.item_id)
                  .map((item, index) => (
                    <option key={item.item_id!} value={item.item_id!}>
                      第 {index + 1} 题 · {item.title} ·{" "}
                      {item.vote ? "已投票" : "待投票"}
                    </option>
                  ))}
              </select>
              <h2>{current.title}</h2>
              <p>{current.prompt}</p>
              <p className="muted">{current.constraints.join("；")}</p>
              <div className="grid">
                <article className="card">
                  <h3>左侧{mapping ? ` · ${mapping.left_source}` : ""}</h3>
                  <p
                    data-testid="evaluation-left"
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {current.left}
                  </p>
                </article>
                <article className="card">
                  <h3>右侧{mapping ? ` · ${mapping.right_source}` : ""}</h3>
                  <p
                    data-testid="evaluation-right"
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {current.right}
                  </p>
                </article>
              </div>
              {current.vote ? (
                <p>
                  已保存：{current.vote.choice} · {current.vote.origin} ·{" "}
                  {current.vote.comment}；原票不可覆盖。
                </p>
              ) : (
                <>
                  <fieldset>
                    <legend>你的比较判断</legend>
                    {(
                      [
                        ["left", "更偏好左侧"],
                        ["right", "更偏好右侧"],
                        ["tie", "两者平手"],
                        ["both_bad", "两者都不满意"],
                      ] as const
                    ).map(([value, title]) => (
                      <label key={value} className="row">
                        <input
                          style={{ width: 18 }}
                          type="radio"
                          name="evaluation-vote"
                          value={value}
                          checked={choice === value}
                          onChange={() => setChoice(value)}
                        />
                        {title}
                      </label>
                    ))}
                  </fieldset>
                  <label htmlFor="eval-comment">本题评语（可选）</label>
                  <textarea
                    id="eval-comment"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <label htmlFor="eval-semantic">
                    事实、数字、否定、引语的人工复核
                  </label>
                  <select
                    id="eval-semantic"
                    value={semantic}
                    onChange={(e) => setSemantic(e.target.value)}
                  >
                    <option value="not_reviewed">尚未复核</option>
                    <option value="pass">已复核，两版关键语义保留</option>
                    <option value="risk">发现关键语义变化风险</option>
                  </select>
                  <label className="row">
                    <input
                      style={{ width: 18 }}
                      type="checkbox"
                      checked={data.run.test_run || testVote}
                      disabled={data.run.test_run}
                      onChange={(e) => setTestVote(e.target.checked)}
                    />
                    这是一条测试投票，不计入真人偏好样本
                  </label>
                  <p className="muted">
                    普通用户判断由你本人提交；自动化操作必须标记测试票。只有全部题完成后才展示来源与统计。
                  </p>
                  <button disabled={busy || !choice} onClick={vote}>
                    保存本题投票
                  </button>
                </>
              )}
            </section>
          )}
          <section className="panel" data-testid="evaluation-results">
            <h2>
              {results?.metrics ? "人类投票记录" : "待评测：尚无真人改善结论"}
            </h2>
            <p>可用真人样本：{results?.human_sample_count ?? 0}</p>
            <p>{results?.notice}</p>
            {results?.metrics && <Metrics metrics={results.metrics} />}{" "}
            {results && "test_sample_count" in results && (
              <p>
                测试票：{results.test_sample_count} · 模拟输出上的用户票：
                {results.simulated_human_sample_count}
              </p>
            )}
            {results && "test_metrics" in results && results.test_metrics && (
              <details>
                <summary>测试管线统计（不代表改善）</summary>
                <Metrics metrics={results.test_metrics} />
              </details>
            )}
            {results?.mapping && (
              <details>
                <summary>投票完成后的来源与模型配置</summary>
                <pre className="mono">
                  {JSON.stringify(results.mapping, null, 2)}
                </pre>
                <p>
                  保留题来源：
                  {"holdout_source" in results ? results.holdout_source : ""}
                  ；当前构建不会因本次投票变化。
                </p>
              </details>
            )}
            {results && "diagnostics" in results && (
              <details>
                <summary>模式命中与复核操作记录</summary>
                <pre className="mono">
                  {JSON.stringify(results.diagnostics, null, 2)}
                </pre>
              </details>
            )}
          </section>
        </>
      )}
    </>
  );
}
