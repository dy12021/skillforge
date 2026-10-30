"use client";
import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "../../../../lib/api";
import type { sessionSnapshot } from "@skillforge/core/training";
import type { eraseSession } from "@skillforge/core/privacy";
type Snapshot = Awaited<ReturnType<typeof sessionSnapshot>>;
export default function SessionPrivacy({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params),
    [data, setData] = useState<Snapshot | null>(null),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [report, setReport] = useState<Awaited<
      ReturnType<typeof eraseSession>
    > | null>(null);
  const load = useCallback(
    () => api<Snapshot>(`sessions/${id}`).then(setData),
    [id],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  async function erase() {
    if (!data) return;
    setError("");
    setBusy(true);
    try {
      setReport(
        await api(`sessions/${id}`, "DELETE", {
          confirm,
          expected_version: data.session.version,
        }),
      );
      setData(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="eyebrow">SESSION DATA CONTROL</div>
      <h1>本会话原始数据控制</h1>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {report ? (
        <section className="panel">
          <h2>隐私清除已完成</h2>
          <p role="status">{report.notice}</p>
          <pre className="mono">{JSON.stringify(report.counts, null, 2)}</pre>
          <p className="mono">
            清除凭证 {report.erasure_id} · SHA256 {report.content_digest}
          </p>
          <Link href={`/projects/${report.project_id}`}>返回项目</Link>
        </section>
      ) : (
        data && (
          <>
            <Link href={`/sessions/${id}/compare`}>← 返回会话</Link>
            <section className="panel">
              <h2>先导出，再决定保留范围</h2>
              <p>
                {data.feedback_events.length} 条反馈、
                {data.document_versions.length} 个文档版本、
                {data.annotations.length} 条批注。当前版本{" "}
                {data.session.version}。
              </p>
              <a
                href={`/api/sessions/${id}/export`}
                download={`skillforge-session-${id}.json`}
              >
                下载本会话原始数据
              </a>
              <p>
                普通撤销会保留原始审计。以下是明确的永久隐私清除：删除本会话的原文、反馈、批注和直接模型输入缓存，停用依赖它的规则，并清除其旧证据文本；只留不含原文的数量和
                hash 凭证。
              </p>
              <p>
                历史 Skill
                包、独立评测快照、另行复制的语料/模式复核不自动撤回；已发送到外部模型的数据由其提供商保留政策控制。单独的模式复核可在模式页逐条清除。
              </p>
              <label className="row">
                <input
                  style={{ width: 18 }}
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                我确认永久清除本会话原始反馈、文档和关联证据文本
              </label>
              <div className="actions">
                <button
                  className="danger"
                  disabled={!confirm || busy}
                  onClick={erase}
                >
                  永久清除此会话数据
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setConfirm(false);
                    load().catch((e) => setError(e.message));
                  }}
                >
                  刷新清除预览
                </button>
              </div>
            </section>
          </>
        )
      )}
    </>
  );
}
