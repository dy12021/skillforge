"use client";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { api } from "../../lib/api";
import RuleEditor, { type ProjectOption } from "../../components/rule-editor";
import { ruleConfig, detectionContext } from "@skillforge/core/rule-types";
import type {
  listPatterns,
  checkPatterns,
  patternCheckInput,
} from "@skillforge/core/patterns";
import type { z } from "zod";
type Data = Awaited<ReturnType<typeof listPatterns>>;
type Check = Awaited<ReturnType<typeof checkPatterns>>;
type Input = z.infer<typeof patternCheckInput>;
type Job = {
  id: string;
  status: string;
  error_code?: string;
  result?: {
    judgements: { finding_index: number; verdict: string; reason: string }[];
    model_details: { simulated?: boolean };
  };
};
export default function Patterns() {
  const [projects, setProjects] = useState<ProjectOption[]>([]),
    [projectId, setProjectId] = useState(""),
    [domain, setDomain] = useState("writing"),
    [text, setText] = useState(""),
    [genre, setGenre] = useState("general"),
    [logical, setLogical] = useState(false),
    [terms, setTerms] = useState(""),
    [useBuiltins, setUseBuiltins] = useState(true),
    [data, setData] = useState<Data>({
      patterns: [],
      reviews: [],
      builtins: [],
    }),
    [checked, setChecked] = useState<Check | null>(null),
    [input, setInput] = useState<Input | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [editing, setEditing] = useState(""),
    [source, setSource] = useState("agent"),
    [job, setJob] = useState<Job | null>(null),
    [busy, setBusy] = useState(false);
  const [eraseReviews, setEraseReviews] = useState<Record<string, boolean>>({});
  const load = useCallback(() => api<Data>("patterns").then(setData), []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<ProjectOption[]>("projects")
      .then((rows) => {
        setProjects(rows);
        const id = new URLSearchParams(window.location.search).get(
          "project_id",
        );
        if (id && rows.some((p) => p.id === id)) {
          setProjectId(id);
          setDomain(rows.find((p) => p.id === id)!.domain);
        }
      })
      .catch((e) => setError(e.message));
    const params = new URLSearchParams(window.location.search),
      session = params.get("session_id"),
      version = params.get("version_id");
    if (session && version)
      api<{
        session: { mode: string; project_id: string };
        document_versions: { id: string; content_text: string }[];
      }>(`sessions/${session}`)
        .then((s) => {
          setText(
            s.document_versions.find((v) => v.id === version)?.content_text ??
              "",
          );
          setProjectId(s.session.project_id);
          setDomain(s.session.mode);
        })
        .catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    if (!job || ["succeeded", "failed", "cancelled"].includes(job.status))
      return;
    const interval = setInterval(
      () =>
        api<Job>(`jobs/${job.id}`)
          .then(setJob)
          .catch((e) => setError(e.message)),
      2000,
    );
    return () => clearInterval(interval);
  }, [job]);
  async function act(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function current(): Input {
    return {
      text,
      context: detectionContext.parse({
        domain,
        project_id: projectId || undefined,
        genre,
        genuine_logical_contrast: logical,
        technical_terms: terms.split("\n").filter(Boolean),
      }),
      use_builtins: useBuiltins,
    };
  }
  async function check() {
    await act(async () => {
      const snapshot = current();
      setChecked(await api("patterns/check", "POST", snapshot));
      setInput(snapshot);
      setJob(null);
      setStatus("确定性检查完成；匹配不是 AI 文本鉴定");
    });
  }
  async function review(f: Check["findings"][number], decision: string) {
    if (!input) return;
    await act(async () => {
      await api("patterns/review", "POST", {
        ...input,
        rule_id: f.rule_id,
        start_utf16: f.start_utf16,
        end_utf16: f.end_utf16,
        decision,
        comment:
          decision === "false_positive"
            ? "用户标记为误报，保留原文和语境"
            : "用户复核此处语境",
      });
      await load();
      setStatus("复核已写入不可变证据，原文保留");
    });
  }
  return (
    <>
      <div className="eyebrow">CONTEXTUAL LANGUAGE PATTERNS</div>
      <h1>语言模式与语境复核</h1>
      <p>
        句式和短语只提示检查。必要逻辑纠正、引语与人物对白保留；用户明确的风格范围决定如何处理。
      </p>
      <section className="panel">
        <div className="field-grid">
          <div>
            <label htmlFor="pattern-project">检测项目（可选）</label>
            <select
              id="pattern-project"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                const p = projects.find((p) => p.id === e.target.value);
                if (p) setDomain(p.domain);
              }}
            >
              <option value="">仅用户范围</option>
              {projects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pattern-domain">文本用途</label>
            <select
              id="pattern-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            >
              <option value="writing">写作</option>
              <option value="dialogue">对话</option>
            </select>
          </div>
          <div>
            <label htmlFor="pattern-genre">当前体裁</label>
            <input
              id="pattern-genre"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
            />
          </div>
        </div>
        <label htmlFor="pattern-text">待检查文本</label>
        <textarea
          id="pattern-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={20000}
          rows={7}
        />
        <label className="row">
          <input
            type="checkbox"
            style={{ width: 18 }}
            checked={useBuiltins}
            onChange={(e) => setUseBuiltins(e.target.checked)}
          />
          包含内置转折与口语短语提示
        </label>
        <label className="row">
          <input
            type="checkbox"
            style={{ width: 18 }}
            checked={logical}
            onChange={(e) => setLogical(e.target.checked)}
          />
          我确认本文的对比是必要逻辑区分
        </label>
        <label htmlFor="pattern-terms">需保留的专业术语（每行一个）</label>
        <textarea
          id="pattern-terms"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
        />
        <button disabled={busy || !text.trim()} onClick={check}>
          检查语言模式
        </button>
      </section>
      {error && (
        <div role="alert" aria-label="模式操作错误" className="notice error">
          {error}
        </div>
      )}
      <p role="status" aria-label="模式保存状态">
        {status}
      </p>
      {checked && (
        <section className="panel">
          <h2>检测结果</h2>
          <p>
            {checked.summary.matches} 处匹配 · {checked.summary.review} 处待复核
            · {checked.summary.exempt} 处豁免
          </p>
          {input?.text !== text && (
            <div className="notice">
              正文已编辑，以下仍是上次检查的原文证据；再次检查可更新结果。
            </div>
          )}
          {checked.findings.map((f, i) => (
            <article
              className="card"
              key={f.rule_id + ":" + i}
              data-testid="pattern-finding"
            >
              <span className="badge">
                {f.status === "exempt" ? "豁免/保留" : "需语境判断"}
              </span>
              <blockquote>{f.exact_quote}</blockquote>
              <p>{f.reason}</p>
              <p className="muted">
                UTF-16 [{f.start_utf16}, {f.end_utf16}) · {f.method} · 规则{" "}
                {f.rule_id}
              </p>
              <p>{f.context}</p>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => review(f, "false_positive")}
                >
                  标记误报
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => review(f, "confirmed")}
                >
                  确认此处需检查
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => review(f, "exception")}
                >
                  保留为语境例外
                </button>
              </div>
            </article>
          ))}
          <label htmlFor="pattern-model">进一步判断来源</label>
          <select
            id="pattern-model"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="agent">宿主 Agent</option>
            <option value="provider">应用内 provider（默认 mock）</option>
          </select>
          <button
            disabled={
              busy ||
              (!!job &&
                ["awaiting_agent", "queued", "running"].includes(job.status))
            }
            onClick={() =>
              act(async () => {
                const r = await api<{ job: Job }>("patterns/context", "POST", {
                  ...input,
                  generation_source: source,
                });
                setJob(r.job);
              })
            }
          >
            请求语境判断
          </button>
          {job && (
            <div className="notice">
              {job.status} {job.error_code}
              <pre className="mono">pnpm skillforge job get {job.id}</pre>
              {job.status === "failed" && (
                <p>模型分析失败；上面的确定性结果仍有效，可继续人工复核。</p>
              )}
              {job.result && (
                <>
                  <p>
                    {job.result.model_details.simulated
                      ? "模拟判断，不是真实语义分析"
                      : "模型建议，仍需人工复核"}
                  </p>
                  {job.result.judgements.map((j) => (
                    <p key={j.finding_index}>
                      命中 {j.finding_index + 1} · {j.verdict} · {j.reason}
                    </p>
                  ))}
                </>
              )}
            </div>
          )}
        </section>
      )}
      <h2>自定义模式</h2>
      <details>
        <summary>添加可编辑语言模式</summary>
        <RuleEditor
          key={"new-pattern-" + projectId}
          projects={projects}
          projectId={projectId}
          label="保存模式"
          onSave={async (config) => {
            await api("patterns", "POST", { config });
            await load();
            setStatus("模式已保存；尚未发布为偏好规则");
          }}
        />
      </details>
      {data.patterns.map((p) => {
        const config = ruleConfig.parse(p.config_json);
        return (
          <article className="panel" key={p.id}>
            <h3>{config.title}</h3>
            <p>{config.instruction}</p>
            <p>
              {p.active ? "检测启用" : "检测停用"} · v{p.version} ·{" "}
              {config.strength} · {config.scope.domain}
            </p>
            <div className="actions">
              <button
                className="secondary"
                onClick={() => setEditing(editing === p.id ? "" : p.id)}
              >
                编辑模式与强度
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await api(`patterns/${p.id}`, "PATCH", {
                      expected_version: p.version,
                      active: !p.active,
                    });
                    await load();
                  })
                }
              >
                {p.active ? "停用检测" : "启用检测"}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await api("preferences", "POST", {
                      config,
                      pattern_id: p.id,
                    });
                    setStatus("已生成待确认规则，请前往偏好页明确确认");
                  })
                }
              >
                提出偏好规则
              </button>
            </div>
            {editing === p.id && (
              <RuleEditor
                key={p.id + p.version}
                projects={projects}
                projectId={config.scope.project_id ?? ""}
                initial={config}
                label="保存模式修改"
                onSave={async (config) => {
                  await api(`patterns/${p.id}`, "PATCH", {
                    expected_version: p.version,
                    config,
                  });
                  setEditing("");
                  await load();
                }}
              />
            )}
          </article>
        );
      })}
      <Link
        href={"/preferences" + (projectId ? `?project_id=${projectId}` : "")}
      >
        前往确认偏好规则 →
      </Link>
      <details>
        <summary>不可变复核记录（{data.reviews.length}）</summary>
        {data.reviews.map((r) => (
          <article className="card" key={r.id}>
            <p>
              {r.event_type} · {new Date(r.created_at).toLocaleString("zh-CN")}
            </p>
            <pre className="mono">
              {JSON.stringify(r.payload_json, null, 2)}
            </pre>
            <details>
              <summary>永久清除此复核原文</summary>
              <p>
                清除复核原文与直接模型缓存，相关规则停用并擦除旧证据文本；历史成品与独立评测不自动撤回。
              </p>
              <label className="row">
                <input
                  style={{ width: 18 }}
                  type="checkbox"
                  checked={eraseReviews[r.id] ?? false}
                  onChange={(e) =>
                    setEraseReviews({
                      ...eraseReviews,
                      [r.id]: e.target.checked,
                    })
                  }
                />
                我确认永久清除此条模式复核与关联证据文本
              </label>
              <button
                disabled={busy || !eraseReviews[r.id]}
                className="danger"
                onClick={() =>
                  act(async () => {
                    await api(`patterns/reviews/${r.id}`, "DELETE", {
                      confirm: true,
                    });
                    await load();
                    setStatus("复核原文已清除；相关规则停用，清除凭证已保留");
                  })
                }
              >
                永久清除此复核
              </button>
            </details>
          </article>
        ))}
      </details>
    </>
  );
}
