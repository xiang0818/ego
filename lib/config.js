import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const CONFIG_DIR = join(homedir(), '.git-tool');
export const USERS_FILE = join(CONFIG_DIR, 'users.json');

export function loadUsers() {
  try {
    const data = JSON.parse(readFileSync(USERS_FILE, 'utf8'));
    return data && typeof data.users === 'object' ? data.users : {};
  } catch {
    return {};
  }
}
export function saveUsers(users) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  let data = {};
  try {
    data = JSON.parse(readFileSync(USERS_FILE, 'utf8'));
  } catch {}
  data.users = users;
  writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}
export function loadRepos() {
  try {
    const data = JSON.parse(readFileSync(USERS_FILE, 'utf8'));
    return data && typeof data.repos === 'object' ? data.repos : {};
  } catch {
    return {};
  }
}
export function saveRepos(repos) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  let data = {};
  try {
    data = JSON.parse(readFileSync(USERS_FILE, 'utf8'));
  } catch {}
  data.repos = repos;
  writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}
/** 读取项目配置；baseDir 应传仓库根目录（在子目录里跑命令时 cwd 不含 .git-tool.json） */
export function loadProjectConfig(baseDir = process.cwd()) {
  try {
    const data = JSON.parse(readFileSync(join(baseDir, '.git-tool.json'), 'utf8'));
    // 文件内容可能是 null / 数组 / 标量：统一回落到空对象，避免下游读属性崩溃
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}
export function expandHome(p) {
  if (!p || typeof p !== 'string') return '';
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}
