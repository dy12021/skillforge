# 宿主目录映射

`skill install <zip> --host <名称>` 按此表定位安装目录。未知名称直接报错，不猜路径。

| host | 安装目录 | 适用宿主 |
|---|---|---|
| `minimax` | `~/.minimax/skills/` | MiniMax Code（本机默认） |
| `codex` | `~/.codex/skills/` | Codex |
| `agents` | `~/.agents/skills/` | OpenCode 用户级、通用 agents 约定 |
| `project` | `<当前目录>/.agents/skills/` | 只装进当前项目，不污染全局 |

`opencode` 是 `agents` 的别名。

## 两种装法怎么选

- **用户级**（`minimax` / `codex` / `agents`）：所有项目都能用。装之前先确认该宿主确实读这个目录——本机 `~/.minimax/skills/`、`~/.codex/skills/`、`~/.agents/skills/` 都已存在且被读取。
- **项目级**（`project` 或 `--target`）：只在该仓库生效，适合"这个项目的特定写法"。

## 安装规则

- 只装本机目录，拒绝网络共享路径与符号链接。
- 目标已存在时报错，**不覆盖**。用 `--name <新名称>` 换名安装，旧的保留以便回退。
- 不执行包内脚本。
- 校验离线完成：`skill validate` 只做 YAML、引用、路径与完整性检查。

## 本 Skill 自身的位置

本包（SkillForge 训练入口）的规范位置是仓库内的 `.agents/skills/skillforge/`——那是 OpenCode / Codex 支持的项目级发现目录。

要让 MiniMax Code 直接加载，用仓库的打包脚本装到 `~/.minimax/skills/skillforge/`：

```sh
pnpm skill:package
```

脚本会生成 `dist/skillforge-<version>.zip` 与同名 `.sha256`，并把包复制到 `~/.minimax/skills/skillforge/`，同时写入 `service-config.json` 指向本仓库，好让 `service start` 能定位到它。
