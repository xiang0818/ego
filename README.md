# ego — Git 多身份管理 CLI

全局 Git 管理工具：多身份注册表、一键绑定仓库、构建提交推送、打 tag、SSH 账号校验。

## 安装（全局）

```bash
cd ego
npm install -g .          # 或 npm link，安装后任意目录可用 `ego`
```

## 快速上手

```bash
# 1. 生成身份密钥（放 ~/.ssh/，并注册到 users）
ego key-new <user> --email <you@example.com>
#    把输出的公钥添加到你的 Git 平台（如 GitHub → Settings → SSH and GPG keys）

# 2. 在仓库里绑定身份（写入该仓库 .git/config，不污染全局）
cd 你的项目
ego init <user>

# 3. 日常：提交 + 推送
ego publish "修复xx" --yes
```

> 下文 `<user>` 指你在 `ego users` 里注册的身份名（如 `work`、`personal`），请替换成你自己的。

### 目录还没纳入 Git 管理？

`ego init` 会**先检测当前目录是否在 Git 仓库内**，不在就先提示并引导初始化：

```bash
cd 新目录
ego init work
# ⚠ 当前目录没有 Git 管理（未检测到 .git 仓库）。
#   目录: /path/to/新目录
#
#   初始化项目的方式（任选其一）:
#     1) 只建仓库:                git init
#     2) 建仓库 + 绑定 + 初始提交:  ego start <user>
#   完成后再运行 `ego init work` 绑定身份即可。
#
# 是否现在执行 git init 初始化当前目录? (Y/n):
```

- 回答 `Y`（或直接回车）→ 先 `git init`，再继续完成身份绑定；
- 回答 `n` → **中止且不产生任何副作用**，并打印后续步骤；
- 非交互环境（无 TTY，如 CI / agent 驱动）：不会提问（避免卡死），直接报错并给出步骤；
  要自动初始化就显式加 `--init`（或 `--yes`）。
- 未安装 git 时会提示安装 Git 并中止。


## 命令

```
身份管理
  users                             列出已注册身份（含各身份绑定的仓库数）
  keys                              列出 ~/.ssh 密钥，标出已绑定/未绑定
  add <user> --name 名字 --email 邮箱 --key 密钥   注册身份
  key-new <user> [--email 邮箱]     生成 SSH 密钥并注册
  remove <user>                    删除身份（删除前先确认并解除其仓库绑定）
  show <user>                      查看身份详情
  set-global <user>                把某身份设为全局 git 身份（写 --global 配置）

仓库绑定
  init <user> [--init] [--yes]     当前仓库绑定身份（可省略 user，按远程所有者推断；
                                   非 git 目录会先提示并引导初始化，--init/--yes 自动 git init）
  switch <user> [--init] [--yes]   同 init
  remote [url]                     查看/绑定/修改 origin
  start <user> [remote]            一键初始化新项目（git init + 绑定 + 初始提交 + 展示 log）
  repos [user]                     列出仓库绑定（已删除的仓库会标注）
  check [--prune]                  校验仓库实际身份与记录是否一致；--prune 清理失效记录
  sync [user] [--dry-run] [--yes]  把身份的 name/email/key 变更同步到其全部绑定仓库
  verify                           校验当前密钥绑定的 Git 账号（ssh -T）
  whoami                           快速查看当前仓库/全局身份
  scan [目录]                      批量扫描目录下各仓库的绑定归属

取数（按身份拉取，SSH 远端才靠密钥切身份）
  clone <user> <地址> [目录] [--no-bind]   用该身份克隆（密钥仅本次认证用），成功后自动绑定身份
  pull [user] [--rebase] [--ff-only]      用该身份 fetch + 合并（省略 user 则用仓库绑定）
  fetch [user] [--all] [--prune]          只更新远端引用，不合并
  ls-remote <user> [地址]                 验证该身份能否访问远端（零副作用）

提交/推送
  status                           工作区状态 + 当前身份
  commit ["信息"] [--build] [--yes] [--force]   构建(可选)+hooks+暂存+提交
  push                             推送
  publish ["信息"] [--build] [--yes] [--force]  构建(可选)+提交+推送
  release [版本号]                  打 tag（默认读 package.json version）+ 推送

备份/恢复
  export [--with-keys] [路径]      导出身份 + 仓库绑定清单（可选含 SSH 私钥）
  import <备份文件> [--yes]        恢复身份/密钥，并列出仓库重绑步骤
```

## 项目配置 `.git-tool.json`（可选，放项目根）

```jsonc
{
  "build": "npm run build",      // commit/publish 加 --build 时执行
  "beforeCommit": ["npm test"],  // 构建后的前置检查（可多个）
  "largeFileLimitMB": 50         // 大文件告警阈值
}
```

无 build 脚本的项目会自动跳过构建步骤。

## 通用参数

- `--build`：执行 `.git-tool.json` 里的 build（**默认不构建**，需要构建产物时显式加）
- `--yes`：非交互模式（自动生成提交信息、跳过确认，供 CI；`init`/`switch` 下等同自动 `git init`）
- `--force`：忽略敏感文件/大文件守卫
- `--init`：`init`/`switch` 专用，非 git 目录下无需确认直接执行 `git init`

## 安全守卫

`commit`/`publish` 会自动：
- 拦截可能敏感的文件被暂存（`.env*`、`*.pem`、`id_*`、`*.key`，**含中文等非 ASCII 路径**）
- 告警超过 `largeFileLimitMB` 的大文件（阈值与文件路径都以**仓库根**为基准，在子目录里提交同样生效）
- 提交前展示 `git diff --stat` 确认（`--yes` 跳过）

## 多账号

- 身份按仓库隔离：`init` 只写仓库级 `.git/config`（`user.name/email` + `core.sshCommand`）
- 不同项目用不同账号：各自 `ego init <对应身份>` 即可
- 每个身份对应一把独立 SSH 密钥（Git 平台一公钥只能绑一账号，天然一一对应）

## 按身份拉取数据（clone / pull / fetch / ls-remote）

拉取数据时，"身份"唯一的作用是 **SSH 认证用哪把私钥**（与提交作者无关）。所以这几个命令
通过 `GIT_SSH_COMMAND` 临时借用某个身份的密钥，**不改仓库绑定、不写 `.git/config`、用完即失效**：

```bash
# 用 work 身份克隆私有仓库（成功后自动把 work 绑定到新仓库）
ego clone work git@github.com:company/private-repo.git
ego clone work git@github.com:company/private-repo.git my-dir     # 指定目录
ego clone work git@github.com:company/private-repo.git --no-bind  # 只要代码，不绑定身份

# 先探通路（零副作用）：克隆/推送前确认"这个身份到底能不能访问"
ego ls-remote work                                  # 用当前仓库 origin
ego ls-remote work git@github.com:company/repo.git  # 指定地址

# 用某个身份拉取更新
ego pull work                 # fetch + 合并
ego pull work --rebase        # 变基式拉取
ego pull                      # 省略身份：沿用仓库绑定
ego fetch work --all --prune  # 只更新远端引用（含清理已删除分支），不合并
```

- **借用谁**：任何已注册身份（`ego users`）。借用的身份与仓库绑定不同时，ego 会明确提示
  "只借用 X 拉取，提交作者与绑定均不变" —— 正是"用另一个账号拉数据，但提交仍算自己"的场景。
- **边界**：只有 **SSH 远端**（`git@host:owner/repo.git`、`ssh://…`）才靠密钥切换身份；
  `https://` 由 Git 凭据管理器认证，ego 无法介入（会明确提示）；本地路径远端不需要密钥。
- **密钥校验**：SSH 远端时若密钥文件不存在／身份未配密钥，会在**联网前**直接报错，不等 git 抛晦涩的认证失败；
  https 与本地远端用不上密钥，因此这类远端不要求身份有密钥（也不会写 `core.sshCommand`）。

## 改了身份信息？记得 `ego sync`

仓库里的 `user.name/email/core.sshCommand` 是**绑定那一刻的快照**；`ego add` 只改注册表，
**不会**回头更新任何仓库（不跑 `sync` 的话，那些仓库会继续用旧邮箱提交，而且没有任何提示）：

```bash
ego add work --email new@example.com     # ① 改注册表
ego sync work --dry-run                  # ② 先看影响面：哪些仓库会被改成什么（不落盘）
ego sync work                            # ③ 落盘；该身份若是全局身份，同时刷新 --global 配置

ego sync                                 # 不带身份：同步全部身份
```

- **密钥轮换同理**：`key-new` 重新生成密钥后跑 `ego sync <身份>`，各仓库的 `core.sshCommand` 才会指向新密钥。
- `sync` 只写 `user.name/email`；`core.sshCommand` 仅在**该仓库按 SSH 认证**时写（https/本地远端不写，与 `ego check` 判定一致）。
- 目录不存在／不是 git 仓库的绑定记录会被跳过并列出（就是 `ego check` 里显示为 ❌ 的那种脏记录）。
- 同步完用 `ego check` 复核，应全绿。
- 注意：`sync` 只影响**以后**的提交；历史提交的作者不会变（要改历史得 `git filter-repo` 重写 + 强推，风险自负）。

## 备份与迁移（换设备）

```bash
# 导出身份 + 仓库绑定清单（可选 --with-keys 连同 SSH 私钥一起打包）
ego export                          # 默认输出到 ~/.git-tool/export-日期.json
ego export --with-keys my-backup.json

# 在新设备上恢复
ego import my-backup.json           # 恢复身份/密钥，并打印每个仓库的克隆+绑定步骤
ego import my-backup.json --yes     # 非交互，跳过冲突确认
```

> 私钥属最高敏感数据：`--with-keys` 导出的文件请加密保管，用后即删；公钥已绑平台账号，无需备份。

## 说明

- 依赖 Node.js ≥ 14、Git（含 ssh）
- 身份注册表存于 `~/.git-tool/users.json`
- 密钥默认放 `~/.ssh/`（`key-new` 自动生成；也可 `add` 手动指定已有密钥）

---

详细场景示例见 [GUIDE.md](GUIDE.md)。
