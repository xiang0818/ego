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
    echo(`  ${u.isGlobal ? '★全局 ' : ''}${k}  ${u.name} <${u.email}>  key=${u.key || '(未设)'}`);
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
    return execFileSync('git', ['-C', repo, 'config', '--local', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
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
  // 未指定用户时，从 remote origin 所有者推断
  let target = user;
  if (!target) {
    target = inferUserFromRemote();
    if (!target) {
      throw new Error('用法: ego init <user>（或先绑定远程，省略 user 时按远程所有者自动推断）');
    }
    echo(`根据 remote 所有者推断身份: ${target}`);
  }
  const u = users[target];
  if (!u) throw new Error(`未找到身份 ${target}。先 \`ego add ${target}\` 或 \`ego key-new ${target}\``);
  if (!u.key) throw new Error(`身份 ${target} 未配置密钥。`);
  const keyAbs = expandHome(u.key);
  git(['config', 'user.name', u.name]);
  git(['config', 'user.email', u.email]);
  git(['config', 'core.sshCommand', sshCommandFor(keyAbs)]);
  try {
    const root = gitOut(['rev-parse', '--show-toplevel']);
    if (root) {
      const repos = loadRepos();
      repos[root] = target;
      saveRepos(repos);
      echo(`已记录仓库 → ${target}: ${root}`);
    }
  } catch {}
  echo(`已在当前仓库绑定身份 ${target}（${u.name} <${u.email}>）`);
  echo(`SSH 密钥: ${keyAbs}`);
  // 远程所有者推断到不同身份时提醒
  const inferred = inferUserFromRemote();
  if (inferred && inferred !== target) {
    echo(`⚠ 注意: remote 所有者疑似 ${inferred}，但你绑定的是 ${target}，请确认身份无误。`);
  }
  echo('可用 `ego verify` 校验密钥绑定，`ego whoami` 查看当前身份。');
}

// ---- 身份删除 / 详情 / 全局 ----
export async function cmdRemove(user, { yes = false } = {}) {
  if (!user) throw new Error('用法: ego remove <user>');
  const users = loadUsers();
  if (!users[user]) throw new Error(`未找到身份 ${user}`);

  const repos = loadRepos();
  const bound = Object.entries(repos).filter(([, u]) => u === user).map(([p]) => p);

  // 先要求确认清理「身份 + 仓库绑定」关系
  if (bound.length) {
    echo(`身份 ${user} 当前绑定 ${bound.length} 个仓库:`);
    bound.forEach((p) => echo('  ' + p));
    if (!yes) {
      const a = await prompt(`将删除身份 ${user} 并解除上述 ${bound.length} 个仓库的绑定，继续? (y/N): `);
      if (a.toLowerCase() !== 'y') {
        echo('已取消，未做任何删除。');
        return;
      }
    } else {
      echo(`--yes 已指定，删除身份 ${user} 并解除 ${bound.length} 个仓库绑定。`);
    }
    for (const p of bound) delete repos[p];
    saveRepos(repos);
  }

  delete users[user];
  saveUsers(users);
  echo(`已删除身份 ${user}${bound.length ? `，并解除 ${bound.length} 个仓库绑定` : ''}。`);
}

export function cmdShow(user) {
  if (!user) throw new Error('用法: ego show <user>');
  const users = loadUsers();
  const u = users[user];
  if (!u) throw new Error(`未找到身份 ${user}`);
  const repos = loadRepos();
  const list = Object.entries(repos).filter(([, x]) => x === user).map(([p]) => p);
  echo(`身份: ${user}${u.isGlobal ? '  ★全局' : ''}`);
  echo(`  name: ${u.name}`);
  echo(`  email: ${u.email}`);
  echo(`  key: ${u.key || '(未设)'}`);
  echo(`  key 存在: ${u.key ? existsSync(expandHome(u.key)) : false}`);
  echo(`  绑定仓库: ${list.length} 个`);
  list.forEach((p) => echo('    ' + p));
}

export function cmdSetGlobal(user) {
  if (!user) throw new Error('用法: ego set-global <user>');
  const users = loadUsers();
  const u = users[user];
  if (!u) throw new Error(`未找到身份 ${user}`);
  if (!u.key) throw new Error(`身份 ${user} 未配置密钥。`);
  for (const k of Object.keys(users)) users[k].isGlobal = false;
  u.isGlobal = true;
  saveUsers(users);
  const keyAbs = expandHome(u.key);
  git(['config', '--global', 'user.name', u.name]);
  git(['config', '--global', 'user.email', u.email]);
  git(['config', '--global', 'core.sshCommand', sshCommandFor(keyAbs)]);
  echo(`已将 ${user}（${u.name} <${u.email}>）设为全局 git 身份，并写入 --global 配置。`);
}

export function cmdRemote(url) {
  if (url) {
    const origin = currentOrigin();
    if (origin) {
      git(['remote', 'set-url', 'origin', url]);
      echo(`已修改 origin: ${origin} → ${url}`);
    } else {
      git(['remote', 'add', 'origin', url]);
      echo(`已绑定 origin: ${url}`);
    }
  } else {
    const origin = currentOrigin();
    if (origin) echo(`origin: ${origin}`);
    else echo('未设置 origin。用 `ego remote <url>` 绑定。');
  }
}

export function cmdWhoami() {
  const users = loadUsers();
  const globalKey = Object.keys(users).find((k) => users[k].isGlobal);
  if (!isInsideRepo()) {
    echo('当前目录不是 git 仓库。');
    if (globalKey) {
      const g = users[globalKey];
      echo(`全局身份: ${globalKey}（${g.name} <${g.email}>）`);
    } else {
      const gName =
        execFileSync('git', ['config', '--global', 'user.name'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim() || '(未设)';
      echo(`全局 git 身份: ${gName}`);
    }
    return;
  }
  const bound = detectBoundUser();
  const name = gitConfigAt(process.cwd(), 'user.name') || '(未设)';
  const email = gitConfigAt(process.cwd(), 'user.email') || '';
  echo(`当前仓库身份: ${bound ? bound : '(未绑定注册用户)'}（${name} <${email}>）`);
  if (globalKey && globalKey !== bound) {
    const g = users[globalKey];
    echo(`全局身份: ${globalKey}（${g.name} <${g.email}>）`);
  }
}

export function cmdScan(dir) {
  const base = dir || process.cwd();
  if (!existsSync(base)) throw new Error(`目录不存在: ${base}`);
  const repos = loadRepos();
  const found = [];
  const walk = (d, depth) => {
    if (depth > 8) return;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.git') {
        found.push(d);
        continue;
      }
      if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) {
        walk(join(d, e.name), depth + 1);
      }
    }
  };
  walk(base, 0);
  if (!found.length) {
    echo(`在 ${base} 下未发现 git 仓库。`);
    return;
  }
  echo(`扫描 ${base} 下共 ${found.length} 个仓库:`);
  for (const r of found) {
    const key = r.replace(/\\/g, '/');
    const recorded = repos[key] || '(未记录)';
    const actual = detectUserAt(r) || '(未绑定)';
    echo(`  ${r}`);
    echo(`    记录: ${recorded}   实际: ${actual}`);
  }
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

export async function cmdCommit(msg, { build = false, force, yes }) {
  const cfg = loadProjectConfig();
  if (cfg.build && build) {
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

function currentOrigin() {
  try {
    return gitOut(['remote', 'get-url', 'origin']) || '';
  } catch {
    return '';
  }
}
function isInsideRepo() {
  try {
    return (
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim() === 'true'
    );
  } catch {
    return false;
  }
}
function hasHead() {
  try {
    return !!execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return false;
  }
}
/** 生成 core.sshCommand 值；Windows 反斜杠会被 sh 吃掉，统一转正斜杠 */
function sshCommandFor(keyAbs) {
  return `ssh -i "${keyAbs.replace(/\\/g, '/')}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
}
/** 检测某仓库绑定到了哪个已注册身份（按 user.name/email 或密钥匹配），未绑定返回 null */
function detectUserAt(repo) {
  const users = loadUsers();
  const name = gitConfigAt(repo, 'user.name');
  const email = gitConfigAt(repo, 'user.email');
  const ssh = gitConfigAt(repo, 'core.sshCommand');
  if (!name && !email && !ssh) return null;
  for (const [k, u] of Object.entries(users)) {
    if (name === u.name && email === u.email) return k;
    const keyAbs = expandHome(u.key || '');
    if (keyAbs && ssh.includes(keyAbs)) return k;
  }
  return null;
}
function detectBoundUser() {
  return detectUserAt(process.cwd());
}
/** 从当前仓库 remote origin 的所有者推断应绑定的身份（git@github.com:coresZ/xxx.git → coresz） */
function inferUserFromRemote() {
  const origin = currentOrigin();
  if (!origin) return null;
  const m = origin.match(/:([^/]+)\//);
  const owner = m ? m[1].toLowerCase() : null;
  if (!owner) return null;
  return Object.keys(loadUsers()).find((k) => k.toLowerCase() === owner) || null;
}

/** 一键初始化新项目：git init + 绑定身份 + 初始提交 + 展示 log。
 *  已有提交的仓库：只做用户绑定，不重复初始化/提交；
 *  若已绑定其它身份，拒绝并提示用 `ego switch` 换绑。 */
export function cmdStart(user, { remoteUrl } = {}) {
  const users = loadUsers();
  const u = users[user];
  if (!u) throw new Error(`未找到身份 ${user}。先 \`ego add ${user}\` 或 \`ego key-new ${user}\``);
  if (!u.key) throw new Error(`身份 ${user} 未配置密钥。`);

  const wasRepo = isInsideRepo();
  const hadCommits = wasRepo && hasHead();

  // 已有提交且已绑定其它身份 → 拒绝，提示用 switch 换绑
  if (hadCommits) {
    const current = detectBoundUser();
    if (current && current !== user) {
      throw new Error(
        `该仓库已绑定身份 ${current}（非 ${user}）。` +
          `如需换绑请用 \`ego switch ${user}\`，不要在已有项目上使用 \`ego start\`。`
      );
    }
  }

  // 1. 仅新目录需要初始化 git
  if (!wasRepo) {
    echo('▶ 初始化 git');
    git(['init']);
  }

  // 2. 绑定身份（始终执行）
  const keyAbs = expandHome(u.key);
  git(['config', 'user.name', u.name]);
  git(['config', 'user.email', u.email]);
  git(['config', 'core.sshCommand', sshCommandFor(keyAbs)]);
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

  // 3. 已有提交：跳过初始化/提交；否则空目录生成 .gitignore + 初始提交
  if (hadCommits) {
    echo('检测到已有提交，跳过初始提交。');
  } else {
    if (!gitOut(['status', '--porcelain']) && !existsSync(join(process.cwd(), '.gitignore'))) {
      writeFileSync(join(process.cwd(), '.gitignore'), 'node_modules/\n.DS_Store\n');
      echo('（空目录，已生成 .gitignore 作为初始提交内容）');
    }
    git(['add', '-A']);
    if (gitOut(['status', '--porcelain'])) {
      git(['commit', '-m', 'chore: 初始化项目']);
    } else {
      echo('没有可提交的内容。');
    }
    try {
      git(['branch', '-M', 'main']);
    } catch {}
  }

  // 4. 远程绑定：传了地址且无 origin 则添加；已有 origin 则提示
  const origin = currentOrigin();
  if (remoteUrl && !origin) {
    git(['remote', 'add', 'origin', remoteUrl]);
    echo(`已绑定远程 origin: ${remoteUrl}`);
  } else if (origin) {
    echo(`检测到已有远程 origin: ${origin}`);
  }

  // 5. 展示 log
  echo('\n▶ git log');
  git(['log', '--oneline']);
  if (origin || remoteUrl) echo('\n▶ 可 `ego push` 推送。');
}
