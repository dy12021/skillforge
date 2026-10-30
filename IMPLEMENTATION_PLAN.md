# SkillForge — 可执行分阶段开发计划

这份计划配合 `PROJECT_SPEC.md` 使用。Codex 应根据阶段分批实现、验证和提交成果，而不是一次性搭建许多无法运行的空目录。阶段可跨多次 Codex 会话，当前进度保存在仓库 `docs/IMPLEMENTATION_STATUS.md`。

## Phase 0 — 工程骨架与数据基座

**目标**：一个新用户能在本地运行完整网页，无 API Key 时仍能体验真实界面流程中的 mock 生成结果。

**实现清单**
- [ ] pnpm 项目结构、Next.js、TS strict、Tailwind、应用导航。
- [ ] PostgreSQL Compose、Drizzle schema/migrations、seed、数据库连接错误提示。
- [ ] ModelProvider 接口；MockProvider 返回固定但多样化的示例，真实 Provider 适配器至少一个。
- [ ] 本地单用户 workspace / project 的 CRUD；基础设置和隐私说明。
- [ ] 一致的 API 错误格式、Zod 校验、request_id、日志脱敏。
- [ ] lint/typecheck/test/e2e/build 命令与 CI 基础。

**验收**：`pnpm dev` 打开首页；创建项目；`/api/projects` 真正落库；重启仍存在；无密钥明确显示“演示模式”。

## Phase 1 — 人类反馈训练闭环

**目标**：从自动生成题目到人类多选/圈选/改写再到修改预览和历史版本，完整可用。

**实现清单**
- [ ] TopicGenerator：writing / dialogue、粒度与维度、自动/手动。
- [ ] 生成 2～8 候选，候选设置和随机显示序列。
- [ ] `best_one`、`approve_many`、`full_ranking`、`tie`、`reject_all`，候选单独评语/人工改写。
- [ ] FeedbackEvent 服务端不可变事件、事务写入、幂等键。
- [ ] 基于 Tiptap 的文档与圈选批注（UTF-16 offset + quote hash + version 校验）。
- [ ] 修订生成、局部/全文选项、diff、接受/拒绝、永不覆盖旧文档版本。
- [ ] Session 记录、状态机、继续训练与恢复会话。

**验收**：AC-02～AC-05；Playwright 覆盖 N=2、N=5、N=8、重叠标注、组合反馈、刷新恢复、幂等提交。

## Phase 2 — 模式检测与偏好学习

**目标**：用户能对具体词、短语、句式家族及语境设置规则，让规则产生可解释的修订效果。

**实现清单**
- [ ] LinguisticPattern 模型、规则编辑器和确认/误报/例外操作。
- [ ] 确定性检测器：字词和短语匹配、受限模板、频率统计、span 显示。
- [ ] 语义检测适配器（真实模型可用时启用），JSON schema 输出与异常回退。
- [ ] `不是……而是……` 家族样例及正反使用，`我认` / `我不亏` 短语样例。
- [ ] 从多条反馈提出规则（`proposed`），展示来源证据，用户确认后进入 `confirmed`。
- [ ] 规则作用域、强度、例外、冲突识别与版本记录；语义保护测试。

**验收**：AC-06、AC-09；同一句式在必要逻辑转折/人物对白时可被正确豁免或提示用户判断。

## Phase 3 — 人类语料学习与 Skill 构建

**目标**：用户能用自己的语料辅助训练，并下载符合开放规范的三类成品 Skill。

**实现清单**
- [ ] TXT/MD/SRT/VTT、粘贴及 JSON 聊天记录导入，来源/许可/用途标签。
- [ ] 片段提取、原上下文、正负例与观察样本，人工确认提取的风格特征。
- [ ] Corpus 数据删除与基础数据导出；输入污染/Prompt injection 防范。
- [ ] Skill Compiler：三类 Skill，YAML frontmatter、references、版本快照、ZIP 打包。
- [ ] 静态检查器（可选可检规则）及验证报告，完整预览与构建历史。
- [ ] CLI `serve/session/skill build/validate/install`，路径与覆盖安全检查。
- [ ] 自动化验证成品包结构及 `SKILL.md` 的合法性。

**验收**：AC-07、AC-10、AC-12、AC-13。将 ZIP 放入 `.agents/skills/` 后，Codex 可以发现并打开（不能在当前环境测试时清晰标注并提供脚本）。

## Phase 4 — 盲测、真实模型、端到端交付

**目标**：给出可证明的偏好改善证据，而不是只显示令人满意的 UI 数字。

**实现清单**
- [ ] Holdout 题集，baseline 与 personal skill 同题生成；随机映射、隐藏来源。
- [ ] 用户评分 left/right/tie/both-bad；公布结果时显示真实样本量和胜率定义。
- [ ] 评测记录、Skill 版本对比、规则变动回归测试。
- [ ] 一个实际可用的 ModelProvider + 真实 API 调用集成测试（凭据缺失时跳过并说明）。
- [ ] 全部 P0 验收流程回归，README/截图/故障排除/数据备份说明。

**验收**：AC-01～AC-07、AC-09～AC-13 全部可复现；完整 Demo 见 `ACCEPTANCE_FIXTURES.md`。

## Phase 5 — 音视频与增强（MVP 之后的明确目标）

**目标**：从真实音视频获得带时间戳的语言样本，并支持更主动、更精细的偏好学习。

**实现清单**
- [ ] MP3/WAV/MP4 本地上传、大小/格式上限、FFmpeg 安全抽取音轨。
- [ ] 配置可用的语音转写供应商；保留 raw transcript 与 user-corrected transcript。
- [ ] 时间戳与说话人信息（如供应商支持）、上下文切片与手工修订。
- [ ] 自适应主题选择：覆盖不足、意见分歧、误报率高的模式。
- [ ] 多轮对话评测与连续回应风格一致性。
- [ ] 可选 MCP Server（与现有 service layer 复用）。

**验收**：AC-08，且字幕替代路径可用；没有凭据时不得把模板结果冒充真实视频转录。

## 跨阶段的自动化测试矩阵

| 类别 | 必须覆盖 |
|---|---|
| Unit | N 选一语义、rank tie、rule precedence、pattern exceptions、Skill generator |
| API Integration | 会话/反馈事务、idempotency、409 conflict、数据删除、asset 权限 |
| UI E2E | 自动出题、比较、圈选、diff、确认规则、生成 ZIP、盲测 |
| Security | prompt injection in corpus、ZIP path traversal、unsafe upload、credential masking |
| Compatibility | 生成 Skill 规范验证、相对引用存在、Codex 可发现性（环境允许时） |
| Quality | 中文标点与 UTF-16 偏移、原句保护、否定/数字/事实不被误改 |

## 阶段汇报模板

每阶段结束由 Codex 更新 `docs/IMPLEMENTATION_STATUS.md`，至少包含：

```text
Phase: <0..5>
Status: complete | partial | blocked
Implemented: <确切功能>
Tests run: <命令 + pass/fail/skip>
Manual demo: <操作路径>
Open issues: <阻塞与未完成>
Next steps: <下一阶段目标>
```

## 不要做的事

- 不要优先搭建微服务、消息总线、推荐系统而延误 Web 训练闭环。
- 不要用一次 LLM 总结直接覆盖用户确认的长期规则。
- 不要把 AI 味检测降级为全局黑名单；保留上下文和例外。
- 不要用静态/硬编码截图替代真实用户操作和服务端持久化。
