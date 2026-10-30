# 决策日志

## 2026-10-27 · Phase 4 与验收边界

- 盲测对固定构建快照生成同题 baseline / personalized，服务端保存随机映射，全部投票前连备份也不揭示。测试库或显式测试评测的票永久标记 test；模拟输出与测试票不进入真人胜率。胜率排除平局与双拒，语义通过率只以已复核的票为分母。
- 普通原始审计记录不可修改、删除；用户明确请求的隐私清除使用事务内 owner 限定的删除例外，清除源数据、缓存与旧证据文本并停用派生规则，保留无原文的 hash/数量凭证。已发布构建、独立评测与其他副本不自动撤回。
- 按任务作用域发布规则时附最小可读题目语境与 hash；潜在注入/秘密不导出，离线检查器要求显式匹配 task ID。固定 mock 主题有限且不可冒充真实出题。
- `serve` 采用规范允许的显示 URL 路径：服务未就绪时明确报错和启动指引，不假装启动/打开。用户仍可通过 README 启动服务，`session open` 返回可复制 URL。
- 下一轮生成任务携带本会话最近 20 条未撤销的原始事件和相关候选短摘录；provider 与宿主 Agent 均可按原比较语义参考。用户撤销已进入待处理快照的事件时，取消旧任务并禁止重试，重新创建时才使用更新后的反馈。
- 基于语料的训练题由用户选择本项目片段后自行编写并确认传输；模型任务不自动接收语料原文，只保存来源 ID 和用户编写题目。删除语料不静默删除作为独立会话保存的题目/候选；会话有单独的导出和隐私清除入口。
- PostgreSQL 17.11 Compose 使用单独项目、端口 55435/55436 和空白库验证；保留原 55432/55433 数据。系统 Edge 间歇下载问题和未配置的真实模型调用继续如实报告。

## 2026-10-27 · 完整 MVP 与 Phase 1 补齐

- 用户明确继续完整 MVP（AC-01～07、09～13）；按 Phase 1→2→3→4 顺序推进，音视频保持 Phase 5 backlog。
- 通用 jobs 增加 job_type 与可空 session_id，主题/修订共享 Agent 提交与 provider 租约。训练的单活动任务唯一索引仅作用于 training，不阻塞独立修订。
- 建议与接受后的文档分开持久化。优秀片段原文默认保护；语义检查是保守提示，任何实际改动均需人工复核实体/语气/观点，不能声称自动保证等价。
- 跨版本批注由用户明确选择新选区再保存新记录，保留 reanchored_from_id；不做未经确认的自动重锚。
- 当前 3000 端口被另一个非本项目进程占用，不终止它；后续本项目人工验收使用空闲端口 3001。隔离 E2E 使用 3100 与独立 PostgreSQL 测试库。
- Phase 2 不提供用户任意 regex；采用精确短语和固定有界句式模板，NFC 命中映射回原始 UTF-16。内置模式仅作检查提示，不自动发布为用户偏好。
- 模型规则提议只允许本项目本领域，至少两条实际未撤销证据；用户可显式编辑扩大范围。证据摘要不当作正确概率。mock 提议写明模拟，不宣称学到真实偏好。
- 同 family 的不同指导作为潜在冲突展示；同层级确认必须显式处理，跨层级按 task > project > user 保留较具体指导。facts 与用户当前任务优先，静态模式不能证明全文语义等价。
- Phase 3 选择 fflate 打包与 YAML 库解析；解包先检查中央目录路径/大小/符号链接，再用 Node zlib maxOutputLength 限制实际膨胀并校验 CRC。CLI 工具从同一源码打包，包含许可证；不会执行第三方包内脚本。
- Skill 编译是有限的确定性操作，直接返回 ready 构建及验证报告；模型提取仍走持久化 job。空规则包明确为 0，不声称已学到风格。
- 原始语料仅保存在私密存储；授权下载/备份是 API 的附件响应，区别于普通 {data,error,request_id} JSON。删除脱敏幂等响应并保留操作指纹，以免旧请求重导入原文。
- 本机 Edge 156 的 Playwright ZIP 下载间歇 canceled（13 pass / 1 fail），API 与配套 Chromium 下载通过。自动化默认采用 Playwright 官方配套 Chromium，E2E_BROWSER_CHANNEL=msedge 保留兼容性验证入口；不禁用安全机制。
- 已核对 Agent Skills https://agentskills.io/specification 与 Codex https://learn.chatgpt.com/docs/build-skills ：YAML name/description、目录同名、相对引用与 .agents/skills 发现位置。当前三类成品通过本机 quick_validate，未冒充真实质量评测。

## 2026-10-26 · 首轮范围和结构

- 按既定规范实施 Phase 0，再完成 Phase 1 首条纵向流程；完整产品、偏好学习、语料、Skill 编译和盲测仍属后续阶段，不提前标记完成。
- pnpm monorepo：`apps/web` 为独立 Next.js App Router 工作台及 HTTP API；`packages/core` 放数据库、Zod 契约、领域服务与模型接口；`scripts` 放迁移、seed 与 worker。业务状态全部写入 PostgreSQL。
- 保留 PostgreSQL + Drizzle migrations，不采用内存数据库或 localStorage 替代。开发库 55432，隔离测试库 55433，仅监听 loopback。默认单用户 workspace，owner_id 仍由服务端指定。
- 默认显式 mock（固定测试样例，无 AI 能力声明）；真实适配器采用 Ollama HTTP API，可运行自有本地模型，不需要付费账户。模型不可用或 schema 不合法时失败，不回退为假成功。未配置真实模型时真实集成测试跳过。
- 项目删除采用归档，避免破坏不可变反馈、文本版本和将来的构建引用。更新使用 expected_version；POST 使用 Idempotency-Key，复用同键且不同输入返回 409。
- **用户补充澄清：产品首先是 Agent 使用的 Skill + Web 人类反馈面板。** `skillforge` 由 OpenCode/Codex 等宿主 Agent 读取，宿主使用自己的模型生成任务/候选，通过 CLI/HTTP 提交，读取真实人类反馈继续训练。应用不要求另配 Ollama 或 API Key。
- CLI/Web 默认 `generation_source=agent`：job 为 `awaiting_agent`，显示等待状态，不自动捏造输出。Agent 提交时记录宿主声明的模型来源，标为“Agent 提交，来源自述”，不冒充经过供应商验证。Web 可明确选择 provider 路径，用 mock 演示或可选 Ollama。
- Provider 路径的长耗时生成采用 PostgreSQL jobs 与独立 worker；事务创建任务，请求返回 job_id。worker 租约、有限重试和恢复不依赖浏览器连接。Agent 路径不需要应用内模型 worker。
- 依官方文档核对：Next.js App Router https://nextjs.org/docs/app/getting-started/installation ；Drizzle migrations https://orm.drizzle.team/docs/migrations ；Tiptap SSR https://tiptap.dev/docs/editor/getting-started/install/nextjs ；Ollama schema 输出 https://github.com/ollama/ollama/blob/main/docs/capabilities/structured-outputs.mdx 。
- 训练入口提前放在仓库 .agents/skills/skillforge，可由宿主发现；OpenCode 官方支持该路径 https://opencode.ai/docs/skills/ 。本机实际发现已验证，未发起宿主模型调用。
- 本机最初只有文档目录，无 Git 历史，已 git init；不自动提交变更。
- 当前 Docker 镜像下载未能完成，额外提供 Windows 便携 PostgreSQL 18.6 的开发启动脚本。它运行真实 PostgreSQL，默认地址及隔离库与 Compose 一致；应用仍使用原 PostgreSQL/Drizzle 栈。明确记录两种路径的实际验证范围。
- pnpm 11 使用 allowBuilds 明确允许 esbuild/unrs-resolver/sharp 的必要安装脚本。TypeScript 固定到兼容的 5.9.3，避免最新版 7.0 与 typescript-eslint 不兼容。
- 针对本机 commit 内存紧张，限制构建 worker、Rayon/UV 线程。根 pnpm build 先完整 typecheck，再关闭 Next 重复的并发类型检查，保持检查门禁。E2E 在生产构建上运行，降低浏览器与开发编译器同时运行的资源峰值。
- 第一条切片用稳定 document 逻辑文本块保存 UTF-16 偏移；Tiptap 段落经换行映射。旧版本批注永不默默贴到新版本，显式重新选择后生成新批注。更细的块身份、AI 修订与保护规则仍留在 Phase 1 backlog。
- Tiptap 原文表面允许光标/键盘选区，但通过 ProseMirror filterTransaction 拒绝 docChanged，标记 aria-readonly；人工编辑在 diff 面板显式另存版本，保护不可变原文。
- 本机 pnpm dev 首页/项目页/API 定向检查通过，但训练页热编译受系统内存限制曾退出。最终面板由 pnpm build + pnpm start 提供，完整浏览器验收基于生产构建；不隐瞒开发模式的环境限制。

## 2026-10-28 · 把训练入口改造成可安装的 Skill 包

- **包名从 `skillforge-trainer` 改为 `skillforge`。** 原名只覆盖"训练"，但改造后这个包同时负责训练闭环、服务引导、成品编译与安装、以及跨宿主分发，继续叫 trainer 已经不诚实。改名还修掉一个硬约束：Skill 校验器要求 frontmatter 的 `name` 与目录名一致，`skillforge-trainer` 目录无法以 `skillforge` 之外的任何名字被 MiniMax Code 加载。
- **保留 monorepo，不把 Web 应用拆进 Skill 包。** Skill 包内只放 CLI（`skillforge.mjs`）、离线打包工具（`package-tools.mjs`）、服务引导（`service.mjs`）和 references。Next.js 应用、数据库与 migrations 仍归仓库。理由：Skill 的价值是"让 agent 直接用"，不是"把整个应用塞进 zip"。
- **服务引导进 Skill 包。** 此前 CLI 明令"不会自行启动数据库或浏览器"，服务未就绪就非零退出——agent 第一次使用必然撞墙，用户得手工跑完数据库、迁移、构建、启动四步。这与"agent 直接使用"直接冲突，所以补 `service status|start|stop`。
- **服务状态放在用户级状态文件，不写进仓库。** `%LOCALAPPDATA%\SkillForge\service.json` 记录 baseUrl/port/pid/repo。这样 CLI 在任何项目里都能找回自己启动的服务，仓库也保持干净。仓库定位顺序为 `SKILLFORGE_HOME` → Skill 目录的 `service-config.json` → 状态文件 → 向上查找目录；找不到就报 `REPO_NOT_FOUND`，**不猜路径当真**。
- **端口自动避让。** 本机 3000 端口已被另一个 node 服务占用（`/api/health` 返回 401），默认地址直接失效。`service start` 改为优先用配置端口，其次 3000，被占用则顺延到 3001-3099 的空闲端口，并把实际地址写进状态文件。**以服务返回的 `url` 为准，不假设是 3000。**
- **`service start` 幂等。** 已运行就返回 `already_running: true`，不重复启动。启动顺序固定为 便携 PostgreSQL → `pnpm db:migrate` → `pnpm db:seed` → 条件性 `pnpm build` → Web，任一步失败立刻返回真实错误（退出码 + stderr/stdout），不留"已启动"的说法。`service stop` 只终止自己记录且仍占用该端口的 PID，核对不过就不动任何进程。
- **`skill install` 增加 `--host`。** 原先必须手填 `--target`，用户不知道各宿主的 Skill 目录在哪。新增 `minimax` / `codex` / `agents`（别名 `opencode`）/ `project` 四个已知宿主，未知值直接报错。映射写在 `packages/core/src/skill-package.ts` 并随离线工具打包，安装行为不变：离线、拒绝覆盖、不执行包内脚本。
- **分发走仓库脚本而非手工复制。** `pnpm skill:package` 校验并打包 `.agents/skills/skillforge/`，产出 `dist/skillforge-<version>.zip` 与 SHA256，同时复制到 `~/.minimax/skills/skillforge/` 并写入 `service-config.json` 指向本仓库。ZIP 内**不含** `service-config.json`——机器绝对路径不进可分发产物。
- **前端脚手架仍留在仓库 `.agents/skills/`。** 那仍是 OpenCode/Codex 的项目级发现位置，且是单一来源，不做第二份拷贝造成漂移。全局安装由打包脚本从同一份源复制生成。
- **不改动已发布成品的语义。** 三类成品 Skill、规则快照、盲测与隐私清除行为一律不变；本轮只改"怎么被安装、怎么找到服务"。
