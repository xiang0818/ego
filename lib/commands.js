import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import readline from 'node:readline';
import { git, gitOut, run, runFile } from './git.js';
import { CONFIG_DIR, loadUsers, saveUsers, loadProjectConfig, expandHome, loadRepos, saveRepos } from './config.js';

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

/** 该仓库是否"按 SSH 密钥认证"：只有 SSH 远端才该校验 core.sshCommand；
 *  https/本地远端不走密钥，此时不校验密钥（否则非 SSH 克隆的仓库会被永远判为身份漂移） */
function keyRelevantAt(repo) {
  const origin = gitConfigAt(repo, 'remote.origin.url');
  return origin ? isSshUrl(origin) : true;
}

function checkRepoBinding(repo, user, users) {
  const name = gitConfigAt(repo, 'user.name');
  const email = gitConfigAt(repo, 'user.email');
  const ssh = gitConfigAt(repo, 'core.sshCommand');
  const actual = (name || '(未设)') + ' <' + (email || '(未设)') + '>';
  const u = users[user];
  if (!u) return { code: 2, mark: '❌', actual: actual + '  （记录的用户不存在）' };
  const keyAbs = expandHome(u.key || '');
  const sshMatch = keyRelevantAt(repo) ? !!(keyAbs && ssh.includes(keyAbs.replace(/\\/g, '/'))) : true;
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

/** 命令行取值归一化：`--key` 这类需要取值的 flag 若被写成裸 flag，argv 里会是 true，
 *  必须当成"没给值"，否则 true 会被写进注册表并在后续 expandHome 处崩溃 */
function flagStr(v) {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v === true) echo('⚠ 该参数需要一个取值（例如 --key "~/.ssh/id_ed25519_work"），已忽略空值。');
  return '';
}

export function cmdAdd(user, opts) {
  if (!user) throw new Error('用法: ego add <user> --name "名字" --email "邮箱" --key "密钥路径"');
  const users = loadUsers();
  users[user] = {
    name: flagStr(opts.name) || (users[user] && users[user].name) || '',
    email: flagStr(opts.email) || (users[user] && users[user].email) || '',
    key: flagStr(opts.key) || (users[user] && users[user].key) || ''
  };
  saveUsers(users);
  echo(`已注册身份 ${user}。可用 \`ego init ${user}\` 在当前仓库绑定。`);
}

export function cmdKeyNew(user, opts) {
  if (!user) throw new Error('用法: ego key-new <user> [--email 邮箱]');
  const keyPath = join(homedir(), '.ssh', `id_ed25519_${user}`);
  const email = flagStr(opts.email) || `${user}@localhost`;
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

export async function cmdInit(user, { yes = false, init = false } = {}) {
  // 0) Git 环境检测：不在仓库内时提示「没有 Git 管理」并引导用户初始化项目
  await ensureGitRepo({ yes, init, hint: user ? `ego init ${user}` : 'ego init' });

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
  const keyShown = typeof u.key === 'string' && u.key ? u.key : '(未设)';
  echo(`  key: ${keyShown}`);
  echo(`  key 存在: ${keyShown === '(未设)' ? false : existsSync(expandHome(keyShown))}`);
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
      // 注意 git config 在键不存在时以非 0 退出，必须捕获，否则 whoami 会直接崩
      let gName = '(未设)';
      try {
        gName =
          execFileSync('git', ['config', '--global', 'user.name'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
          }).trim() || '(未设)';
      } catch {}
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
  requireRepo('status');
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

/** 取暂存文件名。必须用 -z（NUL 分隔）：git 默认 core.quotePath=true 会把含非 ASCII 的
 *  路径输出成 "\347\247\201\351\222\245.key" 这种转义形式，导致守卫漏检 && 路径拼接失败 */
function stagedNames() {
  return gitOut(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean);
}

async function guardSensitive(force, yes) {
  const hit = stagedNames().filter((f) => SENSITIVE_RE.test(f));
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
  // 阈值与文件路径都必须以仓库根为基准：在子目录里执行时 cwd 既读不到 .git-tool.json，
  // 暂存列表里的路径又是仓库根相对路径，按 cwd 拼接会全部 stat 失败而静默放行
  const root = repoRootOrCwd();
  const cfg = loadProjectConfig(root);
  const limit = cfg.largeFileLimitMB || 50;
  const big = [];
  for (const f of stagedNames()) {
    try {
      const sz = statSync(join(root, f)).size;
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
  const staged = stagedNames();
  const brief = staged.slice(0, 3).map((f) => f.split('/').pop()).join(', ');
  return `chore: 更新 ${staged.length} 个文件${brief ? '（' + brief + '…）' : ''}`;
}

/** 提交前身份检查：无绑定记录时轻量提醒；绑定用户与仓库实际身份不符时中止 */
function checkIdentityDrift({ force = false, yes = false } = {}) {
  let root;
  try {
    root = gitOut(['rev-parse', '--show-toplevel']);
  } catch {
    return;
  }
  if (!root) return;
  const expectedUser = loadRepos()[root.replace(/\\/g, '/')];
  if (!expectedUser) {
    // 轻量提醒（非自动切换，也不阻止）
    if (!yes) {
      echo('ℹ 该仓库未绑定身份，建议运行 `ego init`（可省略 user 按远程推断）或 `ego start <user>`（新项目）');
    }
    return;
  }
  const u = loadUsers()[expectedUser];
  if (!u) return;
  const name = gitConfigAt(process.cwd(), 'user.name');
  const email = gitConfigAt(process.cwd(), 'user.email');
  const ssh = gitConfigAt(process.cwd(), 'core.sshCommand');
  const nameOk = name === u.name && email === u.email;
  const keyAbs = expandHome(u.key || '');
  // https/本地远端的认证不走 SSH 密钥，这类仓库只校验 user.name/email
  const keyOk = keyRelevantAt(process.cwd()) ? !!(keyAbs && ssh.includes(keyAbs.replace(/\\/g, '/'))) : true;
  if (nameOk && keyOk) return; // 一致

  const detail = [];
  if (!nameOk) {
    detail.push(`git user 不符（绑定 ${u.name} <${u.email}>，实际 ${name || '(无)'} <${email || '(无)'}>）`);
  }
  if (!keyOk) detail.push('SSH 密钥与绑定不符');
  echo('⚠ 身份漂移: ' + detail.join('；'));
  echo(`  本仓库绑定身份: ${expectedUser}`);
  if (force) {
    echo('--force 已指定，继续提交。');
    return;
  }
  throw new Error('身份与绑定不一致，已中止提交。请先 `ego switch <正确身份>`，或加 --force 强制提交。');
}

export async function cmdCommit(msg, { build = false, force, yes }) {
  checkIdentityDrift({ force, yes });
  const cfg = loadProjectConfig(repoRootOrCwd());
  if (cfg.build && build) {
    echo('▶ 构建: ' + cfg.build);
    run(cfg.build);
  }
  // 必须是数组：写成字符串（如 "npm test"）时 for...of 会按字符逐条执行命令
  if (Array.isArray(cfg.beforeCommit) && cfg.beforeCommit.length) {
    for (const c of cfg.beforeCommit) {
      echo('▶ ' + c);
      run(c);
    }
  } else if (cfg.beforeCommit) {
    echo('⚠ .git-tool.json 的 beforeCommit 应为数组，已忽略: ' + JSON.stringify(cfg.beforeCommit));
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

// ---- 取数：按身份 clone / pull / fetch / ls-remote ----
// 身份在"取数"时唯一的作用是 SSH 认证（用哪把私钥），与提交作者无关；
// 因此统一通过 GIT_SSH_COMMAND 借用密钥：不改仓库绑定、不写 .git/config。

/** 取身份并校验。
 *  needKeyFile=true（SSH 场景）：要求已配置密钥且密钥文件存在；
 *  needKeyFile=false（https/本地远端）：密钥用不上，允许没有密钥的身份，也不做文件校验。 */
function requireIdentity(user, { needKeyFile = true } = {}) {
  if (!user) throw new Error('未指定身份。');
  const u = loadUsers()[user];
  if (!u) throw new Error(`未找到身份 ${user}。先 \`ego add ${user}\` 或 \`ego key-new ${user}\``);
  const hasKey = typeof u.key === 'string' && u.key.trim().length > 0;
  if (needKeyFile && !hasKey) throw new Error(`身份 ${user} 未配置密钥。`);
  const keyAbs = hasKey ? expandHome(u.key) : '';
  if (needKeyFile && !existsSync(keyAbs)) {
    throw new Error(`身份 ${user} 的密钥文件不存在: ${keyAbs}（\`ego show ${user}\` 核对，\`ego key-new ${user}\` 重建）`);
  }
  return { u, keyAbs };
}

/** 借用身份的环境变量：只影响本次网络操作的 SSH 认证 */
function borrowEnv(keyAbs) {
  return { GIT_SSH_COMMAND: sshCommandFor(keyAbs) };
}

/** 是否 SSH 地址（借用密钥只对 SSH 生效；https 由 Git 凭据管理器认证） */
function isSshUrl(url) {
  return /^ssh:\/\//i.test(url) || /^[^/@\s]+@[^/:\s]+:/.test(url);
}

/** 是否本地路径/文件远端（这类远端本来就不需要密钥） */
function isLocalUrl(url) {
  return /^(file:\/\/|[a-zA-Z]:[\\/]|\\\\|\.{1,2}[\\/])/.test(url);
}

/** 非 SSH 地址时说明为什么用不上密钥 */
function nonSshNote(url) {
  if (/^https?:\/\//i.test(url)) return 'https 由 Git 凭据管理器认证';
  if (isLocalUrl(url)) return '本地路径/文件远端，无需密钥';
  return '该协议不使用 SSH 密钥';
}

/** 从地址猜所有者，用于提醒"远端 owner 疑似另一个身份" */
function ownerFromUrl(url) {
  const m =
    /^ssh:\/\/[^/]+\/([^/]+)\//i.exec(url) ||
    /^https?:\/\/[^/]+\/([^/]+)\//i.exec(url) ||
    /:([^/]+)\//.exec(url);
  return m ? m[1].toLowerCase() : null;
}

/** 从地址推导默认克隆目录名（用 basename 语义，避免 Windows 盘符/反斜杠被切掉） */
function dirFromUrl(url) {
  const cleaned = String(url).replace(/[\\/]+$/, '');
  const m = /([^\\/:]+?)(\.git)?$/i.exec(cleaned);
  return (m && m[1]) || 'repo';
}

/** 打印本次网络操作实际使用的身份（借用不改变仓库绑定） */
function printNetIdentity(user, u, keyAbs, { url } = {}) {
  if (!user) {
    const bound = detectBoundUser();
    echo(bound ? `▶ 使用仓库绑定身份 ${bound}` : '▶ 未指定身份，按仓库/全局 git 配置执行');
    return;
  }
  echo(`▶ 使用身份 ${user}（${u.name} <${u.email}>）`);
  echo(`  密钥: ${keyAbs}（仅本次生效，不写入 .git/config）`);
  if (url && !isSshUrl(url)) {
    echo(`  注意: 远端不是 SSH 地址（${nonSshNote(url)}），本次借用的密钥不会生效。`);
  }
  const bound = detectBoundUser();
  if (bound && bound !== user) {
    echo(`  注意: 本仓库绑定的是 ${bound}，本次只借用 ${user} 拉取；提交作者与绑定均不变。`);
  }
}

/** 探测类调用：需要 stderr 才能解释失败原因；保留错误码以区分"git 不可用"与"认证失败" */
function gitProbe(args, { cwd = process.cwd(), env } = {}) {
  const opts = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    const out = execFileSync('git', args, env ? { ...opts, env: { ...process.env, ...env } } : opts);
    return { ok: true, out };
  } catch (e) {
    return { ok: false, code: e && e.code, stderr: String((e && e.stderr) || (e && e.message) || '') };
  }
}

/** 需要处于 git 仓库内的命令前置检查（避免只抛 git 原生报错） */
function requireRepo(cmd, hint = '请在 git 仓库内执行，或用 `ego clone <身份> <地址>` 克隆。') {
  if (!isInsideRepo()) throw new Error(`当前目录不是 git 仓库，无法 ${cmd}。${hint}`);
}

/** ego pull/fetch 的第一个位置参数是"身份名"，不是远端名/分支名：
 *  若它恰好是本仓库的远端名，给出一条能自解释的报错（git 肌肉记忆陷阱） */
function assertIdentityArg(user, cmd) {
  if (!user || loadUsers()[user]) return;
  if (user.startsWith('--')) {
    throw new Error(`未知参数 ${user}。\`ego ${cmd}\` 支持: --rebase / --ff-only / --all / --prune（用 \`ego\` 查看全部命令）`);
  }
  let remotes = [];
  try {
    remotes = (gitOut(['remote']) || '').split('\n').filter(Boolean);
  } catch {}
  if (remotes.includes(user)) {
    throw new Error(
      `\`ego ${cmd}\` 的第一个参数是【身份名】，不是远端名/分支名。检测到 \`${user}\` 是本仓库的远端名。\n` +
        `  想拉取当前配置的远端: 直接 \`ego ${cmd}\`（不带参数）\n` +
        `  想借用某个身份:       \`ego ${cmd} <身份>\`（身份用 \`ego users\` 查看）`
    );
  }
}

/** 用某身份克隆仓库；成功后默认把该身份绑定到新仓库 */
export function cmdClone(user, url, dir, { bind = true } = {}) {
  if (!user || !url) throw new Error('用法: ego clone <身份> <仓库地址> [目录] [--no-bind]');
  const ssh = isSshUrl(url);
  const { u, keyAbs } = requireIdentity(user, { needKeyFile: ssh });
  const target = dir || dirFromUrl(url);
  if (existsSync(target) && (!statSync(target).isDirectory() || readdirSync(target).length)) {
    throw new Error(`目标路径已存在且非空，拒绝克隆: ${target}`);
  }
  echo(`▶ 使用身份 ${user}（${u.name} <${u.email}>）克隆`);
  if (ssh) echo(`  密钥: ${keyAbs}（仅本次认证用）`);
  else echo(`  注意: 远端不是 SSH 地址（${nonSshNote(url)}），本次不使用该密钥`);
  git(['clone', url, target], ssh ? { env: borrowEnv(keyAbs) } : {});

  if (!bind) {
    echo('--no-bind 已指定，跳过身份绑定。');
    return;
  }
  git(['config', 'user.name', u.name], { cwd: target });
  git(['config', 'user.email', u.email], { cwd: target });
  // 非 SSH 远端：不写 core.sshCommand（密钥在此不生效，写了只会误导，且可能指向不存在的文件）
  if (ssh) {
    git(['config', 'core.sshCommand', sshCommandFor(keyAbs)], { cwd: target });
  } else if (keyAbs) {
    echo('  已跳过 core.sshCommand 写入（该远端不用 SSH 密钥）');
  }
  let root = resolve(target).replace(/\\/g, '/');
  try {
    const r = gitOut(['rev-parse', '--show-toplevel'], { cwd: target });
    if (r) root = r;
  } catch {}
  const repos = loadRepos();
  repos[root] = user;
  saveRepos(repos);
  echo(`已绑定身份 ${user} 到新仓库: ${root}`);
  const owner = ownerFromUrl(url);
  const other = owner && owner !== user.toLowerCase() && Object.keys(loadUsers()).find((k) => k.toLowerCase() === owner);
  if (other) echo(`⚠ 注意: 远端所有者疑似 ${other}，但你绑定的是 ${user}，请确认身份无误。`);
  echo('可用 `ego whoami` 查看当前身份，`ego verify` 校验账号。');
}

/** 用某身份 pull（省略身份时沿用仓库绑定/配置） */
export function cmdPull(user, { rebase = false, ffOnly = false } = {}) {
  assertIdentityArg(user, 'pull');
  requireRepo('pull', '用 `ego clone <身份> <地址>` 克隆，或先 `git init`。');
  const origin = currentOrigin();
  const { u, keyAbs } = user ? requireIdentity(user, { needKeyFile: origin ? isSshUrl(origin) : false }) : {};
  const args = ['pull'];
  if (rebase) args.push('--rebase');
  if (ffOnly) args.push('--ff-only');
  printNetIdentity(user, u, keyAbs, { url: origin });
  git(args, user && keyAbs ? { env: borrowEnv(keyAbs) } : {});
}

/** 用某身份 fetch（只更新远端引用，不合并） */
export function cmdFetch(user, { all = false, prune = false } = {}) {
  assertIdentityArg(user, 'fetch');
  requireRepo('fetch', '用 `ego clone <身份> <地址>` 克隆，或先 `git init`。');
  const origin = currentOrigin();
  if (!all && !origin) {
    echo('当前仓库未设置 origin。用 `ego remote <url>` 绑定，或 `ego fetch <身份> --all` 拉取全部远程。');
    return;
  }
  const { u, keyAbs } = user ? requireIdentity(user, { needKeyFile: origin ? isSshUrl(origin) : false }) : {};
  const args = ['fetch'];
  if (all) args.push('--all');
  if (prune) args.push('--prune');
  printNetIdentity(user, u, keyAbs, { url: origin });
  git(args, user && keyAbs ? { env: borrowEnv(keyAbs) } : {});
}

/** 探测某身份能否访问远端（零副作用；clone 前先验通路） */
export function cmdLsRemote(user, url) {
  if (!user) throw new Error('用法: ego ls-remote <身份> [仓库地址]（省略地址时用当前仓库 origin）');
  const target = url || currentOrigin();
  if (!target) throw new Error('未提供地址，且当前仓库没有 origin。用法: ego ls-remote <身份> <仓库地址>');
  if (!hasGitBinary()) {
    echo('❌ 未检测到 git 命令，无法探测远端。');
    echo('   请先安装 Git（含 ssh）: https://git-scm.com/downloads');
    throw new Error('当前环境未安装 git。');
  }
  const ssh = isSshUrl(target);
  const { keyAbs } = requireIdentity(user, { needKeyFile: ssh });
  echo(`▶ 用身份 ${user} 探测远端: ${target}`);
  if (!ssh) echo(`  注意: 远端不是 SSH 地址（${nonSshNote(target)}），本次不使用该密钥`);
  const r = gitProbe(['ls-remote', target], ssh && keyAbs ? { env: borrowEnv(keyAbs) } : {});
  if (r.ok) {
    const n = String(r.out).split('\n').filter(Boolean).length;
    echo(`✔ 身份 ${user} 可访问该远端（远端引用 ${n} 个）`);
    return;
  }
  // git 本身跑不起来时不要误报成"密钥/权限"问题
  if (r.code === 'ENOENT' || r.code === 'EPERM') {
    echo('❌ 无法执行 git（未安装或被环境限制），并非身份/密钥问题。');
    throw new Error('git 不可用，无法探测远端。');
  }
  echo(`❌ 身份 ${user} 无法访问该远端。`);
  const lines = String(r.stderr).trim().split('\n').filter(Boolean).slice(-4);
  for (const l of lines) echo('  ' + l);
  throw new Error('ls-remote 失败（密钥未在平台注册 / 无权限 / 地址有误）。');
}

function currentOrigin() {
  try {
    return gitOut(['remote', 'get-url', 'origin']) || '';
  } catch {
    return '';
  }
}

/** git 命令是否可用（未安装时应给出明确指引，而不是抛 ENOENT）
 *  注意：只有 ENOENT 才算「没装 git」；其它错误（权限/沙箱限制等）说明 git 存在。 */
function hasGitBinary() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return !!e && e.code !== 'ENOENT';
  }
}

/** 取仓库根目录；读取失败时退回 cwd，避免因 git 输出不可读而中断流程 */
function repoRootOrCwd() {
  try {
    return gitOut(['rev-parse', '--show-toplevel']) || process.cwd();
  } catch {
    return process.cwd();
  }
}

/** 当前会话能否安全交互提问（无 TTY 时 prompt 会挂住，必须避免） */
function canPrompt() {
  return !!process.stdin.isTTY;
}

/** 非 git 目录时的初始化指引文案 */
function printInitGuide(hint) {
  echo('  初始化项目的方式（任选其一）:');
  echo('    1) 只建仓库:                git init');
  echo('    2) 建仓库 + 绑定 + 初始提交:  ego start <user>');
  echo(`  完成后再运行 \`${hint}\` 绑定身份即可。`);
}

/**
 * 前置检测：当前目录是否处于 Git 管理之下。
 * - 未安装 git            → 提示安装并中止
 * - 不在仓库内（无 .git）  → 提示「没有 Git 管理」+ 初始化指引，并引导用户当场初始化：
 *     · 交互模式：询问是否执行 git init（默认 Y）
 *     · --init / --yes：非交互，直接执行 git init
 *     · 无 TTY 且未给 flag：不提问（避免挂住），直接报错并给出步骤
 * 返回仓库根目录；用户拒绝或无 TTY 时抛错。
 */
async function ensureGitRepo({ yes = false, init = false, hint = 'ego init' } = {}) {
  if (!hasGitBinary()) {
    echo('❌ 未检测到 git 命令，无法进行身份绑定。');
    echo('   请先安装 Git（含 ssh）: https://git-scm.com/downloads');
    throw new Error('当前环境未安装 git。');
  }
  if (isInsideRepo()) return repoRootOrCwd();

  echo('⚠ 当前目录没有 Git 管理（未检测到 .git 仓库）。');
  echo(`  目录: ${process.cwd()}`);
  echo('');
  printInitGuide(hint);
  echo('');

  const autoInit = yes || init;
  if (autoInit) {
    echo(`▶ ${yes ? '--yes' : '--init'} 已指定，自动执行 git init`);
  } else if (!canPrompt()) {
    throw new Error(
      `当前目录没有 Git 管理，且非交互环境无法确认。请先 \`git init\`（或 \`ego start <user>\`），再运行 \`${hint}\`。`
    );
  } else {
    const a = await prompt('是否现在执行 git init 初始化当前目录? (Y/n): ');
    if (a.toLowerCase() === 'n') {
      throw new Error(
        `已取消：当前目录仍未纳入 Git 管理。请先 \`git init\`（或 \`ego start <user>\`），再运行 \`${hint}\`。`
      );
    }
  }
  git(['init']);
  echo('✔ 已初始化 Git 仓库（未产生提交）。');
  echo('');
  return repoRootOrCwd();
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
    if (keyAbs && ssh.includes(keyAbs.replace(/\\/g, '/'))) return k;
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

// ---- 备份 / 恢复 ----
export function cmdExport({ withKeys = false, outFile } = {}) {
  const users = loadUsers();
  const repos = loadRepos();
  const repoList = [];
  const skipped = [];
  for (const [p, u] of Object.entries(repos)) {
    if (!existsSync(p)) {
      skipped.push(`${p}（目录不存在）`);
      continue;
    }
    let remote = '';
    try {
      remote = execFileSync('git', ['-C', p, 'remote', 'get-url', 'origin'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    } catch {}
    if (remote) repoList.push({ remote, user: u });
    else skipped.push(`${p}（无 origin，无法生成克隆步骤）`);
  }
  const data = { app: 'ego', version: 1, exportedAt: new Date().toISOString(), users, repos: repoList };
  if (withKeys) {
    data.keys = {};
    for (const u of Object.values(users)) {
      if (!u.key) continue;
      const abs = expandHome(u.key);
      try {
        data.keys[basename(abs)] = {
          priv: readFileSync(abs).toString('base64'),
          pub: readFileSync(abs + '.pub').toString('base64')
        };
      } catch {}
    }
  }
  const file = outFile || join(CONFIG_DIR, 'export-' + new Date().toISOString().slice(0, 10) + '.json');
  // 默认输出目录由 saveUsers/saveRepos 顺带创建，这里必须自己保证存在（否则首次 export 直接 ENOENT）
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
  echo(`已导出到 ${file}`);
  echo(`  身份 ${Object.keys(users).length} 个，仓库清单 ${repoList.length} 条${withKeys ? '，含 SSH 私钥（请务必妥善保管）' : ''}`);
  if (skipped.length) {
    echo(`  ⚠ ${skipped.length} 个绑定仓库未纳入清单:`);
    skipped.forEach((s) => echo('    - ' + s));
  }
}

export async function cmdImport(file, { yes = false } = {}) {
  if (!file) throw new Error('用法: ego import <备份文件> [--yes]');
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error('无法读取或解析备份文件。');
  }
  if (data.app !== 'ego') throw new Error('不是 ego 备份文件（app 字段不符）。');

  const users = loadUsers();
  const incoming = data.users && typeof data.users === 'object' ? data.users : {};
  const conflict = Object.keys(incoming).filter((k) => users[k]);
  if (conflict.length && !yes) {
    echo(`备份中的身份与本地冲突: ${conflict.join(', ')}`);
    const a = await prompt(`覆盖这些身份? (y/N): `);
    if (a.toLowerCase() !== 'y') {
      echo('已取消。');
      return;
    }
  }
  for (const [k, v] of Object.entries(incoming)) users[k] = v;
  saveUsers(users);

  // 恢复私钥，并把用户 key 归一化为 ~/.ssh/<basename>
  if (data.keys && typeof data.keys === 'object') {
    const sshDir = join(homedir(), '.ssh');
    // 全新机器上 ~/.ssh 往往不存在，必须先建（否则部分导入：身份已写、密钥丢失）
    mkdirSync(sshDir, { recursive: true });
    let restored = 0;
    for (const [name, k] of Object.entries(data.keys)) {
      // 备份里的键名来自外部文件：拒绝任何路径成分，避免 ../ 越界写入 ~/.ssh 之外
      if (basename(name) !== name || name === '.' || name === '..') {
        echo(`⚠ 备份中的密钥名不安全，已跳过: ${name}`);
        continue;
      }
      if (k && k.priv) {
        writeFileSync(join(sshDir, name), Buffer.from(k.priv, 'base64'));
        if (k.pub) writeFileSync(join(sshDir, name + '.pub'), Buffer.from(k.pub, 'base64'));
        restored++;
      }
    }
    for (const k of Object.keys(users)) {
      const u = users[k];
      if (u && u.key && data.keys[basename(expandHome(u.key))]) {
        u.key = '~/.ssh/' + basename(expandHome(u.key));
      }
    }
    saveUsers(users);
    echo(`已恢复 ${restored} 个 SSH 密钥到 ~/.ssh/`);
  }

  echo(`已恢复身份 ${Object.keys(incoming).length} 个。`);
  const list = Array.isArray(data.repos) ? data.repos : [];
  if (list.length) {
    echo('\n仓库绑定清单（在新设备上逐个执行）:');
    for (const r of list) {
      echo(`  git clone ${r.remote}`);
      echo(`    cd <仓库目录> && ego init ${r.user}`);
    }
  } else {
    echo('备份中没有仓库清单。');
  }
  if (data.keys) {
    echo('\n⚠ 备份含私钥，如不再需要请删除该备份文件。');
  }
}
