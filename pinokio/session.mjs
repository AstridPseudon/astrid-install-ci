// One foreground shell owns the Runtime and (when selected) the editor. Build
// uses the same owner temporarily and always releases it in finally.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import app from './lib.js';
import { bounded, createController, DOWN_MS, runCommand } from './lifecycle.mjs';

export function installation(root, { platform = process.platform, filesystem = fs, environment = process.env } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const read = (file) => JSON.parse(filesystem.readFileSync(file, 'utf8'));
  const version = filesystem.readFileSync(p.join(root, 'current'), 'utf8').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version)) throw new Error('Invalid Astrid version pointer.');
  const versionRoot = p.join(root, 'versions', version);
  const record = read(p.join(versionRoot, 'version.json'));
  const install = read(p.join(root, 'install.json'));
  if (install.owner !== 'haus.astrid.runtime' || install.managed_by !== 'pinokio') throw new Error("This copy of Astrid wasn't installed with Pinokio.");
  for (const value of [record.root, record.python, record.profile, record.env?.ASTRID_NODE_EXECUTABLE, install.data_root]) {
    if (typeof value !== 'string' || !p.isAbsolute(value)) throw new Error('Incomplete Astrid installation record.');
  }
  if (p.resolve(record.root) !== p.resolve(versionRoot)) throw new Error('Astrid version points outside the program root.');
  const node = record.env.ASTRID_NODE_EXECUTABLE;
  const relative = p.relative(versionRoot, node);
  if (!relative || relative === '..' || relative.startsWith(`..${p.sep}`) || p.isAbsolute(relative)) throw new Error('Pinned Node is outside the installed version.');
  const npm = platform === 'win32'
    ? p.join(p.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : p.resolve(p.dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npx = p.join(p.dirname(npm), 'npx-cli.js');
  for (const file of [node, npm, npx, record.python, record.profile]) {
    if (!filesystem.existsSync(file)) throw new Error(`Astrid installed file is missing: ${file}`);
  }
  const env = { ...environment, ...record.env };
  // No ambient developer checkout or discovery may redirect the editor.
  for (const key of ['PYTHONPATH', 'PYTHONHOME', 'PYTHONNOUSERSITE', 'GIT_CONFIG_GLOBAL', 'NODE_OPTIONS', 'ASTRID_WORKSPACE_ENDPOINT', 'ASTRID_WORKSPACE_CREDENTIAL',
    'ASTRID_RUNTIME_CHECKOUT', 'ASTRID_CHECKOUT', 'ASTRID_PUBLIC_CHECKOUT', 'ASTRID_APP_HOSTED_ORIGIN_CONFIG',
    'ASTRID_APP_PAIRED_RELAY_ORIGIN']) delete env[key];
  Object.assign(env, {
    ASTRID_INSTALL_MANAGED_BY: 'pinokio', ASTRID_RUNTIME_DOOR_PORT: '17340',
    ASTRID_RUNTIME_DATA_ROOT: install.data_root, ASTRID_SUPPORT_ROOT: install.data_root,
    ASTRID_WORKSPACE_DISCOVERY: p.join(install.data_root, 'runtime', 'discovery.json'),
    ASTRID_RUNTIME_PYTHON: record.python, ASTRID_RUNTIME_SOURCE_MANIFEST: record.profile,
    // These are explicitly empty so .env.local cannot restore a checkout.
    ASTRID_RUNTIME_CHECKOUT: '', ASTRID_CHECKOUT: '', ASTRID_PUBLIC_CHECKOUT: '',
    ASTRID_START_COMMAND: p.join(root, platform === 'win32' ? 'run.cmd' : 'run'),
    npm_execpath: npm, npm_node_execpath: node,
    PORT: '5180', VITE_ASTRID_DYNAMIC_PROXY_PORT: '17336',
  });
  const pathKey = platform === 'win32' ? Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'Path' : 'PATH';
  const previousPath = env[pathKey] || '';
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env[pathKey] = `${p.dirname(node)}${platform === 'win32' ? ';' : ':'}${previousPath}`;
  return { node, npm, npx, python: record.python, profile: record.profile, data: install.data_root, env };
}

export function commands(root, editor, mode, installed, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const off = mode === 'local';
  const runtimeArgs = off ? ['--hosted-origin', 'off'] : [];
  let runtime;
  if (platform === 'win32') {
    const entry = p.join(root, 'run.cmd');
    if (/[\r\n"%]/.test(entry)) throw new Error('The Windows install path cannot contain quotes, % or newlines.');
    runtime = { command: environmentCmd(installed.env), args: ['/d', '/s', '/c', `""${entry}"${runtimeArgs.length ? ` ${runtimeArgs.join(' ')}` : ''}"`], windowsVerbatimArguments: true };
  } else runtime = { command: p.join(root, 'run'), args: runtimeArgs };
  return {
    runtime,
    down: { command: installed.python, args: ['-I', '-m', 'astrid_runtime', 'down', '--profile', 'astrid', '--data-root', installed.data, '--source-manifest', installed.profile, '--json'] },
    status: { command: installed.python, args: ['-I', '-m', 'astrid_runtime', 'status', '--data-root', installed.data, '--json'] },
    dependencies: { command: installed.node, args: [installed.npx, '-y', 'npm@11', 'ci', '--no-audit', '--no-fund'] },
    build: { command: installed.node, args: ['scripts/dev-local-workspace.mjs', '--build'] },
    preview: { command: installed.node, args: ['scripts/dev-local-workspace.mjs', '--preview', '--preview-dir', p.join(editor, 'dist')] },
  };
}
const environmentCmd = (env) => env.ComSpec || env.COMSPEC || path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');

// On macOS a disappearing/zombie-only process group can report EPERM rather
// than ESRCH. Ignore that only after ps confirms no live group members remain.
export function signalGroup(pid, signal, { killProcess = process.kill.bind(process),
  snapshot = () => spawnSync('/bin/ps', ['-A', '-o', 'pgid=,stat='], { encoding: 'utf8' }) } = {}) {
  try { killProcess(-pid, signal); }
  catch (error) {
    if (error.code === 'ESRCH') return;
    if (error.code === 'EPERM') {
      const result = snapshot();
      if (result.status === 0 && !result.stdout.trim().split('\n').some((line) => {
        const [group, state] = line.trim().split(/\s+/);
        return Number(group) === pid && state && !state.startsWith('Z');
      })) return;
    }
    throw error;
  }
}

export async function runSession({ action, root, editor, mode, platform = process.platform,
  installed = installation(root), spawnProcess = spawn, request = fetch,
  portOpen = app.tcpPortOpen, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  killProcess = process.kill.bind(process), signals = process, output = console.log,
  startupDeadlineMs = 180_000, openController = createController, gracefulDown = runCommand,
  limit = bounded } = {}) {
  if (!['serve', 'build'].includes(action) || !['backend', 'local'].includes(mode)) throw new Error('Invalid Astrid session arguments.');
  const specs = commands(root, editor, mode, installed, platform);
  const env = { ...installed.env };
  if (mode === 'local') env.ASTRID_APP_LOOPBACK_ORIGIN = 'off';
  else delete env.ASTRID_APP_LOOPBACK_ORIGIN;
  const children = [];
  let stopping = false;
  let discovery;
  let runtimeItem;
  let editorItem;
  let controller;
  let stopRequested = false;
  let cleanupPromise;
  let failure;
  let wakeFailure;
  const failed = new Promise((_, reject) => { wakeFailure = reject; });
  failed.catch(() => {});
  const fail = (error) => { failure ??= error; wakeFailure(failure); };

  function launch(spec, { cwd = root, capture = false, persistent = false } = {}) {
    if (stopping) throw new Error('Astrid start cancelled.');
    const child = spawnProcess(spec.command, spec.args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      detached: platform !== 'win32', ...(spec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}) });
    const item = { child, done: null, closed: false, released: false, stdout: '' };
    children.push(item);
    if (capture) { child.stdout?.on('data', (chunk) => { item.stdout += chunk; }); child.stderr?.on('data', () => {}); }
    item.done = new Promise((resolve, reject) => {
      child.once('error', (error) => { item.closed = true; reject(error); if (persistent) fail(error); });
      child.once('close', (code, signal) => {
        item.closed = true;
        if (persistent && !stopping) fail(new Error(`Astrid quit unexpectedly (${signal || code}).`));
        resolve(code);
      });
    });
    item.done.catch(() => {});
    return item;
  }
  const checked = async (spec, options) => {
    const item = launch(spec, options);
    const code = await Promise.race([item.done, failed]);
    await terminate(item);
    if (code !== 0) throw new Error(`Astrid command failed (exit ${code}): ${path.basename(spec.command)}`);
    return item;
  };
  async function runtimeHealthy() {
    const item = launch(specs.status, { capture: true });
    const code = await Promise.race([item.done, failed]);
    await terminate(item);
    if (code !== 0) return false;
    try {
      const status = JSON.parse(item.stdout);
      const healthy = status.support?.healthy === true && !status.stale_discovery && status.health?.status === 'ok';
      if (healthy) discovery = status.discovery;
      return healthy;
    } catch { return false; }
  }
  async function waitUntil(check, description) {
    const deadline = Date.now() + startupDeadlineMs;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (await Promise.race([check(), failed])) return;
      await Promise.race([pause(500), failed]);
    }
    throw new Error(`${description} didn't start in time. Check the messages above, then try again.`);
  }
  async function terminate(item) {
    if (item.released || !item.child.pid) return;
    if (item.closed && platform === 'win32') { item.released = true; return; }
    if (platform === 'win32') {
      const killer = spawnProcess(path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(item.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      await new Promise((resolve, reject) => { killer.once('error', reject); killer.once('close', (code) => code === 0 || item.closed ? resolve() : reject(new Error(`Could not stop Astrid process tree ${item.child.pid}.`))); });
    } else {
      if (!item.closed) signalGroup(item.child.pid, 'SIGTERM', { killProcess });
      let rejectEscalation;
      const escalation = new Promise((_, reject) => { rejectEscalation = reject; });
      const timer = setTimeout(() => {
        try { signalGroup(item.child.pid, 'SIGKILL', { killProcess }); } catch (error) { rejectEscalation(error); }
      }, 5000);
      try { await Promise.race([item.done, escalation]); } finally { clearTimeout(timer); }
      // A group can outlive its leader (for example an npm child after a failed
      // build). Drain it even when the direct child has already closed.
      signalGroup(item.child.pid, 'SIGKILL', { killProcess });
    }
    await item.done;
    item.released = true;
  }
  function shutdown() {
    return cleanupPromise ??= (async () => {
      stopping = true;
      const errors = [];
      // The editor (and any in-flight build/status command) goes first.
      for (const item of [...children].reverse().filter((owned) => owned !== runtimeItem && !owned.released)) {
        try {
          if (stopRequested && item === editorItem && platform !== 'win32' && !item.closed) {
            // Keep a hung editor root alive so Pinokio can still enumerate and
            // kill all descendants, including the app's detached Vite groups.
            signalGroup(item.child.pid, 'SIGTERM', { killProcess });
            await limit(item.done, 5000, 'Editor stop');
            item.released = true;
          } else await limit(terminate(item), 8000, 'Editor/command stop');
        }
        catch (error) { errors.push(error.message); }
      }
      if (runtimeItem && !runtimeItem.released) {
        if (!runtimeItem.closed && discovery?.runtime_instance_id && errors.length === 0) {
          try {
            await gracefulDown(specs.down, { env, cwd: root, timeoutMs: DOWN_MS });
            await limit(runtimeItem.done, 5000, 'Runtime exit after down');
          } catch (error) { errors.push(error.message); }
        } else if (!runtimeItem.closed && !discovery?.runtime_instance_id) {
          // Startup never established custody. Signal only the owned foreground
          // process; do not down a stale/external discovery at the same root.
          try { await limit(terminate(runtimeItem), 8000, 'Starting Runtime stop'); }
          catch (error) { errors.push(error.message); }
        }
        // Controlled Stop leaves a failed/live Runtime for Pinokio's final tree
        // kill. Direct signals and temporary builds have to drain it themselves.
        if (!stopRequested || runtimeItem.closed) {
          try { await limit(terminate(runtimeItem), 8000, 'Runtime cleanup'); }
          catch (error) { errors.push(error.message); }
        }
      }
      return { ok: errors.length === 0, errors };
    })();
  }
  const requestStop = () => {
    stopRequested = true;
    stopping = true;
    fail(new Error('Astrid session stopped.'));
    return shutdown();
  };
  const onSignal = () => { stopping = true; fail(new Error('Astrid session stopped.')); };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) signals.on(signal, onSignal);
  try {
    // Never attach the editor to someone else's same-data-root Runtime.
    if (await runtimeHealthy()) throw new Error('Another Astrid is already running with your projects. Stop it, then try again.');
    if (mode === 'local' && action === 'serve' && await portOpen(5180)) throw new Error("Another program is using port 5180, so Astrid's editor can't start. Close it, then try again.");
    controller = await openController(root, requestStop);
    if (action === 'build') await checked(specs.dependencies, { cwd: editor });
    discovery = undefined;
    runtimeItem = launch(specs.runtime, { persistent: true });
    await waitUntil(runtimeHealthy, 'Astrid');
    if (action === 'build') {
      await checked(specs.build, { cwd: editor });
    } else {
      if (mode === 'local') editorItem = launch(specs.preview, { cwd: editor, persistent: true });
      const url = mode === 'local' ? 'http://127.0.0.1:5180/tools/video-editor' : app.DOOR_HEALTH_URL;
      await waitUntil(async () => {
        try {
          const response = await request(url, { signal: AbortSignal.timeout(2500), headers: mode === 'backend' ? { Origin: 'https://astrid.haus' } : {} });
          if (mode === 'local') {
            if (!response.ok) return false;
            const config = await request('http://127.0.0.1:5180/runtime-config/v1/workspace.json', { signal: AbortSignal.timeout(2500) });
            const binding = await config.json();
            return config.ok && binding.schemaVersion === 1 && Boolean(discovery?.runtime_instance_id)
              && binding.runtimeInstanceId === discovery.runtime_instance_id && binding.realmId === discovery.active_realm;
          }
          const body = await response.json();
          return response.status === 200 && body.status === 'ok' && body.protocol === 'workspace.v1';
        } catch { return false; }
      }, mode === 'local' ? "Astrid's editor" : 'Astrid');
      if (failure) throw failure;
      output('ASTRID_PINOKIO_READY');
      await failed;
    }
  } catch (error) {
    if (!stopRequested) throw error;
  } finally {
    const result = await shutdown();
    await controller?.close();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) signals.removeListener(signal, onSignal);
    if (!result.ok && !stopRequested) throw new Error(result.errors.join(' '));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, root, editor, mode] = process.argv.slice(2);
  runSession({ action, root, editor, mode }).catch((error) => { console.error(`Astrid: ${error.message}`); process.exitCode = 1; });
}
