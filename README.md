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
  init <user> / switch <user>      当前仓库绑定/切换身份（init 可省略 user，按远程所有者推断）
  remote [url]                     查看/绑定/修改 origin
  start <user> [remote]            一键初始化新项目（git init + 绑定 + 初始提交 + 展示 log）
  repos [user]                     列出仓库绑定（已删除的仓库会标注）
  check [--prune]                  校验仓库实际身份与记录是否一致；--prune 清理失效记录
  verify                           校验当前密钥绑定的 Git 账号（ssh -T）
  whoami                           快速查看当前仓库/全局身份
  scan [目录]                      批量扫描目录下各仓库的绑定归属

提交/推送
  status                           工作区状态 + 当前身份
  commit ["信息"] [--build] [--yes] [--force]   构建(可选)+hooks+暂存+提交
  push                             推送
  publish ["信息"] [--build] [--yes] [--force]  构建(可选)+提交+推送
  release [版本号]                  打 tag（默认读 package.json version）+ 推送
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
- `--yes`：非交互模式（自动生成提交信息、跳过确认，供 CI）
- `--force`：忽略敏感文件/大文件守卫

## 安全守卫

`commit`/`publish` 会自动：
- 拦截可能敏感的文件被暂存（`.env*`、`*.pem`、`id_*`、`*.key`）
- 告警超过 `largeFileLimitMB` 的大文件
- 提交前展示 `git diff --stat` 确认（`--yes` 跳过）

## 多账号

- 身份按仓库隔离：`init` 只写仓库级 `.git/config`（`user.name/email` + `core.sshCommand`）
- 不同项目用不同账号：各自 `ego init <对应身份>` 即可
- 每个身份对应一把独立 SSH 密钥（Git 平台一公钥只能绑一账号，天然一一对应）

## 说明

- 依赖 Node.js ≥ 14、Git（含 ssh）
- 身份注册表存于 `~/.git-tool/users.json`
- 密钥默认放 `~/.ssh/`（`key-new` 自动生成；也可 `add` 手动指定已有密钥）

---

详细场景示例见 [GUIDE.md](GUIDE.md)。
