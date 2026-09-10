# ego Skill — 使用文档

本目录提供 **`ego` skill**：一份可分发的能力包，让 Claude Code / oh-my-Codex 等
基于 "skills 目录 + `SKILL.md`" 约定的 agent 学会正确使用
[`ego`](https://github.com/xiang0818/ego)（Git 多身份管理 CLI）：身份绑定、按身份提交推送、
SSH 账号校验、一致性审计与备份迁移。

> 仓库只维护**源文件**，不主动安装到任何机器；需要的人按下面步骤自己拷过去。

## 目录结构

```
skills/
├── ego/
│   └── SKILL.md      # skill 本体（frontmatter 含 name/description/aliases）
└── README.md         # 本文档
```

整个 `ego/` 目录即为一个完整 skill，拷贝时**整个目录**一起拷。

## 它能做什么（给 agent 的核心能力）

- 在提交/推送前先判断"当前仓库以谁的身份操作"（`ego whoami` / `ego status`）
- 绑定/切换/初始化身份（`ego init` / `switch` / `start`）；目录还没纳入 Git 管理时，
  `init` 会先提示「没有 Git 管理」并引导初始化（交互提问，或 `--init`/`--yes` 自动 `git init`）
- 带守卫的提交推送打 tag（`ego commit` / `publish` / `release`），含敏感文件与
  大文件拦截、身份漂移中止、`--yes` 非交互约定
- 密钥与账号校验（`ego verify` / `check` / `scan`）
- 备份迁移（`export` / `import`）的安全注意事项

## 安装

### 方式 A：用户级（推荐，所有项目生效）

把 `ego` 目录拷入你的 skills 根目录：

```bash
# macOS / Linux
mkdir -p ~/.claude/skills
cp -r skills/ego ~/.claude/skills/ego

# Windows (PowerShell)
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills" | Out-Null
Copy-Item -Recurse skills\ego "$env:USERPROFILE\.claude\skills\ego"
```

> oh-my-Codex 复用同一套 `~/.claude/skills/` 约定，同样生效。

### 方式 B：项目级（只在本仓库生效）

```bash
mkdir -p .claude/skills
cp -r skills/ego .claude/skills/ego
```

### 方式 C：其它 agent 系统

本 skill 是纯 Markdown（YAML frontmatter + 指令正文），任何能加载自定义指令的
agent 都可把 `SKILL.md` 的内容作为技能/角色说明注入，或按你的平台惯例放到对应
skills 目录（参考各自文档的 "skills directory" 约定）。

## 验证是否生效

1. 新开一个会话（skills 通常在会话启动时扫描加载）。
2. 问 agent 一句：*"你认识 ego 吗？列出它的 3 个常用命令"*。
   若答得出 `users` / `init` / `publish` / `verify` 等，说明已加载。
3. 或在用户级目录确认文件就位：

```bash
ls ~/.claude/skills/ego/SKILL.md
```

## 触发方式

agent 是否自动调用由 `SKILL.md` frontmatter 的 `description` / `aliases` 决定：
命中"多 Git 账号、身份名、ego、按账号提交推送"等语义即触发；也可直接指名
`ego` 要求它按 skill 执行。

## 更新 / 卸载

- **更新**：重新拷贝覆盖 `SKILL.md` 即可（本仓库会随 ego CLI 行为演进同步修订）。
- **卸载**：删除对应目录 `~/.claude/skills/ego`（或 `.claude/skills/ego`）。

## 事实来源与维护约定

- skill 中的命令、参数、守卫行为均以仓库内 `bin/ego.mjs`、`lib/commands.js`、
  `lib/config.js` 的实现为准（README/GUIDE 为辅）。
- **改 ego CLI 行为时，请同步检查并更新本 skill**，避免教给 agent 过期用法。
  建议对照检查点：新增/改名命令、参数与 flag、交互提示是否变成 `--yes` 可跳过、
  守卫规则（敏感文件/大文件）变化、注册表字段变化。
