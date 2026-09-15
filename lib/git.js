import { execFileSync, execSync } from 'node:child_process';

/** env 为「增量」环境变量：仅在传入时叠加到 process.env 上（供 GIT_SSH_COMMAND 借用身份） */
function withEnv(opts) {
  const { env, ...rest } = opts;
  return env ? { ...rest, env: { ...process.env, ...env } } : rest;
}

export function git(args, { cwd = process.cwd(), env } = {}) {
  execFileSync('git', args, withEnv({ cwd, stdio: 'inherit', env }));
}
export function gitOut(args, { cwd = process.cwd(), env } = {}) {
  // 读取性命令失败是常态（如无 origin），忽略 stderr 防止泄漏
  return execFileSync('git', args, withEnv({ cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env })).trim();
}
export function run(cmd, { cwd = process.cwd() } = {}) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}
export function runFile(file, args, opts = {}) {
  execFileSync(file, args, { cwd: process.cwd(), stdio: 'inherit', ...opts });
}
