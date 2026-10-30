import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = {
  title: "SkillForge · 表达训练工作台",
  description: "Agent Skill 与人类反馈工作台",
};
const links = [
  ["/", "工作台"],
  ["/projects", "训练项目"],
  ["/topics", "主题任务"],
  ["/corpus", "人类语料"],
  ["/patterns", "语言模式"],
  ["/preferences", "偏好规则"],
  ["/skills", "成品 Skills"],
  ["/evaluations", "盲测评估"],
  ["/settings", "设置与隐私"],
];
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <Link className="brand" href="/">
              S
              <span>
                SkillForge<small>人类反馈 · Agent Skills</small>
              </span>
            </Link>
            <nav aria-label="主导航">
              {links.map(([url, label], i) => (
                <Link key={url} href={url}>
                  <span className="nav-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {label}
                </Link>
              ))}
            </nav>
            <div className="sidebar-foot">
              本地工作空间
              <br />
              <span>反馈属于你，模型由 Agent 选择。</span>
            </div>
          </aside>
          <div className="main-shell">
            <header className="topbar">
              <span>SKILLFORGE / TRAINING WORKBENCH</span>
              <span className="badge">Agent + Web</span>
            </header>
            <main id="main-content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
