"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";
export default function TrainingForm({
  projectId,
  mode,
}: {
  projectId: string;
  mode: string;
}) {
  const router = useRouter(),
    [count, setCount] = useState(3),
    [source, setSource] = useState("auto"),
    [prompt, setPrompt] = useState(""),
    [generation, setGeneration] = useState("agent"),
    [strategy, setStrategy] = useState("diverse"),
    [assets, setAssets] = useState<{ id: string; filename: string }[]>([]),
    [assetId, setAssetId] = useState(""),
    [segments, setSegments] = useState<
      { id: string; position: number; original_text: string }[]
    >([]),
    [segmentId, setSegmentId] = useState(""),
    [transferConfirmed, setTransferConfirmed] = useState(false),
    [dimension, setDimension] = useState("具体、自然，保持事实"),
    [granularity, setGranularity] = useState(
      mode === "dialogue" ? "single-turn" : "paragraph",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (source === "corpus-derived")
      api<typeof assets>(`corpora?project_id=${projectId}`)
        .then(setAssets)
        .catch((e) => setError(e.message));
  }, [source, projectId]);
  useEffect(() => {
    let active = true;
    if (source === "corpus-derived" && assetId)
      api<{ segments: typeof segments }>(`corpora/${assetId}`)
        .then((result) => {
          if (active) setSegments(result.segments);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [source, assetId]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ url: string }>("sessions", "POST", {
        project_id: projectId,
        mode,
        source,
        prompt: source === "auto" ? "" : prompt,
        candidate_count: count,
        generation_source: generation,
        target_dimension: dimension,
        granularity,
        strategy,
        ...(source === "corpus-derived"
          ? {
              corpus_asset_id: assetId,
              corpus_segment_id: segmentId,
              data_transfer_confirmed: transferConfirmed,
            }
          : {}),
      });
      router.push(result.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h2>开始一轮训练</h2>
      <div className="field-grid">
        <div>
          <label htmlFor="strategy">生成策略</label>
          <select
            id="strategy"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
          >
            <option value="diverse">多样性探索</option>
            <option value="focused">单维度微调</option>
          </select>
        </div>
        <div>
          <label htmlFor="generation-source">生成来源</label>
          <select
            id="generation-source"
            value={generation}
            onChange={(e) => setGeneration(e.target.value)}
          >
            <option value="agent">宿主 Agent（OpenCode / Codex）</option>
            <option value="provider">应用内 provider（默认 mock 演示）</option>
          </select>
        </div>
        <div>
          <label htmlFor="candidate-count">候选数量（2～8）</label>
          <input
            id="candidate-count"
            type="number"
            min={2}
            max={8}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor="topic-source">题目来源</label>
          <select
            id="topic-source"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setAssetId("");
              setSegmentId("");
              setSegments([]);
              setTransferConfirmed(false);
            }}
          >
            <option value="auto">自动出题</option>
            <option value="manual">手动主题</option>
            <option value="corpus-derived">基于已导入语料的片段</option>
          </select>
        </div>
        <div>
          <label htmlFor="granularity">训练粒度</label>
          <select
            id="granularity"
            value={granularity}
            onChange={(e) => setGranularity(e.target.value)}
          >
            {(mode === "dialogue"
              ? ["single-turn", "multi-turn"]
              : ["phrase", "sentence", "paragraph", "article"]
            ).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>
      {source === "corpus-derived" && (
        <>
          <label htmlFor="training-corpus">参考语料</label>
          <select
            id="training-corpus"
            value={assetId}
            onChange={(e) => {
              setAssetId(e.target.value);
              setSegmentId("");
              setSegments([]);
              setTransferConfirmed(false);
            }}
            required
          >
            <option value="">选择本项目语料</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.filename}
              </option>
            ))}
          </select>
          <label htmlFor="training-segment">参考片段</label>
          <select
            id="training-segment"
            value={segmentId}
            onChange={(e) => setSegmentId(e.target.value)}
            required
          >
            <option value="">选择一个片段</option>
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                片段 {segment.position + 1}
              </option>
            ))}
          </select>
          {segments.find((segment) => segment.id === segmentId) && (
            <blockquote>
              {
                segments.find((segment) => segment.id === segmentId)
                  ?.original_text
              }
            </blockquote>
          )}
          <p>
            请根据片段自行编写训练题。系统只发送你填写的题目，记录所选片段
            ID，不会自动发送片段或相邻上下文。题目和候选作为独立会话保存；删除语料不会自动删除这些另行创建的内容。
          </p>
          <label className="row">
            <input
              type="checkbox"
              checked={transferConfirmed}
              onChange={(e) => setTransferConfirmed(e.target.checked)}
              required
            />
            我确认将自己填写的训练题交给所选模型
          </label>
        </>
      )}
      {source !== "auto" && (
        <>
          <label htmlFor="manual-prompt">训练题目</label>
          <textarea
            id="manual-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            required
          />
        </>
      )}
      <label htmlFor="dimension">本轮训练维度</label>
      <input
        id="dimension"
        value={dimension}
        onChange={(e) => setDimension(e.target.value)}
        required
      />
      {generation === "agent" ? (
        <div className="notice success">
          任务会等待宿主 Agent 生成内容。无需应用内模型凭据；创建后可用 CLI 的
          job list 领取。
        </div>
      ) : (
        <div className="notice">
          将使用设置中配置的 provider，默认返回明确标记的固定 mock
          示例。需要另启动 pnpm worker。
        </div>
      )}
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <button disabled={busy}>{busy ? "创建中…" : "创建训练会话"}</button>
    </form>
  );
}
