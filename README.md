# SkillForge

**Agent 调用的训练 Skill，配套独立 Web 人类反馈面板。** OpenCode / Codex 等宿主使用自己的模型生成题目和 2～8 个候选；用户在网页比较、圈选、评论和改写；Agent 通过 CLI / HTTP 读取持久化反馈，继续下一轮。

当前已接入训练修订、偏好确认、文本语料、三种成品 Skill 编译/安装及保留题盲测。音视频转写属于后续 Phase 5；真实模型与真人改善证据的实际验证范围见 [实施状态](docs/IMPLEMENTATION_STATUS.md)。`skillforge` 是内部训练入口，既负责训练闭环，也负责构建与安装成品 Skill；它不是三种成品 Skill 的替代品。

## 启动

需要 Node >=22.13、pnpm 11.7.0，以及 PostgreSQL。默认单用户，仅本机访问。

```sh
pnpm install --frozen-lockfile
```

复制 .env.example 为 .env（PowerShell：`Copy-Item .env.example .env`；已有配置不要覆盖）。默认 provider 为 mock，Agent 路径不依赖它。

```sh
docker compose --profile test up -d --wait
pnpm db:migrate
pnpm db:seed
pnpm dev
```

打开 <http://localhost:3000>。开发库端口 55432，隔离测试库端口 55433；Compose 数据卷保留业务数据。迁移通过 SQL 文件执行，业务 API 不建表。seed 仅初始化单用户 workspace，不伪造项目、反馈或规则。

本机内存紧张时，训练页的开发热编译可能耗尽系统内存。可将最后一条启动命令改为 `pnpm build`，完成后运行 `pnpm start`。浏览器 E2E 基于生产构建；测试结束不会保留测试 Web 服务。

Windows 如镜像下载不可用，可改用真实 PostgreSQL 的便携路径（需要 Python，仅用于开发数据库启动工具，不改变应用 TypeScript 技术栈）：

```powershell
./scripts/local-postgres.ps1 start
pnpm db:migrate
pnpm db:seed
pnpm dev
# 查看状态或停止本项目自己的数据库
./scripts/local-postgres.ps1 status
./scripts/local-postgres.ps1 stop
```

脚本将固定版本 embedded-postgres==18.6.3 安装在仓库 .local/pg-runtime，启动 PostgreSQL 18.6；Compose 使用 PostgreSQL 17。二者只能选择一个，端口相同。首次初始化使用 SCRAM 密码认证，不清除或覆盖已有数据目录。.local 和 .env 均不提交。

端口通过 .env 的 PORT 设置；同时修改 BASE_URL。CLI 使用 SKILLFORGE_URL（默认 localhost:3000）。数据库地址由 DATABASE_URL、TEST_DATABASE_URL 指定。

## Agent 主流程

训练入口位于 [SKILL.md](.agents/skills/skillforge/SKILL.md)，包含独立 Node CLI、提交协议和服务引导命令。项目级 .agents/skills/ 是 [OpenCode 支持的发现位置](https://opencode.ai/docs/skills/)，Codex 同样按此约定发现。CLI 本身不写入其他仓库或用户的全局 Skill 目录；全局安装由下面的打包命令显式执行。

本包已可安装到 MiniMax Code 的全局目录 `~/.minimax/skills/skillforge/`，让 Mavis 也能直接加载：

```sh
pnpm skill:package
```

该命令校验并打包 `.agents/skills/skillforge/`，产出 `dist/skillforge-<version>.zip` 与同名 `.zip.sha256`，默认复制到 `~/.minimax/skills/skillforge/`，并写入一份指向本仓库的 `service-config.json`，好让 `service start` 能定位到仓库。宿主目录映射见 [宿主目录](.agents/skills/skillforge/references/hosts.md)。

在本仓库启动 Agent，调用：

> 使用 skillforge 开始写作训练，自动出题，生成三个有实质差异的候选，提交后给我 Web 反馈 URL。

Agent 依 Skill 指引执行：

```sh
pnpm skillforge serve
pnpm skillforge project create --name "夜间叙事" --mode writing
pnpm skillforge session create --project <project-id> --mode writing --topic auto --candidates 3
pnpm skillforge job get <job-id>
# 宿主 Agent 使用自身模型，依 generation_request 生成 JSON 文件
pnpm skillforge job submit <job-id> --file generated.json --key <stable-operation-key>
pnpm skillforge session open <session-id>
# 用户在网页反馈后
pnpm skillforge session feedback <session-id>
pnpm skillforge session next <session-id>
```

提交 JSON 见 [协议](.agents/skills/skillforge/references/protocol.md)。Agent 来源标为“宿主自述，未经供应商验证”，不凭空填入模型名称、token 或耗时。session open 返回 URL 和 opened=false，不假装已打开浏览器。

`serve` 检查已运行的服务并返回 URL；服务未就绪时返回非零退出码和启动指引，它不会自行启动数据库或浏览器。先按上述步骤启动服务；不能打开浏览器时复制返回的 URL。

Web 发起路径：创建项目 → 进入项目 → 选择“宿主 Agent”及候选数 → 创建训练会话 → Agent 用 job list 读取 awaiting_agent 任务并提交 → 网页自动显示候选 → 保存反馈 → 刷新恢复 → Agent 读取反馈。

其他仓库可将 `skillforge` 整个目录复制到该项目的 .agents/skills/（若已存在请先比较，勿覆盖）。复制时把 `scripts/service.mjs` 一起带上——CLI 会 import 它。其 CLI 只需要 Node；训练闭环要求运行中的 SkillForge HTTP 服务（可由 `skillforge service start` 拉起），离线校验与安装只依赖 Node，不依赖整个 pnpm 工作区：

```sh
node <skill-directory>/scripts/skillforge.mjs project list
```

## 服务引导

`skillforge service status|start|stop` 管理本机服务。三条命令都只操作本机，不下载模型，不调用付费 API。

- `service status`：只读体检，输出 `url`、`reachable`、`http_status`、`database`、`repo`、`pid`、`port`、`state_file`、`log_file`；服务不可达时退出码为 1。它不启动任何东西。
- `service start`：幂等启动。服务已在运行就返回 `already_running: true`，不重复启动；否则依次启动项目自带的便携 PostgreSQL → `pnpm db:migrate` → `pnpm db:seed` → 仅当 `apps/web/.next/BUILD_ID` 缺失时 `pnpm build` → 后台起 Web 并轮询 `/api/health`，最多 180 秒。任一步失败返回真实错误与退出码，不会留下“已启动”的说法。
- `service stop`：只终止本服务记录的那个 PID，且先核对它仍占用记录的端口；不是就不动任何进程。数据库保持运行。

端口优先取 `SKILLFORGE_PORT`，其次 3000；被占用则顺延到 3001-3099 内的空闲端口。以返回的 `url` 为准，不要假设是 3000。

状态文件在 `%LOCALAPPDATA%\SkillForge\service.json`，Web 日志在 `%LOCALAPPDATA%\SkillForge\web.log`。服务地址按 `SKILLFORGE_URL` → 本 Skill 启动记录 → `BASE_URL` → `http://localhost:3000` 解析。

`service start` 需要先定位 SkillForge 仓库：环境变量 `SKILLFORGE_HOME` → Skill 目录下的 `service-config.json` → 状态文件记录的 repo → 从 Skill 目录或当前工作目录向上找。一个都找不到时报 `REPO_NOT_FOUND`，不猜路径；此时用 `SKILLFORGE_HOME` 指向仓库根目录。

前置依赖是本机已装 pnpm 与 Python（Python 仅用于启动便携 PostgreSQL）。细节见 [服务引导](.agents/skills/skillforge/references/service.md)。

提醒一句：`service start` 会真的拉起数据库与 Web 进程、写入状态文件并占用端口，不是模拟；`service stop` 也只停本服务记录的进程。

## 私人语料与成品

`/corpus` 支持粘贴或上传有效 UTF-8 TXT/MD/SRT/VTT/JSON（1MB 上限）。声明来源与使用许可、正/负/观察用途；原文件与时间戳保留在私密目录。详情页可校订独立文本、调整片段用途和选择分析范围。提取前必须明确授权所选模型接收片段及相邻上下文；没有授权仍能本地查看、下载和校订。JSON 格式为 `{ "messages": [{ "role": "human", "content": "原文", "speaker_id": "可选", "timestamp_ms": 1000 }] }`，role 可为 user/assistant/human/system，均只作语料。

项目训练表单的“基于已导入语料的片段”允许选择本项目片段并自行编写题目，确认后把所写题目交给所选 Agent/provider；不会自动发送原片段或相邻上下文，任务记录来源标识。题目和候选是独立会话内容，删除语料不会自动删除这些另行创建的内容。

发现经逐项确认后只产生 proposed 规则，再到 `/preferences` 确认。语料删除会清除文件、片段、发现、模型输入缓存及旧幂等响应中的私人内容，并停用派生规则；已经导出的独立 Skill 不能远程撤回。`/settings` 可下载含原始反馈和仍保留语料文件的 JSON 备份，备份需妥善保存。

在 `/skills` 选择项目和三种类型之一，编译确认规则、查看验证报告与文件、下载 ZIP；详情页可比较同类历史版本。写作和对话规则分域，历史包不被新训练改写。没有确认规则时明确显示 0，不声称已经学到个人风格。

```sh
pnpm skillforge skill build --project <id> --type personalized-writing --out <new-file.zip>
pnpm skillforge skill validate <new-file.zip>
pnpm skillforge skill install <new-file.zip> --target .agents/skills
# 按宿主装到该宿主的全局目录
pnpm skillforge skill install <new-file.zip> --host minimax
# 保留旧安装，选新名称用于回退或并行比较
pnpm skillforge skill install <new-file.zip> --target .agents/skills --name personalized-writing-v2
```

validate / install 离线运行，只需包的脚本文件和 Node。`--target` 直接给安装目录，`--host` 按宿主名自动定位目录：`minimax` → `~/.minimax/skills/`、`codex` → `~/.codex/skills/`、`agents`（别名 `opencode`）→ `~/.agents/skills/`、`project` → 当前目录的 `.agents/skills/`；两者只能给一个，未知 host 直接报错。安装拒绝路径穿越、符号链接、非法文件名及已有目标，不执行包内脚本；不主动写入全局目录，除非显式指定 `--host`。包内 `node scripts/check-patterns.mjs --file <text-file>` 也离线可用，只做受限静态匹配。

任务级规则的发布包附带最小任务语境和 hash；离线检查器只有传入匹配的 `--task-id <uuid>` 才应用这些规则。文本指导要求 Agent 先判断当前任务语境是否匹配，不能将任务级规则当作全局规则。

## 保留题盲测

1. `/evaluations` 选择已发布的固定版本，使用默认保留题或自行提供至少五个未用于本项目训练的题目。选“宿主 Agent”后创建评测，将页面显示的 job 交给 Agent；provider 路径则需要 worker。
2. Agent 用 `pnpm skillforge job get <job-id>` 读取固定 Skill 指导与保留题，按 [协议](.agents/skills/skillforge/references/protocol.md) 为每题分别生成不带个人规则的 baseline 和应用快照的 personalized，再用 `job submit` 提交；不能代替用户投票。
3. 用户在评测页面逐题选择左、右、平手或都不满意，可记录评语和语义复核。全部投票后才揭示来源；胜率分母只包括有明确胜方的题目，平手和双拒单列。
4. 自动化或演示必须在创建时选“测试评测”，测试票与模拟输出不会变成人类改善证据。没有可用真人票时显示“待评测”；模型来源与自述指标均有标签。

也可运行 `pnpm skillforge evaluation create --build <build-id>`，并用 `pnpm skillforge evaluation get <evaluation-id>` 或 `evaluation results <evaluation-id>` 读取；测试使用 `--test`。

`pnpm skill:tools` 从 TypeScript 源码重建可移植脚本，根 `pnpm build` 会自动执行。测试构建的外部格式烟测：设置 `SKILL_VALIDATOR_SCRIPT` 为本机 skill-creator/scripts/quick_validate.py 后执行 `pnpm exec tsx scripts/validate-built-skills.ts --test`；只安装到本仓库 .local/skill-smoke 的隔离目录。

## 可选的应用内 provider

选择“应用内 provider”后，在另一个终端启动：

```sh
pnpm worker
```

默认 MODEL_PROVIDER=mock、MOCK_MODE=true，使用固定、多样化的验收示例。界面明确显示“演示模式”，不代表真实 AI 生成、学习或质量提升；固定样例不保证适合任意手动题目。自动主题每个领域提供五个不同示例，用尽后明确报错，可改用宿主 Agent 或手动主题。

如需独立于宿主 Agent 运行真实模型，自行配置已安装且有可用模型的 Ollama：

```dotenv
MODEL_PROVIDER=ollama
MOCK_MODE=false
MODEL_BASE_URL=http://127.0.0.1:11434
MODEL_NAME=<your-installed-model>
MODEL_API_KEY=
```

重启 Web 和 worker 后使用。训练文本发送到配置的模型地址；不会自动下载模型或调用付费 API。HTTP、超时或结构校验失败令任务失败，不回退成伪造的真实结果。Agent 主流程照常使用宿主模型。

任务有排队、租约、两次有限尝试、取消和显式重试。Agent job 无需 worker，只等待宿主提交。会话状态和错误在页面可见。

## 反馈、文本与 API

- 五种比较：选一、多选认可、含并列的完整排序、全部平手、全拒绝。也可仅评论或人工改写，无需胜者。
- 原始事件、候选顺序、随机显示顺序、文本版本保存到 PostgreSQL；普通操作不能更新或删除原始事件和版本，撤销是补偿事件。明确的隐私清除是事务中的受限删除例外，保留不含原文的凭证；构建和盲测快照不会被自动撤回。
- Tiptap 正文支持鼠标或键盘圈选，UTF-16 quote/offset 服务端校验，保留 quote hash 与邻接上下文，允许重叠。新版本不默默继承旧偏移，提示重新定位。
- 人工全文/选区改写与 AI 建议均有 diff 预览。优秀区域默认保护；接受/拒绝/按新要求再改/人工编辑建议，只有明确接受才另存不可变版本。实际变化要求复核实体、数字、否定与引语，自动提示不保证语义等价。
- /topics 提供独立题生成和去重；比较页可选择策略、挑战明确优胜者、切换历史轮次。下一轮将本会话最近 20 条未撤销反馈及对应候选短摘录传给所选生成端，保持多选、并列、全拒绝的原始语义；撤销已进入待处理任务的反馈会取消该任务，需重新创建。
- /patterns 检查短语/受限句式家族、频率和语境例外，保存误报证据。/preferences 从至少两条实际反馈提议规则，或手动添加；确认才进入后续生成，编辑需重新确认。作用域与冲突可见。

核心 API：/api/projects、/api/sessions、/api/sessions/:id、/api/sessions/:id/candidates、/api/jobs、/api/jobs/:id/complete、/api/feedback、/api/feedback/undo、/api/annotations、/api/revisions。

隐私控制：会话比较页进入“导出或永久清除本会话数据”，可先导出该会话，再明确勾选永久清除反馈、文档与关联模型输入缓存；依赖该证据的规则停用并清除旧证据文本。模式复核可在模式页逐条清除。独立的 Skill 包、盲测快照和另行复制的材料需分别处理；外部提供商保留的数据受其政策约束。

统一返回 {data,error,request_id}。写操作接收 Idempotency-Key，同一键不同输入返回 409；项目/会话修改使用 expected_version。后台生成返回 job_id。密钥不返回浏览器；日志只包含 request_id 与错误代码，不记录私人原文或模型错误响应。

## 测试与构建

先启动隔离测试库。测试拒绝数据库名不以 _test 结尾的地址；迁移和 seed 不清空已有测试数据。E2E 使用测试数据库及 3100 端口，默认不调用真实模型。

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

E2E 启动生产构建，因此先执行 pnpm build。先运行 `pnpm exec playwright install chromium`（Linux / CI 可用 `--with-deps`）。默认使用当前 Playwright 配套 Chromium；可设 `E2E_BROWSER_CHANNEL=msedge` 验证系统 Edge。本机 Edge 自动化 ZIP 下载曾间歇取消，配套 Chromium 和 CLI 下载路径另行验证；不关闭浏览器安全防护。CI 见 .github/workflows/ci.yml。

pnpm build 强制先执行 core 和 Web 的完整类型检查，然后 Next 编译。Next 内重复类型检查关闭，以免同时保留多个编译堆；直接绕过根命令执行 next build 不属于验证路径。

真实 Ollama 冒烟测试需手动 opt-in（自行准备模型）：PowerShell 设置 `$env:RUN_REAL_MODEL_TEST='true'` 后 `pnpm test tests/models.test.ts`。缺少配置时明确 skip；HTTP 契约单测的替身不算真实调用证据。

Skill 格式验证：PowerShell 先设 `$env:PYTHONUTF8='1'`，再运行本机 skill-creator 的 quick_validate.py，参数为 .agents/skills/skillforge。它只证明格式合法；真实宿主发现/调用证据另见实施状态。

`pnpm skill:package` 校验并打包 `.agents/skills/skillforge/`，产出 `dist/skillforge-<version>.zip` 与同名 `.zip.sha256`，默认复制到 `~/.minimax/skills/skillforge/`（`--host` 可换目标，`--no-install` 跳过），并写入指向本仓库的 `service-config.json`。`dist/` 不入版本库。

## 排错与数据保留

- 数据库不可用：检查 55432/55433、DATABASE_URL，执行迁移与 seed。页面显示统一错误，不悄悄使用浏览器本地状态代替。
- **Windows 便携 PostgreSQL 起不来后端进程**：日志出现 `could not reserve shared memory region ... error code 487` 或 `client backend ... terminated by exception 0xC0000142`，是宿主内存紧张导致 Windows DSM 固定地址预留失败，postmaster 随后重置全部连接。PG 18 的 Windows 版只接受 `dynamic_shared_memory_type=windows`，改参数无效；此时改用 `docker compose --profile test up -d --wait` 的容器版 PostgreSQL 17 绕开。两种数据库端口相同，只能选其一。
- 内存紧张：PowerShell 设置 `$env:PNPM_MAX_WORKERS='1'` 和 `$env:NODE_OPTIONS='--max-old-space-size=384 --max-semi-space-size=2'` 后重试。Web 启动器限制 Rayon/UV 并发，构建使用单 worker。
- 同一幂等键修改输入报 409 是预期行为：相同操作重试保留 key，新操作使用新 key。
- 关闭终端后 provider job 仍在数据库；重启 worker 可恢复过期租约。取消已完成任务返回 409。
- 数据在 Compose volume 或 .local/pg-dev；文件在 STORAGE_DIR（默认 storage）。用 PostgreSQL pg_dump 与私密对象目录一起备份；不要用 docker compose down -v 或删除数据目录来排错。应用级 JSON 备份位于 /settings。

规范：[PROJECT_SPEC.md](PROJECT_SPEC.md) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) · [ACCEPTANCE_FIXTURES.md](ACCEPTANCE_FIXTURES.md) · [决策](docs/DECISIONS.md) · [实际状态](docs/IMPLEMENTATION_STATUS.md)。
