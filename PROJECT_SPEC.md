# SkillForge — 人类反馈驱动的写作与对话 Skill 训练平台

> **项目说明书 / 可直接交付 Codex 的实现规范**  
> 版本：**V1.0 开发基线**（根据产品讨论 V0.1～V0.3 汇总）  
> 日期：2026-10-26  
> 状态：待实现；下文“应/必须”均为开发要求，不表示功能已经完成。

---

## 0. 给开发 Agent 的总指令

在一个新的代码仓库中实现 SkillForge。先按 `IMPLEMENTATION_PLAN.md` 分阶段交付，每阶段都提供可运行代码、测试与演示证据；不要仅生成 UI 示意图或空壳接口。若存在不影响目标的歧义，采用本文件的默认决策并记录在 `docs/DECISIONS.md`，不因小问题阻塞实现。**不得声称已经实现尚未实现的模型学习、音视频分析、真实 Skill 安装或盲测。**

优先完成可纵向运行的 MVP：**自动生成主题 → 生成 N 个候选 → 人类选择/标注/修改/评语 → 保存不可变反馈 → 提炼候选偏好 → 用户确认 → 生成有效 Agent Skill → 进行盲测评估 → 下载并在 Codex 中调用。**

该系统为独立 Web 应用，不需要 ChatGPT 网页内嵌 UI。可通过 CLI/HTTP API 提供 Agent 接入能力；本地浏览器启动能力允许有环境差异，应优雅降级为返回 URL。

## 1. 产品愿景与非目标

### 1.1 愿景

让用户通过多候选比较、文本圈选、直接重写、文字评语，以及真实人类文章/日常对话/音视频中的语言样本，持续训练 **可解释、可编辑、可导出** 的个人表达偏好，并生成独立使用的 Agent Skills。

不是训练基础大模型权重，也不是仅仅去掉一批“AI 味”词语：核心产物是一个可以在 Codex 等兼容 Agent 中运行的个人化 Skill 包，且用户能追溯每条规则从何而来。

### 1.2 必须支持的三类成品 Skill

1. `personalized-writing`：文章、段落、句子、短语的生成、润色、改写；保持事实和原意。
2. `personalized-dialogue`：独立的聊天/问答/多轮对话回复风格；明确区别于文章写作偏好。
3. `language-naturalizer`：审查和改善不自然、过度模板化的词汇/短语/句式及篇章表达；可以独立调用，亦可被前两者引用规则。

此外项目维护一个内部训练入口 `skillforge`（面向 Agent 的调用说明/适配脚本），负责打开或定位训练工作台、创建会话、触发构建；这不是上述三个用户成品 Skill 的替代品。

### 1.3 明确非目标

- **不**在第一版实现真正的 RLHF 权重更新、DPO 训练或基础模型微调；本阶段的“学习”是样本结构化、偏好规则提取、上下文检索与 Skill 编译。
- **不**依赖 ChatGPT 网页插件、聊天窗口上的自定义面板、浏览器扩展或操作某个聊天客户端 DOM。
- **不**自动抓取全网视频、绕过付费/访问控制或未经许可导入私人聊天记录。
- **不**保证任一第三方 Agent 必然自动发现并调用 Skill；提供标准兼容文件、安装说明与 Codex 冒烟测试。
- **不**把真人语料简单当作“正确表达”；必须有来源、情境、用途标签及用户确认。

## 2. 核心概念与术语

- **Workspace**：用户的工作空间；MVP 单用户本地运行，数据模型仍保留 `owner_id` 以便未来多用户。
- **Project**：写作或对话训练项目；有主题范围、用途与项目级偏好。
- **Session**：一次训练会话，可在多候选与圈选两种模式之间切换。
- **Task/Prompt**：单轮训练题。可由用户提供或由 AI 自主生成。
- **Candidate**：模型生成的候选写法，关联同一任务与生成参数。
- **DocumentVersion**：文本的不可变版本；任何优化都另建版本。
- **FeedbackEvent**：用户每次选择、标注、评语、改写、撤销等原始反馈；可审计。
- **HumanCorpus**：用户导入的人类文本/音频/视频/字幕及其来源与授权声明。
- **LanguageExample**：从语料或反馈中提取、保留上下文的正向/负向/中性实例。
- **LinguisticPattern**：词汇、短语、句式、修辞或篇章模式的结构化描述。
- **PreferenceRule**：用户确认或待确认的行为规则，带作用域、例外、优先级、证据。
- **SkillBuild**：对当前规则和样例的快照编译，生成可验证的独立 Skill 包。
- **EvaluationRun**：在未参与训练的题目上做基线对照和人类盲测的记录。

## 3. 用户角色与核心用户故事

目标用户：希望让 AI 学习自己语言偏好的写作者，以及希望个性化 Agent 对话风格的用户。

- US-01：我不提供主题，系统也能自动生成一条写作任务或对话情境，并说明本轮训练维度。
- US-02：我能设置比较候选数 2～8（默认 3），选择一个最优、多个优秀、完整排序、打成平手或全部不满意。
- US-03：我能给任意候选添加评语和直接编辑修正版，而无需先选出胜者。
- US-04：我能圈选文章的任意片段，标记“优秀/AI 味/不满意/其他”，直接改写或评语。
- US-05：我能指出“不是……而是……”等句式家族，以及“我认”“我不亏”等词语/短语的不合语境使用，并调整规则强度、适用范围和例外。
- US-06：我能上传真实文章、聊天或带字幕的材料作为正向/负向/观察语料，从中挑选想学习的语言特征。
- US-07：我能导入音视频，从转写结果中检查、修改和选择训练片段（有转写服务时；无服务可手动导入字幕）。
- US-08：系统从我的历史反馈提出偏好假设，但未经确认不得自动升级为全局强制规则。
- US-09：我能创建并下载 `personalized-writing` / `personalized-dialogue` / `language-naturalizer` Skill ZIP 包，且可在 Codex 中实际调用。
- US-10：我能盲测新 Skill 与基线输出、查看胜率和实际改善，也能回退到历史 Skill 版本。
- US-11：我能查看、导出、删除自己的原始语料和反馈；未经明确选择，不将私人材料上传到外部模型提供商。

## 4. 技术与部署基线

### 4.1 核心原则

- **Web-first / agent-agnostic**：前端为独立网页；模型、Agent、存储均用可替换适配层。
- **单一主要语言优先**：默认全栈 TypeScript，降低 Codex 交付复杂度。
- **服务端可信状态**：浏览器仅承担编辑和展示；最终反馈、版本、规则、Skill 版本由服务端保存。
- **本地优先**：默认 Docker Compose + 本机运行；未来再做多租户部署。
- **模型可选**：API Key 经环境变量配置。没有外部凭据时仍可以用明确标示的 mock provider 验证全流程。

### 4.2 推荐栈（允许等效替代，需记录理由）

- 包管理 / 仓库：pnpm monorepo；TypeScript strict。
- 前端与 HTTP API：Next.js App Router、React、Tailwind CSS、可访问性组件库。
- 文本编辑器：Tiptap/ProseMirror，支持精确选区和 annotation marks。
- 数据：PostgreSQL + Drizzle ORM + migrations；MVP 可通过 Docker Compose 启动。
- 校验：Zod；任务执行可采用 Postgres-backed job queue（或其他有重试/状态机制的方案）。
- 模型适配器：`ModelProvider` 接口，包括 `generateText`、`generateStructured`、`transcribeAudio?`；至少实现一个真实供应商适配器与一个 mock 适配器。
- 文件：本地对象存储目录，数据库仅存路径和元数据；后续可换 S3。
- 音视频：FFmpeg（可选外部依赖）提取音轨；转写模型可选；字幕 SRT/VTT 不需转写。
- Agent 接入：轻量 CLI + HTTP API，后续可增 MCP Server；不将 MCP 作为 MVP 运行的硬性前提。
- 质量：ESLint / Prettier / Vitest / Playwright / 类型检查 / Skill 校验。

### 4.3 配置与启动

必须提供 `.env.example`，包括 DATABASE_URL、STORAGE_DIR、MODEL_PROVIDER、MODEL_API_KEY（不得提交明文秘钥）、MOCK_MODE、可选 TRANSCRIPTION_PROVIDER/KEY、端口与基础 URL。README 至少包含 `pnpm install`、数据库迁移、`pnpm dev`、`pnpm test`、`pnpm test:e2e`、`pnpm build` 的可执行说明。缺少密钥时明确呈现“演示模式”，不得伪装为真实模型能力。

## 5. 页面与导航

| 页面 | 主要功能 | 阶段 |
|---|---|---|
| `/` | 首页 / 开始自动训练 / 进入项目 / 最近 Skill | P0 |
| `/projects`、`/projects/:id` | 新建写作/对话项目、训练历史、设置 | P0 |
| `/sessions/:id/compare` | N 候选比较、排序、改写和评语 | P0 |
| `/sessions/:id/annotate` | 富文本圈选、局部改写、批注及差异预览 | P0 |
| `/topics` | 自动出题、定向出题、历史主题/覆盖情况 | P0 基础 / P1 自适应 |
| `/corpus`、`/corpus/:id` | 人类语料导入、正负向标签、片段与来源 | P0 文本 / P1 音视频 |
| `/patterns` | AI 味语言模式库、误报、例外与规则强度 | P0 |
| `/preferences` | 候选偏好规则、证据、确认、作用域与冲突 | P0 |
| `/skills`、`/skills/:id` | 三种 Skill 创建、预览、验证、下载、版本 | P0 |
| `/evaluations` | 盲测与基线比较、结果统计 | P0 基础 / P1 扩展 |
| `/settings` | Provider 配置指引、数据导入/导出/删除、隐私 | P0 |

### 5.1 无障碍与响应式

- 桌面优先；移动端能查看、比较和提交反馈，长文本圈选以桌面为主。
- 交互必须支持键盘，颜色不作为唯一信息，选区/按钮要有明确标签。
- 候选不得只靠固定排序暗示优劣；盲测时随机 A/B 身份且持久记录映射。
- 保存状态（保存中/成功/失败）、任务重试、断网恢复、版本冲突必须可见。

## 6. 核心流程 A：自动训练与 N 候选比较

### 6.1 会话开始

用户选择：`write` / `dialogue`；题目来源 `auto` / `manual` / `corpus-derived`；训练粒度 `phrase` / `sentence` / `paragraph` / `article` / `single-turn` / `multi-turn`；候选数 2～8；目标风格与可选约束。

`auto` 模式应生成 `{title, prompt, genre, target_dimension, difficulty, constraints, seed_or_generation_id}`；对话题包含模拟用户消息与可选多轮上下文。自动生成主题要能在无密钥 mock 模式下使用固定示例，同时清楚标为模拟。

### 6.2 同题生成

候选必须共享相同任务、必要事实、长度范围、目标读者与禁改条件。策略：`diverse`（多样性探索）、`focused`（单维度微调）、`challenger`（现有优胜版 vs 新版）；要求避免只改几个近义词形成伪差异。输出保存 model / prompt version / seed(if any) / decoding 参数 / latency / token usage(if any)。

### 6.3 反馈 UI

- 候选数量可配置，默认 3，范围 2～8；布局随宽度自动调整。
- 反馈方式：`best_one`、`approve_many`、`full_ranking`（允许并列名次）、`tie`、`reject_all`。
- 额外操作：候选级 `comment`、`human_rewrite`、标记局部优点/缺点；用户可以修改一条候选而不进行偏好比较。
- 对 `approve_many`，不要擅自将获选候选之间建立相对排名；对 `reject_all`，不能凭空创造胜者。
- 反馈提交使用幂等键，记录原始候选顺序及显示时随机顺序。重复提交应返回同一事件，不产生重复样本。
- 显示每条反馈如何用于下一轮，并允许回退/撤销（撤销以补偿事件记录，不物理篡改审计记录）。

### 6.4 下一轮

用户可以 `继续探索`、`挑战当前最佳`、`转入圈选`、`生成偏好提议`、`完成`。系统不得暗自将低置信度结论写入全局偏好。

## 7. 核心流程 B：圈选与人工改写

### 7.1 编辑体验

- 编辑器显示某个 `DocumentVersion`；用户可选择字符、短语、整句、跨句片段。
- 工具栏：`优秀`、`AI 味`、`不满意`、`其他评语`、`我来改写`、`让 AI 改写`、`识别同类表达`。
- 每条注释保存 `version_id`、`block_id`、起止 offset（声明采用 UTF-16 offsets，与编辑器一致）、精确 quote、邻接上下文、quote hash、标注类别、评语、人工替换文本、作者/时间。
- 跨版本显示标注时必须进行显式重新锚定；若 quote 校验失败，标记“待重新定位”，绝不把注释静默贴到错误文字上。
- 支持重叠/嵌套注释：内部数据允许重叠，UI 使用侧栏和优先级表现；不可因添加第二条注释而丢失第一条。
- 允许直接改写，原始版本保留；用户改写优先作为参考，不再次自动覆盖。

### 7.2 修订操作

- `revise_selection`（仅局部）与 `revise_document`（协调全文）分开。
- 修改必须给出 diff，提供 `accept`、`reject`、`edit_again`、`manual_edit`。
- `优秀`区域默认应保护，除非为满足用户明确的新约束/必要修复；保护约束在 prompt 和结果校验中均被体现。
- 显示语义保持提示；检测对实体、数字、引语、否定、逻辑关系的潜在修改，必要时请求用户确认。

## 8. 真实人类语料学习

### 8.1 支持的输入与优先级

**P0 必须有**：粘贴文本、`.txt`、`.md`、`.srt`、`.vtt`，可选 `.json` 聊天记录（定义公开 schema，用户能检查内容）；语料分类 `positive`/`negative`/`observational`；文本抽取、分段、上下文呈现、候选语言特征及人工确认。`pdf/docx` 文本抽取可列 P1；扫描件 OCR 不是 MVP 目标。

**P1 必须有**：本地 `.mp3` / `.wav` / `.mp4`（可配置大小限制）以及通过授权方式提供的字幕文件；FFmpeg 音轨提取 → 语音转写接口 → 时间戳/说话人字段（未获得则置空） → 用户可编辑转录 → 选择片段 → 提炼规则。无转写服务时引导用户导入字幕，不能伪称处理成功。

公开 URL 导入如存在条款、鉴权或下载限制，必须提供合法使用提示；不实现绕过限制的下载器。

### 8.2 数据提取要求

每个 corpus asset 至少记录：文件类型、hash、来源名称/URL（可空）、用户许可确认、用途标签、语言、创建时间、提取版本、原始文件删除状态。片段记录 `start_ms/end_ms`（音视频可选）、`speaker_id`、原始文本、上下文、清洗文本（另列，不覆盖原句）。

模型只能生成“候选风格发现”，例如“常用具体行为替代抽象情绪描述”，必须附样本证据并由用户确认纳入偏好。区别 `正向案例`、`负向案例`、`中性观察`；不把一个文本作者的所有语言习惯全盘认作用户喜好。不大段复制受版权保护的文字到成品 Skill；优先抽象规则和最小必要的、获准使用的例句。

### 8.3 数据与安全边界

导入内容一律视为数据而非系统指令，不能执行其中的脚本、提示词、URL 操作指令或密钥请求。文件上传校验 MIME/扩展名/大小和内容安全，不将原始文件置于公开静态目录。未经显式授权不向外部模型 API 发送私人语料，展示清楚的 provider 与使用成本/数据传输提示。

## 9. Linguistic Pattern Engine：AI 味语言模式引擎

### 9.1 检测层级

| level | 对象 | 示例/能力 |
|---|---|---|
| token | 词语 | 某个词在不适合的文体中突兀出现 |
| phrase | 短语 | “我认”“我不亏”等指定短语 |
| syntax | 句式家族 | “不是 A，而是 B”及其相关变体 |
| rhetoric | 修辞功能 | 无必要的二元对立、刻意升华、空泛总结 |
| paragraph | 段落模式 | 机械性的概括—展开—总结 |
| discourse | 篇章模式 | 高频套话、重复转折、句式节奏单一 |

例：`不是……而是……` **不是默认全局禁用**。当它承担必要逻辑区分时应保留；当机械频繁出现且脱离语境时才提示。类似地，“我认”“我不亏”在对白中可能合理，在评论性散文中可能不自然；完全取决于用户规则及上下文。

### 9.2 规则属性

`id, level, family, title, match_spec, positive_examples, negative_examples, rewrite_strategies, strength, scope, exceptions, source_evidence_ids, confidence, status, created_at, version`

- `strength`：`forbid`（范围内强禁止；引语及用户要求原样保留为例外）、`avoid`（尽量避免）、`limit_frequency`（限制出现频率）、`suggest_only`（只提示）。
- `scope`：全局/项目/任务 + writing/dialogue + 体裁/情境；规则不得默认跨写作与对话传播。
- `status`：`proposed`、`confirmed`、`rejected`、`archived`。
- `confidence` 是系统内部的证据摘要，不是伪精确的“正确概率”。必须有证据与负例，允许用户标注误报。
- `exceptions` 支持引用原文、人物对白、必要逻辑转折、专业术语与特定体裁。

### 9.3 检测算法（两阶段）

1. **确定性检测**：Unicode 正规化（保留原始文本）、用户精确词表、字词边界、短语词典、受限正则/结构化模板；返回 span + 命中规则 + 推荐动作。对中文不应简单依赖空格分词。防止用户输入造成 ReDoS，限制 regex 复杂度和运行开销。
2. **语境检测**：在模型可用时判断语义作用、真实变体、修辞套用、出现频率与例外；产出 JSON schema；缺失上下文时返回 `uncertain`，不可强行把自然句式判成 AI 味。
3. **全局统计**：同一文本中的重复模式计数、段落分布、密度；阈值要能配置和解释。对于短语出现与 AI 味之间不作普适因果断言。
4. **用户复核**：标记误报、确认同类句式、设置强度/作用域/例外；存入反馈事件用于改进。

### 9.4 主动发现模式

定期对 `negative` 反馈聚类或分析共同句法、修辞特征（不能只把整句记为黑名单），提出模式家族和包含/不包含示例。必须展示支持该提议的真实反馈证据、反例以及泛化边界。待用户确认后才影响已发布 Skill。

### 9.5 修订约束

优先使用直接陈述、具体细节或自然逻辑衔接替换机械套路；**但语义、立场、事实、专有名词、引语必须尽量保持**。对原句有真实对比逻辑时，不可为了避开“不是……而是……”而删除关键否定关系。修订后再跑规则与语义回归检查，并且不得死循环改写。

## 10. 偏好学习引擎（非权重训练）

### 10.1 输入事件

`candidate_selected`、`candidates_approved`、`candidates_ranked`、`candidates_tied`、`all_rejected`、`candidate_commented`、`human_rewrite`、`span_annotated`、`pattern_false_positive`、`pattern_confirmed`、`rule_confirmed`、`rule_rejected`、`revision_accepted` 等。

事件不可变，含 `id, session_id, actor_id, target_type, target_id, event_type, payload_json, idempotency_key, created_at`。一次复杂操作允许产生多个独立事件；派生统计可重建。

### 10.2 候选规则提取

- 基于多条证据提出 `proposed` 规则，例：“叙事时偏好通过动作和可观察细节表达情绪”，附支持/反对样例。
- `single-best` 仅给出相对比较信息；`approve-many` 不提供获选者间排名；`reject-all` 不提供正向样本；人工改写的目标句可作为高价值参考但不代表所有场景都适用。
- 规则范围：`task < project < user` 的继承结构，**冲突时**显式任务要求 > 项目特殊要求 > 已确认的用户级偏好 > 候选偏好 > 语料观察；更高优先级的安全与事实约束始终不可被风格规则覆盖。
- 同一层级冲突时禁止静默覆盖，提示用户选择、缩小作用域或给出条件例外。
- 提议与发布分离：只有 `confirmed` 规则可进入默认成品 Skill；可选“实验性构建”显式纳入 `proposed` 并标识。
- 支持手动增加、编辑、停用规则；保留证据与变更历史。

### 10.3 主动选题（P0 基础 / P1 自适应）

四种策略：`explore` 自由探索、`targeted` 定向、`weakness` 针对高误报/低覆盖规则、`holdout` 独立盲测。P0 实现按类型/风格/粒度自动生成和去重；P1 加入覆盖率、反馈分歧、规则证据不足等信号。评测 holdout 题不能被训练引擎读取其人工打分用于同一次评测前的规则生成。

## 11. Skill Compiler：成品构建与导出

### 11.1 格式与兼容

使用 [Agent Skills 规范](https://agentskills.io/specification)；每个导出目录必须包含 `SKILL.md`，其 YAML frontmatter 至少包含合法的 `name` 与 `description`（说明何时应调用，以及何时不应调用）。可使用 `references/`、`scripts/`、`assets/`，引用相对路径。遵循渐进加载原则：核心 `SKILL.md` 精炼，详细偏好与例句放 `references/`。

Codex 工作区默认安装位置 `.agents/skills/<skill-name>/`，也支持用户级路径；提供 ZIP 下载及 CLI 安装选项。**不得未经用户明确操作自动写入仓库外位置**。

### 11.2 构建产物结构

```text
personalized-writing/
├── SKILL.md
├── references/
│   ├── style-profile.md
│   ├── writing-rules.md
│   ├── positive-examples.md
│   └── negative-examples.md
└── scripts/                    # 可选；存在时必须可离线运行
    └── check-patterns.*

personalized-dialogue/
├── SKILL.md
├── references/
│   ├── dialogue-profile.md
│   ├── response-rules.md
│   └── conversation-examples.md

language-naturalizer/
├── SKILL.md
├── references/
│   ├── pattern-catalog.md
│   ├── exceptions.md
│   └── rewrite-policy.md
└── scripts/                    # 可选
    └── check-patterns.*
```

### 11.3 编译器必须保证

1. `SKILL.md` frontmatter 合法；`name` 与导出目录匹配；文件名无路径穿越；目录 ZIP 可解压。
2. 成品默认 **可离线使用**：无网络时核心写作/对话指导仍有效；可选脚本不得要求登录训练服务器。
3. 只使用发布快照中的 `confirmed` 规则，不因训练库随后修改而悄悄改变历史版本。
4. 将规则编译为可执行的正向/负向指导与示例；对 `forbid` / `limit_frequency` 等可检规则可输出本地轻量检测器，检查器不得访问网络。
5. 过滤语料中的提示注入文本和潜在秘密，避免把隐私原文/长篇第三方作品直接打包进去。
6. 三个 Skill 的作用域区分明确：文章风格不强加给对话；对话偏好不影响未授权的专业事实推断；自然化只在不损坏原意的情况下修订。
7. 打包前完成 schema 校验、引用链接检查、静态扫描；可配置调用 `skills-ref validate`（工具缺失时要明确提示，不可假装验证成功）。
8. SkillBuild 记录 `semantic_version, content_hash, rules_snapshot, generator_version, validation_report, created_at`；可下载/对比/回退。

### 11.4 Skill 调用示例

- `使用 personalized-writing 按我的表达习惯写一段关于深夜公交站的文字。`
- `使用 personalized-writing 优化下面这段文字，但不要修改事实。`
- `使用 personalized-dialogue 回答我提出的问题，遵循我确认过的回复风格。`
- `使用 language-naturalizer 检查下面的文本，标注并修正高频模板句式。`

## 12. Agent 接入方案

### 12.1 本地 CLI（P0）

要求提供等效命令（具体二进制名可由实现确定，README 必须准确）：

```bash
skillforge serve                # 启动/显示 Web URL（若服务已运行，则返回 URL）
skillforge session create --mode writing --topic auto --candidates 3
skillforge session open <id>   # 有能力则打开浏览器，否则打印 URL
skillforge skill build --project <id> --type personalized-writing
skillforge skill validate <zip-or-directory>
skillforge skill install <zip-or-directory> --target .agents/skills
```

安装须有路径安全检查、确认覆盖、回退选项。CLI 不能凭空声称能从沙箱之外自动打开浏览器；如果宿主禁止，返回可复制的链接。

### 12.2 HTTP API（P0）与 MCP（P1）

HTTP API 与 UI 共用应用层服务。P1 可实现 MCP Server，把会话创建、自动出题、启动 UI、反馈提交、Skill 构建等能力映射为 MCP 工具，不应重新实现领域逻辑。已安装的 Agent 能在外部浏览器访问工作台即可，不要求在 Agent 内嵌面板。

## 13. API 契约（可扩充，不得随意破坏语义）

统一返回 `{data, error, request_id}`；输入采用 Zod 校验。时间用 ISO 8601 UTC，ID 用 UUID，枚举严格验证。所有有副作用 POST 接收 `Idempotency-Key`；编辑更新支持 `expected_version` 乐观锁，冲突返回 409。长耗时生成返回 `job_id`，GET job 状态及按需要 SSE 流式进度；不让浏览器请求悬挂数分钟。

| 方法 | 路径 | 功能 |
|---|---|---|
| POST | `/api/projects` | 新建 writing/dialogue 项目 |
| GET | `/api/projects/:id` | 项目设置、进度与统计 |
| POST | `/api/topics/generate` | 自主生成训练任务 |
| POST | `/api/sessions` | 创建会话 |
| POST | `/api/sessions/:id/candidates` | 创建 N 候选生成任务 |
| GET | `/api/sessions/:id` | 会话、版本、候选和反馈摘要 |
| POST | `/api/feedback` | 原子保存一次或一组人类反馈 |
| POST | `/api/annotations` | 创建圈选批注并校验锚点 |
| POST | `/api/revisions` | 人工/模型修订，产生新版本 |
| POST | `/api/revisions/:id/decision` | 接受/拒绝建议修订 |
| POST | `/api/corpora` | 上传文件/粘贴内容并声明用途 |
| POST | `/api/corpora/:id/extract` | 提取候选风格样本；P1 可转录 |
| GET/POST/PATCH | `/api/patterns` | 列出/创建/更新语言模式 |
| GET/POST/PATCH | `/api/preferences` | 规则管理和确认 |
| POST | `/api/skills/builds` | 生成 Skill 构建任务 |
| GET | `/api/skills/builds/:id` | 状态/验证报告/摘要 |
| GET | `/api/skills/builds/:id/download` | 授权下载 ZIP |
| POST | `/api/evaluations` | 创建盲测任务 |
| POST | `/api/evaluations/:id/votes` | 提交盲测结果 |
| GET | `/api/evaluations/:id/results` | 聚合结果、含样本数 |
| GET | `/api/jobs/:id` | 后台任务状态、错误与重试信息 |
| GET | `/api/export` | 用户数据导出 |
| DELETE | `/api/corpora/:id` | 删除语料及关联原始文件，必要时标注无法撤销的导出版本 |

### 13.1 关键请求示例

**多候选反馈**：

```json
{
  "session_id": "uuid",
  "task_id": "uuid",
  "candidate_ids": ["uuid-a", "uuid-b", "uuid-c"],
  "feedback_mode": "approve_many",
  "approved_ids": ["uuid-b", "uuid-c"],
  "ranking_groups": null,
  "comments": [{"candidate_id":"uuid-b", "text":"更具体"}],
  "human_edits": [{"candidate_id":"uuid-c", "original":"...", "replacement":"..."}]
}
```

**圈选反馈**：

```json
{
  "document_version_id": "uuid",
  "block_id": "paragraph-3",
  "start_utf16": 6,
  "end_utf16": 17,
  "exact_quote": "不是努力不够，而是方向不对",
  "context_before": "...",
  "context_after": "...",
  "label": "ai_like",
  "comment": "不是……而是……的机械套用；这里直接说原因",
  "human_rewrite": "这次失败主要是方向出了问题",
  "propose_pattern": true
}
```

示例中的 offset/quote 只是格式样例，真实请求必须经服务端锚点验证；不能把示意值当作有效位置。

**偏好规则**：

```json
{
  "title": "避免机械的否定—转折模板",
  "status": "proposed",
  "scope": {"domain":"writing", "genres":["essay", "commentary"]},
  "pattern_family": "contrast_reframing",
  "strength": "limit_frequency",
  "exceptions": ["genuine_logical_contrast", "verbatim_quote"],
  "rewrite_strategy": ["direct_statement", "concrete_example"],
  "evidence_event_ids": ["uuid-1", "uuid-2"]
}
```

## 14. 数据模型（建议 PostgreSQL 表）

开发时应落实 foreign key、index、unique 和 migration；字段可细化，但不得丢失语义：

| 表 | 关键字段 |
|---|---|
| `users` / `workspaces` | id, local_user_id, created_at |
| `projects` | id, owner_id, name, domain, genre, settings_json, created_at |
| `sessions` | id, project_id, mode, state, current_task_id, created_at |
| `tasks` | id, session_id, source, kind, topic, prompt, target_dimension, constraints_json, holdout_group |
| `candidate_sets` | id, task_id, model_provider, generation_strategy, prompt_version, shuffled_order_json |
| `candidates` | id, set_id, text, model_details_json, created_at |
| `document_versions` | id, session_id, parent_version_id, content_json, content_text, revision_source, created_at |
| `feedback_events` | id, owner_id, session_id, task_id, event_type, payload_json, idempotency_key, created_at |
| `annotations` | id, document_version_id, block_id, offsets, quote, hash, label, comment, status |
| `corpus_assets` | id, owner_id, source, usage_role, rights_confirmed, storage_path, sha256, media_type, created_at |
| `corpus_segments` | id, asset_id, text, context, start_ms, end_ms, speaker_id, user_corrected |
| `language_examples` | id, source_kind, source_id, role, excerpt, context, approved |
| `linguistic_patterns` | id, level, family, match_spec_json, strength, scopes_json, exceptions_json, status, revision |
| `preference_rules` | id, owner_id, project_id nullable, title, instruction, status, scope_json, strength, evidence_json, revision |
| `skill_builds` | id, project_id, type, version, rules_snapshot_json, content_hash, artifact_path, validation_json, status |
| `evaluation_tasks` | id, project_id, prompt, held_out, tags_json |
| `evaluation_runs` | id, build_id, baseline_config, variant_config, randomized_map_json, status, created_at |
| `evaluation_votes` | id, evaluation_run_id, task_id, vote, comment, created_at |
| `jobs` | id, job_type, status, attempts, payload_ref, result_ref, error_code, created_at, updated_at |

关键索引：`feedback_events(session_id, created_at)`、`feedback_events(owner_id, idempotency_key) UNIQUE`、`annotations(document_version_id, block_id)`、`linguistic_patterns(status, family)`、`preference_rules(project_id, status)`、`skill_builds(project_id, created_at)`；导入文件 hash 检查重复，但不得跨用户泄露存在性。

## 15. 评测体系

### 15.1 最小闭环

系统为相同 holdout 题目生成：baseline（无偏好 Skill）和 personalized（应用已发布规则）。随机打乱左右次序并隐去来源；用户可选择左/右/平手/都不满意，并填写评语。仅在收集投票后显示版本身份。

### 15.2 基础指标

- 盲测偏好胜率：`personalized_wins / (personalized_wins + baseline_wins)`，平局与拒绝均另列；必须同时展示样本量。
- 规则命中情况：触发次数、误报率（人工标记）、确认的有效修改比例。
- 语义保护：数字/实体/引语/否定和关键观点变化的人工复核通过率。
- 操作体验：完成一轮反馈所需时间、用户手动修改量、撤销次数（可选，默认本地聚合）。
- 多候选训练不以“多选了几个”充当模型提高的证明。

### 15.3 防止评测泄漏

测试题与训练题分组隔离。盲测投票不得在投票前暴露候选来源，不能把当前评测反馈用于重新构建同一被测版本。报告说明测试来源、样本数量、模型配置与统计局限。

## 16. 隐私、权限和可靠性

- 本地单用户默认部署；以后开启多用户时必须对 owner_id 做服务端授权检查。
- 外部模型调用需明确表明数据将被发送给哪一个配置的提供商；用户可设为离线/mock，仅使用本地语料处理。
- 语料、对话记录、音视频可能包含敏感信息。应支持按 asset 删除原始文件、派生片段和模型输入缓存；已导出的离线 Skill 不会自动被远程撤回，UI 需告知。
- 文件上传大小与 MIME 校验；安全解析 ZIP/字幕；清理临时文件；限制路径穿越/命令注入/SSRF/模板注入；CLI 调用 FFmpeg 使用固定参数数组而非 shell 字符串拼接。
- 模型输入视为不可信：语料中的“忽略先前指令”等只能作为被分析文本，不能提升系统权限。
- 数据库事务保证一次反馈和关联数据的一致性；后台任务具备排队、超时、重试、取消或失败可恢复机制。
- 为所有模型输出做 schema 校验，失败时重试有限次数并给出可理解的错误；不得默默捏造用户反馈或模型能力。
- 保存构建快照和可导出备份。日志不能写入 API Key 和完整私人原文。

## 17. 验收标准（必须转为自动测试与人工验收清单）

**AC-01 运行**：按 README 在全新环境启动数据库和网页；无 API Key 进入明确的 mock 模式；类型检查、单测、build 通过。

**AC-02 自动出题**：无需用户题目即可创建写作主题或单轮对话情境；任务记录目标维度、限制条件、来源与版本；可切换手动主题。

**AC-03 N 候选**：可设置 2、3、5、8；候选同题、编号清楚、显示排序可随机；支持选一、多选、并列排序、全拒绝，后端正确记录不同信息语义。

**AC-04 组合反馈**：在不选胜者的情况下给候选 B 评语、给候选 C 人工改写；重载页面后仍在；重复提交幂等。

**AC-05 圈选**：可圈选中文词语/跨标点句式并标注；用户直接改写后保留原版本，展示 diff；重叠批注不丢失；旧版偏移不匹配时有明确提示。

**AC-06 语言模式**：至少演示 `不是……而是……` 的直接样式与两种变体、`我认` / `我不亏` 短语匹配；能区分“必要逻辑转折”例外；有“误报”反馈和强度调整；检测结果带证据、不无条件声称是 AI 味。

**AC-07 语料**：导入 TXT/MD/SRT/VTT、声明正/负/观察、查看上下文、确认或拒绝提议的风格特征；未经确认不得自动写入全局规则；导出与删除可验证。

**AC-08 音视频（P1）**：带可用转写配置时 MP3/MP4 提取/转写后可编辑并回流训练；无配置时明确提示并支持导入字幕替代；不可伪装转写成功。

**AC-09 偏好**：规则有作用域、证据、状态、例外、冲突提示；用户确认后才进入默认成品 Skill，停止/撤销规则影响后续构建、不回写历史包。

**AC-10 Skill**：三个类型的 ZIP 都可解压，frontmatter/引用合法；至少一个真实 Codex 加载或本地技能验证的冒烟测试（无 Codex 环境时记录未执行并提供用户可执行脚本）；历史版本可下载。

**AC-11 盲测**：能对至少 5 个保留题做 baseline vs personalized 盲测、保存隐藏映射、投票后展示胜率与样本量；无真人投票时只能展示“待评测”，不能凭模型自评宣称改进。

**AC-12 Agent 接入**：CLI 创建会话、返回浏览器 URL、构建/验证/安装 Skill；无法打开浏览器时提示 URL 而不是报成功。

**AC-13 隐私**：上传含“忽略所有规则”字样的文本不会执行其指令；路径穿越 ZIP 被拒绝；日志没有 API Key；原始语料删除有确认及结果报告。

## 18. 实施阶段与完成定义

按 `IMPLEMENTATION_PLAN.md` 执行，各阶段结束都要提交：功能列表、测试结果、页面截图（如可用）、遗留问题和下一阶段计划。

- **Phase 0 基础**：仓库/数据库/配置/mock/导航/测试基线。
- **Phase 1 训练闭环**：自动主题、多候选、圈选、反馈事件、版本 diff。
- **Phase 2 偏好与语言模式**：词句式检测、作用域、证据、误报、规则确认。
- **Phase 3 语料与成品 Skill**：人类文本导入、特征提取、三种 Skill 构建、ZIP、CLI。
- **Phase 4 验证与交付**：盲测、自动回归、可复制安装说明、真实供应商适配器。
- **Phase 5 音视频与增强**：音视频转写、自适应主题、多轮对话深度评测、MCP 等。

**MVP Definition of Done**：AC-01～AC-07、AC-09～AC-13（不含 AC-08 音视频项）全通过，能无凭据在 mock 模式完整演示，配置真实模型后可运行真实生成和规则提炼；用户拿到的 ZIP 可独立用于 Codex。Phase 5 的音视频功能是完整产品路线的重要交付，不能从 backlog 消失，但不是阻塞最早可用版本的条件。

## 19. 需要 Codex 主动保持的设计纪律

- 不创建仅有“保存成功”提示但后端不落库的假交互。
- 不把普通 Prompt 或下载 TXT 伪称有效 Agent Skill。
- 不把所有 N 选 1 数据粗暴展开成完整、独立且等权的二元偏好对；应保留原始事件语义。
- 不把所有真人语言都当作正向样本；保持语料来源和角色。
- 不靠一张通用“AI 味黑名单”代替句式家族、语境例外和负例。
- 不让偏好修改覆盖原文或在未确认时跨作用域永久生效。
- 不为了“去 AI 味”而破坏事实、引语、关键逻辑或真实人物口语。
- 不一次性搭建不可运行的庞大微服务；先打通 Web/API/DB/Compiler 的纵向闭环。

## 20. 权威参考

- Agent Skills 规范：<https://agentskills.io/specification>
- Codex Skills 官方说明：<https://learn.chatgpt.com/docs/build-skills>
- Codex `AGENTS.md` 指南：<https://learn.chatgpt.com/docs/agent-configuration/agents-md>
- OpenAI Skills 参考实现：<https://github.com/openai/skills>

> 优先遵守本项目的产品定义；遇到规范版本变动，以开发时官方有效规范为准并在决策日志中记录变更。此项目说明书对功能与验收具有最高优先级，`AGENTS.md` 和实施计划用于指导实现方法。
