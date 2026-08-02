import { execFileSync, execSync } from 'node:child_process';

export function git(args, { cwd = process.cwd() } = {}) {
  execFileSync('git', args, { cwd, stdio: 'inherit' });
}
export function gitOut(args, { cwd = process.cwd() } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
export function run(cmd, { cwd = process.cwd() } = {}) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}
export function runFile(file, args, opts = {}) {
  execFileSync(file, args, { cwd: process.cwd(), stdio: 'inherit', ...opts });
}
