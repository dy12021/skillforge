# 实施状态

更新时间：2026-10-28。本文件记录实际实现、验证及未实施的 Phase 5。最终完整门禁执行于 2026-10-27，移动端定向补验执行于 2026-10-28，Skill 包改造的门禁执行于 2026-10-28。

各阶段保留当时的测试与环境记录；当前完成状态和最终门禁以顶部摘要及 Phase 4 为准。

## 当前交付记录（MVP 已通过验收，Phase 5 仍未实施）

- 已补充 Phase 1 的持久化修订建议及 accept / reject / edit_again / manual_edit 状态机、优秀片段保护、数字/引语/否定/逻辑变化提示和人工复核。只有接受才另建版本。
- 已补充独立主题生成与按项目去重、固定题训练、challenger 优胜文本保护、历史轮次切换，以及批注显式重新定位的新记录关联。
- migrations 0000～0009 已落库；默认入口始终为宿主 Agent Skill + 独立 Web。规则确认、文本语料、三类成品构建安装、隐私清除和固定版本盲测均已有实际数据库/API/UI 验证。
- Phase 0～4 的 MVP 核心闭环已实现，最终完整门禁为 **63 pass / 1 skip**（Vitest）、**19 pass**（配套 Chromium）；lint、core/Web 类型检查和生产构建通过。反馈上下文修复包含在这次结果内。尚不能报告真人改善率。
- 2026-10-28 的 Skill 包改造见 [Phase 6](#phase-6)。改造后的门禁为 **68 pass / 1 skip**（Vitest），lint 与 typecheck 通过。

## Phase 0

Status: complete（工程基座与生产运行验证完成；环境限制见下）

Implemented:
- pnpm monorepo、TypeScript strict、Next.js App Router / React / Tailwind 独立工作台；apps/web 为 UI/API，packages/core 为共享领域服务。
- PostgreSQL + Drizzle schema / SQL migrations / seed，FK、索引、唯一约束；业务请求不建表。单用户 workspace 有 owner_id、读取和重命名，项目可创建、读取、更新、归档，归档保留历史。
- 统一 {data,error,request_id}、Zod 校验、事务型幂等命令、同键不同输入 409、expected_version 乐观锁、本机 Host/Origin 边界、脱敏日志和数据库错误提示。
- ModelProvider 的 generateText / generateStructured、显式 MockProvider、可选真实 Ollama HTTP/schema 适配器。真实模型不可用时不回退为伪造成功。
- Compose 开发/测试库、Windows 便携真实 PostgreSQL 替代启动脚本、环境示例、README、ESLint / Vitest / Playwright / CI 配置。

Tests run:
- pnpm install --frozen-lockfile：通过（PNPM_MAX_WORKERS=1）。
- 最终 pnpm install --frozen-lockfile --offline、pnpm db:migrate、pnpm db:seed 再次通过（幂等，无新增训练数据）。
- pnpm lint：通过。pnpm typecheck：通过（core + Web）。
- pnpm test：最终 27 pass、1 skip，5 个测试文件。skip 是未配置/未授权调用的真实 Ollama 冒烟测试；HTTP 替身契约测试不当作真实调用证据。
- pnpm build：通过。根命令先强制完整类型检查，再运行 Next 编译，关闭重复的并行检查来降低内存峰值。
- pnpm dev 定向烟测：开发服务首页 /、项目页 /projects 均 HTTP 200，/api/health 显示 database=connected、mock=true（临时端口 3001，验证后已停止）。训练页的开发热编译限制仍单独保留。
- pnpm test:e2e：最终 9 pass，Microsoft Edge，生产构建，真实隔离 PostgreSQL。Phase 0 项目 CRUD/刷新恢复/mock 标识的定向 E2E 也单独通过。
- Drizzle migrate / seed：通过。实际运行 PostgreSQL 18.6 便携版，开发库 55432 与隔离测试库 55433，SCRAM 本机认证；非内存替代。
- docker compose --profile test config --quiet：通过。Docker Engine 可用，但 PostgreSQL 17 镜像下载未完成，因此未声称 Compose 启动成功。
- GitHub Actions 配置已写，未在远端执行。

Manual demo:
- README 的便携 PostgreSQL 启动 → pnpm db:migrate → pnpm db:seed → pnpm build → pnpm start → /projects 创建、更新项目 → 刷新保留 → /settings 查看 provider 与隐私。
- 生产构建已在隔离测试服务 3100 验证；当前 3000 由其他程序占用。2026-10-27 启动 3001 生产服务被自动审批以 blocked by policy 拒绝，未给详细原因；不能声称此刻生产演示服务已启动。

Open issues:
- 本机系统 commit 内存曾非常紧张。pnpm dev 的服务和 API 已启动、写入成功，但训练页热编译曾因系统内存不足退出；生产构建 + 浏览器路径已经验证，测试 Web 进程结束后不会常驻。README 提供生产运行替代路径；不能把开发热编译记成完整通过。
- Compose 与 PostgreSQL 17 实机兼容已于 Phase 4 在隔离环境验证；远端 CI 未运行。

Next steps: 继续 Phase 1 余项，保留阶段边界。

## Phase 1

Status: complete（2026-10-27 补齐核心闭环；增强项仍明确列出）

Implemented:
- 主入口是 .agents/skills/skillforge/SKILL.md + 独立 Node CLI。宿主 Agent 使用自身模型，不要求应用额外配置模型账户。
- CLI 创建项目/会话、领取 awaiting_agent job、提交自动主题与 N 候选、返回 URL、读取反馈/版本、继续下一轮、取消/重试。未实现的 skill build / validate / install 返回非零错误，绝不报成功。
- writing/dialogue、自动/手动题目、粒度与目标维度、N=2..8、持久化随机展示序列、来源与模型元数据。Agent 声明明确标为自述，mock 明确标为模拟。
- 五类原始比较语义：best_one、approve_many、full_ranking（并列）、tie、reject_all；独立评语、无胜者的人工改写、不可变 FeedbackEvent、事务回滚、并发幂等、撤销补偿事件。
- 文档版本、反馈及批注有数据库禁止 UPDATE / DELETE 的 trigger。生成提交和反馈串行锁定 session，保护版本递增。后续改写绝不覆盖原文。
- Tiptap 鼠标/键盘圈选与重叠高亮；UTF-16 offset + 精确 quote + SHA-256 + 邻接上下文服务端校验；人工全文/选区改写、diff 预览、另存版本。旧版批注待显式重新定位，不静默迁移。
- Session 状态、历史列表、刷新恢复、继续探索、完成会话。provider 路径使用 PostgreSQL job queue，worker 有租约、最多两次尝试、取消及显式重试；Agent 路径无需 worker。

Tests run:
- Vitest 27 pass / 1 skip：真实数据库 CRUD、并发幂等、409、组合反馈事务回滚、五种反馈语义、不可变原文/事件、重叠锚点、UTF-16 emoji、mock worker、模型 schema 错误不回退、CLI 未实现命令非零退出。
- Playwright 9 pass：项目刷新恢复；N=2/3/5/8 的 Agent 提交 → Web 组合反馈 → 刷新 → CLI 读取；Tiptap 键盘重叠圈选/拒绝原文覆盖/改写 diff/恢复父版本；Web 手动建题/多选与并列排序；显式 mock queued job；独立 CLI 实际 HTTP 创建与提交。
- Skill 格式验证：PYTHONUTF8=1 + skill-creator quick_validate.py .agents/skills/skillforge → Skill is valid。
- opencode --pure debug skill：实际发现本仓库 `.agents/skills/skillforge/SKILL.md`。仅验证发现，不冒充 OpenCode 真实模型调用或长期偏好学习。
- 当前开发 Agent 另行实时生成并提交三个新候选，model 名称未知保留 null。数据库中人类反馈为 0，未代替用户投票，也未生成任何偏好结论。
- 本地服务重启后再次通过实际浏览器检查：同一会话恢复 3 个候选、0 条人类反馈；开发库中的演示不依赖原 Node 进程内存。

Manual demo:
1. 打开 http://localhost:3000/sessions/0bd286a6-5034-435b-a972-eee8cce622e9/compare 。项目名“Agent 实时生成 · 待你反馈”，标题“末班公交前的五分钟”。
2. 比较三个当前 Agent 生成的候选，选择反馈方式，或仅留下评语/人工改写；保存后刷新。
3. Agent 运行 pnpm skillforge session feedback 0bd286a6-5034-435b-a972-eee8cce622e9 读取原始反馈。
4. 进入“圈选与版本”，选择文档后圈选、保存重叠批注；人工编辑后查看 diff，保存新版本，再切回原版。
5. 从头复现：/projects 新建项目 → 训练来源“宿主 Agent” → 创建会话 → Agent 依据 job get 返回要求生成 JSON → job submit → Web 反馈 → session feedback。完整命令见 README 和 trainer 引用协议。

Evidence:
- docs/evidence/phase1-agent-feedback.png：隔离测试库的浏览器流程截图，全部人类操作为自动化测试 fixture，不是真实用户偏好。
- docs/evidence/live-agent-training.png：开发库实时 Agent 候选，尚无用户反馈。

2026-10-27 补齐：
- AI 局部/全文修订任务，protected_spans 输入与提交后校验；diff、accept / reject / edit_again / manual_edit，显式风险确认与乐观锁；未接受不产生文档，已接受另建不可变版本。
- 独立 /api/topics/generate 与 /topics、规范化 prompt 去重、固定主题候选；challenger 只采用明确选出的优胜者，并校验原文不变。diverse / focused 可选；历史轮次可切换。
- 批注增加作者和显式重新定位关联；保留旧批注并创建新记录，不自动粘贴旧偏移。
- 最终门禁：31 pass / 1 skip（Vitest），11 pass（Playwright），lint/typecheck/build 通过。真实 Ollama opt-in 未执行，mock 与测试反馈不当作真实偏好。

Open issues / 后续增强：
- 稳定 document 逻辑文本块已可精确定位；更细块身份和自动重锚未实施。
- 未提交编辑草稿的跨设备/离线自动恢复未实施；已提交记录、任务、建议和历史均可刷新恢复，网络错误可见。
- 自适应覆盖选题归 Phase 5；三类 Skill、规则确认和盲测归 Phase 2～4，尚无真人改善率。

Manual demo 补充：/topics 生成独立题 → Agent job get/submit → 用此题比较 → 反馈后挑战当前最佳 → 查看历史轮次；圈选页选版本 → 创建 AI 修订任务 → Agent 提交 replacement/rationale → 查看 diff → 人工复核 → 接受/拒绝/按新要求再改。提交契约见 trainer 的 references/protocol.md。

Next steps: Phase 2 模式检测与有证据的规则确认。

## Phase 2

Status: complete（2026-10-27；真实供应商调用仍需显式配置）

Implemented:
- rule-types.ts 定义严格规则、作用域、强度、语境例外与受限模板；pattern-engine.ts 支持精确短语、对立转折直接样式及变体、NFC 匹配映射回原始 UTF-16 span、频率统计。必要按钮事实纠正、引语、对白可豁免；命中只提示人工判断。
- /patterns：真实检测 API、自定义模式及强度编辑、启停、原文与语境、误报/确认/例外不可变记录。可请求 Agent/provider 的 schema 语境判断，uncertain 为明确状态；模型失败保留确定性证据，不捏造成功。
- /preferences：从未撤销反馈创建持久化模型任务，提议至少引用两条实际不同证据，拒绝伪造 ID、已撤销证据及擅自全局化；一律 proposed。手动规则同样先待确认。
- 显式确认、拒绝、编辑后重新确认、停用/恢复、证据和历史；expected_version 防止覆盖。同层级潜在冲突需缩小范围或明确停用；任务 > 项目 > 用户，写作/对话不默认传播。更高作用域指导覆盖同家族的低优先级差异指导，并提示冲突。
- confirmed 规则进入适用的后续训练和修订任务；修订完成后再次运行模式检查并提示残余命中，仍须保护事实/数字/否定/引语。迁移 0005 已应用；rule_history 和 pattern_reviews DB trigger 禁止篡改。

Tests run:
- pnpm lint / pnpm typecheck / pnpm build：通过。
- pnpm test：**40 pass / 1 skip**，8 文件；真实 Ollama opt-in skip，模拟语境与提议均明确标记。
- pnpm test:e2e：最终 **13 pass（37.0 秒）**，生产构建 + Edge + 隔离 PostgreSQL。新增证据提议→Web 确认→编辑→重确认→停用→刷新，以及语境例外/误报/自定义频率保存。
- 回归发现并修复偏好页刷新时项目范围初始化竞态；重复运行测试使用唯一数据名，未清除既有测试数据。

Manual demo:
1. /patterns 粘贴 ACCEPTANCE_FIXTURES.md C 的句式与短语 → 检查 → 查看精确原句、UTF-16 范围、逻辑纠正/引用豁免 → 标记误报 → 刷新查看不可变记录。
2. 展开“添加可编辑语言模式”，选择项目/领域/强度/例外/阈值 → 保存模式 → 提出偏好规则 → /preferences 选择项目并确认。
3. 训练会话保存至少两条原始反馈 → 偏好页“从未撤销反馈生成偏好提议” → Agent job get / submit（契约见 trainer 协议）→ 查看证据 → 确认规则 → 修改后再次确认或停用 → 查看历史。
4. 新训练/修订任务的 confirmed_rules 可检查范围及版本；已有文档、反馈和历史规则不被覆盖。

Evidence: docs/evidence/phase2-preference.png 为自动化测试项目与测试判断，不能当作真人偏好或改善证据。

Open issues:
- 语义检测的真实 Ollama 响应未执行；宿主 Agent 任务接口已接通，供应商错误和模拟结果均有独立诚实状态。
- 上下文启发式不是完整语义鉴定；不确定情况由 Agent/provider 建议与用户复核，不自动判坏或篡改文字。
- 原始语料提取、三类成品与盲测归 Phase 3～4，尚未交付。

Next steps: Phase 3 文本语料与三类离线 Skill 编译/验证/安全安装。

## Phase 3

Status: complete（2026-10-27；系统 Edge 下载兼容问题见下）

Implemented:
- /corpus 与详情：粘贴/文件上传 UTF-8 TXT/MD/SRT/VTT/公开 JSON 聊天格式，1MB / MIME / 文件名 / UTF-8 检查；原文件私密 UUID 存储，hash、许可、来源、用途、原文/校订、时间戳和相邻语境可恢复。
- 片段正/负/观察标签；每次提取明确授权所选模型接收片段和相邻语境。Agent / provider 生成结构化发现，拒绝虚构引用、陈旧片段版本和污染指导；语料伪指令不执行。mock 明确标记。
- 用户逐项确认发现只产生 proposed 规则，再独立确认才用于构建；不会学习整篇材料。语料例句导出另需许可并限制最小长度。
- 删除语料清除私密原文件、派生段落、发现、模型输入缓存，停用来源规则；旧幂等响应被脱敏且重试返回 410，不复活已删除材料。/settings 提供 JSON 备份（含仍保留的原文件），历史离线成品不能自动撤回。
- 三类成品 compiler：有效 YAML、领域与作用域、确认规则快照、references、离线 Node 检查器、第三方许可证、ZIP / CRC / SHA256、版本历史、差异和授权下载。DB trigger 禁止构建被 UPDATE/DELETE，文件下载复核 ZIP hash。
- CLI skill build / validate / install 真正可用。可移植 bundle 无 node_modules 和服务依赖，拒绝路径穿越、重复/大小写碰撞、符号链接、非法 Windows 文件名、超限/损坏/加密 ZIP 与已有目标。新名称安装保留旧版，不执行包内脚本。
- migrations 0006～0007 已应用；pnpm build 自动从源码重新打包离线工具。

Tests run:
- pnpm install --frozen-lockfile --offline：通过。
- pnpm lint / pnpm typecheck / pnpm build：通过。
- pnpm test：**49 pass / 1 skip**，12 文件。包含真实存储/数据库授权与删除、污染输入、三类实际 ZIP、历史 v1 不变、缺引用失败、解压上限/CRC/路径/链接检查、独立 CLI 与离线检查器实际执行。真实 Ollama opt-in 仍 skip。
- pnpm test:e2e：配套 Chromium 最终 **14 pass（43.2 秒）**。新增 SRT 文件上传→片段用途→明确授权→Agent fixture 发现→两次确认→浏览器 ZIP 下载→实际离线安装→CLI build v2→隐私删除与导出检查。
- 系统 Edge 全量为 **13 pass / 1 fail**，ZIP 下载间歇 canceled；补齐 Content-Length 后定向曾通过，完整回归仍复现，未伪称已稳定修复。默认验收改用 Playwright 配套 Chromium，未关闭任何浏览器安全防护。
- scripts/validate-built-skills.ts --test：三类构建均下载、验证、安装到 .local/skill-smoke/1c7f6dec-61d2-4395-93d1-d5dcac98a780/.agents/skills；本机 skill-creator quick_validate.py 对三者分别返回 Skill is valid!。这是格式/脚本实证，不是模型质量或真人偏好改善证据。

Manual demo:
1. 启动 PostgreSQL、迁移、pnpm build、设置空闲 PORT/BASE_URL 后 pnpm start。打开 /corpus，上传自有/获准字幕，声明用途与来源；详情查看时间戳、原文与上下文，选择具体片段。
2. 勾选数据传输授权→提取→Agent 通过 job get / submit 提交真实发现→只确认想学习的特征→/preferences 独立确认规则。
3. /skills 选择项目与类型→编译→查看完整包、报告及历史差异→下载 ZIP→CLI validate / install 到指定项目的 .agents/skills；已有目标使用 --name 新名称。命令见 README。
4. 语料详情勾选永久删除→查看清除报告→旧详情 404、旧提取幂等重试 410、后续构建不再使用停用规则；历史包保持原 hash 并明确不可自动撤回。

Evidence: docs/evidence/phase3-skill.png 为隔离 E2E 测试项目的真实浏览器截图；样例及判断均为测试 fixture，不是真实个人偏好。

Open issues:
- 系统 Edge 自动化 ZIP 下载存在上述间歇取消；配套 Chromium 完整下载与 CLI 下载已验证。
- 生产 3001 服务启动被自动审批拒绝；14 条 UI 验收通过隔离测试服务运行，不将其混同为常驻生产服务。
- Phase 3 结束时盲测尚未实现，已于下方 Phase 4 实现；真人改善率仍待真实投票。最终审计另见 docs/MVP_AUDIT.md。

Next steps: Phase 4 保留题、隐藏映射投票、真实来源与全量验收审计。

## Phase 4

Status: complete（AC-01～07、09～13 的 MVP 验收链路通过；限制见下）

Implemented:
- 保留题和固定 Skill 构建、Agent/provider 同题 baseline/personalized、服务端随机隐藏映射、完整投票后揭示来源、四种判断、评语、样本量及明确胜率公式。训练/主题与保留题隔离；投票和测试输出不回流训练证据。
- 测试库/测试 run 强制 test 来源；模拟输出与测试票不计入真人改善。真人样本为零时显示待评测；语义人工复核及静态命中/误报与接受记录分别标明分母和局限。
- 模型 job 保留租约、有限重试和取消；CLI 增加 evaluation create/get/results。通用 Web 写入重试保留幂等键，serve 对未启动服务返回真实失败和启动说明。
- 下一轮传入最近 20 条未撤销的本会话反馈及相关候选摘录，保留比较语义；撤销已进入待处理快照的反馈会取消旧任务，不能重试旧快照。
- 显式会话与模式复核隐私清除、规则证据脱敏、旧幂等响应清除和无原文凭证；历史构建/评测及独立副本不自动撤回。任务级规则输出最小可读语境，离线检查器按 task ID 应用。
- 首页显示最近构建；语料衍生训练由用户选本项目片段、自行编题及确认，模型不自动接收原片段；mock 自动主题为每领域五个不同示例，用尽后诚实报错。
- migrations 0008～0009 已应用于既有便携开发/测试库与隔离 PostgreSQL 17 库。原始审计不可修改，只有用户明确隐私清除可在受限事务中删除指定原始记录，构建/评测保持不可变。

Tests run:
- 全新 Compose PostgreSQL 17.11，开发库迁移/seed 通过；最终 `pnpm lint`、`pnpm build`（包含 core 和 Web 完整 typecheck）通过，`pnpm test` **63 pass / 1 skip，15 文件（15.44 秒）**，`pnpm test:e2e` **19 pass（1.1 分钟）**。`pnpm db:generate` 确认无缺失 schema 迁移。
- 反馈上下文修复已纳入最终全量回归，另有训练/隐私定向测试 **12 pass**。真实 Ollama 调用未启用，故该集成测试 skip；HTTP 替身测试不当作真实调用。
- 语料衍生题接口定向 **9 pass**（首次进程意外退出，重跑通过）；完整浏览器回归包含同一项目从 Agent CLI 到盲测的端到端路径。
- 2026-10-28 手机宽度 390×844 补验：N=3 比较页无横向溢出，组合反馈提交、刷新和 CLI 读取均通过（**1 pass，6.9 秒**）。第一次测试服务启动提前退出，检查确认数据库健康并重新执行后通过；没有修改生产代码或伪报首次成功。
- 三类实际构建隔离安装后，本机 skill-creator quick_validate 均 `Skill is valid!`；OpenCode `--pure debug skill` 实际发现隔离目录内三类成品。此项验证发现与格式，不声称模型质量或真人改善。

Manual demo:
1. 按 README 启动数据库、迁移/seed、构建并启动 Web；在宿主调用 skillforge-trainer 创建 Agent 会话并提交 2～8 个真实候选，打开返回 URL。
2. 用户保存评语或改写；Agent 读取反馈并依据至少两条实际证据提交偏好提议；用户在 `/preferences` 明确确认。
3. `/skills` 构建/下载，再用 trainer CLI validate/install 到指定项目；`/evaluations` 固定构建和至少五题，Agent 按协议提交同题双版本，用户逐题投票，全部完成后查看身份与统计。
4. `/corpus` 导入获准文本；项目页也可选语料片段并自行编写训练题。会话比较页可导出或明确清除源数据；`/settings` 下载备份。

Evidence: docs/evidence/phase4-blind-test.png 来自隔离测试 run，五票均为测试票，真人样本 0；同一项目完整链路见 tests/e2e/complete-chain.spec.ts。

本机隔离复现：Compose 项目 skillforge-mvp-audit 使用 55435/55436，未占用原有 55432/55433。PowerShell 设置 `$env:TEST_DATABASE_URL='postgresql://skillforge:skillforge_test@localhost:55436/skillforge_test'` 后运行 `pnpm test`、`pnpm build`、`pnpm test:e2e`；空白环境可直接按 README 的默认 Compose 端口启动。Playwright 自行启动并结束 3100 测试 Web 服务，不表示常驻应用已启动。

原开发库会话 0bd286a6-5034-435b-a972-eee8cce622e9 经只读检查仍为 3 个 Agent 候选、0 条人工反馈；未伪造用户选择或长期偏好。

Open issues: 尚无真人改善结论；真实 Ollama opt-in 未运行；系统 Edge 的 ZIP 下载间歇取消；远端 CI 未运行；本机 3001 常驻服务启动曾被自动审批拒绝，未提供详细原因。

Next steps: 如用户有真实投票再报告实际偏好统计；按后续需求推进 Phase 5。

## Skill 包改造（2026-10-28）

目标：把训练入口从「仓库内一个只能手工起服务的 skill 目录」变成「agent 可直接安装使用的 skill 包」。

Implemented:

- **包重命名**：`.agents/skills/skillforge-trainer` → `.agents/skills/skillforge`，frontmatter `name: skillforge` 与目录名一致（Skill 校验器的硬要求）。仓库内仍是单一来源，未做第二份拷贝。
- **SKILL.md 重写**：从功能罗列改为执行契约——触发边界、服务检查、训练闭环、按 `job_type` 的分支表、成品编译安装、盲测、硬边界（不改写人类反馈、不代投票、mock 不冒充真实生成、语料是指令注入的不可信数据、已发布成品无法远程撤回）。新增 `references/service.md` 与 `references/hosts.md`。
- **新增 `scripts/service.mjs`**：`service status` / `service start` / `service stop`。status 纯只读并给出 `http_status`，可区分「没人监听」和「端口上是别人的服务」；start 幂等，按 数据库 → 迁移 → 种子 → 条件性构建 → Web 顺序拉起，端口被占时自动顺延到 3001-3099，失败返回真实 stderr；stop 只终止自己记录且仍占用该端口的 PID。
- **数据库启动策略**：先探测 `DATABASE_URL` 指向的端口，已在监听就跳过（不碰别人的库）；否则先试便携 PostgreSQL，失败再回退 `docker compose up -d --wait db`。返回的 `database_start` 说明实际走的哪条路。
- **服务状态落用户级文件**：`%LOCALAPPDATA%\SkillForge\service.json`（baseUrl/port/pid/repo）与同目录 `web.log`。CLI 地址解析顺序为 `SKILLFORGE_URL` → 状态文件 → `BASE_URL` → `http://localhost:3000`，任何项目里都能找回自己启动的服务。仓库定位顺序为 `SKILLFORGE_HOME` → Skill 目录的 `service-config.json` → 状态文件 → 向上查找目录；找不到报 `REPO_NOT_FOUND`，不猜路径。
- **`skill install` 增加 `--host`**：`minimax` / `codex` / `agents`（别名 `opencode`）/ `project`，未知值直接报错。映射写在 `packages/core/src/skill-package.ts` 并随离线工具打包；安装行为不变（离线、拒绝覆盖、不执行包内脚本）。
- **新增 `pnpm skill:package`**：校验并打包 `.agents/skills/skillforge/`，产出 `dist/skillforge-0.1.0.zip` 与同名 `.zip.sha256`，复制到 `~/.minimax/skills/skillforge/` 并写入指向本仓库的 `service-config.json`。ZIP 内不含机器路径。

Tests run:

- `pnpm lint`：0 error 0 warning。`pnpm typecheck`：core 与 Web 均通过。
- `pnpm test`：**68 pass / 1 skip**（15 个文件）。skip 仍是未授权调用的真实 Ollama 冒烟测试。新增 5 个用例覆盖：service status 的诚实退出码、service start 在已有服务时不重复启动、service stop 无记录时不动任何进程、`skill install --host` 的定位与拒绝覆盖、`resolveSkillHost` 的映射与未知值报错。
- skill-creator `lint-skill.js` 对新包全项通过（name 与目录一致、description 含触发短语、正文 101 行、references 链接全部可解析）。
- skill-creator 的 with-skill / baseline 对比评测已跑完一轮（同一请求、同一轻量约束：只读命令、不构建、不起服务、不产生任何反馈数据）。结论：**with-skill 更好，但不是全面碾压**。
  - with-skill 更强的地方：把「我不能替你做」精确标在真正需要人拍板的阶段（启动服务、项目命名、网页反馈、规则确认、成品类型选择）；额外指出两个只有读源码才会暴露的坑——**`skill build` 在 0 条已确认规则时静默产出空包而不报错**，以及安装目录名等于包内 `name` 字段导致二次安装必然撞名；并实跑了离线校验器证明离线链路可用、比对安装副本与仓库副本哈希一致。
  - baseline 更强的地方：篇幅更长（727 行 vs 506 行），并且把「便携 PG 与 Docker PG 两边数据互不相通、你要用哪边的旧数据」单列为硬前提；with-skill 版本默认了数据库自动探测，没有把这句风险摆到台面上。
  - 据此改了 SKILL.md 与 references/service.md：补上「构建成功不等于有内容，先核对规则条数」与服务端构建错误码；补上「监听着的端口不等于是用户的数据，探测到端口已占用时要问用户用哪边」。两处都写进了 SKILL.md 本身，不只留在 references。
- 实机链路：`service start` 在本机 3000 端口被别的 node 服务占用的情况下自动落到 **3002**，跳过已在监听的 Docker 数据库，`/api/health` 返回 `database: connected`；`serve` 随后解析到 `http://127.0.0.1:3002/`，`project list` 正常返回；`service stop` 精确终止记录的 PID、释放端口、清状态文件，数据库保持运行。Web 首页 HTTP 200。
- 全局安装副本独立可用：只带 Node 运行 `service status`，能经 `service-config.json` 找回仓库。
- 评测中 with-skill 一侧真实产出了「向非技术同学解释向量数据库」这一轮的 3 个实质不同候选、诚实的模型来源标注、一个 `personalized-writing` 成品 ZIP，以及一次离线安装，证明训练闭环本身可跑通。

Open issues / 限制:

- **本机 Windows 便携 PostgreSQL 18.6 无法稳定创建后端进程**：日志出现 `could not reserve shared memory region ... error code 487` 与 `client backend ... terminated by exception 0xC0000142`（STATUS_DLL_INIT_FAILED），宿主内存紧张时触发，postmaster 随之重置全部连接。已确认 PG 18 的 Windows 版只接受 `dynamic_shared_memory_type=windows`，改不动；`min_dynamic_shared_memory=64MB` 与关闭并行 worker 只能缓解，不能根除。**本轮改用项目既有的 Docker Compose PostgreSQL 17 路径跑完整门禁**，`docker compose --profile test up -d --wait` 两个容器均 healthy，迁移、种子与全部 69 个用例在其上通过。便携启动脚本已加上缓解参数与原因注释。
- `scripts/local-postgres.ps1` 必须保持纯 ASCII 注释：Windows PowerShell 5.1 按 ANSI 读取无 BOM 的 .ps1，中文注释在 GBK 下会被误解码并吞掉下一行（本轮实际踩到）。
- 打包脚本未做增量/并发保护，只适合单机手动执行。
- 本轮未执行 `pnpm test:e2e`（Playwright 浏览器门禁）；E2E 依赖生产构建与浏览器环境，与本次包改造无直接耦合，仍保留 Phase 4 的 19 pass 记录作为基线。
- **门禁对宿主内存敏感**：本机物理内存低于约 500 MB 空闲时，同一套测试会出现 3 个连接超时失败（耗时从 15 秒涨到 105 秒）；内存回到 1 GB 以上后稳定复现 68 pass / 1 skip。失败是环境导致，不是代码回归，但排错时要先看内存。

## Phase 5

尚未实施：音视频/FFmpeg/真实转写/用户校订、自适应主题、多轮对话深度评测与可选 MCP。
