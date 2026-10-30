"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import type { listSkillBuilds } from "@skillforge/core/skill-compiler";
import type { ProjectOption } from "../../components/rule-editor";
export default function Skills() {
  const [projects, setProjects] = useState<ProjectOption[]>([]),
    [projectId, setProjectId] = useState(""),
    [type, setType] = useState("personalized-writing"),
    [rows, setRows] = useState<Awaited<ReturnType<typeof listSkillBuilds>>>([]),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api<Awaited<ReturnType<typeof listSkillBuilds>>>("skills/builds").then(
        setRows,
      ),
    [],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<ProjectOption[]>("projects")
      .then(setProjects)
      .catch((e) => setError(e.message));
  }, [load]);
  async function build() {
    setError("");
    setBusy(true);
    try {
      const r = await api<{
        build_id: string;
        build: { semantic_version: string; rules_snapshot: unknown[] };
      }>("skills/builds", "POST", { project_id: projectId, type });
      setStatus(
        `已构建 ${r.build.semantic_version}，包含 ${r.build.rules_snapshot.length} 条确认规则；可在历史中预览和下载`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="eyebrow">IMMUTABLE AGENT SKILLS</div>
      <h1>三类离线成品 Skill</h1>
      <p>
        每次构建固定确认规则和最小获准例句。修改偏好只影响新构建，历史版本保留原
        hash 和下载。
      </p>
      <section className="panel">
        <label htmlFor="build-project">构建项目</label>
        <select
          id="build-project"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setType(
              projects.find((p) => p.id === e.target.value)?.domain ===
                "dialogue"
                ? "personalized-dialogue"
                : "personalized-writing",
            );
          }}
        >
          <option value="">请选择项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.domain}
            </option>
          ))}
        </select>
        <label htmlFor="build-type">Skill 类型</label>
        <select
          id="build-type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="personalized-writing">
            personalized-writing · 写作生成与改写
          </option>
          <option value="personalized-dialogue">
            personalized-dialogue · 对话回复
          </option>
          <option value="language-naturalizer">
            language-naturalizer · 语境自然化
          </option>
        </select>
        <p className="muted">
          写作/对话按规则领域隔离；自然化采用所选项目领域。零条确认规则会明确显示，不冒充已经学习偏好。
        </p>
        <button disabled={busy || !projectId} onClick={build}>
          {busy ? "编译并验证中…" : "编译确认规则并验证 ZIP"}
        </button>
        <div className="actions">
          <Link
            href={
              "/preferences" + (projectId ? `?project_id=${projectId}` : "")
            }
          >
            先确认或调整规则 →
          </Link>
        </div>
      </section>
      {error && (
        <div role="alert" aria-label="构建错误" className="notice error">
          {error}
        </div>
      )}
      <p role="status" aria-label="构建状态">
        {status}
      </p>
      <h2>构建历史</h2>
      <div className="grid">
        {rows
          .filter((r) => !projectId || r.project_id === projectId)
          .map((r) => (
            <article className="card" key={r.id} data-testid="skill-build">
              <span className="badge">
                {r.validation_report.valid ? "静态验证通过" : "验证未通过"}
              </span>
              <h3>{r.skill_type}</h3>
              <p>
                {r.semantic_version} ·{" "}
                {new Date(r.created_at).toLocaleString("zh-CN")}
              </p>
              <p className="mono">{r.content_hash}</p>
              <div className="actions">
                <Link href={`/skills/${r.id}`}>预览、比较与安装说明</Link>
                <a
                  href={`/api/skills/builds/${r.id}/download`}
                  download={`${r.skill_type}-${r.semantic_version}.zip`}
                >
                  下载 ZIP
                </a>
              </div>
            </article>
          ))}
      </div>
      {!rows.length && <p>尚无构建。不会展示预生成的假成品。</p>}
    </>
  );
}
