// Pinokio's shell.run env can add variables but cannot remove inherited ones.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import policy from './environment.js';

export function runShell({ appDirectory, message, explicit = {}, platform = process.platform,
  environment = process.env, spawnProcess = spawn, ...options }) {
  const env = policy.buildEnvironment({ appDirectory, platform, environment, explicit, ...options });
  const win = platform === 'win32';
  const shell = win ? path.win32.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/bash';
  const args = win ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `$ErrorActionPreference = 'Stop'\n${message}`]
    : ['--noprofile', '--norc', '-c', `set -eu\nunset PWD\n${message}`];
  // Nested installer shells recreate PWD. Run them outside Pinokio's home;
  // every launcher command uses absolute paths (including Git's -C).
  const child = spawnProcess(shell, args, { env, cwd: env.HOME || env.USERPROFILE, stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [appDirectory, message, explicit] = process.argv.slice(2);
  try { process.exitCode = await runShell({ appDirectory, message, explicit: JSON.parse(explicit) }); }
  catch (error) { console.error(`Astrid: ${error.message}`); process.exitCode = 1; }
}
