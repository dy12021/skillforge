"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
export default function Settings() {
  const [erasures, setErasures] = useState<unknown[]>([]);
  const [config, setConfig] = useState<{
      provider: string;
      mock: boolean;
      model: string;
      endpoint: string | null;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<unknown[]>("privacy/erasures")
      .then(setErasures)
      .catch((e) => setError(e.message));
    api<typeof config>("settings")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="eyebrow">SETTINGS & PRIVACY</div>
      <h1>连接 Agent，保留数据控制权</h1>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <section className="panel">
        <h2>主要入口：Agent Skill + CLI</h2>
        <p>
          SkillForge 由 OpenCode / Codex 等宿主 Agent 调用。Agent
          使用自己的模型生成内容，这里负责展示候选、收集反馈和持久化记录。
        </p>
        <p>
          trainer Skill 和 CLI 的可复现说明见仓库 README。不会自动写入宿主 Agent
          的全局配置。
        </p>
      </section>
      <section className="panel">
        <h2>可选的应用内模型</h2>
        {config && (
          <div className="notice">
            {config.mock
              ? "演示模式：固定模拟样例，不是真实 AI 能力"
              : `真实模型配置：${config.provider} / ${config.model}，是否可用取决于实际调用结果`}
          </div>
        )}
        <p>
          默认 MODEL_PROVIDER=mock。需要应用独立生成时，可显式配置本机
          Ollama；Agent 接入不需要这些配置。
        </p>
        {config && !config.mock && (
          <p>
            实际接收地址：{config.endpoint}
            。请求成本与材料保留政策由你配置的服务决定。
          </p>
        )}
        <p>
          应用不会把 Agent
          提交的输出声明为经过模型供应商验证。模型标识与来源均按提交记录展示。
        </p>
      </section>
      <section className="panel">
        <h2>本地单用户与隐私</h2>
        <p>
          数据库仅监听本机。请勿把此开发版部署到公网。API Key
          仅从环境变量读取，不返回浏览器，不写入日志。
        </p>
        <p>
          选择真实 provider 意味着训练文本将发送到配置的模型地址；选择 Agent
          路径时数据传输遵循宿主 Agent
          的配置。私人语料提取需在每次任务明确授权；导入本身不会自动形成长期偏好。
        </p>
        <a href="/api/export" download="skillforge-backup.json">
          下载本机工作空间 JSON 备份
        </a>
        <p>
          备份含原始反馈和仍保留的私人语料，请妥善存放。删除语料请进入该语料详情，明确确认后清除原文件、片段与模型输入缓存；已导出的离线
          Skill 无法自动撤回。
        </p>
      </section>
      <section className="panel">
        <h2>隐私清除凭证</h2>
        <p>
          会话页可导出或永久清除该会话的原始反馈，模式页可逐条清除复核。清除记录仅保留数量、目标
          ID 和 hash，不含原文。
        </p>
        <details>
          <summary>查看清除记录（{erasures.length}）</summary>
          <pre className="mono">{JSON.stringify(erasures, null, 2)}</pre>
        </details>
      </section>
    </>
  );
}
