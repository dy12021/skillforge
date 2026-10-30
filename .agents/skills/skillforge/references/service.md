# 服务引导

`skillforge service status | start | stop` 管理本机 SkillForge 服务。三条命令都只操作本机，不下载模型，不调用付费 API。

## 状态文件

| 内容 | 位置 |
|---|---|
| 运行状态 | `%LOCALAPPDATA%\SkillForge\service.json`（可用 `SKILLFORGE_STATE_DIR` 改） |
| Web 日志 | `%LOCALAPPDATA%\SkillForge\web.log` |

状态文件记录 `baseUrl`、`port`、`pid`、`repo`、`startedAt`。CLI 解析服务地址时，优先级是 `SKILLFORGE_URL` → 状态文件的 `baseUrl` → `BASE_URL` → `http://localhost:3000`。

## 仓库定位

`service start` 按顺序找 SkillForge 仓库，找到第一个就停：

1. 环境变量 `SKILLFORGE_HOME`
2. Skill 目录下的 `service-config.json` 的 `repo` 字段（全局安装时由安装脚本写入）
3. 状态文件里记录的 `repo`
4. 从 Skill 目录向上逐层找含 `pnpm-workspace.yaml` 与 `apps/web/package.json` 的目录
5. 从当前工作目录向上同样查找

一个都找不到时报 `REPO_NOT_FOUND`，**不会**启动任何进程、也不会猜一个路径当真。

## 启动顺序

`service start` 幂等：服务已经在跑就直接报告 `already_running: true`，不重复启动。否则依次执行：

1. **数据库** —— 先看 `DATABASE_URL`（默认本机便携库 55432）指向的端口有没有进程在监听。
   - 已经在监听（常见于 Docker Compose 的库已在跑）→ **跳过启动**，不碰它。
   - 没有监听 → 先跑 `scripts/local-postgres.ps1 start`（项目自带便携 PostgreSQL）。
   - 便携库起不来（例如端口被别的实例占着）→ 回退 `docker compose up -d --wait db`。
   - 两条路都失败才报错，并附带两条命令的真实 stderr/stdout。

   ⚠️ **监听着不等于是用户的数据**。便携库在 `.local/pg-dev`（端口 55432），Docker 版在 `skillforge_data` 卷（同样 55432），两边数据互不相通。探测到端口已被占用时，要问用户"用哪边已有的数据"，不要默认空库就是他要的。

2. `pnpm db:migrate` —— 应用迁移，不在业务代码里建表。
3. `pnpm db:seed` —— 只初始化单用户 workspace，不伪造项目、反馈或规则，重复执行安全。
4. `pnpm build` —— 仅在 `apps/web/.next/BUILD_ID` 缺失时执行。这一步最慢。
5. 挑端口 —— 优先 `SKILLFORGE_PORT` 与状态文件里的端口，其次 3000；被占用则顺延到 3001-3099 内的空闲端口。
6. `node scripts/web.mjs start -p <port>` —— 后台启动，同时注入 `PORT` 与 `BASE_URL=http://127.0.0.1:<port>`。
7. 轮询 `/api/health`，最多等 180 秒。超时返回 `WEB_START_TIMEOUT` 并附日志尾部。

任一步失败立刻返回真实错误（退出码与 stderr/stdout 片段），不会留下"已启动"的说法。

返回结果里的 `database_start` 会说明数据库是怎么来的：`already-listening` / `local-postgres.ps1` / `docker compose`。

## 停止

`service stop` 只终止**本服务记录的那个 PID**，且先确认该 PID 仍占用记录的端口；不是就不动任何进程。数据库保持运行。端口占用核对用 `netstat -ano -p tcp`。

## 排错

| 现象 | 处理 |
|---|---|
| `REPO_NOT_FOUND` | 设 `SKILLFORGE_HOME` 指向仓库根目录，或在 Skill 目录放 `service-config.json` |
| `启动项目数据库失败` | 看 `stdout`/`stderr`；确认 55432/55433 未被别的 PostgreSQL 占用（Docker 与便携版只能选其一） |
| Windows 上 PostgreSQL 后端起不来 | 日志出现 `could not reserve shared memory region ... error code 487` 或 `terminated by exception 0xC0000142`，是宿主内存不足导致 Windows DSM 固定地址预留失败；用 `docker compose --profile test up -d --wait` 跑容器版 PostgreSQL 绕开 |
| `生产构建失败` | 内存不足时设 `$env:PNPM_MAX_WORKERS='1'` 与 `$env:NODE_OPTIONS='--max-old-space-size=384 --max-semi-space-size=2'` 后重试 |
| `WEB_START_TIMEOUT` | 读 `%LOCALAPPDATA%\SkillForge\web.log` 尾部；确认 `DATABASE_URL` 与实际库一致 |
| 页面报错但端口在听 | 该端口可能是别人的服务；以 `service status` 返回的 `url` 为准，`http_status` 非 200 也说明不是 SkillForge |
| 需要应用内 provider | 另开终端跑 `pnpm worker`；默认 mock 只是固定演示样例，不是真实生成 |

## 数据与隐私

数据库在 `.local/pg-dev`（便携模式）或 Compose volume；业务文件在 `STORAGE_DIR`（默认 `storage`）。排错时**不要**执行 `docker compose down -v` 或删除数据目录。应用级 JSON 备份在 Web 的 `/settings` 页面。
