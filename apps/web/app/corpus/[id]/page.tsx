"use client";
import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { ruleConfig } from "@skillforge/core/rule-types";
import type { corpusDetail } from "@skillforge/core/corpus";
type Detail = Awaited<ReturnType<typeof corpusDetail>>;
export default function CorpusDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params),
    [data, setData] = useState<Detail | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [consent, setConsent] = useState(false),
    [source, setSource] = useState("agent"),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [learn, setLearn] = useState<Record<string, boolean>>({}),
    [edits, setEdits] = useState<Record<string, string>>({}),
    [purposes, setPurposes] = useState<Record<string, string>>({}),
    [deleteConfirmed, setDeleteConfirmed] = useState(false),
    [deleted, setDeleted] = useState<{
      notice: string;
      deleted_segments: number;
    } | null>(null);
  const load = useCallback(
    () => api<Detail>(`corpora/${id}`).then(setData),
    [id],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  const active = data?.jobs.some((j) =>
    ["awaiting_agent", "queued", "running"].includes(j.status),
  );
  useEffect(() => {
    if (!active || deleted) return;
    const interval = setInterval(() => {
      load().catch((e) => setError(e.message));
    }, 2000);
    return () => clearInterval(interval);
  }, [active, deleted, load]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (deleted)
    return (
      <>
        <h1>语料删除结果</h1>
        <p role="status">
          已清除 {deleted.deleted_segments} 个片段。{deleted.notice}
        </p>
        <Link href="/corpus">返回语料库</Link>
      </>
    );
  return (
    <>
      <div className="eyebrow">PRIVATE SOURCE & DISCOVERIES</div>
      <h1>{data?.asset.filename ?? "读取语料…"}</h1>
      <Link href="/corpus">← 返回语料库</Link>
      {error && (
        <div role="alert" aria-label="语料操作错误" className="notice error">
          {error}
        </div>
      )}
      <p role="status" aria-label="语料操作状态">
        {status}
      </p>
      {data && (
        <>
          <section className="panel">
            <h2>来源与授权</h2>
            <p>
              {data.asset.source_name} · {data.asset.purpose} · 许可已声明
            </p>
            <p>{data.asset.source_url}</p>
            <p className="mono">SHA256 {data.asset.file_hash}</p>
            <a href={`/api/corpora/${id}/download`}>下载原始文件</a>
            <p className="muted">
              原文保存在私密对象目录；授权下载须经本机
              API。清洗文本与原文分开保存。
            </p>
          </section>
          <section className="panel">
            <h2>选择片段与用途</h2>
            {data.segments.map((s) => (
              <article className="card" key={s.id} data-testid="corpus-segment">
                <label className="row">
                  <input
                    style={{ width: 18 }}
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, s.id]
                          : selected.filter((id) => id !== s.id),
                      )
                    }
                  />
                  选择片段 {s.position + 1}
                </label>
                <p>
                  {s.start_ms === null
                    ? "无时间戳"
                    : `${s.start_ms}～${s.end_ms ?? "?"} ms`}{" "}
                  · {s.speaker_id ?? "说话人未知"} · v{s.version}
                </p>
                <blockquote>{s.original_text}</blockquote>
                <details>
                  <summary>相邻上下文</summary>
                  <p>前：{s.context_before || "无"}</p>
                  <p>后：{s.context_after || "无"}</p>
                </details>
                <label htmlFor={`segment-purpose-${s.id}`}>
                  片段 {s.position + 1} 用途
                </label>
                <select
                  id={`segment-purpose-${s.id}`}
                  value={purposes[s.id] ?? s.purpose}
                  onChange={(e) =>
                    setPurposes({ ...purposes, [s.id]: e.target.value })
                  }
                >
                  <option value="positive">正向参考</option>
                  <option value="negative">负向参考</option>
                  <option value="observational">中性观察</option>
                </select>
                <label htmlFor={`segment-clean-${s.id}`}>
                  片段 {s.position + 1} 清洗/校订文本（保留上方原文）
                </label>
                <textarea
                  id={`segment-clean-${s.id}`}
                  value={edits[s.id] ?? s.cleaned_text}
                  onChange={(e) =>
                    setEdits({ ...edits, [s.id]: e.target.value })
                  }
                />
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await api(`corpora/${id}/segments/${s.id}`, "PATCH", {
                        expected_version: s.version,
                        purpose: purposes[s.id] ?? s.purpose,
                        cleaned_text: edits[s.id] ?? s.cleaned_text,
                      });
                      await load();
                      setStatus("用途与校订文本已保存，原文不变");
                    })
                  }
                >
                  保存片段 {s.position + 1}
                </button>
              </article>
            ))}
            <label htmlFor="corpus-model">风格提取来源</label>
            <select
              id="corpus-model"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="agent">宿主 Agent（使用其已授权模型）</option>
              <option value="provider">应用内 provider（默认 mock）</option>
            </select>
            <label className="row">
              <input
                style={{ width: 18 }}
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              明确允许把所选片段与相邻上下文交给所选模型分析；真实 provider
              将发送到设置中的地址，可能产生其费用
            </label>
            <p className="muted">
              不授权也能本地查看、校订、标记和下载。观察材料不会自动变成偏好。
            </p>
            <button
              disabled={busy || !consent || !selected.length}
              onClick={() =>
                act(async () => {
                  await api(`corpora/${id}/extract`, "POST", {
                    generation_source: source,
                    data_transfer_confirmed: consent,
                    segment_ids: selected,
                  });
                  await load();
                  setConsent(false);
                  setStatus("提取任务已创建；发现与长期规则均需人工确认");
                })
              }
            >
              从所选片段提出风格发现
            </button>
          </section>
          {data.jobs.map((job) => (
            <section className="notice" key={job.id}>
              <p>
                提取任务 · {job.status} · {job.error_code}
              </p>
              {job.status === "awaiting_agent" && (
                <pre className="mono">pnpm skillforge job get {job.id}</pre>
              )}
              {["queued", "running"].includes(job.status) && (
                <p>等待所选 provider worker</p>
              )}
              {["failed", "cancelled"].includes(job.status) && (
                <button
                  disabled={busy}
                  className="secondary"
                  onClick={() =>
                    act(async () => {
                      await api(`jobs/${job.id}/retry`, "POST", {});
                      await load();
                    })
                  }
                >
                  重试提取
                </button>
              )}
              {["queued", "running", "awaiting_agent"].includes(job.status) && (
                <button
                  disabled={busy}
                  className="secondary"
                  onClick={() =>
                    act(async () => {
                      await api(`jobs/${job.id}/cancel`, "POST", {});
                      await load();
                    })
                  }
                >
                  取消提取
                </button>
              )}
            </section>
          ))}
          <h2>候选风格发现</h2>
          {!data.discoveries.length && (
            <p>还没有模型发现；导入本身不代表已学习风格。</p>
          )}
          {data.discoveries.map((d) => (
            <article
              className="panel"
              key={d.id}
              data-testid="corpus-discovery"
            >
              <span className="badge">{d.status}</span>
              <h3>{ruleConfig.parse(d.config_json).title}</h3>
              <p>{ruleConfig.parse(d.config_json).instruction}</p>
              <p>{d.rationale}</p>
              <p className="muted">
                {d.model_details_json.simulated
                  ? "模拟发现，不代表真实风格分析"
                  : d.model_details_json.provider === "agent"
                    ? "宿主 Agent 分析，模型来源自述"
                    : "模型响应，仍需用户判断"}
              </p>
              {d.evidence_json.map((e, i) => (
                <blockquote key={i}>
                  {e.quote}
                  <footer>
                    片段{" "}
                    {(data.segments.find((s) => s.id === e.segment_id)
                      ?.position ?? -1) + 1}{" "}
                    · {e.purpose} · 原始 v{e.version}
                  </footer>
                </blockquote>
              ))}
              {d.status === "proposed" && (
                <>
                  <label className="row">
                    <input
                      style={{ width: 18 }}
                      type="checkbox"
                      checked={learn[d.id] ?? false}
                      onChange={(e) =>
                        setLearn({ ...learn, [d.id]: e.target.checked })
                      }
                    />
                    只学习此项特征，不将整份材料视为个人偏好
                  </label>
                  <div className="actions">
                    <button
                      disabled={busy || !learn[d.id]}
                      onClick={() =>
                        act(async () => {
                          await api(
                            `corpora/${id}/discoveries/${d.id}`,
                            "POST",
                            {
                              decision: "confirm",
                              expected_version: d.version,
                              learn_this_feature: learn[d.id],
                            },
                          );
                          await load();
                          setStatus(
                            "发现已确认，规则仍为 proposed；请在偏好页独立确认",
                          );
                        })
                      }
                    >
                      确认此项发现
                    </button>
                    <button
                      disabled={busy}
                      className="secondary"
                      onClick={() =>
                        act(async () => {
                          await api(
                            `corpora/${id}/discoveries/${d.id}`,
                            "POST",
                            { decision: "reject", expected_version: d.version },
                          );
                          await load();
                        })
                      }
                    >
                      拒绝此项发现
                    </button>
                  </div>
                </>
              )}
              {d.rule_id && (
                <Link href={`/preferences?project_id=${data.asset.project_id}`}>
                  前往确认提议规则 →
                </Link>
              )}
            </article>
          ))}
          <section className="panel">
            <h2>删除这份私人材料</h2>
            <p>
              清除原文件、派生片段、发现与模型输入缓存，停用相关规则。已导出的独立
              Skill 和历史快照不能自动撤回。
            </p>
            <label className="row">
              <input
                style={{ width: 18 }}
                type="checkbox"
                checked={deleteConfirmed}
                onChange={(e) => setDeleteConfirmed(e.target.checked)}
              />
              我确认永久删除这份语料及其派生片段
            </label>
            <button
              className="danger"
              disabled={busy || !deleteConfirmed}
              onClick={() =>
                act(async () => {
                  const report = await api<{
                    notice: string;
                    deleted_segments: number;
                  }>(`corpora/${id}`, "DELETE", {
                    confirm: deleteConfirmed,
                    expected_version: data.asset.version,
                  });
                  setDeleted(report);
                })
              }
            >
              确认删除语料
            </button>
          </section>
        </>
      )}
    </>
  );
}
