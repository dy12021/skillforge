"use client";
import { useEffect, useState } from "react";
import { diffChars } from "diff";
import { api } from "../lib/api";
import type { listRevisions } from "@skillforge/core/revisions";
type Revision = Awaited<ReturnType<typeof listRevisions>>[number];
export default function RevisionWorkbench({
  sessionId,
  versionId,
  original,
  selection,
  onAccepted,
}: {
  sessionId: string;
  versionId: string;
  original: string;
  selection: {
    start_utf16: number;
    end_utf16: number;
    exact_quote: string;
  } | null;
  onAccepted: (id: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<Revision[]>([]),
    [instruction, setInstruction] = useState(
      "表达更自然直接，保留事实、数字、否定、引语和优秀区域",
    ),
    [source, setSource] = useState("agent"),
    [scope, setScope] = useState("revise_document"),
    [override, setOverride] = useState(false),
    [confirm, setConfirm] = useState<Record<string, boolean>>({}),
    [edits, setEdits] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  useEffect(() => {
    const read = () =>
      api<Revision[]>(`revisions?session_id=${sessionId}`)
        .then(setRows)
        .catch((e) => setError(e.message));
    void read();
    const interval = setInterval(() => {
      void read();
    }, 2000);
    return () => clearInterval(interval);
  }, [sessionId]);
  async function request() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ job_id: string }>("revisions", "POST", {
        document_version_id: versionId,
        operation: scope,
        instruction,
        generation_source: source,
        override_protected: override,
        ...(scope === "revise_selection" && selection ? selection : {}),
      });
      setStatus(
        `修订任务已创建：${result.job_id}；${source === "agent" ? "等待宿主 Agent 使用 job get / job submit 提交" : "等待 provider worker"}`,
      );
      setRows(await api<Revision[]>(`revisions?session_id=${sessionId}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decide(row: Revision, decision: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ version?: { id: string }; job_id?: string }>(
        `revisions/${row.id}/decision`,
        "POST",
        {
          decision,
          expected_version: row.version,
          semantic_confirmed: confirm[row.id] ?? false,
          ...(decision === "manual_edit"
            ? { content_text: edits[row.id] ?? row.suggested_text }
            : {}),
          ...(decision === "edit_again" ? { instruction } : {}),
        },
      );
      setRows(await api<Revision[]>(`revisions?session_id=${sessionId}`));
      if (result.version) await onAccepted(result.version.id);
      setStatus(
        decision === "edit_again"
          ? `新修订任务：${result.job_id}`
          : decision === "reject"
            ? "建议已拒绝，原文未改变"
            : "新版本已保存，原文仍可恢复",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>让 Agent / AI 修订</h2>
      <div className="field-grid">
        <div>
          <label htmlFor="ai-revision-scope">修订范围</label>
          <select
            id="ai-revision-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="revise_document">协调全文</option>
            <option value="revise_selection">仅改选区</option>
          </select>
        </div>
        <div>
          <label htmlFor="ai-revision-source">修订来源</label>
          <select
            id="ai-revision-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="agent">宿主 Agent</option>
            <option value="provider">应用内 provider（默认 mock）</option>
          </select>
        </div>
      </div>
      <label htmlFor="ai-revision-instruction">修订要求</label>
      <textarea
        id="ai-revision-instruction"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
      />
      <label className="row">
        <input
          style={{ width: 18 }}
          type="checkbox"
          checked={override}
          onChange={(e) => setOverride(e.target.checked)}
        />
        明确允许修改本版优秀区域
      </label>
      <p className="muted">
        宿主 Agent 使用自己的模型。选择 provider
        将把本版文本发送到设置中的模型服务；mock
        只验证流程。未接受的建议不会改动原文。
      </p>
      {scope === "revise_selection" && (
        <p>当前选区：{selection?.exact_quote ?? "请先圈选正文"}</p>
      )}
      <button
        disabled={busy || (scope === "revise_selection" && !selection)}
        onClick={request}
      >
        创建 AI 修订任务
      </button>
      {error && (
        <div role="alert" aria-label="修订错误" className="notice error">
          {error}
        </div>
      )}
      <p role="status" aria-label="修订状态">
        {status}
      </p>
      {rows
        .filter((r) => r.parent_version_id === versionId)
        .map((row) => (
          <article
            className="panel"
            key={row.id}
            data-testid="revision-suggestion"
          >
            <div className="row spread">
              <h3>修订建议</h3>
              <span className="badge">{row.status}</span>
            </div>
            <p>任务 {row.job_id}</p>
            {row.status === "awaiting_generation" && (
              <pre className="mono">
                pnpm skillforge job get {row.job_id}
                {"\n"}pnpm skillforge job submit {row.job_id} --file
                revision.json
              </pre>
            )}
            {row.suggested_text && (
              <>
                <p>{row.rationale}</p>
                <div className="notice">
                  {row.model_details_json?.simulated
                    ? "模拟建议，不是真实 AI 优化"
                    : row.model_details_json?.provider === "agent"
                      ? "Agent 提交，来源自述"
                      : `模型响应：${row.model_details_json?.provider}`}
                </div>
                <div data-testid="ai-revision-diff">
                  {diffChars(original, row.suggested_text).map((p, i) => (
                    <span
                      key={i}
                      className={
                        p.added ? "diff-add" : p.removed ? "diff-remove" : ""
                      }
                    >
                      {p.value}
                    </span>
                  ))}
                </div>
                {row.semantic_warnings.length > 0 && (
                  <div className="notice">
                    <ul>
                      {row.semantic_warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {row.status === "pending" && (
                  <>
                    <label className="row">
                      <input
                        style={{ width: 18 }}
                        type="checkbox"
                        checked={confirm[row.id] ?? false}
                        onChange={(e) =>
                          setConfirm({ ...confirm, [row.id]: e.target.checked })
                        }
                      />
                      我已复核事实、数字、引语、否定及人物语气
                    </label>
                    <div className="actions">
                      <button
                        disabled={busy}
                        onClick={() => decide(row, "accept")}
                      >
                        接受建议
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => decide(row, "reject")}
                      >
                        拒绝建议
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => decide(row, "edit_again")}
                      >
                        按新要求再改
                      </button>
                    </div>
                    <details>
                      <summary>人工编辑建议后接受</summary>
                      <label htmlFor={`manual-${row.id}`}>人工修订内容</label>
                      <textarea
                        id={`manual-${row.id}`}
                        value={edits[row.id] ?? row.suggested_text}
                        onChange={(e) =>
                          setEdits({ ...edits, [row.id]: e.target.value })
                        }
                      />
                      <button
                        disabled={busy}
                        onClick={() => decide(row, "manual_edit")}
                      >
                        接受人工编辑版
                      </button>
                    </details>
                  </>
                )}
              </>
            )}
          </article>
        ))}
    </section>
  );
}
