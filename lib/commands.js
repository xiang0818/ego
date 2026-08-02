import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import readline from 'node:readline';
import { git, gitOut, run, runFile } from './git.js';
import { loadUsers, saveUsers, loadProjectConfig, expandHome, loadRepos, saveRepos } from './config.js';

const KNOWN_NOT_KEYS = new Set([
  'config',
  'config.old',
  'known_hosts',
  'known_hosts.old',
  'authorized_keys',
  'authorized_keys2',
  'hosts',
  'environment',
  'rc',
  'ssh_config',
  'sshd_config',
  'agent.sock',
  'control'
]);

function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => {
    rl.close();
    r(a.trim());
  }));
}
function echo(...args) {
  console.log(...args);
}

// ---- 身份管理 ----
export function cmdUsers() {
  const users = loadUsers();
  const keys = Object.keys(users);
  if (!keys.length) {
    echo('未注册任何身份。用 `ego add <user> --name ... --email ... --key ...` 或 `ego key-new <user>` 添加。');
    return;
  }
  const repos = loadRepos();
  const byUser = {};
  for (const [p, u] of Object.entries(repos)) (byUser[u] = byUser[u] || []).push(p);

  echo('已注册身份:');
  for (const k of keys) {
    const u = users[k];
    const list = byUser[k] || [];
    echo(`  ${k}  ${u.name} <${u.email}>  key=${u.key || '(未设)'}`);
    echo(`        → 绑定 ${list.length} 个仓库`);
    for (const p of list) echo(`           ${p}`);
  }
}

export function cmdRepos(filterUser) {
  const repos = loadRepos();
  const fmt = (p) => p + (existsSync(p) ? '' : '  （已删除）');
  if (filterUser) {
    const list = Object.entries(repos).filter(([, u]) => u === filterUser).map(([p]) => p);
    echo(`${filterUser} 绑定 ${list.length} 个仓库:`);
    list.forEach((p) => echo('  ' + fmt(p)));
    if (!list.length) echo('  （无）');
    return;
  }
  if (!Object.keys(repos).length) {
    echo('还没有仓库绑定记录。在仓库里运行 `ego init <user>` 即会记录。');
    return;
  }
  const byUser = {};
  for (const [p, u] of Object.entries(repos)) (byUser[u] = byUser[u] || []).push(p);
  for (const [u, list] of Object.entries(byUser)) {
    echo(`${u}  → ${list.length} 个仓库`);
    list.forEach((p) => echo('  ' + fmt(p)));
    echo('');
  }
}

function gitConfigAt(repo, key) {
  try {
    return execFileSync('git', ['-C', repo, 'config', '--local', key], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function checkRepoBinding(repo, user, users) {
  const name = gitConfigAt(repo, 'user.name');
  const email = gitConfigAt(repo, 'user.email');
  const ssh = gitConfigAt(repo, 'core.sshCommand');
  const actual = (name || '(未设)') + ' <' + (email || '(未设)') + '>';
  const u = users[user];
  if (!u) return { code: 2, mark: '❌', actual: actual + '  （记录的用户不存在）' };
  const keyAbs = expandHome(u.key || '');
  const sshMatch = keyAbs && ssh.includes(keyAbs);
  const nameMatch = name === u.name && email === u.email;
  if (sshMatch && nameMatch) return { code: 0, mark: '✅', actual };
  if (sshMatch) return { code: 1, mark: '⚠️', actual: actual + '  （user.name/email 与记录不同）' };
  if (nameMatch) return { code: 1, mark: '⚠️', actual: actual + '  （密钥与记录不同）' };
  return { code: 2, mark: '❌', actual };
}

export async function cmdCheck({ prune = false, yes = false } = {}) {
  const repos = loadRepos();
  const users = loadUsers();
  const entries = Object.entries(repos);
  if (!entries.length) {
    echo('没有仓库绑定记录。在仓库里运行 `ego init <user>` 即会记录。');
    return;
  }
  let ok = 0;
  let warn = 0;
  let fail = 0;
  const stale = [];
  for (const [repo, user] of entries) {
    if (!existsSync(repo)) {
      fail++;
      echo(`  ❌ ${repo}`);
      echo(`       记录: ${user}  实际: 仓库不存在（已删除）`);
      stale.push(repo);
      continue;
    }
    const r = checkRepoBinding(repo, user, users);
    if (r.code === 0) ok++;
    else if (r.code === 1) warn++;
    else fail++;
    echo(`  ${r.mark} ${repo}`);
    echo(`       记录: ${user}  实际: ${r.actual}`);
  }
  echo('');
  echo(`✅ 一致 ${ok} · ⚠️ 部分 ${warn} · ❌ 不一致/异常 ${fail}${stale.length ? `（其中 ${stale.length} 个仓库不存在）` : ''}`);
  if (prune && stale.length) {
    echo('');
    if (!yes) {
      const a = await prompt(`从记录中移除 ${stale.length} 个失效仓库? (y/N): `);
      if (a.toLowerCase() !== 'y') {
        echo('已取消清理。');
        return;
      }
    }
    for (const p of stale) delete repos[p];
    saveRepos(repos);
    echo(`已清理 ${stale.length} 个失效记录。`);
  }
}

export function cmdKeys() {
  const sshDir = join(homedir(), '.ssh');
  let files;
  try {
    files = readdirSync(sshDir);
  } catch {
    echo(`未找到 ~/.ssh 目录: ${sshDir}`);
    return;
  }
  const users = loadUsers();
  const boundByUser = new Map();
  for (const [k, u] of Object.entries(users)) {
    if (u.key) boundByUser.set(expandHome(u.key), k);
  }
  const isKeyFile = (f) => {
    if (f.endsWith('.pub')) return false;
    if (KNOWN_NOT_KEYS.has(f)) return false;
    return (
      /^(id_[a-zA-Z0-9_-]+)$/.test(f) ||
      /\.(key|rsa|ed25519|ecdsa)$/i.test(f) ||
      /^(github|gitlab)_[a-zA-Z0-9_-]+$/.test(f)
    );
  };

  const bound = [];
  const unbound = [];
  for (const f of files.filter(isKeyFile).sort()) {
    const abs = join(sshDir, f);
    const user = boundByUser.get(abs);
    if (user) bound.push({ f, user });
    else unbound.push(f);
  }

  echo(`~/.ssh 密钥清单（共 ${bound.length + unbound.length} 个）:`);
  echo('');
  if (bound.length) {
    echo('已绑定身份:');
    for (const { f, user } of bound) echo(`  ${f}  →  ${user}`);
    echo('');
  }
  if (unbound.length) {
    echo('未绑定的密钥:');
    for (const f of unbound) {
      echo(`  ${f}   （绑定: ego add <user> --key "~/.ssh/${f}" 后 ego init <user>）`);
    }
    echo('');
  }
  if (!bound.length && !unbound.length) {
    echo('（~/.ssh 下没有可用的私钥）');
  }
}

export function cmdAdd(user, opts) {
  if (!user) throw new Error('用法: ego add <user> --name "名字" --email "邮箱" --key "密钥路径"');
  const users = loadUsers();
  users[user] = {
    name: opts.name || (users[user] && users[user].name) || '',
    email: opts.email || (users[user] && users[user].email) || '',
    key: opts.key || (users[user] && users[user].key) || ''
  };
  saveUsers(users);
  echo(`已注册身份 ${user}。可用 \`ego init ${user}\` 在当前仓库绑定。`);
}

export function cmdKeyNew(user, opts) {
  if (!user) throw new Error('用法: ego key-new <user> [--email 邮箱]');
  const keyPath = join(homedir(), '.ssh', `id_ed25519_${user}`);
  const email = opts.email || `${user}@localhost`;
  runFile('ssh-keygen', ['-t', 'ed25519', '-C', email, '-f', keyPath, '-N', '']);
  const pub = keyPath + '.pub';
  const users = loadUsers();
  users[user] = {
    name: (users[user] && users[user].name) || user,
    email: (users[user] && users[user].email) || email,
    key: keyPath
  };
  saveUsers(users);
  echo(`密钥已生成并注册：${keyPath}`);
  echo('公钥（添加到你的 Git 平台，如 GitHub → Settings → SSH and GPG keys）:');
  console.log(readFileSync(pub, 'utf8').trim());
}

export function cmdInit(user) {
  const users = loadUsers();
  const u = users[user];
  if (!u) throw new Error(`未找到身份 ${user}。先 \`ego add ${user}\` 或 \`ego key-new ${user}\``);
  if (!u.key) throw new Error(`身份 ${user} 未配置密钥。`);
  const keyAbs = expandHome(u.key);
  git(['config', 'user.name', u.name]);
  git(['config', 'user.email', u.email]);
  git(['config', 'core.sshCommand', `ssh -i "${keyAbs}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`]);
  try {
    const root = gitOut(['rev-parse', '--show-toplevel']);
    if (root) {
      const repos = loadRepos();
      repos[root] = user;
      saveRepos(repos);
      echo(`已记录仓库 → ${user}: ${root}`);
    }
  } catch {}
  echo(`已在当前仓库绑定身份 ${user}（${u.name} <${u.email}>）`);
  echo(`SSH 密钥: ${keyAbs}`);
  echo('可用 `ego verify` 校验密钥绑定，`ego status` 查看当前身份。');
}

// ---- 状态 / 校验 ----
export function cmdStatus() {
  git(['status']);
  echo('');
  const name = gitOut(['config', 'user.name']) || '(未设置)';
  const email = gitOut(['config', 'user.email']) || '';
  echo(`当前身份: ${name} <${email}>`);
}

export function cmdVerify() {
  let host = 'github.com';
  try {
    const url = gitOut(['remote', 'get-url', 'origin']);
    const m = url.match(/[git@](?:ssh\.)?([\w.-]+):/);
    if (m) host = m[1].replace(/^ssh\./, '');
  } catch {}
  echo(`校验 ${host} 上的账号（按当前仓库 core.sshCommand 所用密钥）...`);
  try {
    execFileSync('ssh', ['-T', `git@${host}`], { stdio: 'inherit' });
  } catch {
    // ssh -T 总是非 0 退出；成功时输出 "Hi <user>! You've successfully authenticated"
  }
  echo('（若上方出现 "Hi <用户名>!" 即校验成功）');
}

// ---- 提交 ----
const SENSITIVE_RE = /(^|\/)(\.env([^/]*)?|.*\.pem|id_[a-z0-9_]+(\.pub)?|.*\.key)$/i;

async function guardSensitive(force, yes) {
  const staged = gitOut(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const hit = staged.filter((f) => SENSITIVE_RE.test(f));
  if (!hit.length) return;
  echo('⚠ 检测到可能敏感的文件被暂存:');
  hit.forEach((f) => echo('  - ' + f));
  if (force) {
    echo('--force 已指定，继续。');
    return;
  }
  if (yes) throw new Error('检测到敏感文件，已中止（可用 --force 覆盖）。');
  const a = await prompt('确认提交这些文件? (y/N): ');
  if (a.toLowerCase() !== 'y') throw new Error('已中止。');
}

async function guardLarge(force, yes) {
  const cfg = loadProjectConfig();
  const limit = cfg.largeFileLimitMB || 50;
  const staged = gitOut(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const big = [];
  for (const f of staged) {
    try {
      const sz = statSync(join(process.cwd(), f)).size;
      if (sz > limit * 1024 * 1024) big.push(`${f} (${(sz / 1024 / 1024).toFixed(1)}MB)`);
    } catch {}
  }
  if (!big.length) return;
  echo(`⚠ 超过 ${limit}MB 的大文件:`);
  big.forEach((f) => echo('  - ' + f));
  if (force) {
    echo('--force 已指定，继续。');
    return;
  }
  if (yes) throw new Error('检测到大文件，已中止（可用 --force 覆盖）。');
  const a = await prompt('继续? (y/N): ');
  if (a.toLowerCase() !== 'y') throw new Error('已中止。');
}

function autoMessage() {
  const staged = gitOut(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const brief = staged.slice(0, 3).map((f) => f.split('/').pop()).join(', ');
  return `chore: 更新 ${staged.length} 个文件${brief ? '（' + brief + '…）' : ''}`;
}

export async function cmdCommit(msg, { noBuild, force, yes }) {
  const cfg = loadProjectConfig();
  if (cfg.build && !noBuild) {
    echo('▶ 构建: ' + cfg.build);
    run(cfg.build);
  }
  if (cfg.beforeCommit && cfg.beforeCommit.length) {
    for (const c of cfg.beforeCommit) {
      echo('▶ ' + c);
      run(c);
    }
  }
  git(['add', '-A']);
  await guardSensitive(force, yes);
  await guardLarge(force, yes);
  if (!yes) {
    echo('\n▶ 待提交变更');
    git(['diff', '--cached', '--stat']);
    const a = await prompt('确认提交? (Y/n): ');
    if (a.toLowerCase() === 'n') throw new Error('已取消。');
  }
  let m = msg;
  if (!m) {
    if (yes) m = autoMessage();
    else {
      m = await prompt('提交信息: ');
      if (!m) throw new Error('未提供提交信息。');
    }
  }
  git(['commit', '-m', m]);
  echo('\n▶ 最近提交');
  git(['log', '--oneline', '-3']);
}

// ---- 推送 / 发布 ----
export function cmdPush() {
  echo('▶ 推送');
  git(['push']);
}

export async function cmdPublish(msg, opts) {
  await cmdCommit(msg, opts);
  echo('');
  cmdPush();
}

export function cmdRelease(version, { force, yes }) {
  let v = version;
  if (!v) {
    try {
      const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
      v = pkg.version;
    } catch {}
  }
  if (!v) throw new Error('用法: ego release [版本号]，或项目根有 package.json 时自动读取 version');
  const tag = String(v).startsWith('v') ? v : 'v' + v;
  echo(`▶ 打 tag ${tag}`);
  git(['tag', tag]);
  git(['push']);
  git(['push', 'origin', tag]);
  echo('已推送 tag。');
}

/** 一键初始化新项目：git init + 绑定身份 + 初始提交 + 展示 log */
export function cmdStart(user, { remoteUrl } = {}) {
  const users = loadUsers();
  const u = users[user];
  if (!u) throw new Error(`未找到身份 ${user}。先 \`ego add ${user}\` 或 \`ego key-new ${user}\``);
  if (!u.key) throw new Error(`身份 ${user} 未配置密钥。`);

  // 1. 初始化 git（已存在则幂等）
  echo('▶ 初始化 git');
  git(['init']);

  // 2. 绑定身份
  const keyAbs = expandHome(u.key);
  git(['config', 'user.name', u.name]);
  git(['config', 'user.email', u.email]);
  git(['config', 'core.sshCommand', `ssh -i "${keyAbs}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`]);
  try {
    const root = gitOut(['rev-parse', '--show-toplevel']);
    if (root) {
      const repos = loadRepos();
      repos[root] = user;
      saveRepos(repos);
      echo(`已记录仓库 → ${user}`);
    }
  } catch {}
  echo(`已绑定身份 ${user}（${u.name} <${u.email}>）`);

  // 3. 空目录自动生成 .gitignore，保证有内容可提交
  if (!gitOut(['status', '--porcelain']) && !existsSync(join(process.cwd(), '.gitignore'))) {
    writeFileSync(join(process.cwd(), '.gitignore'), 'node_modules/\n.DS_Store\n');
    echo('（空目录，已生成 .gitignore 作为初始提交内容）');
  }

  // 4. 可选：绑定远程
  if (remoteUrl) {
    try {
      const has = gitOut(['remote']).split(/\s+/).filter(Boolean);
      if (!has.includes('origin')) git(['remote', 'add', 'origin', remoteUrl]);
    } catch {}
  }

  // 5. 初始提交
  git(['add', '-A']);
  if (gitOut(['status', '--porcelain'])) {
    git(['commit', '-m', 'chore: 初始化项目']);
  } else {
    echo('没有可提交的内容。');
  }

  // 分支统一 main
  try {
    git(['branch', '-M', 'main']);
  } catch {}

  // 6. 展示 log
  echo('\n▶ git log');
  git(['log', '--oneline']);
  if (remoteUrl) echo('\n▶ 远程已绑定，可 `ego push` 推送。');
}
