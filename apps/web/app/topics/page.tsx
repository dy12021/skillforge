"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
type Project = { id: string; name: string; domain: string };
type Topic = {
  id: string;
  topic_json: Record<string, unknown>;
  model_details_json: Record<string, unknown>;
};
export default function Topics() {
  const router = useRouter(),
    [projects, setProjects] = useState<Project[]>([]),
    [projectId, setProjectId] = useState(""),
    [source, setSource] = useState("agent"),
    [dimension, setDimension] = useState("具体自然，保持事实"),
    [job, setJob] = useState<{
      id: string;
      status: string;
      error_code?: string;
    } | null>(null),
    [topics, setTopics] = useState<Topic[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    api<Project[]>("projects")
      .then(setProjects)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (projectId)
      api<Topic[]>(`topics?project_id=${projectId}`)
        .then(setTopics)
        .catch((e) => setError(e.message));
  }, [projectId]);
  useEffect(() => {
    if (!job || ["succeeded", "failed", "cancelled"].includes(job.status))
      return;
    const interval = setInterval(() => {
      api<typeof job>(`jobs/${job.id}`)
        .then((j) => {
          setJob(j);
          if (j?.status === "succeeded")
            void api<Topic[]>(`topics?project_id=${projectId}`).then(setTopics);
        })
        .catch((e) => setError(e.message));
    }, 2000);
    return () => clearInterval(interval);
  }, [job, projectId]);
  async function generate() {
    setError("");
    try {
      const r = await api<{ job: { id: string; status: string } }>(
        "topics/generate",
        "POST",
        {
          project_id: projectId,
          generation_source: source,
          target_dimension: dimension,
          granularity:
            projects.find((p) => p.id === projectId)?.domain === "dialogue"
              ? "single-turn"
              : "paragraph",
        },
      );
      setJob(r.job);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function train(topicId: string) {
    try {
      const r = await api<{ url: string }>("sessions", "POST", {
        project_id: projectId,
        mode: projects.find((p) => p.id === projectId)!.domain,
        source: "auto",
        topic_id: topicId,
        candidate_count: 3,
        generation_source: source,
        target_dimension: dimension,
      });
      router.push(r.url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="eyebrow">TOPICS</div>
      <h1>自动主题与覆盖历史</h1>
      <section className="panel">
        <label htmlFor="topic-project">项目</label>
        <select
          id="topic-project"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setJob(null);
          }}
        >
          <option value="">请选择项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.domain}
            </option>
          ))}
        </select>
        <label htmlFor="topic-provider">出题来源</label>
        <select
          id="topic-provider"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="agent">宿主 Agent</option>
          <option value="provider">应用内 provider（默认 mock）</option>
        </select>
        <label htmlFor="topic-dimension">训练维度</label>
        <input
          id="topic-dimension"
          value={dimension}
          onChange={(e) => setDimension(e.target.value)}
        />
        <div className="actions">
          <button
            disabled={
              !projectId ||
              (!!job &&
                ["queued", "running", "awaiting_agent"].includes(job.status))
            }
            onClick={generate}
          >
            生成独立训练题
          </button>
        </div>
        <p className="muted">
          按项目对规范化后的 prompt
          去重；这里只显示实际保存的题目，不推测覆盖率或偏好进步。
        </p>
        {job && (
          <div className="notice">
            {job.status} {job.error_code}
            <pre className="mono">pnpm skillforge job get {job.id}</pre>
          </div>
        )}
      </section>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <div className="grid">
        {topics.map((t) => (
          <section className="card" key={t.id}>
            <span className="badge">
              {String(t.model_details_json.provider)}
            </span>
            <h2>{String(t.topic_json.title)}</h2>
            <p>{String(t.topic_json.prompt)}</p>
            <p>维度：{String(t.topic_json.target_dimension)}</p>
            <button onClick={() => train(t.id)}>用此题开始比较</button>
          </section>
        ))}
      </div>
    </>
  );
}
