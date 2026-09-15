# ego 使用手册

> 说明：本文示例使用占位符 `<user>`、`work`、`personal`、`<you@example.com>`、`git@github.com/<owner>/<repo>.git`，请替换成你自己的身份名、邮箱与仓库地址。

## 0. 安装与准备

```bash
cd ego
npm install -g .
ego users            # 首次应显示「未注册任何身份」
```

依赖：Node.js ≥ 14、Git（含 ssh）。

---

## 1. 首次使用：注册第一个身份

```bash
# 一键生成 SSH 密钥到 ~/.ssh/ 并注册
ego key-new work --email work@example.com
# 输出公钥（id_ed25519_work.pub 内容），把它添加到你的 Git 平台
#   GitHub: Settings → SSH and GPG keys → New SSH key

# 也可注册已有密钥
ego add work --name "My Work Name" --email "work@example.com" --key "~/.ssh/id_ed25519_work"

ego users            # 看到 work 已注册
```

---

## 2. 多账号：一个工作、一个个人

```bash
# 生成两个身份，各自独立密钥
ego key-new work --email work@example.com
ego key-new personal --email personal@example.com

# 工作项目绑定 work
cd ~/work/project-a
ego init work

# 个人项目绑定 personal
cd ~/personal/project-b
ego init personal

# 全局身份设为 work（新仓库默认用它）
ego set-global work

# 一眼看清全局看板
ego users            # work ★全局、personal
ego whoami           # 当前仓库身份 + 全局身份
```

---

## 3. 新建项目：一条命令初始化

```bash
mkdir ~/personal/new-project && cd ~/personal/new-project
ego start personal
```

自动完成：`git init` → 绑定 personal → 空目录生成 `.gitignore` → 初始提交 `chore: 初始化项目` → 展示 git log。

带远程：

```bash
ego start personal git@github.com:personal-owner/new-project.git
```

若目录**已有提交记录**：只绑定身份、跳过初始化/提交，并提示已有远程；若已绑定其它身份会**拒绝**并提示改用 `ego switch`。

---

## 4. 已有项目：绑定 / 切换身份

```bash
# 手动绑定（省略 <user> 时按远程所有者自动推断）
cd ~/work/project-a
ego init work

# 换绑
ego switch personal
```

`init` 推断示例：

```bash
git remote -v        # origin  git@github.com:myowner/repo.git
ego init             # 自动推断 myowner 对应的已注册身份
```

### 4.1 目录还没有 Git 管理（没有 .git）

`ego init` / `ego switch` 会**先检测当前目录是否在 Git 仓库内**；不在就先提示并引导初始化，
而不是直接抛出 git 的原始报错：

```bash
cd ~/some/plain-dir
ego init work
# ⚠ 当前目录没有 Git 管理（未检测到 .git 仓库）。
#   目录: /home/you/some/plain-dir
#
#   初始化项目的方式（任选其一）:
#     1) 只建仓库:                git init
#     2) 建仓库 + 绑定 + 初始提交:  ego start <user>
#   完成后再运行 `ego init work` 绑定身份即可。
#
# 是否现在执行 git init 初始化当前目录? (Y/n):
```

三种处理方式：

| 场景 | 做法 |
|---|---|
| 人在终端，想就地初始化 | 回车或输入 `y` → 先 `git init`，随后自动完成身份绑定 |
| 不想在这里建仓库 | 输入 `n` → **中止且无副作用**，按提示先 `git init` 或改用 `ego start <user>` |
| CI / agent（无 TTY） | 不带参数会**直接报错并给出步骤**（不会卡在提问上）；要自动初始化加 `--init`（或 `--yes`） |

判定说明与坑：

- 检测按 git 语义进行：**子目录只要属于上层某个仓库，就算已有 Git 管理**（绑定的是该仓库根目录的
  `.git/config`），不会因为"当前目录里没有 `.git`"就误判为未纳入 Git 管理。
- 未安装 git 时给出安装指引（<https://git-scm.com/downloads>）并中止，不抛底层 `ENOENT`。
- 无论是自动还是手动 `git init`，都**只建仓库、不产生提交**；需要"建仓库 + 绑定 + 初始提交"
  一条龙请用 `ego start <user>`。

---

## 5. 远程管理

```bash
ego remote                       # 查看 origin
ego remote git@github.com:owner/repo.git    # 绑定（无 origin 时 add，有则 set-url 修改）
```

---

## 6. 校验与一致性

```bash
# 校验当前仓库密钥绑定的账号（ssh -T）
ego verify           # 输出 "Hi <用户名>!" 即绑定成功

# 校验所有已记录仓库：记录 vs 仓库实际身份是否一致
ego check
# 输出 ✅/⚠️/❌ 汇总；仓库已删除会标出

# 清理失效记录（仓库已删除）
ego check --prune

# 批量扫描某目录下所有仓库的绑定归属
ego scan ~/work
```

---

## 7. 删除身份

```bash
# 有绑定仓库时，先列出并确认后才会解除绑定并删除
ego remove personal
# 身份 personal 当前绑定 N 个仓库: ...
# 将删除身份 personal 并解除上述 N 个仓库的绑定，继续? (y/N):
#   y → 删除；n → 取消（不删任何东西）

# 非交互（CI）用 --yes
ego remove personal --yes
```

---

## 8. 提交 / 推送 / 打 tag

```bash
# 提交（默认不构建）
ego commit "修复了登录 bug"
ego commit --yes            # 非交互，自动生成提交信息

# 需要构建产物时加 --build
ego commit "更新构建产物" --build

# 提交 + 推送一步到位
ego publish "发布 v2" --yes

# 单独推送
ego push

# 打 tag（默认读 package.json version）+ 推送
ego release                # 等价 release 1.2.3 → tag v1.2.3
ego release 1.2.3
```

提交前守卫（`commit`/`publish` 自动触发）：
- 敏感文件（`.env*`、`*.pem`、`id_*`、`*.key`）被暂存 → 警告并需确认
- 超过 `largeFileLimitMB` 的大文件 → 警告并需确认
- 展示 `git diff --stat`（`--yes` 跳过）

项目级配置 `.git-tool.json`：

```jsonc
{
  "build": "npm run build",
  "beforeCommit": ["npm test"],
  "largeFileLimitMB": 50
}
```

---

## 9. CI / 脚本（非交互）

```bash
ego publish "自动化构建" --build --yes --force
# --yes 自动生成提交信息、跳过确认；--force 忽略敏感文件/大文件守卫
```

---

## 10. 备份与迁移（换设备）

```bash
# ① 旧设备：导出身份与仓库清单（可选连同 SSH 私钥）
ego export --with-keys ego-backup.json
#    身份定义 + 每个仓库的「远程地址 → 绑定用户」清单；
#    --with-keys 会把 ~/.ssh/ 对应私钥以 base64 打包进文件

# ② 将 ego-backup.json 安全转移到新设备（加密/私传，勿公开）

# ③ 新设备：安装 ego 后恢复
npm install -g .
ego import ego-backup.json
#    恢复身份注册表；含密钥则写回 ~/.ssh/；
#    并打印仓库重绑清单

# ④ 按清单逐个克隆并绑定
git clone git@github.com:owner/repo.git
cd repo && ego init <user>
```

**为什么仓库绑定关系是"清单"而不是绝对路径**：绑定记录里的路径是新旧设备不同的绝对路径，无法直接迁移；真正可移植的是「远程地址 + 用户」，克隆后各跑一次 `ego init` 即可。整目录拷贝时 `.git/config` 自带身份，绑定自动保留。

> 备份文件若含私钥（`--with-keys`），务必加密保存、用后即删。

---

## 11. 按某个身份拉取数据（clone / pull / fetch / ls-remote）

拉取数据时，"身份"唯一的作用是 **SSH 认证用哪把私钥**（和提交作者无关）。ego 通过
`GIT_SSH_COMMAND` 临时借用身份密钥：**不改仓库绑定、不写 `.git/config`、用完即失效**。

### 11.1 用某个身份克隆私有仓库

```bash
# 用 work 身份克隆（SSH 地址），成功后自动把 work 绑定到新仓库
ego clone work git@github.com:company/private-repo.git
# ▶ 使用身份 work（My Work <work@example.com>）克隆
#   密钥: ~/.ssh/id_ed25519_work（仅本次认证用）
# 已绑定身份 work 到新仓库: /path/to/private-repo

ego clone work git@github.com:company/private-repo.git my-dir      # 指定目录
ego clone work git@github.com:company/private-repo.git --no-bind   # 只要代码，不绑定身份
```

- 克隆后**自动完成绑定**（`user.name/email` + 记入 `ego repos`），之后 `cd` 进去直接 `ego publish`
  即可，不需要再跑 `ego init`；**SSH 远端**才会同时写入 `core.sshCommand`，
  https/本地远端会跳过该写入并打印提示（密钥在那些远端不生效）。
- 目录已存在且非空会**拒绝克隆**，不会覆盖你的文件。
- 远端 owner 疑似另一个已注册身份时会打印 ⚠ 提醒（和 `init` 一致）。

### 11.2 先探通路（零副作用）

克隆或推送前不确定"这个身份能不能访问"，先探测：

```bash
ego ls-remote work                                  # 用当前仓库 origin
ego ls-remote work git@github.com:company/repo.git  # 指定地址
# ✔ 身份 work 可访问该远端（远端引用 42 个）
# 失败则 ❌ + 最后几行 git/ssh 的错误原因，并以非 0 退出
```

它只读远端引用，不落盘、不改本地任何状态，比 `git clone` 试错便宜得多。

### 11.3 用某个身份拉取更新

```bash
ego pull work                 # fetch + 合并
ego pull work --rebase        # 变基式拉取
ego pull work --ff-only       # 只允许快进
ego pull                      # 省略身份：沿用仓库绑定/现有配置
ego fetch work --all --prune  # 只更新远端引用并清理已删除分支，不合并
```

借用身份与仓库绑定不同时，会明确提示：

```bash
cd ~/work/project-a          # 该仓库绑定 work
ego fetch personal --prune
# ▶ 使用身份 personal（Me <me@example.com>）
#   密钥: ~/.ssh/id_ed25519_personal（仅本次生效，不写入 .git/config）
#   注意: 本仓库绑定的是 work，本次只借用 personal 拉取；提交作者与绑定均不变。
```

这正是"**用另一个账号拉数据，但提交仍算自己**"的场景 —— 不需要 `ego switch`（那会换掉提交身份）。

### 11.4 边界与限制

| 远端类型 | 能否按身份切换 |
|---|---|
| `git@github.com:owner/repo.git`、`ssh://…` | ✅ 用该身份的私钥认证 |
| `https://…` | ❌ 由 Git 凭据管理器认证，ego 无法介入（会打印提示，不做假动作） |
| 本地路径 / `file://` | ➖ 本来就不需要密钥（会打印提示） |

- 身份未注册 → 直接报错，不会走到 git 的晦涩认证失败。
- **SSH 远端**才会要求身份已配密钥且密钥文件存在（不存在时在联网前报错）；
  https/本地远端用不上密钥，因此不要求身份配密钥。
- `ego pull` / `ego fetch` 的第一个位置参数是**身份名**，不是远端名/分支名：
  写 `ego pull origin main` 会得到一条自解释的报错（而不是被当成身份名默默失败）；要拉当前
  配置的远端直接 `ego pull`（不带参数）即可。
- 不认识的 `--xxx` 参数不会被静默忽略，会当成位置参数并给出明确报错（拼错 `--ff-only` 时能立刻发现）。

---

## 12. 常见问题

**Q: push 报 `Permission denied (publickey)`**
- 确认 `ego show <user>` 里 key 路径存在，且公钥已添加到对应平台账号
- 用 `ego verify` 校验；GitHub 提示 "Hi <用户名>!"

**Q: 仓库绑错了用户**
- 用 `ego switch <正确身份>` 换绑，不要用 `ego start`

**Q: 想用另一个账号拉一个私有仓库（但不换自己的提交身份）**
- `ego clone <那个身份> <地址>`，或先 `ego ls-remote <那个身份> <地址>` 探通路；见第 11 节

**Q: 换电脑/重装后，注册表还在吗**
- 身份注册表在 `~/.git-tool/users.json`，密钥在 `~/.ssh/`，记得一起备份迁移

**Q: 想用 HTTPS 而不是 SSH**
- `ego remote https://github.com/owner/repo.git` 即可，SSH 密钥自动失效（走凭据管理器）
