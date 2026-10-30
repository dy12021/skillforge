# 给 Codex 的第一条任务指令（复制到 Codex 对话）

请把本目录中的 `PROJECT_SPEC.md` 当作 SkillForge 的权威产品说明书，`AGENTS.md` 作为项目开发规则，`IMPLEMENTATION_PLAN.md` 作为阶段路线，`ACCEPTANCE_FIXTURES.md` 作为测试样例。

现在开始在当前仓库实现一个**真实可运行**的 SkillForge，不要只输出规划、静态界面或伪造演示。

**第一轮先完成 Phase 0，并尽可能开始 Phase 1 的纵向切片**：

1. 阅读四份规范，检查当前仓库实际状态；若为空则初始化 pnpm / Next.js / TypeScript / PostgreSQL / Drizzle 的单体仓库结构。
2. 建立数据库 migrations、Project/Session/Task/Candidate/FeedbackEvent 的初始 schema 和 service/API 边界。
3. 实现配置清晰的 mock provider 和可切换的真实模型 adapter 入口；没有密钥时不能假装进行了真实生成。
4. 建立初始 Web 导航，并交付从“开始自动训练”到“N 候选展示、提交选择并刷新可恢复”的首条垂直演示路径。
5. 编写关键单测、API 集成测试及最基本的 E2E；提供 `.env.example`、Docker Compose、README。
6. 按 `IMPLEMENTATION_PLAN.md` 创建/更新 `docs/DECISIONS.md` 与 `docs/IMPLEMENTATION_STATUS.md`，准确记录已实现、未实现和测试结果。

**实现纪律**：优先可运行性与完整的事件存储，避免扩展到不必要的微服务；出现可自行处理的歧义时作合理取舍并记录，不要反复要求产品确认。Phase 0 完成后给出运行和验收说明，再进入下一阶段。不要虚报测试通过，不要上传隐私数据或提交密钥。

后续继续开发时可以使用：

> 继续按 `IMPLEMENTATION_PLAN.md` 完成下一未交付阶段，严格依据 `PROJECT_SPEC.md` 的验收标准，运行测试并更新实施状态。不必重复向我确认已在规范中确定的事项。
