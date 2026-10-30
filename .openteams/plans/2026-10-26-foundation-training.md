# SkillForge Foundation and First Training Flow Implementation Plan

**Goal:** 完成 Phase 0 可运行工程及 Phase 1 自动出题、多候选、不可变反馈、刷新恢复的首条纵向流程。

**Architecture:** OpenCode/Codex 宿主调用 skillforge-trainer Skill，经 CLI/HTTP 创建任务与提交生成内容；Next.js Web 提供人类反馈面板，Drizzle 将状态写入 PostgreSQL。应用内模型 worker 是可选路径；Agent、mock 与 Ollama 来源严格区分。

**Tech Stack:** pnpm、TypeScript strict、Next.js、React、Tailwind、PostgreSQL 17、Drizzle、Zod、Vitest、Playwright、Tiptap。

---

### Task 1: Phase 0 工程、配置与数据

文件：根 package/config、`apps/web`、`packages/core/src/{config,schema,db,errors,commands,projects,models}.ts`、`migrations`、`scripts/{migrate,seed,prepare-test}.ts`。
顺序：安装锁定依赖 → 声明 Drizzle schema → `pnpm db:generate` → `docker compose --profile test up -d --wait` → `pnpm db:migrate` → `pnpm db:seed`。业务代码不创建表。

### Task 2: Phase 0 API、工作台与验证

文件：`apps/web/app/api/[...path]/route.ts`、layout、导航、项目 CRUD、设置与待交付说明页；`tests/{domain,projects.integration}.test.ts`、`tests/e2e/foundation.spec.ts`、CI。
先验证 Zod 无效输入与 CRUD/幂等/冲突，再实现对应服务。执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:e2e`；只把实际通过项记入 `docs/IMPLEMENTATION_STATUS.md`。

### Task 3: Phase 1 首条流程

文件：`packages/core/src/{training,jobs,feedback}.ts`、`scripts/worker.ts`、`.agents/skills/skillforge-trainer/SKILL.md` 与其独立 Node CLI、session 工作台；集成与 E2E 测试。按用户澄清把 trainer CLI 从原 Phase 3 提前，Skill 编译/安装仍在 Phase 3，不虚构这部分能力。
服务端生成 task、candidate_set、N=2..8 candidates 与 display_order，保留模型参数、耗时、usage、prompt version。五类比较反馈和无需胜者的评论/人工改写保留原始语义；事务、不可变事件及幂等并发校验。
主流程：Agent 创建会话 → 自己生成题目及 N 候选 → CLI 提交 → 用户打开 Web URL → 比较及反馈 → Agent 读取反馈 → 下一轮。Web 也能创建 awaiting_agent 任务，或者显式选择 mock/provider 路径。失败/重试与来源可见。

### Task 4: Phase 1 文本版本与圈选切片

文件：`packages/core/src/annotations.ts`（圈选与人工版本服务）、Tiptap 编辑器与版本 diff。验证 UTF-16 offset/quote/hash、重叠注释、人工改写产生新版本、旧版标注失配提示。未覆盖完整 Phase 1 时状态保持 partial。

### Task 5: 最终交付

执行同一质量门禁，报告真实 pass/fail/skip；在 README 写明开发库、隔离测试库、worker、真实模型配置、故障排查。状态文档区分 Phase 0、Phase 1 首条切片、剩余阶段。真实调用仅显式 opt-in，不自动消耗账户资源。
