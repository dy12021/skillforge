# Complete SkillForge MVP Implementation Plan

**Goal:** 完成并验证训练、反馈修订、偏好确认、文本语料、三类 Skill 构建安装与保留题盲测的完整 MVP 链路（AC-01..07、09..13）。

**Architecture:** 宿主 Agent 是主要生成端，通过已有 CLI / HTTP 消费持久化模型任务；Web 是独立人类反馈工作台。所有状态与证据保存在 PostgreSQL，Drizzle migrations 保留原有数据。mock 只作显式测试，真实 AI 与来源自述均如实标记。

**Tech Stack:** 既有 pnpm / Next.js / TypeScript / PostgreSQL / Drizzle / Zod / Tiptap / Vitest / Playwright；编译器采用 ZIP 和 YAML 解析库，脚本离线运行。

## 1. 完成 Phase 1 后再推进下一阶段

- 在 schema / migrations 添加 revisions 与通用 job 类型，复用任务租约、幂等命令与 CLI job submit。
- `revisions.ts`：选择/全文生成请求，Agent 或 provider 提交建议；保护优秀区域；对数字/引语/否定等变化给出风险报告；接受/拒绝/再编辑均记录事件，只有接受才创建新文档版本。
- Web 圈选页展示生成状态、建议 diff、风险确认与决策；比较页提供历史轮次、策略和挑战当前最佳。独立主题 API、去重与选区重锚保留证据。
- 测试覆盖：保护区被改返回错误，风险确认、乐观锁、接受/拒绝不覆盖旧文档、Agent/provider 两条真实事务路径；运行质量门禁并更新状态。

## 2. Phase 2 模式与偏好

- pattern / preference / history 表及 migrations；受限模板和精确短语，语境例外、频率、误报证据。
- 从真实、未撤销反馈提交 Agent 规则提议任务；提议必须引用证据。确认/拒绝/编辑/停用、作用域与冲突均可审计，确认才纳入发布。
- `/patterns` 与 `/preferences` 完成实际 API/DB UI；覆盖 ACCEPTANCE_FIXTURES 的正反例和 scope precedence。

具体实施顺序：
1. `rule-types.ts` 定义 scope / strength / exceptions / 受限 match_spec 契约，`pattern-engine.ts` 实现 UTF-16 spans、频率与引用/对白/必要事实纠正例外；先添加 fixture 单测。
2. `schema.ts` + migrations 添加 patterns、pattern_reviews、preference_rules、rule_history；review/history 不可变。`patterns.ts` 管理模式、检测与误报事件。
3. `preferences.ts` 收集未撤销真实反馈，创建持久化 preference job；Agent/provider 输出必须引用至少两条实际证据，默认 proposed。确认/编辑/停用使用乐观锁并保存历史。相同范围冲突要求显式处理；任务 > 项目 > 用户，事实约束优先。
4. `model-dispatch.ts`、`jobs.ts`、`models.ts` 增加规则提议与语境判断适配；mock 结果永久标记，不宣称已学到偏好，模型失败保留确定性检测结果。
5. 共享 API + `/patterns`、`/preferences` 可编辑界面；测试证据伪造、作用域隔离、冲突、撤销、历史快照和浏览器确认流程。门禁通过后记录 Phase 2 状态。

## 3. Phase 3 语料与编译

- TXT/MD/SRT/VTT/JSON 粘贴或文件导入；来源、许可、用途、hash、时间戳和上下文。私密存储不公开，导出/删除及派生证据处理。
- 语料提议需显式模型数据授权；原始内容只作为不可信数据；可选本地分析不捏造 AI 总结。
- 三类 Skill compiler：确认规则快照、frontmatter、references、hash、版本历史、ZIP 和本地校验；独立离线脚本无训练服务器依赖。
- CLI build/validate/install：拒绝路径穿越、符号链接、危险 ZIP、已有目标；显式操作可在 workspace 内隔离路径安装验证，不覆盖用户技能。

具体实施顺序：
1. `corpus-parser.ts` 与 `storage.ts`：UTF-8/MIME/文件名/大小检查，TXT/MD/SRT/VTT/公开 JSON 聊天 schema；私密 UUID 路径存储与下载、删除。字幕保留原始文件及时间戳，不声称转写。
2. schema/migrations 增加 corpus_assets / corpus_segments / corpus_discoveries；提取 job 需要明确数据传输许可。发现引用实际片段 ID 与原句，用户确认发现后只生成 proposed 规则，再独立确认发布。删除撤销派生规则、清理 job 原文及幂等缓存，独立历史包只提示不可撤回。
3. `skill-package.ts` / `skill-compiler.ts`：只编译 confirmed 快照，领域隔离、净化秘密/注入、有效 YAML、相对引用、ZIP 和 SHA256、静态报告与不可变构建历史。
4. CLI 离线 validate/install 使用同一可移植 bundle：ZIP 大小/路径/重复项/符号链接限制，文件系统 realpath/lstat 检查；不执行包内脚本，不覆盖已有目录。`--name` 可安装到新名称，目录和 frontmatter 一并改名且再验证；保留原安装可回退。
5. `/corpus` 和详情、`/skills` 和详情、导出删除 UI；覆盖注入、越界、删除、三种 ZIP、v1 hash 不变、缺引用失败、安全安装、离线脚本及 Skill 格式验证。Phase 3 门禁通过后进入盲测。

## 4. Phase 4 盲测与交付

- 五个以上保留题与构建快照隔离；baseline/personalized 同题输出，随机映射仅服务端保存，投票前不泄漏来源。
- 保存 left/right/tie/both-bad；只对真实投票统计，测试投票永久标识，不能冒充真人改善。
- 真实模型测试仅显式 opt-in；主路径由当前 Agent 实际生成和提交，未运行的供应商测试保持 skip。
- 完整回归 AC 矩阵、README、docs/IMPLEMENTATION_STATUS、截图与浏览器操作证据；MVP 全部要求有实证后才 complete。音视频 AC-08 继续保持 Phase 5 backlog。

具体实施顺序：
1. 迁移增加 evaluation_runs / evaluation_items / evaluation_votes，保留题、随机映射与投票不可变。创建 run 固定 build_id 和至少5题，规范化 prompt 拒绝训练题复用；保留题和投票不进入训练反馈查询。
2. `evaluations.ts` 提供创建/模型提交/只读盲测视图/投票/结果。Agent 输出按 task_id 给 baseline/personalized 同题结果；服务端 crypto 随机左右映射，普通 GET 与 job 完成结果不得泄漏映射。所有题投票后才揭示。
3. 复用模型 job 与 worker：provider 两套同题提示，仅 personalized 应用 immutable Skill 指导；mock 永久 simulated，不伪装学习或提升。Agent provenance 保持自述。
4. 投票 left/right/tie/both_bad + 评语 + human/test 来源。测试库强制 test；开发验收 run 显式 test。测试票只能验证管线，真人样本为0时始终“待评测”，不生成改善结论；胜率定义排除平局/双拒，展示总数。
5. `/evaluations` 与详情页完成实际盲测；至少5题 E2E、未投票泄漏检查、随机映射重载稳定、测试票不计真人、来源揭示与历史 build hash 不变。API/CLI 真实 Agent 路径另留 provenance。
6. 完成 docs/MVP_AUDIT.md 中的实际缺口：mock 连续题目、通用网络重试幂等键、离线 task 规则的可读语境、serve 的真实启动/失败边界、显式原始反馈隐私清除与不可变审计的边界。
7. 完整质量门禁和 README 新环境演练（包括可行时 PG17 Compose），浏览器截图；检查所有 AC 与命令、文件、安全回归实证，只有最终审计全部成立才将 goal complete。
