'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const posix = require('./platforms/posix');
const windows = require('./platforms/windows');

// The factory keeps platform command generation testable without executing a
// shell, querying the real ports, or writing into a real installation.
function createApp({ platform = process.platform, appDirectory = path.resolve(__dirname, '..'),
  environment = process.env, filesystem = fs, probe = probeDoor, lifecycle, execute = spawnSync, getTemp } = {}) {
  const isWindows = platform === 'win32';
  const paths = isWindows ? path.win32 : path.posix;
  const APP_DIR = appDirectory;
  const PROGRAMS_DIR = paths.join(APP_DIR, 'app');
  const BACKEND_ROOT = paths.join(PROGRAMS_DIR, 'astrid');
  const EDITOR_DIR = paths.join(PROGRAMS_DIR, 'editor');
  const MODE_FILE = paths.join(PROGRAMS_DIR, 'install-mode.json');
  const shellName = isWindows ? 'powershell.exe' : 'bash';
  const q = isWindows ? windows.quotePowerShell : posix.quote;

  function setting(name, fallback = '') {
    if (environment[name] !== undefined) return environment[name];
    for (const file of ['ENVIRONMENT', '_ENVIRONMENT']) {
      try {
        const lines = filesystem.readFileSync(paths.join(APP_DIR, file), 'utf8').split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
          if (match?.[1] === name) return match[2].replace(/^(?:"(.*)"|'(.*)')$/, (_all, a, b) => a ?? b);
        }
      } catch { /* Either Pinokio environment file is optional. */ }
    }
    return fallback;
  }

  function launcherPullMessage() {
    const failure = CONSTANTS.LAUNCHER_PULL_FAILURE;
    if (isWindows) {
      return [
        'try {',
        `git -C ${q(APP_DIR)} pull --ff-only`,
        `if ($LASTEXITCODE -ne 0) { throw ${q(failure)} }`,
        '} catch {',
        `Write-Output ${q(failure)}`,
        'throw',
        '}',
      ].join('\n');
    }
    return `git -C ${q(APP_DIR)} pull --ff-only || { printf '%s\\n' ${q(failure)} >&2; exit 1; }`;
  }

  function shellStep(message, { cwd = APP_DIR, env, on, pinokioEnvironment = false } = {}) {
    // Pinokio resolves a shell at its prompt even after a nonzero exit. Emit
    // a dedicated failure event so the next step (especially local.set/save)
    // cannot run after a failed command. Split the marker in source to avoid
    // matching the terminal's echo of the submitted command itself.
    const helper = paths.join(APP_DIR, 'pinokio', 'shell.mjs');
    const command = isWindows
      ? `node ${q(helper)} ${q(`--pinokio-payload=${Buffer.from(JSON.stringify({ appDirectory: APP_DIR, message, explicit: env || {} })).toString('base64')}`)}`
      : `node ${[helper, APP_DIR, message, JSON.stringify(env || {})].map(q).join(' ')}`;
    const wrapped = isWindows
      ? `& {\n$ErrorActionPreference = 'Stop'\ntry {\n${command}\nif ($LASTEXITCODE -ne 0) { throw 'Astrid process failed.' }\n} catch {\nWrite-Output ('ASTRID_PINOKIO_' + 'FAILURE')\nthrow\n}\n}`
      : `${command}\nstatus=$?\nif [ "$status" -ne 0 ]; then printf 'ASTRID_PINOKIO_%s\\n' FAILURE; fi\n(exit "$status")`;
    return { method: 'shell.run', params: { shell: shellName, path: cwd, message: wrapped, input: false,
      ...(pinokioEnvironment ? { env: { ASTRID_PINOKIO_ENVIRONMENT: '1' } } : {}),
      on: [{ event: '/ASTRID_PINOKIO_FAILURE/', break: true }, ...(on || [])] } };
  }

  const gitShellStep = (message) => shellStep(message, { pinokioEnvironment: true });

  function appRef() {
    const ref = setting('ASTRID_APP_REF').trim();
    if (ref && (ref.startsWith('-') || /[\s\\?#\x00-\x1f]/.test(ref) || ref.split('/').some((part) => !part || part === '..' || part === '.'))) {
      throw new Error('ASTRID_APP_REF must be a Git branch or tag, such as main.');
    }
    return ref;
  }

  function bootstrapScript(action = 'install', manifest, deleteData = false) {
    if (!['install', 'update', 'update-app', 'uninstall'].includes(action)) throw new Error('Unknown installer action.');
    if (deleteData && action !== 'uninstall') throw new Error('Data deletion requires uninstall.');
    const ref = appRef();
    const raw = ref ? `https://raw.githubusercontent.com/banodoco/astrid-app/${ref.split('/').map(encodeURIComponent).join('/')}/public` : null;
    return (isWindows ? windows : posix).bootstrap({
      root: BACKEND_ROOT, action, deleteData,
      ...(manifest ? { manifest, installerFile: paths.join(EDITOR_DIR, 'public', isWindows ? 'install.ps1' : 'install') }
        : { installerUrl: raw ? `${raw}/install${isWindows ? '.ps1' : ''}` : `https://astrid.haus/install${isWindows ? '.ps1' : ''}`,
          ...(raw ? { manifestUrl: `${raw}/install-manifest.json` } : {}) }),
    });
  }

  const customStep = (method) => ({ method });
  const ensureProgramDirectory = () => filesystem.mkdirSync(PROGRAMS_DIR, { recursive: true });
  function readInstallMode() {
    try {
      const record = JSON.parse(filesystem.readFileSync(MODE_FILE, 'utf8'));
      return record?.schema_version === 1 && ['backend', 'local'].includes(record.mode) ? record.mode : null;
    } catch { return null; }
  }
  function hasOwnedSupervisor() {
    try {
      const record = JSON.parse(filesystem.readFileSync(paths.join(BACKEND_ROOT, 'pinokio-control.json'), 'utf8'));
      return record.schema === 1 && Number.isInteger(record.pid) && record.pid > 0
        && Number.isInteger(record.port) && record.port > 0 && record.port <= 65535;
    } catch { return false; }
  }
  function saveModeStep(mode) {
    return customStep(async () => {
      ensureProgramDirectory();
      filesystem.writeFileSync(MODE_FILE, `${JSON.stringify({ schema_version: 1, mode }, null, 2)}\n`, { mode: 0o600 });
      return { mode };
    });
  }
  function removeProgramFiles() {
    if (paths.dirname(PROGRAMS_DIR) !== APP_DIR) throw new Error('Refusing to remove files outside the Pinokio app.');
    filesystem.rmSync(PROGRAMS_DIR, { recursive: true, force: true });
  }
  function validateExistingEditorCheckout() {
    if (!filesystem.existsSync(EDITOR_DIR)) return false;
    if (!filesystem.existsSync(paths.join(EDITOR_DIR, '.git'))) throw new Error("Astrid's editor files are damaged. Choose Reset, then install again.");
    const result = execute('git', ['-C', EDITOR_DIR, 'remote', 'get-url', 'origin'], {
      env: environment, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 || result.stdout.trim().replace(/\.git$/, '').replace(/\/$/, '').toLowerCase() !== EDITOR_REPOSITORY.toLowerCase()) {
      throw new Error(`Astrid's editor folder doesn't come from ${EDITOR_REPOSITORY}. Choose Reset, then install again.`);
    }
    return true;
  }
  function cloneEditorMessage() {
    return checkedNative(`git clone --branch ${q(appRef() || 'main')} --single-branch -- ${q(EDITOR_REPOSITORY)} ${q(EDITOR_DIR)}`, 'Editor clone');
  }
  function pullEditorMessage() {
    // Fail if the test ref changed since install; never silently build old pins.
    const ref = appRef() || 'main';
    const check = isWindows
      ? `$branch = (& git -C ${q(EDITOR_DIR)} branch --show-current).Trim()\nif ($LASTEXITCODE -ne 0 -or $branch -ne ${q(ref)}) { throw 'Editor branch differs from ASTRID_APP_REF. Reset and reinstall to change refs.' }`
      : `[ "$(git -C ${q(EDITOR_DIR)} branch --show-current)" = ${q(ref)} ] || { echo 'Editor branch differs from ASTRID_APP_REF. Reset and reinstall to change refs.' >&2; exit 1; }`;
    return `${isWindows ? "$ErrorActionPreference = 'Stop'" : 'set -eu'}\n${check}\n${checkedNative(`git -C ${q(EDITOR_DIR)} pull --ff-only`, 'Editor update')}`;
  }
  function checkedNative(command, label) {
    return isWindows ? `${command}\nif ($LASTEXITCODE -ne 0) { throw '${label} failed.' }` : command;
  }

  function sessionMessage(action, mode = 'local') {
    // Resolve at shell execution time: install/update may have just changed current.
    const helper = paths.join(APP_DIR, 'pinokio', action === 'stop' ? 'lifecycle.mjs' : 'session.mjs');
    const args = (action === 'stop' ? [helper, action, BACKEND_ROOT] : [helper, action, BACKEND_ROOT, EDITOR_DIR, mode]).map(q).join(' ');
    if (isWindows) return [
      "$ErrorActionPreference = 'Stop'",
      `$version = (Get-Content -Raw -LiteralPath ${q(paths.join(BACKEND_ROOT, 'current'))}).Trim()`,
      "if ($version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') { throw 'Invalid Astrid version pointer.' }",
      `$versionRoot = Join-Path ${q(paths.join(BACKEND_ROOT, 'versions'))} $version`,
      "$record = Get-Content -Raw -LiteralPath (Join-Path $versionRoot 'version.json') | ConvertFrom-Json",
      '$node = [IO.Path]::GetFullPath([string]$record.env.ASTRID_NODE_EXECUTABLE)',
      '$prefix = [IO.Path]::GetFullPath($versionRoot) + [IO.Path]::DirectorySeparatorChar',
      "if (-not $node.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Pinned Node is outside the installed version.' }",
      `& $node ${args}`,
      "if ($LASTEXITCODE -ne 0) { throw 'Astrid process failed.' }",
    ].join('\n');
    return [
      'set -eu',
      `version=$(cat ${q(paths.join(BACKEND_ROOT, 'current'))})`,
      `case "$version" in ''|*[!A-Za-z0-9._-]*) echo 'Invalid Astrid version pointer.' >&2; exit 2 ;; esac`,
      `version_root=${q(paths.join(BACKEND_ROOT, 'versions'))}/"$version"`,
      `node=$("$version_root/py/bin/python" -I -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["env"]["ASTRID_NODE_EXECUTABLE"])' "$version_root/version.json")`,
      'case "$node" in "$version_root"/*) ;; *) echo "Pinned Node is outside the installed version." >&2; exit 2 ;; esac',
      `exec "$node" ${args}`,
    ].join('\n');
  }
  function sessionStep(action, mode) {
    return shellStep(sessionMessage(action, mode), { env: { ASTRID_INSTALL_MANAGED_BY: 'pinokio' },
      ...(action === 'serve' ? { on: [{ event: '/ASTRID_PINOKIO_READY/', done: true }] } : {}) });
  }
  function stopHook() {
    // A URI on.stop is only queued by api.process. A direct shell.run is awaited.
    return shellStep(sessionMessage('stop'));
  }
  async function stopOwnedStart(_req, ondata, kernel) {
    const uri = paths.join(APP_DIR, 'pinokio', 'start.js');
    const active = !kernel.api.running || Boolean(kernel.api.running[uri]);
    const operations = lifecycle || await import('./lifecycle.mjs');
    const options = { filesystem, platform, environment, appDirectory: APP_DIR };
    const errors = [];
    if (active || hasOwnedSupervisor()) {
      // Explicitly obtain the result: Pinokio logs but swallows direct hook
      // failures. The same idempotent request also serves the native Stop hook.
      try { await operations.requestGracefulStop(BACKEND_ROOT, options); }
      catch (error) { errors.push(error.message); }
      // Always perform Pinokio's final forced cleanup, even after grace expires.
      try { if (active) await kernel.api.stop({ params: { uri } }); }
      catch (error) { errors.push(error.message); }
    }
    try { await operations.waitForInstallerLock(BACKEND_ROOT, options); }
    catch (error) { errors.push(error.message); }
    if (errors.length) {
      const prefix = 'Astrid is still running. Stop it in Pinokio, then try again.';
      const details = errors.filter((error) => !error.includes(prefix)).join(' ');
      const message = `${prefix}${details ? ` ${details}` : ''}`;
      ondata?.({ raw: `${message}\r\n` });
      throw new Error(message);
    }
    ondata?.({ raw: 'Astrid stopped.\r\n' });
    return { stopped: active, lockFree: true };
  }
  async function ensureDoorPortFree(_req, ondata) {
    const result = await probe();
    if (result.kind === 'free') return { free: true };
    const message = result.kind === 'astrid'
      ? 'Astrid is already running on this computer. Stop it, then try again.'
      : "Another program is using port 17340, so Astrid can't start. Close it, then try again.";
    ondata?.({ raw: message });
    throw new Error(message);
  }
  return { APP_DIR, PROGRAMS_DIR, BACKEND_ROOT, EDITOR_DIR, MODE_FILE, isWindows, shellName, paths,
    getPaths: () => ({ root: BACKEND_ROOT, editor: EDITOR_DIR }), setting, appRef, bootstrapScript,
    shellStep, gitShellStep, launcherPullMessage, customStep, ensureProgramDirectory, readInstallMode, saveModeStep, removeProgramFiles,
    validateExistingEditorCheckout, cloneEditorMessage, pullEditorMessage, sessionMessage, sessionStep,
    stopHook, stopOwnedStart, hasOwnedSupervisor, ensureDoorPortFree, probeDoor: probe, modeOpenTarget, localSetOpenTarget,
    runScript: (root, args) => (isWindows ? windows : posix).run(root, args),
    ...CONSTANTS };
}

const EDITOR_REPOSITORY = 'https://github.com/banodoco/astrid-app';
const DOOR_HEALTH_URL = 'http://127.0.0.1:17340/api/runtime/v1/health';
const HOSTED_OPEN_URL = 'https://astrid.haus/?connect=1';
const LOCAL_OPEN_URL = 'http://127.0.0.1:5180/tools/video-editor?connect=1';
const CONSTANTS = { EDITOR_REPOSITORY, DOOR_HEALTH_URL, HOSTED_OPEN_URL, LOCAL_OPEN_URL,
  LAUNCHER_PULL_FAILURE: "Couldn't update the Pinokio launcher. If you edited its files, undo those edits, then choose Update again." };
function modeOpenTarget(mode) {
  return { href: mode === 'local' ? LOCAL_OPEN_URL : HOSTED_OPEN_URL, popout: mode !== 'local' };
}
const localSetOpenTarget = (mode) => ({ url: modeOpenTarget(mode).href, mode });
function tcpPortOpen(port, { connect = net.createConnection } = {}) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(800, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
async function probeDoor({ portOpen = tcpPortOpen, request = fetch } = {}) {
  if (!(await portOpen(17340))) return { kind: 'free' };
  for (const origin of ['https://astrid.haus', 'http://127.0.0.1:5180', null]) {
    try {
      const response = await request(DOOR_HEALTH_URL, { headers: { Accept: 'application/json', ...(origin ? { Origin: origin } : {}) }, signal: AbortSignal.timeout(1500) });
      const body = await response.json().catch(() => null);
      if ((response.status === 200 && body?.protocol === 'workspace.v1')
        || (response.status === 503 && ['runtime_unavailable', 'runtime_identity_mismatch'].includes(body?.error))
        || (response.status === 403 && body?.error === 'hosted_origin_required')) return { kind: 'astrid' };
    } catch { /* An open socket with no Astrid response belongs to another program. */ }
  }
  return { kind: 'occupied' };
}
module.exports = { ...createApp(), createApp, probeDoor, tcpPortOpen };
