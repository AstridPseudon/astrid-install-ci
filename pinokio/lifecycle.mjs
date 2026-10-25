// Authenticated control of this launcher's supervisor; no ambient Runtime down.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const STOP_FIRST = 'Astrid is still running. Stop it in Pinokio, then try again.';
export const CONTROL_FILE = 'pinokio-control.json';
export const GRACE_MS = 45_000;
export const DOWN_MS = 25_000;
export const LOCK_MS = 10_000;
export function bounded(promise, ms, label, { schedule = setTimeout, cancel = clearTimeout } = {}) {
  let timer;
  const expired = new Promise((_, reject) => { timer = schedule(() => reject(new Error(`${label} timed out.`)), ms); });
  return Promise.race([promise, expired]).finally(() => cancel(timer));
}
export function runCommand(spec, { env, cwd, timeoutMs = DOWN_MS, execute = execFile } = {}) {
  return new Promise((resolve, reject) => {
    execute(spec.command, spec.args, { env, cwd, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`${error.killed ? 'Command timed out' : 'Command failed'}: ${(stderr || stdout || error.message).trim()}`));
        else resolve(stdout);
      });
  });
}
export async function createController(root, stop, { filesystem = fs, pid = process.pid, killProcess = process.kill.bind(process) } = {}) {
  const file = path.join(root, CONTROL_FILE);
  try {
    const prior = JSON.parse(filesystem.readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(prior.pid) || prior.pid < 1) throw new Error('Invalid Astrid controller record. Reset this install.');
    try { killProcess(prior.pid, 0); throw new Error(STOP_FIRST); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    filesystem.unlinkSync(file);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    req.resume();
    if (req.method !== 'POST' || req.url !== '/stop' || req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403); res.end(); return;
    }
    try {
      const result = await stop();
      res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ ok: false, errors: [error.message] }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    filesystem.writeFileSync(file, JSON.stringify({ schema: 1, pid, port: server.address().port, token }), { flag: 'wx', mode: 0o600 });
  } catch (error) { server.close(); throw error; }
  return { close: async () => {
    try { if (JSON.parse(filesystem.readFileSync(file, 'utf8')).token === token) filesystem.unlinkSync(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await bounded(new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); }), 2000, 'Controller close')
      .catch(() => server.closeAllConnections());
  } };
}
export async function requestGracefulStop(root, { filesystem = fs, request = fetch, timeoutMs = GRACE_MS, platform = process.platform, killProcess = process.kill.bind(process) } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  let record;
  try { record = JSON.parse(filesystem.readFileSync(p.join(root, CONTROL_FILE), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { ok: true, absent: true }; throw error; }
  if (record.schema !== 1 || !Number.isSafeInteger(record.pid) || record.pid < 1 || !Number.isInteger(record.port) || record.port < 1 || record.port > 65535 || !/^[a-f0-9]{64}$/.test(record.token)) {
    throw new Error('Invalid Astrid controller record.');
  }
  try { killProcess(record.pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return { ok: true, absent: true }; throw error; }
  const response = await request(`http://127.0.0.1:${record.port}/stop`, { method: 'POST',
    headers: { Authorization: `Bearer ${record.token}` }, signal: AbortSignal.timeout(timeoutMs) });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error((result.errors || ['Graceful stop failed.']).join(' '));
  return result;
}
export async function waitForInstallerLock(root, { filesystem = fs, platform = process.platform, environment = process.env,
  installed, run = runCommand, timeoutMs = LOCK_MS } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  // No program files means there is no mutation to protect. A partial app with
  // files but no usable installed Python fails closed instead of deleting them.
  if (!filesystem.existsSync(p.dirname(root))) return;
  installed ??= (await import('./session.mjs')).installation(root, { filesystem, platform, environment });
  const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'installer-lock.py');
  await run({ command: installed.python, args: ['-I', helper, String(timeoutMs / 1000)] },
    { env: installed.env, cwd: root, timeoutMs: timeoutMs + 2000 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, root] = process.argv.slice(2);
  if (action !== 'stop') throw new Error('Expected lifecycle.mjs stop <program-root>.');
  requestGracefulStop(root).catch((error) => { console.error(`${STOP_FIRST} ${error.message}`); process.exitCode = 1; });
}
