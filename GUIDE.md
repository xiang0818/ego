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

## 11. 常见问题

**Q: push 报 `Permission denied (publickey)`**
- 确认 `ego show <user>` 里 key 路径存在，且公钥已添加到对应平台账号
- 用 `ego verify` 校验；GitHub 提示 "Hi <用户名>!"

**Q: 仓库绑错了用户**
- 用 `ego switch <正确身份>` 换绑，不要用 `ego start`

**Q: 换电脑/重装后，注册表还在吗**
- 身份注册表在 `~/.git-tool/users.json`，密钥在 `~/.ssh/`，记得一起备份迁移

**Q: 想用 HTTPS 而不是 SSH**
- `ego remote https://github.com/owner/repo.git` 即可，SSH 密钥自动失效（走凭据管理器）
