import Link from "next/link";
import { listSkillBuilds } from "@skillforge/core/skill-compiler";
export const dynamic = "force-dynamic";
export default async function Home() {
  let recent: Awaited<ReturnType<typeof listSkillBuilds>> = [];
  let unavailable = false;
  try {
    recent = (await listSkillBuilds()).slice(0, 4);
  } catch {
    unavailable = true;
  }
  return (
    <>
      <div className="eyebrow">YOUR WORDS, YOUR WAY</div>
      <section className="hero">
        <span className="badge">Agent Skill · 人类反馈训练</span>
        <h1>
          把你的表达偏好，
          <br />
          交给每一次 Agent 写作。
        </h1>
        <p>
          由 OpenCode、Codex 等 Agent
          生成多种表达，在这里比较、圈选和改写。保留每一条原始反馈，让下一轮有据可循。
        </p>
        <div className="actions">
          <Link href="/projects" className="button">
            开始训练 →
          </Link>
          <Link href="/settings" className="button secondary">
            连接 Agent / 配置指引
          </Link>
        </div>
      </section>
      <h2 className="section-label">一轮训练，三个步骤</h2>
      <div className="grid">
        {[
          [
            "01 / GENERATE",
            "让 Agent 提供候选",
            "Agent 通过 Skill / CLI 创建题目，提交 2～8 个候选。应用内模拟生成需明确选择。",
          ],
          [
            "02 / FEEDBACK",
            "用你的判断校准表达",
            "比较候选，留下评语与人工改写。反馈写入数据库，刷新后可恢复。",
          ],
          [
            "03 / CONTINUE",
            "让 Agent 读到真实反馈",
            "通过 CLI 取回原始反馈，确认偏好规则、构建成品，再用保留题盲测。",
          ],
        ].map(([n, t, d]) => (
          <div className="card" key={n}>
            <div className="step-number">{n}</div>
            <h3>{t}</h3>
            <p className="muted">{d}</p>
          </div>
        ))}
      </div>
      <section className="panel">
        <h2>最近构建的 Skill</h2>
        {unavailable ? (
          <p>暂时无法读取构建记录，请检查数据库连接。</p>
        ) : recent.length ? (
          recent.map((build) => (
            <p key={build.id}>
              <Link href={`/skills/${build.id}`}>
                {build.skill_type} · {build.semantic_version}
              </Link>
            </p>
          ))
        ) : (
          <p>还没有构建；确认偏好规则后可在 Skill 页面创建。</p>
        )}
        <Link href="/skills">查看所有 Skill →</Link>
      </section>
    </>
  );
}
