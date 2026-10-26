// Pinokio's shell.run env can add variables but cannot remove inherited ones.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import policy from './environment.js';

export function runShell({ appDirectory, message, explicit = {}, platform = process.platform,
  environment = process.env, spawnProcess = spawn, ...options }) {
  const env = policy.buildEnvironment({ appDirectory, platform, environment, explicit, ...options });
  const win = platform === 'win32';
  const shell = win ? path.win32.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/bash';
  const args = win ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `$ErrorActionPreference = 'Stop'\n$global:LASTEXITCODE = 0\n${message}\nexit $LASTEXITCODE`]
    : ['--noprofile', '--norc', '-c', `set -eu\nunset PWD\n${message}`];
  // Nested installer shells recreate PWD. Run them outside Pinokio's home;
  // every launcher command uses absolute paths (including Git's -C).
  const child = spawnProcess(shell, args, { env, cwd: env.HOME || env.USERPROFILE, stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const [argument, message, explicit] = process.argv.slice(2);
  try {
    const prefix = '--pinokio-payload=';
    const options = argument?.startsWith(prefix)
      ? JSON.parse(Buffer.from(argument.slice(prefix.length), 'base64').toString('utf8'))
      : { appDirectory: argument, message, explicit: JSON.parse(explicit) };
    process.exitCode = await runShell(options);
  }
  catch (error) { console.error(`Astrid: ${error.message}`); process.exitCode = 1; }
}
