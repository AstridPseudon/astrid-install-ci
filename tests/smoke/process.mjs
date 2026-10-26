import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

// Start's output pipes must keep draining while render/HTTP commands wait for
// it. A synchronous subprocess blocks that drain and can deadlock the server.
export async function runTool(command, args, environment) {
  const pending = execute(command, args, {
    encoding: 'utf8', env: environment, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  });
  pending.child.stdin.end();
  const { stdout } = await pending;
  return stdout;
}

export async function timedStep(name, action, log) {
  const started = performance.now();
  log(`START ${name}`);
  let result = 'failed';
  try {
    const value = await action();
    result = 'passed';
    return value;
  } finally {
    log(`END ${name}: ${result} (${((performance.now() - started) / 1000).toFixed(2)}s)`);
  }
}
