"use client";
import { useState } from "react";
import { ruleConfig, type RuleConfig } from "@skillforge/core/rule-types";
export type ProjectOption = { id: string; name: string; domain: string };
export default function RuleEditor({
  projects,
  initial,
  projectId = "",
  onSave,
  label = "保存待确认规则",
}: {
  projects: ProjectOption[];
  initial?: RuleConfig;
  projectId?: string;
  onSave: (config: RuleConfig) => Promise<void>;
  label?: string;
}) {
  const [draft, setDraft] = useState<RuleConfig>(
      initial ?? {
        title: "",
        instruction: "",
        level: "phrase",
        family: "",
        match_spec: { kind: "guidance", phrases: [], frequency_threshold: 2 },
        scope: {
          level: "project",
          project_id: projectId || null,
          task_id: null,
          domain:
            projects.find((p) => p.id === projectId)?.domain === "dialogue"
              ? "dialogue"
              : "writing",
          genre: "",
        },
        strength: "avoid",
        exceptions: [
          "quoted_original",
          "character_dialogue",
          "genuine_logical_contrast",
        ],
        positive_examples: [],
        negative_examples: [],
        rewrite_strategies: [],
        polarity: "avoid",
      },
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const id = "rule-" + (initial ? "edit" : "new");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onSave(ruleConfig.parse(draft));
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="panel">
      <div className="field-grid">
        <div>
          <label htmlFor={id + "title"}>规则标题</label>
          <input
            id={id + "title"}
            value={draft.title}
            required
            maxLength={200}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={id + "family"}>模式家族标识</label>
          <input
            id={id + "family"}
            value={draft.family}
            required
            maxLength={100}
            placeholder="例如 opening / contrast / direct-answer"
            onChange={(e) => setDraft({ ...draft, family: e.target.value })}
          />
        </div>
      </div>
      <label htmlFor={id + "instruction"}>具体指导</label>
      <textarea
        id={id + "instruction"}
        required
        value={draft.instruction}
        onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
      />
      <div className="field-grid">
        <div>
          <label htmlFor={id + "domain"}>适用领域</label>
          <select
            id={id + "domain"}
            value={draft.scope.domain}
            onChange={(e) =>
              setDraft({
                ...draft,
                scope: {
                  ...draft.scope,
                  domain: e.target.value as RuleConfig["scope"]["domain"],
                },
              })
            }
          >
            <option value="writing">写作</option>
            <option value="dialogue">对话</option>
            <option value="both">显式共享写作与对话</option>
          </select>
        </div>
        <div>
          <label htmlFor={id + "scope"}>作用域</label>
          <select
            id={id + "scope"}
            value={draft.scope.level}
            onChange={(e) =>
              setDraft({
                ...draft,
                scope: {
                  ...draft.scope,
                  level: e.target.value as RuleConfig["scope"]["level"],
                  project_id:
                    e.target.value === "user" ? null : projectId || null,
                  task_id: null,
                },
              })
            }
          >
            <option value="project">项目</option>
            <option value="task">任务</option>
            <option value="user">用户</option>
          </select>
        </div>
        {draft.scope.level !== "user" && (
          <div>
            <label htmlFor={id + "project"}>规则项目</label>
            <select
              id={id + "project"}
              value={draft.scope.project_id ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  scope: {
                    ...draft.scope,
                    project_id: e.target.value || null,
                    task_id: null,
                  },
                })
              }
            >
              <option value="">请选择项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {draft.scope.level === "task" && (
          <div>
            <label htmlFor={id + "task"}>任务 UUID</label>
            <input
              id={id + "task"}
              value={draft.scope.task_id ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  scope: { ...draft.scope, task_id: e.target.value || null },
                })
              }
            />
          </div>
        )}
        <div>
          <label htmlFor={id + "genre"}>限定体裁（空为不限）</label>
          <input
            id={id + "genre"}
            value={draft.scope.genre}
            onChange={(e) =>
              setDraft({
                ...draft,
                scope: { ...draft.scope, genre: e.target.value },
              })
            }
          />
        </div>
        <div>
          <label htmlFor={id + "strength"}>规则强度</label>
          <select
            id={id + "strength"}
            value={draft.strength}
            onChange={(e) =>
              setDraft({
                ...draft,
                strength: e.target.value as RuleConfig["strength"],
              })
            }
          >
            <option value="suggest_only">只提示</option>
            <option value="avoid">尽量避免</option>
            <option value="forbid">范围内禁止（保留事实与引用例外）</option>
            <option value="limit_frequency">限制频率</option>
          </select>
        </div>
        <div>
          <label htmlFor={id + "polarity"}>偏好方向</label>
          <select
            id={id + "polarity"}
            value={draft.polarity}
            onChange={(e) =>
              setDraft({
                ...draft,
                polarity: e.target.value as RuleConfig["polarity"],
              })
            }
          >
            <option value="avoid">避免</option>
            <option value="prefer">偏好</option>
          </select>
        </div>
        <div>
          <label htmlFor={id + "match"}>检测方法</label>
          <select
            id={id + "match"}
            value={draft.match_spec.kind}
            onChange={(e) =>
              setDraft({
                ...draft,
                match_spec: {
                  ...draft.match_spec,
                  kind: e.target.value as RuleConfig["match_spec"]["kind"],
                },
              })
            }
          >
            <option value="guidance">语义指导（不伪装静态命中）</option>
            <option value="phrase">精确短语</option>
            <option value="contrast_family">对立转折句式家族</option>
          </select>
        </div>
        <div>
          <label htmlFor={id + "level"}>语言层级</label>
          <select
            id={id + "level"}
            value={draft.level}
            onChange={(e) =>
              setDraft({
                ...draft,
                level: e.target.value as RuleConfig["level"],
              })
            }
          >
            {[
              "token",
              "phrase",
              "syntax",
              "rhetoric",
              "paragraph",
              "discourse",
            ].map((level) => (
              <option key={level}>{level}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={id + "threshold"}>出现次数阈值</label>
          <input
            id={id + "threshold"}
            type="number"
            min={1}
            max={100}
            value={draft.match_spec.frequency_threshold}
            onChange={(e) =>
              setDraft({
                ...draft,
                match_spec: {
                  ...draft.match_spec,
                  frequency_threshold: Number(e.target.value),
                },
              })
            }
          />
        </div>
      </div>
      {draft.match_spec.kind === "phrase" && (
        <>
          <label htmlFor={id + "phrases"}>
            短语（每行一个，不支持任意正则）
          </label>
          <textarea
            id={id + "phrases"}
            value={draft.match_spec.phrases.join("\n")}
            onChange={(e) =>
              setDraft({
                ...draft,
                match_spec: {
                  ...draft.match_spec,
                  phrases: e.target.value.split("\n"),
                },
              })
            }
          />
        </>
      )}
      <fieldset>
        <legend>语境例外</legend>
        {(
          [
            ["quoted_original", "原文引用"],
            ["character_dialogue", "人物对白"],
            ["genuine_logical_contrast", "必要逻辑纠正"],
            ["technical_term", "专业术语"],
            ["genre_exception", "限定体裁由人工判断"],
          ] as const
        ).map(([value, title]) => (
          <label className="row" key={value}>
            <input
              style={{ width: 18 }}
              type="checkbox"
              checked={draft.exceptions.includes(value)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  exceptions: e.target.checked
                    ? [...draft.exceptions, value]
                    : draft.exceptions.filter((v) => v !== value),
                })
              }
            />
            {title}
          </label>
        ))}
      </fieldset>
      {(
        [
          ["positive_examples", "适用或正向例子"],
          ["negative_examples", "反例与不适用边界"],
          ["rewrite_strategies", "替换策略"],
        ] as const
      ).map(([field, title]) => (
        <div key={field}>
          <label htmlFor={id + field}>{title}（每行一条）</label>
          <textarea
            id={id + field}
            value={draft[field].join("\n")}
            onChange={(e) =>
              setDraft({ ...draft, [field]: e.target.value.split("\n") })
            }
          />
        </div>
      ))}
      <p className="muted">
        保存编辑后回到
        proposed，必须再次确认才进入后续构建。事实、数字、否定与用户明确任务始终优先。修改不会回写已发布包。
      </p>
      {error && <div role="alert">{error}</div>}
      <button disabled={busy} type="submit">
        {busy ? "保存中…" : label}
      </button>
    </form>
  );
}
