#!/usr/bin/env node
import {
  cmdUsers,
  cmdKeys,
  cmdRepos,
  cmdCheck,
  cmdAdd,
  cmdRemove,
  cmdShow,
  cmdSetGlobal,
  cmdRemote,
  cmdKeyNew,
  cmdInit,
  cmdStart,
  cmdStatus,
  cmdWhoami,
  cmdVerify,
  cmdScan,
  cmdSync,
  cmdClone,
  cmdPull,
  cmdFetch,
  cmdLsRemote,
  cmdCommit,
  cmdPush,
  cmdPublish,
  cmdRelease,
  cmdExport,
  cmdImport
} from '../lib/commands.js';

const HELP = `ego — Git 多身份管理 CLI

用法: ego <命令> [参数]

身份管理
  users                             列出已注册身份（含各身份绑定的仓库数）
  keys                              列出 ~/.ssh 密钥，标出已绑定/未绑定
  repos [user]                      列出仓库绑定（可按用户过滤；已删除会标注）
  check [--prune]                   校验仓库实际身份与记录是否一致；--prune 清理失效记录
  sync [user] [--dry-run] [--yes]   把身份的 name/email/key 变更同步到其全部绑定仓库
                                    （改了 --email 或轮换密钥后必跑；不带 user 则同步全部身份）
  add <user> --name "名字" --email "邮箱" --key "密钥路径"   注册身份
  key-new <user> [--email 邮箱]     生成 SSH 密钥到 ~/.ssh/ 并注册
  remove <user>                    删除身份（同时清理其仓库绑定）
  show <user>                      查看身份详情（key/绑定仓库/是否全局）
  set-global <user>                把某身份设为全局 git 身份（写 --global 配置）

仓库绑定
  start <user> [remote]               一键初始化新项目：git init + 绑定身份 + 初始提交 + 展示 log
  init <user> [--init] [--yes]      当前仓库绑定身份（可省略 user，按 remote 所有者自动推断；
                                    非 git 目录会提示并引导初始化项目，--init/--yes 自动执行 git init）
  switch <user> [--init] [--yes]    同 init
  remote [url]                      查看/绑定/修改 origin
  verify                            校验当前仓库密钥绑定的 Git 账号（ssh -T）
  whoami                            快速查看当前仓库/全局身份
  status                            工作区状态 + 当前身份
  scan [目录]                       批量扫描目录下各仓库的绑定归属

取数（按身份拉取；只有 SSH 远端才靠密钥切换身份）
  clone <user> <地址> [目录] [--no-bind]   用该身份克隆（密钥仅本次认证用），成功后自动绑定身份
  pull [user] [--rebase] [--ff-only]      用该身份 fetch + 合并（省略 user 则用仓库绑定）
  fetch [user] [--all] [--prune]          只更新远端引用，不合并
  ls-remote <user> [地址]                 验证该身份能否访问远端（零副作用）

备份/恢复
  export [--with-keys] [路径]       导出身份 + 仓库绑定清单（可选含 SSH 私钥）
  import <备份文件> [--yes]         恢复身份/密钥，并列出仓库重绑步骤

提交/推送
  commit ["信息"] [--build] [--yes] [--force]   构建(可选)+hooks+暂存+提交
  push                              推送
  publish ["信息"] [--build] [--yes] [--force]  构建(可选)+提交+推送
  release [版本号]                   打 tag（默认读 package.json version）+ 推送

通用参数
  --build      执行 .git-tool.json 里的 build（默认不构建）
  --yes        非交互（自动生成提交信息、跳过确认；init/switch 下自动执行 git init）
  --force      忽略敏感文件/大文件守卫
  --init       init/switch 专用：非 git 目录下直接执行 git init（无需确认）

项目配置 .git-tool.json（可选）:
  { "build": "npm run build", "beforeCommit": ["npm test"], "largeFileLimitMB": 50 }

示例:
  ego key-new coresz --email fixcores@proton.me
  ego init coresz
  ego clone coresz git@github.com:coresz/private-repo.git
  ego ls-remote coresz
  ego fetch work --prune
  ego publish "修复xx" --yes
  ego release
`;

const VALUE_FLAGS = new Set(['name', 'email', 'key', 'tag', 'b', 'remote']);
const BOOL_FLAGS = new Set([
  'build',
  'yes',
  'force',
  'init',
  'prune',
  'no-bind',
  'rebase',
  'ff-only',
  'all',
  'with-keys',
  'dry-run',
  'help'
]);
const isKnownFlag = (k) => VALUE_FLAGS.has(k) || BOOL_FLAGS.has(k);

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // 不认识的 --xxx 不当 flag 吞掉：交给位置参数，命令侧会给出明确报错；
    // 同时保证 `ego commit "--force 说明"` 这类以 -- 开头的提交信息不被误解析
    if (!a.startsWith('--') || !isKnownFlag(a.indexOf('=') >= 0 ? a.slice(2, a.indexOf('=')) : a.slice(2))) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq >= 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = args[i + 1];
    if (VALUE_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { flags, positional };
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  const rest = positional.slice(1);
  const yes = !!flags.yes;
  const build = !!flags.build;
  const force = !!flags.force;

  switch (cmd) {
    case 'users':
      return cmdUsers();
    case 'keys':
      return cmdKeys();
    case 'repos':
      return cmdRepos(rest[0]);
    case 'check':
      return cmdCheck({ prune: !!flags.prune, yes });
    case 'add':
      return cmdAdd(rest[0], { name: flags.name, email: flags.email, key: flags.key });
    case 'remove':
      return cmdRemove(rest[0], { yes });
    case 'show':
      return cmdShow(rest[0]);
    case 'set-global':
      return cmdSetGlobal(rest[0]);
    case 'remote':
      return cmdRemote(rest[0]);
    case 'key-new':
      return cmdKeyNew(rest[0], { email: flags.email });
    case 'init':
    case 'switch':
      return cmdInit(rest[0], { yes, init: !!flags.init });
    case 'start':
      return cmdStart(rest[0], { remoteUrl: rest[1] || flags.remote });
    case 'status':
      return cmdStatus();
    case 'whoami':
      return cmdWhoami();
    case 'scan':
      return cmdScan(rest[0]);
    case 'sync':
      return cmdSync(rest[0], { dryRun: !!flags['dry-run'], yes });
    case 'clone':
      return cmdClone(rest[0], rest[1], rest[2], { bind: !flags['no-bind'] });
    case 'pull':
      return cmdPull(rest[0], { rebase: !!flags.rebase, ffOnly: !!flags['ff-only'] });
    case 'fetch':
      return cmdFetch(rest[0], { all: !!flags.all, prune: !!flags.prune });
    case 'ls-remote':
      return cmdLsRemote(rest[0], rest[1]);
    case 'export':
      return cmdExport({ withKeys: !!flags['with-keys'], outFile: rest[0] });
    case 'import':
      return cmdImport(rest[0], { yes });
    case 'verify':
      return cmdVerify();
    case 'commit':
      return cmdCommit(rest.join(' ') || undefined, { build, force, yes });
    case 'push':
      return cmdPush();
    case 'publish':
      return cmdPublish(rest.join(' ') || undefined, { build, force, yes });
    case 'release':
      return cmdRelease(rest[0] || flags.tag || flags.b, { force, yes });
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error('错误: ' + e.message);
  process.exit(1);
});
