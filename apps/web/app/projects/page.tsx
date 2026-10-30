"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
type Project = { id: string; name: string; domain: string; version: number };
export default function Projects() {
  const [rows, setRows] = useState<Project[]>([]),
    [name, setName] = useState(""),
    [domain, setDomain] = useState("writing"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setRows(await api<Project[]>("projects"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    api<Project[]>("projects")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("projects", "POST", { name, domain });
      setName("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="eyebrow">PROJECTS</div>
      <h1>训练项目</h1>
      <p className="muted">按用途分开训练，文章风格和对话偏好分别保留。</p>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <form className="panel narrow" onSubmit={create}>
        <h2>新建项目</h2>
        <label htmlFor="name">项目名称</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
        />
        <label htmlFor="domain">训练类型</label>
        <select
          id="domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
        >
          <option value="writing">文章写作</option>
          <option value="dialogue">对话回复</option>
        </select>
        <div className="actions">
          <button disabled={busy}>{busy ? "保存中…" : "创建项目"}</button>
        </div>
      </form>
      <div className="grid">
        {rows.map((p) => (
          <Link className="card" href={`/projects/${p.id}`} key={p.id}>
            <span className="badge">
              {p.domain === "writing" ? "写作" : "对话"}
            </span>
            <h3>{p.name}</h3>
            <span className="muted">进入项目 →</span>
          </Link>
        ))}
      </div>
      {rows.length === 0 && !error && (
        <p className="muted">还没有项目。新建后可由 Agent 或 Web 发起训练。</p>
      )}
    </>
  );
}
