"use client";
import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { diffChars } from "diff";
import { api } from "../../../lib/api";
import type {
  getSkillBuild,
  listSkillBuilds,
} from "@skillforge/core/skill-compiler";
type Build = Awaited<ReturnType<typeof getSkillBuild>>;
export default function SkillDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params),
    [build, setBuild] = useState<Build | null>(null),
    [rows, setRows] = useState<Awaited<ReturnType<typeof listSkillBuilds>>>([]),
    [file, setFile] = useState(""),
    [compareId, setCompareId] = useState(""),
    [comparison, setComparison] = useState<Build | null>(null),
    [error, setError] = useState("");
  const load = useCallback(
    () =>
      api<Build>(`skills/builds/${id}`).then((b) => {
        setBuild(b);
        setFile(`${b.skill_type}/SKILL.md`);
        return api<Awaited<ReturnType<typeof listSkillBuilds>>>(
          `skills/builds?project_id=${b.project_id}`,
        ).then(setRows);
      }),
    [id],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    if (!compareId) return;
    let current = true;
    api<Build>(`skills/builds/${compareId}`)
      .then((b) => {
        if (current) setComparison(b);
      })
      .catch((e) => setError(e.message));
    return () => {
      current = false;
    };
  }, [compareId]);
  return (
    <>
      <div className="eyebrow">BUILD SNAPSHOT</div>
      <h1>
        {build ? `${build.skill_type} ${build.semantic_version}` : "读取构建…"}
      </h1>
      <Link href="/skills">← 返回构建历史</Link>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {build && (
        <>
          <section className="panel">
            <span className="badge">
              {build.validation_report.valid ? "验证通过" : "验证失败"}
            </span>
            <p>
              已确认规则快照 {build.rules_snapshot.length} 条 ·{" "}
              {build.generator_version}
            </p>
            <p className="mono">内容 SHA256：{build.content_hash}</p>
            <p className="mono">ZIP SHA256：{build.zip_hash}</p>
            <a
              href={`/api/skills/builds/${id}/download`}
              download={`${build.skill_type}-${build.semantic_version}.zip`}
            >
              下载此不可变版本 ZIP
            </a>
            <details>
              <summary>验证报告</summary>
              <pre className="mono">
                {JSON.stringify(build.validation_report, null, 2)}
              </pre>
            </details>
          </section>
          <section className="panel">
            <label htmlFor="skill-file">包内文件预览</label>
            <select
              id="skill-file"
              value={file}
              onChange={(e) => setFile(e.target.value)}
            >
              {Object.keys(build.files_json).map((path) => (
                <option key={path}>{path}</option>
              ))}
            </select>
            <pre
              className="mono"
              data-testid="skill-preview"
              style={{ maxHeight: 520, overflow: "auto" }}
            >
              {build.files_json[file]?.slice(0, 100000)}
            </pre>
            {(build.files_json[file]?.length ?? 0) > 100000 && (
              <p>预览截取前 100000 字符，下载 ZIP 获取完整文件。</p>
            )}
          </section>
          <section className="panel">
            <label htmlFor="skill-compare">与历史版本比较</label>
            <select
              id="skill-compare"
              value={compareId}
              onChange={(e) => {
                setCompareId(e.target.value);
                if (!e.target.value) setComparison(null);
              }}
            >
              <option value="">选择同类历史构建</option>
              {rows
                .filter((r) => r.id !== id && r.skill_type === build.skill_type)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.semantic_version} · {r.content_hash.slice(0, 12)}
                  </option>
                ))}
            </select>
            {comparison && (
              <>
                <p>所选历史版本 → 当前版本；两个快照均不会改写。</p>
                <div className="mono" data-testid="skill-build-diff">
                  {diffChars(
                    comparison.files_json[file] ?? "",
                    build.files_json[file] ?? "",
                  ).map((p, i) => (
                    <span
                      key={i}
                      className={
                        p.added ? "diff-add" : p.removed ? "diff-remove" : ""
                      }
                    >
                      {p.value}
                    </span>
                  ))}
                </div>
                <a
                  href={`/api/skills/builds/${comparison.id}/download`}
                  download
                >
                  下载历史版本以回退
                </a>
              </>
            )}
          </section>
          <section className="panel">
            <h2>在 Codex / OpenCode 中使用</h2>
            <p>
              将 ZIP 下载到本机，运行 trainer CLI
              验证并安装；以下命令请替换为实际下载路径。安装不执行包内脚本，已有目录会拒绝覆盖。
            </p>
            <pre className="mono">{`pnpm skillforge skill validate <downloaded.zip>\npnpm skillforge skill install <downloaded.zip> --target .agents/skills\n# 已存在时使用新名称，保留旧版本可回退\npnpm skillforge skill install <downloaded.zip> --target .agents/skills --name ${build.skill_type}-v${build.semantic_version.replaceAll(".", "-")}`}</pre>
            <p>
              也可使用 trainer/scripts/skillforge.mjs，离线 validate / install
              仅需 Node。打开目标项目后显式调用：使用 {build.skill_type}{" "}
              处理我的写作/回复/自然化任务。
            </p>
            <p className="muted">
              本页不声称已经自动安装到你的其他项目或全局目录。历史包是独立快照，删库或语料删除不会远程撤回已导出的文件。
            </p>
          </section>
          <details>
            <summary>规则与来源快照</summary>
            <pre className="mono">
              {JSON.stringify(build.rules_snapshot, null, 2)}
            </pre>
          </details>
        </>
      )}
    </>
  );
}
