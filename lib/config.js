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
export function loadProjectConfig() {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), '.git-tool.json'), 'utf8'));
  } catch {
    return {};
  }
}
export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}
