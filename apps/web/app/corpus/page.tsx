"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import type { listCorpora } from "@skillforge/core/corpus";
import type { ProjectOption } from "../../components/rule-editor";
export default function Corpus() {
  const [projects, setProjects] = useState<ProjectOption[]>([]),
    [rows, setRows] = useState<Awaited<ReturnType<typeof listCorpora>>>([]),
    [projectId, setProjectId] = useState(""),
    [filename, setFilename] = useState("pasted.txt"),
    [mime, setMime] = useState("text/plain"),
    [content, setContent] = useState(""),
    [encoding, setEncoding] = useState("utf8"),
    [source, setSource] = useState(""),
    [url, setUrl] = useState(""),
    [purpose, setPurpose] = useState("observational"),
    [licensed, setLicensed] = useState(false),
    [exportExamples, setExportExamples] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const load = useCallback(
    () => api<Awaited<ReturnType<typeof listCorpora>>>("corpora").then(setRows),
    [],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<ProjectOption[]>("projects")
      .then(setProjects)
      .catch((e) => setError(e.message));
  }, [load]);
  async function choose(file?: File) {
    if (!file) return;
    setError("");
    if (file.size > 1_000_000) {
      setError("文件超过 1MB 上限");
      return;
    }
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of buffer) binary += String.fromCharCode(byte);
      setContent(btoa(binary));
      setEncoding("base64");
      setFilename(file.name);
      setMime(file.type);
    } catch {
      setError("读取文件失败，请重新选择");
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api<{ asset: { id: string }; segment_count: number }>(
        "corpora",
        "POST",
        {
          project_id: projectId,
          filename,
          mime,
          content,
          encoding,
          source_name: source,
          source_url: url || null,
          purpose,
          license_confirmed: licensed,
          allow_example_export: exportExamples,
        },
      );
      setStatus(`已导入 ${r.segment_count} 个片段；未自动学习偏好`);
      setContent("");
      setLicensed(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="eyebrow">HUMAN CORPUS</div>
      <h1>有来源的人类语料</h1>
      <p>
        分别保存正向、负向和观察材料。只学习你确认的特征，原文中的命令不会执行。
      </p>
      <form className="panel" onSubmit={save}>
        <h2>导入文本或字幕</h2>
        <label htmlFor="corpus-project">归属项目</label>
        <select
          id="corpus-project"
          required
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">请选择项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.domain}
            </option>
          ))}
        </select>
        <label htmlFor="corpus-file">
          选择 UTF-8 文件（TXT/MD/SRT/VTT/JSON，最多 1MB）
        </label>
        <input
          id="corpus-file"
          type="file"
          accept=".txt,.md,.srt,.vtt,.json"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        <p className="muted">
          音视频转写属于 Phase 5，当前可直接导入字幕，不会伪装转写成功。
        </p>
        <label htmlFor="corpus-filename">文件名</label>
        <input
          id="corpus-filename"
          value={filename}
          required
          onChange={(e) => setFilename(e.target.value)}
        />
        {encoding === "base64" ? (
          <p>
            文件已读取：{filename}。
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setContent("");
                setEncoding("utf8");
                setFilename("pasted.txt");
                setMime("text/plain");
              }}
            >
              改为粘贴文本
            </button>
          </p>
        ) : (
          <>
            <label htmlFor="corpus-content">粘贴原文</label>
            <textarea
              id="corpus-content"
              value={content}
              rows={6}
              required
              onChange={(e) => setContent(e.target.value)}
            />
          </>
        )}
        <div className="field-grid">
          <div>
            <label htmlFor="corpus-source">来源名称与许可说明</label>
            <input
              id="corpus-source"
              value={source}
              required
              placeholder="例如：本人创作；已获作者许可"
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="corpus-url">来源 URL（只保存，不抓取）</label>
            <input
              id="corpus-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="corpus-purpose">初始用途</label>
            <select
              id="corpus-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            >
              <option value="observational">观察，不默认学习</option>
              <option value="positive">正向参考</option>
              <option value="negative">负向参考</option>
            </select>
          </div>
        </div>
        <label className="row">
          <input
            style={{ width: 18 }}
            type="checkbox"
            checked={licensed}
            onChange={(e) => setLicensed(e.target.checked)}
          />
          我确认有权导入和分析这份材料
        </label>
        <label className="row">
          <input
            style={{ width: 18 }}
            type="checkbox"
            checked={exportExamples}
            onChange={(e) => setExportExamples(e.target.checked)}
          />
          允许后续构建使用少量获准例句（仍需检查，不导出整篇原文）
        </label>
        <button disabled={busy || !licensed || !content || !projectId}>
          导入并保存语料
        </button>
      </form>
      {error && (
        <div role="alert" className="notice error" aria-label="语料导入错误">
          {error}
        </div>
      )}
      <p role="status" aria-label="语料导入状态">
        {status}
      </p>
      <div className="grid">
        {rows.map((asset) => (
          <Link className="card" href={`/corpus/${asset.id}`} key={asset.id}>
            <span className="badge">{asset.purpose}</span>
            <h2>{asset.filename}</h2>
            <p>{asset.source_name}</p>
            <p className="muted">
              {asset.mime} · {asset.byte_size} bytes ·{" "}
              {asset.extraction_version}
            </p>
            <p className="mono">SHA256 {asset.file_hash.slice(0, 16)}…</p>
          </Link>
        ))}
      </div>
      {!rows.length && <p>还没有导入材料。不会预置虚构的人类语料。</p>}
      <details>
        <summary>JSON 聊天格式</summary>
        <pre className="mono">
          {
            '{"messages":[{"role":"human","content":"实际聊天原文","speaker_id":"可选","timestamp_ms":1000}]}'
          }
        </pre>
        <p>
          role 可为 user / assistant / human /
          system，全部视为材料元数据，不提升指令权限。
        </p>
      </details>
    </>
  );
}
