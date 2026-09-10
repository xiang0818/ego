---
name: ego
aliases: [ego-cli, git-identity, git-multi-identity]
description: Use the `ego` CLI — a Git 多身份管理工具 (identity registry + per-repo identity binding + guarded commit/push/tag + SSH account verify + audit + backup/migrate) — whenever a repo task involves multiple Git identities or accounts: binding a repo to an identity (`ego init`/`switch`/`start`), committing/publishing under a specific user (`ego commit`/`publish`/`release`), checking which identity a repo uses, or verifying SSH keys. Triggers: 用户提到 ego、身份名（work/personal/用户名）、多 Git 账号、按账号归属提交/推送、git commit 要带某身份。Do NOT use for fine-grained partial staging or non-Git credential tasks.
---

# ego — Git 多身份管理 Skill

教 agent 在**用户的任意项目**里用全局 `ego` CLI 完成"按身份提交推送"的 Git 工作，
并守住身份一致性与安全守卫。**先读取本 Skill 全篇再操作**；文中命令都已按
`bin/ego.mjs` + `lib/commands.js` 的实现核对，不要臆造参数。

---

## 0. 心智模型（必读）

- **身份注册表**：`~/.git-tool/users.json`，每个身份 = `{ name, email, key, isGlobal? }`。
- **身份 ↔ 密钥 一一对应**：每个身份有一把独立 SSH 私钥（默认 `~/.ssh/id_ed25519_<user>`）。
  平台账号一公钥只能绑一个账号，因此"绑了哪把密钥"就决定了提交身份。
- **绑定是仓库级的**：`ego init` 只写当前仓库 `.git/config`（`user.name/email` +
  `core.sshCommand`，命令形如 `ssh -i "<key>" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`），
  并把这个仓库根目录记入注册表的 `repos`；**不污染全局配置**（`ego set-global` 除外）。
- **身份由仓库决定，不由当前 shell 决定**。同一个终端里不同项目可以是不同作者。
- **`init`/`switch` 会先做 Git 环境检测**：当前目录不在 Git 仓库内 → 打印"没有 Git 管理"提示
  + 初始化指引，并引导初始化（交互提问 / `--init` / `--yes` 自动 `git init`）；
  **无 TTY 且未给 flag 时直接报错**（不提问、不挂住）。
- 输出为中文；出错时打印 `错误: <msg>` 并以非 0 退出。

**前置检查**：先确认环境里装没装 `ego users`。
- 能列出/提示空列表 → 可用。
- 报 `command not found` → **不要假装可用**，提示用户从 ego 仓库安装：
  `cd <ego 仓库> && npm install -g .`（依赖 Node ≥ 14、git、ssh）。

---

## 1. 什么时候用 / 什么时候别用

**用**（命中其一即先走本 Skill 的流程，先 `ego whoami` 看当前身份上下文）：
- 用户提到身份名、邮箱、平台账号/owner（如 work、personal、github 用户名）；
- 提交/推送/打 tag 前需要确认"这次以谁的身份提交"；
- 仓库疑似绑错身份、push 报权限错误、换绑定；
- 在**非 git 目录**跑 `ego init` 报「没有 Git 管理」，或 ego 询问"是否现在执行 git init"；
- 多账号仓库审计、一致性校验、备份迁移。

**别用 / 用普通 git 代替**：
- 精确的部分暂存（只提交几个指定文件、挑 hunks）→ ego 提交是全量 `git add -A`，
  这种需求用原生 `git add <path>` + `git commit`；
- 需要 GitHub/GitLab API 凭据、token 之类的操作（ego 不碰这些）；
- 纯读操作（log/diff/fetch/rebase）→ 原生 git 即可，ego 负责的是"身份 + 守卫 + 记录"。

---

## 2. 工作流

### W1 提交 / 推送（最高频）

```bash
# 0) 先确认身份上下文（在仓库根目录）
ego whoami        # 当前仓库绑定身份 + 全局身份
ego status        # git status + 当前 user.name <email>

# 1) 仓库还没绑定/绑错了 → 见 W2，先 `ego init <身份>` 或 `ego switch <身份>`

# 2) 交互式（有 TTY，人在场）：给明确提交信息
ego commit "修复登录 bug"          # 只提交
ego publish "发布搜索排序修复"       # 提交 + push

# 3) 非交互/无人确认（agent 驱动、CI、无 TTY）：必须带 --yes，否则交互提示会卡住
ego publish "修复登录 bug" --yes

# 4) 需要构建产物时追加 --build（读项目 .git-tool.json 的 build；默认不构建）
ego publish "更新构建产物" --build --yes

# 5) 打 tag + 推送（默认取 package.json 的 version，自动补 v 前缀）
ego release                 # → v<package.json version>
ego release 1.2.3
```

**`ego commit`/`publish` 实际做了什么**（按序，勿跳过/假设）：
1. **身份漂移检查**：比对仓库记录的身份 vs `.git/config` 实际 user.name/email/密钥。
   不一致 → **中止**并提示 `ego switch <正确身份>`（除非显式 `--force`）。
2. `build`（仅当加了 `--build`）→ `beforeCommit` 钩子（`.git-tool.json` 里配了**就会跑**）。
3. `git add -A`（**全量暂存**，含删除与生成物）。
4. 安全守卫：暂存了敏感文件（`.env*`、`*.pem`、`id_*`、`*.key`）或超过
   `largeFileLimitMB`（默认 50）的大文件 → 警告/中止，需确认或 `--force`。
5. 展示 `git diff --cached --stat` 确认（`--yes` 跳过）。
6. `git commit -m <信息>` → 打印最近 3 条 log。
   - 给了信息就用；交互模式没给会提示输入；`--yes` 没给会生成
     `chore: 更新 N 个文件（<文件名>…）`——**尽量自己给有意义的提交信息**。

**注意**：若守卫在 `add -A` 之后中止，改动会停留在已暂存状态，修正后重跑即可
（不要重复 `git add` 也无妨；必要时可 `git reset` 退回）。

### W2 绑定 / 切换 / 新项目

```bash
ego init <身份>            # 当前仓库绑定身份（只写本仓库 .git/config）
ego init <身份> --init     # 非 git 目录：不用确认，先自动 git init 再绑定
ego init <身份> --yes      # 同上（--yes 在 init/switch 下也等同自动 git init）
ego switch <身份>          # init 的别名，语义完全相同
ego init                   # 省略 <身份>：仅当 remote origin 所有者与某已注册身份
                           # 大小写不敏感精确匹配时才可推断，否则报错——不要猜
ego remote [url]           # 查看 origin / 绑定或改 origin
ego start <身份> [remote]  # 新项目一键：git init(如需要) + 绑定 + 初始提交 + 展示 log
```

关键行为与坑：
- **非 git 目录下的 `init`**（本 Skill 最常见的排查点）：目录不在 Git 仓库内时，ego 先打印
  `⚠ 当前目录没有 Git 管理（未检测到 .git 仓库）` + 初始化指引（`git init` 或 `ego start <user>`），
  然后按环境分流：
  - **有 TTY**：提问 `是否现在执行 git init 初始化当前目录? (Y/n)`；回车/`y` → 先 `git init`
    再继续绑定；`n` → 中止且无副作用（非 0 退出）。
  - **无 TTY（agent/CI 调用）**：**不提问，直接报错**并给出步骤。所以 agent 在非 git 目录要么
    先跑 `git init`，要么显式 `ego init <身份> --init`（或 `--yes`）——**不要把这条报错当随机失败反复重试**。
  - **没装 git**：提示安装 Git（含 ssh）后中止，不去猜别的失败原因。
- 检测按 git 语义：**当前目录属于上层某个仓库时视为"已在仓库内"**（绑定落在上层仓库根目录的
  `.git/config`），别因为"这个目录里没有 `.git`"就断言"没有 Git 管理"——先 `git rev-parse --show-toplevel` 看真实根目录。
- 自动/手动 `git init` 都只建仓库、不产生提交；要"建仓库+绑定+初始提交"用 `ego start`。
- `start` 对**已有提交且已绑定其它身份**的仓库会**拒绝**并提示改用 `ego switch`——
  不要绕路（别用 `git init`/改 config 硬来），按它说的 `switch`。
- 空目录 `start` 会生成 `.gitignore`（node_modules/.DS_Store）并提交
  `chore: 初始化项目`，建 `main` 分支。
- 已有提交的仓库 `start`：只绑定身份，跳过初始提交。
- `init` 绑定后若 remote 所有者疑似另一身份会打印 ⚠ 提醒，注意核对。
- 用户没指定身份、又推不出唯一身份时：**问用户**，不要自作主张挑一个。

### W3 身份管理（涉及密钥、影响面大，谨慎操作）

```bash
ego users                # 已注册身份 + 各绑定仓库数（★ = 全局身份）
ego keys                 # ~/.ssh 密钥清单，标出已绑定/未绑定
ego show <身份>          # 详情：name/email/key、key 是否存在、绑定仓库
ego key-new <身份> [--email 邮箱]
ego add <身份> --name "名字" --email "邮箱" --key "~/.ssh/xxx"
ego set-global <身份>    # 设为全局 git 身份（写 --global 配置）
ego remove <身份> [--yes]  # 删除身份并解除其全部仓库绑定
```

- `key-new`：生成 `~/.ssh/id_ed25519_<身份>`（ed25519、无口令），注册并把**公钥打印出来**。
  公钥必须由**用户**贴到平台（GitHub → Settings → SSH and GPG keys）。agent 无法代加，
  把公钥原样展示给用户即可。
- **同用户名重跑 `key-new` 会覆盖已有密钥文件**（ssh-keygen 会交互确认，无 TTY 时可能
  卡住/失败）。已有密钥/身份时先 `ego keys`/`ego show` 核对，用 `ego add` 注册已有密钥更安全。
- `remove` 会列出受影响仓库并要求确认（`--yes` 跳过）；它**只删注册表与绑定记录，
  不回滚仓库 `.git/config`**——被删身份的仓库里 git 作者配置仍在，需提醒用户。
- `set-global` / `remove` 影响面大，agent 不应擅自执行，先向用户确认。

### W4 校验与一致性审计

```bash
ego verify              # 用当前仓库密钥对 origin 所属主机做 ssh -T；
                        # 出现 "Hi <用户名>!" 即校验成功（ssh -T 总是非 0 退出，属正常）
ego check [--prune]     # 逐仓库核对记录 vs 实际身份；--prune 清理已删除仓库的失效记录
ego scan [目录]         # 批量扫描目录下各仓库的记录/实际归属
ego repos [身份]        # 查看绑定清单（已删除的仓库会标注）
```

push 报 `Permission denied (publickey)` 时的排查顺序：
`ego show <身份>`（密钥存在？）→ `ego verify`（账号通不通？）→ 提示用户检查平台公钥是否添加。

### W5 备份 / 迁移（换设备）

```bash
ego export [--with-keys] [路径]   # 默认 ~/.git-tool/export-日期.json
ego import <备份文件> [--yes]      # 恢复身份/密钥，并打印每仓库的 clone + init 步骤
```

- 不带 `--with-keys` 不含私钥；带私钥的备份文件**务必提醒用户加密保管、用后即删**。
- 绑定记录里存的是**绝对路径**，迁移后不可直接复用——真正可移植的是
  「remote 地址 + 身份」，import 后按清单 `git clone` + `ego init <身份>`。

---

## 3. 命令速查表

| 场景 | 命令 | 关键参数 |
|---|---|---|
| 看身份/绑定 | `whoami` `status` `users` `keys` `show <u>` | |
| 绑定/换绑/新项目 | `init [u]` `switch <u>` `start <u> [remote]` `remote [url]` | init 省略 u 需唯一推断；非 git 目录加 `--init`/`--yes` 自动 `git init` |
| 提交 | `commit ["msg"]` | `--build` `--yes` `--force` |
| 提交+推送 | `publish ["msg"]` | 同上 |
| 推送 / 打 tag | `push` / `release [版本]` | `release` 默认读 package.json |
| 校验/审计 | `verify` `check [--prune]` `scan [dir]` `repos [u]` | `check --prune` 需确认 |
| 身份增删 | `add <u> --name --email --key` `key-new <u> [--email]` `remove <u>` `set-global <u>` | `remove` 默认要确认 |
| 备份/恢复 | `export [--with-keys] [路径]` `import <文件>` | |

项目配置 `.git-tool.json`（放项目根，可选）：

```jsonc
{
  "build": "npm run build",      // 仅加 --build 时执行
  "beforeCommit": ["npm test"],  // commit/publish 时总会执行
  "largeFileLimitMB": 50         // 大文件告警阈值
}
```

---

## 4. 铁律（Do / Don't）

**Do**
- 动手前先 `ego whoami` 确认身份上下文；拿不准就问用户。
- 在非 git 目录要绑定时：先 `git init`，或直接用 `ego init <身份> --init`；无 TTY 下不带 flag
  会被明确拒绝（这是设计如此，不是故障）。
- 无 TTY/无人确认的自动化里一律带 `--yes`（并给明确提交信息），防交互卡死。
- 展示给用户的公钥原样输出，别截断别改格式。
- 修复身份问题优先用 ego 自己的命令（`switch`/`init`），别手改 `.git/config`。
- `verify` 用 ssh -T 校验账号后再让用户 push。

**Don't**
- ❌ 手改 `~/.git-tool/users.json`——一律用 `add`/`key-new`/`remove`。
- ❌ 用裸 `ssh-keygen` 造身份密钥（不会注册进 ego，身份是散的）。
- ❌ 未装 git 或不在 Git 仓库时，绕过 ego 的检测提示硬凑一个"成功"结果（例如自己拼 `git config` 命令）。
- ❌ 擅自 `--force` 绕过敏感文件/大文件守卫——只在用户明确要求时用。
- ❌ 在已绑定其它身份的仓库上 `start`/重复 `init`——按提示用 `switch`。
- ❌ 身份不确定时猜一个提交；宁可不提交并问用户。
- ❌ 把带私钥的导出文件留在工作区/公开位置。

---

## 5. 与原生 git 的边界

- 原生 git 的读操作、分支、rebase、精细暂存照常直接做；
- 提交入口二选一：简单全量提交通道用 `ego commit/publish`（有守卫与记录）；
  需要精确控制暂存内容时用原生 git（此时仍应先用 `ego whoami` 确认仓库身份正确）。
- 想让某次提交换作者而**不换绑定**？先和用户确认意图——ego 的模型是
  "仓库级身份一致"，需要临时替身提交属于原生 git `-c user.name=...` 的活，且要明确告知用户风险。
