"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { diffChars } from "diff";
import { api } from "../../../../lib/api";
import AnnotationEditor from "../../../../components/annotation-editor";
import RevisionWorkbench from "../../../../components/revision-workbench";
import type { sessionSnapshot } from "@skillforge/core/training";
type Snapshot = Awaited<ReturnType<typeof sessionSnapshot>>;
export default function Annotate({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params),
    [data, setData] = useState<Snapshot | null>(null),
    [versionId, setVersionId] = useState(""),
    [selection, setSelection] = useState<{
      start_utf16: number;
      end_utf16: number;
      exact_quote: string;
    } | null>(null),
    [label, setLabel] = useState("ai_like"),
    [comment, setComment] = useState(""),
    [rewrite, setRewrite] = useState(""),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [revisionMode, setRevisionMode] = useState("manual_edit");
  const load = useCallback(async () => {
    try {
      const snapshot = await api<Snapshot>(`sessions/${id}`);
      setData(snapshot);
      return snapshot;
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    api<Snapshot>(`sessions/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);
  const version = data?.document_versions.find((v) => v.id === versionId),
    parent = data?.document_versions.find(
      (v) => v.id === version?.parent_version_id,
    );
  const spans = useMemo(
    () =>
      data?.annotations.filter((a) => a.document_version_id === versionId) ??
      [],
    [data, versionId],
  );
  function choose(value: string) {
    setVersionId(value);
    setSelection(null);
    setDraft(
      data?.document_versions.find((v) => v.id === value)?.content_text ?? "",
    );
    setStatus("");
  }
  async function annotate() {
    if (!version || !selection) return;
    setBusy(true);
    setError("");
    try {
      await api("annotations", "POST", {
        document_version_id: version.id,
        block_id: "document",
        ...selection,
        label,
        comment,
        human_rewrite: rewrite || null,
      });
      setStatus("批注已保存，已有重叠批注会保留");
      setComment("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveRevision() {
    if (!version) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        version: Snapshot["document_versions"][number];
      }>("revisions", "POST", {
        document_version_id: version.id,
        content_text: revisionMode === "revise_selection" ? rewrite : draft,
        operation: revisionMode,
        ...(revisionMode === "revise_selection" && selection ? selection : {}),
      });
      await load();
      setVersionId(result.version.id);
      setDraft(result.version.content_text);
      setSelection(null);
      setStatus("人工新版本已保存，旧版批注需要显式重新定位");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reanchor(prior: Snapshot["annotations"][number]) {
    if (!version || !selection) return;
    try {
      await api("annotations", "POST", {
        document_version_id: version.id,
        block_id: "document",
        ...selection,
        label: prior.label,
        comment: prior.comment,
        human_rewrite: prior.human_rewrite,
        reanchored_from_id: prior.id,
      });
      await load();
      setStatus("已按当前明确选区重新定位；旧版本批注保留");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="eyebrow">ANNOTATE & REVISE</div>
      <h1>圈选、改写与原文版本</h1>
      <Link href={`/sessions/${id}/compare`}>← 返回候选比较</Link>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <section className="panel">
        <label htmlFor="version">选择不可变文档版本</label>
        <select
          id="version"
          value={versionId}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">请选择候选原文或人工版本</option>
          {data?.document_versions.map((v, i) => (
            <option key={v.id} value={v.id}>
              版本 {i + 1} · {v.revision_source} · {v.content_text.slice(0, 24)}
            </option>
          ))}
        </select>
        {version && (
          <>
            <RevisionWorkbench
              sessionId={id}
              versionId={version.id}
              original={version.content_text}
              selection={selection}
              onAccepted={async (newId) => {
                const snapshot = await load();
                setVersionId(newId);
                setDraft(
                  snapshot?.document_versions.find((v) => v.id === newId)
                    ?.content_text ?? "",
                );
                setSelection(null);
              }}
            />
            <Link
              href={`/patterns?project_id=${data!.session.project_id}&session_id=${id}&version_id=${version.id}`}
            >
              识别同类表达 →
            </Link>
            <p className="muted">
              在正文中拖动或用键盘选择文字。偏移单位：UTF-16；稳定块：document。重叠标注分别保存。
            </p>
            <AnnotationEditor
              key={version.id}
              content={version.content_json}
              spans={spans}
              onSelection={setSelection}
            />
            {parent && (
              <section className="notice">
                <h3>旧版本批注：待显式重新定位</h3>
                {data?.annotations
                  .filter((a) => a.document_version_id === parent.id)
                  .map((a) => (
                    <div key={a.id}>
                      <p>
                        原选区：“{a.exact_quote}” · {a.label}
                      </p>
                      <button
                        className="secondary"
                        disabled={!selection}
                        onClick={() => reanchor(a)}
                      >
                        将此批注关联到当前选区
                      </button>
                    </div>
                  ))}
              </section>
            )}
            <div className="notice">
              {selection
                ? `选区 [${selection.start_utf16}, ${selection.end_utf16})：${selection.exact_quote}`
                : "尚未选择文字"}
            </div>
            <div className="field-grid">
              <div>
                <label htmlFor="label">圈选类别</label>
                <select
                  id="label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                >
                  <option value="excellent">优秀</option>
                  <option value="ai_like">AI 味（用户判断）</option>
                  <option value="unsatisfied">不满意</option>
                  <option value="other">其他评语</option>
                </select>
              </div>
              <div>
                <label htmlFor="comment">圈选评语</label>
                <input
                  id="comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
            </div>
            <label htmlFor="rewrite">局部人工替换文本（可选）</label>
            <textarea
              id="rewrite"
              value={rewrite}
              onChange={(e) => setRewrite(e.target.value)}
            />
            <button disabled={!selection || busy} onClick={annotate}>
              保存圈选批注
            </button>
            <h3 className="section-label">本版本批注（{spans.length}）</h3>
            {spans.map((s) => (
              <div className="annotation" key={s.id}>
                <strong>{s.label}</strong> [{s.start_utf16}, {s.end_utf16})
                <p>“{s.exact_quote}”</p>
                <p>{s.comment}</p>
                <small>quote hash: {s.quote_hash.slice(0, 16)}…</small>
              </div>
            ))}
            {parent && (
              <div className="notice">
                父版本批注未自动迁移到当前版本，待重新定位。请在新版本显式选择文字创建批注；原始记录仍可在旧版查看。
              </div>
            )}
            <h3 className="section-label">人工改写预览</h3>
            <label htmlFor="revision-mode">改写范围</label>
            <select
              id="revision-mode"
              value={revisionMode}
              onChange={(e) => setRevisionMode(e.target.value)}
            >
              <option value="manual_edit">全文人工编辑</option>
              <option value="revise_selection">仅替换选区</option>
            </select>
            {revisionMode === "manual_edit" && (
              <>
                <label htmlFor="draft">人工新版本</label>
                <textarea
                  id="draft"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </>
            )}
            <p className="muted">
              请复核事实、数字、否定和引语。本切片不声称已自动完成语义保护检查。
            </p>
            <div className="panel" data-testid="diff-preview">
              {diffChars(
                version.content_text,
                revisionMode === "revise_selection" && selection
                  ? version.content_text.slice(0, selection.start_utf16) +
                      rewrite +
                      version.content_text.slice(selection.end_utf16)
                  : draft,
              ).map((part, i) => (
                <span
                  key={i}
                  className={
                    part.added ? "diff-add" : part.removed ? "diff-remove" : ""
                  }
                >
                  {part.value}
                </span>
              ))}
            </div>
            <div className="actions">
              <button
                disabled={
                  busy ||
                  (revisionMode === "revise_selection" &&
                    (!selection || !rewrite))
                }
                onClick={saveRevision}
              >
                保存为人工新版本
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setDraft(version.content_text);
                  setRewrite("");
                }}
              >
                放弃未保存改写
              </button>
            </div>
            {parent && (
              <>
                <h3 className="section-label">与父版本的实际差异</h3>
                <div>
                  {diffChars(parent.content_text, version.content_text).map(
                    (part, i) => (
                      <span
                        key={i}
                        className={
                          part.added
                            ? "diff-add"
                            : part.removed
                              ? "diff-remove"
                              : ""
                        }
                      >
                        {part.value}
                      </span>
                    ),
                  )}
                </div>
              </>
            )}
          </>
        )}
      </section>
      <p role="status" aria-label="批注与人工改写状态">
        {status}
      </p>
    </>
  );
}
