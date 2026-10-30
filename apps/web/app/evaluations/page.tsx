"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import type { listSkillBuilds } from "@skillforge/core/skill-compiler";
import type { listEvaluations } from "@skillforge/core/evaluations";
import type { ProjectOption } from "../../components/rule-editor";
type Builds = Awaited<ReturnType<typeof listSkillBuilds>>;
export default function Evaluations() {
  const router = useRouter(),
    [projects, setProjects] = useState<ProjectOption[]>([]),
    [builds, setBuilds] = useState<Builds>([]),
    [runs, setRuns] = useState<Awaited<ReturnType<typeof listEvaluations>>>([]),
    [projectId, setProjectId] = useState(""),
    [buildId, setBuildId] = useState(""),
    [source, setSource] = useState("agent"),
    [testRun, setTestRun] = useState(false),
    [custom, setCustom] = useState(""),
    [templates, setTemplates] = useState<unknown[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      Promise.all([
        api<Builds>("skills/builds").then(setBuilds),
        api<Awaited<ReturnType<typeof listEvaluations>>>("evaluations").then(
          setRuns,
        ),
      ]),
    [],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<ProjectOption[]>("projects")
      .then(setProjects)
      .catch((e) => setError(e.message));
  }, [load]);
  const selected = builds.find((b) => b.id === buildId),
    domain =
      selected?.skill_type === "personalized-dialogue"
        ? "dialogue"
        : selected?.skill_type === "personalized-writing"
          ? "writing"
          : (projects.find((p) => p.id === selected?.project_id)?.domain ??
            "writing");
  useEffect(() => {
    let current = true;
    api<unknown[]>(`evaluations/templates?domain=${domain}`)
      .then((t) => {
        if (current) setTemplates(t);
      })
      .catch((e) => setError(e.message));
    return () => {
      current = false;
    };
  }, [domain]);
  async function start() {
    setError("");
    setBusy(true);
    try {
      const holdouts = custom.trim() ? JSON.parse(custom) : undefined,
        result = await api<{ url: string }>("evaluations", "POST", {
          build_id: buildId,
          generation_source: source,
          test_run: testRun,
          ...(holdouts ? { holdouts } : {}),
        });
      router.push(result.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="eyebrow">HELD-OUT BLIND EVALUATION</div>
      <h1>保留题盲测</h1>
      <p>
        同一题分别使用普通生成与固定 Skill
        快照，服务端随机左右身份。先投票，再揭示来源；测试票与模拟输出不能证明偏好改善。
      </p>
      <section className="panel">
        <label htmlFor="eval-project">项目筛选</label>
        <select
          id="eval-project"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setBuildId("");
          }}
        >
          <option value="">全部项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label htmlFor="eval-build">固定被测 Skill 版本</label>
        <select
          id="eval-build"
          value={buildId}
          onChange={(e) => setBuildId(e.target.value)}
        >
          <option value="">请选择实际构建</option>
          {builds
            .filter((b) => !projectId || b.project_id === projectId)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.skill_type} {b.semantic_version} ·{" "}
                {b.content_hash.slice(0, 12)}
              </option>
            ))}
        </select>
        <label htmlFor="eval-source">生成来源</label>
        <select
          id="eval-source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="agent">宿主 Agent，使用自身已授权模型</option>
          <option value="provider">应用内 provider（默认 mock）</option>
        </select>
        <label className="row">
          <input
            style={{ width: 18 }}
            type="checkbox"
            checked={testRun}
            onChange={(e) => setTestRun(e.target.checked)}
          />
          这是演示/自动化测试评测，所有票永久标记为测试票
        </label>
        <p className="muted">
          默认使用至少5个固定保留题；与本项目训练题/主题按规范化 prompt
          去重，并阻止保留题回流训练。同一被测构建不可被投票改写。
        </p>
        <details>
          <summary>查看默认保留题</summary>
          <pre className="mono">{JSON.stringify(templates, null, 2)}</pre>
        </details>
        <details>
          <summary>使用自己的5～20个保留题</summary>
          <label htmlFor="eval-custom">保留题 JSON（空则使用默认）</label>
          <textarea
            id="eval-custom"
            rows={5}
            value={custom}
            placeholder={
              '[{"title":"题名","prompt":"未参与训练的新题","constraints":["保留事实"]}, ...至少5题]'
            }
            onChange={(e) => setCustom(e.target.value)}
          />
        </details>
        <button disabled={!buildId || busy} onClick={start}>
          {busy ? "创建中…" : "创建固定版本盲测"}
        </button>
        <Link href="/skills">先构建 Skill →</Link>
      </section>
      {error && (
        <div role="alert" aria-label="盲测创建错误" className="notice error">
          {error}
        </div>
      )}
      <h2>评测记录</h2>
      <div className="grid">
        {runs
          .filter((r) => !projectId || r.project_id === projectId)
          .map((r) => (
            <Link className="card" key={r.id} href={`/evaluations/${r.id}`}>
              <span className="badge">
                {r.test_run ? "测试评测" : "用户评测"} · {r.job_status}
              </span>
              <h3>
                {r.domain} · {r.voted_count}/{r.task_count} 票
              </h3>
              <p>{r.holdout_source}</p>
              <p className="muted">
                {new Date(r.created_at).toLocaleString("zh-CN")}
              </p>
            </Link>
          ))}
      </div>
      {!runs.length && <p>暂无评测；不会用模型自评或虚构票数展示胜率。</p>}
    </>
  );
}
