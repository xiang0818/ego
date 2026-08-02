import { execFileSync, execSync } from 'node:child_process';

export function git(args, { cwd = process.cwd() } = {}) {
  execFileSync('git', args, { cwd, stdio: 'inherit' });
}
export function gitOut(args, { cwd = process.cwd() } = {}) {
  // 读取性命令失败是常态（如无 origin），忽略 stderr 防止泄漏
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
export function run(cmd, { cwd = process.cwd() } = {}) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}
export function runFile(file, args, opts = {}) {
  execFileSync(file, args, { cwd: process.cwd(), stdio: 'inherit', ...opts });
}
