"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import TrainingForm from "../../../components/training-form";
import Link from "next/link";
type Project = { id: string; name: string; domain: string; version: number };
export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params),
    router = useRouter();
  const [project, setProject] = useState<Project | null>(null),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [history, setHistory] = useState<
    { id: string; state: string; created_at: string }[]
  >([]);
  useEffect(() => {
    api<Project>(`projects/${id}`)
      .then((p) => {
        setProject(p);
        setName(p.name);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => {
    api<typeof history>(`projects/${id}/sessions`)
      .then(setHistory)
      .catch((e) => setError(e.message));
  }, [id]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("保存中…");
    try {
      const p = await api<Project>(`projects/${id}`, "PATCH", {
        name,
        expected_version: project!.version,
      });
      setProject(p);
      setStatus("已保存到数据库");
    } catch (e) {
      setError((e as Error).message);
      setStatus("保存失败");
    }
  }
  async function archive() {
    if (!confirm("归档项目？已有反馈与版本会保留。")) return;
    try {
      await api(`projects/${id}`, "DELETE", {
        expected_version: project!.version,
      });
      router.push("/projects");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="eyebrow">PROJECT / {project?.domain}</div>
      <h1>{project?.name ?? "载入项目…"}</h1>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {project && (
        <>
          <TrainingForm projectId={id} mode={project.domain} />
          <div className="panel">
            <h2>训练历史</h2>
            {history.length ? (
              history.map((s) => (
                <p key={s.id}>
                  <Link href={`/sessions/${s.id}/compare`}>
                    会话 {s.id.slice(0, 8)} →
                  </Link>{" "}
                  <span className="badge">{s.state}</span>{" "}
                  <span className="muted">
                    {new Date(s.created_at).toLocaleString("zh-CN")}
                  </span>
                </p>
              ))
            ) : (
              <p className="muted">还没有训练会话</p>
            )}
          </div>
          <form className="panel narrow" onSubmit={save}>
            <h2>项目设置</h2>
            <label htmlFor="name">项目名称</label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <div className="actions">
              <button>保存设置</button>
              <button type="button" className="secondary" onClick={archive}>
                归档项目
              </button>
            </div>
            <p role="status">{status}</p>
          </form>
          <div className="panel">
            <h2>Agent 接入</h2>
            <p>
              在 Agent 中调用 skillforge，或通过 CLI
              创建此项目的训练会话。
            </p>
            <pre className="mono">
              pnpm skillforge session create --project {id} --mode{" "}
              {project.domain} --topic auto --candidates 3
            </pre>
          </div>
        </>
      )}
    </>
  );
}
