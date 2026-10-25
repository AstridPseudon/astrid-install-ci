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
  environment = process.env, filesystem = fs, probe = probeDoor } = {}) {
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
    try {
      const lines = filesystem.readFileSync(paths.join(APP_DIR, 'ENVIRONMENT'), 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (match?.[1] === name) return match[2].replace(/^(?:"(.*)"|'(.*)')$/, (_all, a, b) => a ?? b);
      }
    } catch { /* ENVIRONMENT is optional. */ }
    return fallback;
  }

  function appRef() {
    const ref = setting('ASTRID_APP_REF').trim();
    if (ref && (ref.startsWith('-') || /[\s\\?#\x00-\x1f]/.test(ref) || ref.split('/').some((part) => !part || part === '..' || part === '.'))) {
      throw new Error('ASTRID_APP_REF must be a Git branch or tag, such as feat/pinokio.');
    }
    return ref;
  }

  function bootstrapScript(action = 'install', manifest, deleteData = false) {
    if (!['install', 'update', 'uninstall'].includes(action)) throw new Error('Unknown installer action.');
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

  function shellStep(message, { cwd = APP_DIR, env, on } = {}) {
    // Pinokio resolves a shell at its prompt even after a nonzero exit. Emit
    // a dedicated failure event so the next step (especially local.set/save)
    // cannot run after a failed command. Split the marker in source to avoid
    // matching the terminal's echo of the submitted command itself.
    const wrapped = isWindows
      ? `& {\n$ErrorActionPreference = 'Stop'\ntry {\n${message}\n} catch {\nWrite-Output ('ASTRID_PINOKIO_' + 'FAILURE')\nthrow\n}\n}`
      : `bash --noprofile --norc -c ${posix.quote(`set -eu\n${message}`)}\nstatus=$?\nif [ "$status" -ne 0 ]; then printf 'ASTRID_PINOKIO_%s\\n' FAILURE; fi`;
    return { method: 'shell.run', params: { shell: shellName, path: cwd, message: wrapped, input: false,
      ...(env ? { env } : {}), on: [{ event: '/ASTRID_PINOKIO_FAILURE/', break: true }, ...(on || [])] } };
  }
  const customStep = (method) => ({ method });
  const ensureProgramDirectory = () => filesystem.mkdirSync(PROGRAMS_DIR, { recursive: true });
  function readInstallMode() {
    try {
      const record = JSON.parse(filesystem.readFileSync(MODE_FILE, 'utf8'));
      return record?.schema_version === 1 && ['backend', 'local'].includes(record.mode) ? record.mode : null;
    } catch { return null; }
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
    if (!filesystem.existsSync(paths.join(EDITOR_DIR, '.git'))) throw new Error('The editor folder is not a Git checkout. Reset or move it first.');
    const result = spawnSync('git', ['-C', EDITOR_DIR, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 || result.stdout.trim().replace(/\.git$/, '').replace(/\/$/, '').toLowerCase() !== EDITOR_REPOSITORY.toLowerCase()) {
      throw new Error(`The editor checkout must use ${EDITOR_REPOSITORY}.`);
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
    const helper = paths.join(APP_DIR, 'pinokio', 'session.mjs');
    const args = [helper, action, BACKEND_ROOT, EDITOR_DIR, mode].map(q).join(' ');
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
  async function stopOwnedStart(_req, ondata, kernel) {
    // script.stop in the inspected Pinokio version does not await api.stop.
    // Await it directly, using an absolute URI so resolution is unambiguous.
    const uri = paths.join(APP_DIR, 'pinokio', 'start.js');
    if (kernel.api.running && !kernel.api.running[uri]) return { stopped: false };
    await kernel.api.stop({ params: { uri } });
    ondata?.({ raw: 'Stopped Astrid processes owned by this Pinokio launcher.\r\n' });
  }
  async function ensureDoorPortFree(_req, ondata) {
    const result = await probe();
    if (result.kind === 'free') return { free: true };
    const message = result.kind === 'astrid'
      ? 'Astrid is already running on port 17340. Use Open Astrid; stop that instance before starting this install.'
      : 'Another program is using port 17340. Stop it before starting Astrid.';
    ondata?.({ raw: message });
    throw new Error(message);
  }
  return { APP_DIR, PROGRAMS_DIR, BACKEND_ROOT, EDITOR_DIR, MODE_FILE, isWindows, shellName, paths,
    getPaths: () => ({ root: BACKEND_ROOT, editor: EDITOR_DIR }), setting, appRef, bootstrapScript,
    shellStep, customStep, ensureProgramDirectory, readInstallMode, saveModeStep, removeProgramFiles,
    validateExistingEditorCheckout, cloneEditorMessage, pullEditorMessage, sessionMessage, sessionStep,
    stopOwnedStart, ensureDoorPortFree, probeDoor: probe, modeOpenTarget, localSetOpenTarget,
    runScript: (root, args) => (isWindows ? windows : posix).run(root, args),
    ...CONSTANTS };
}

const EDITOR_REPOSITORY = 'https://github.com/banodoco/astrid-app';
const DOOR_HEALTH_URL = 'http://127.0.0.1:17340/api/runtime/v1/health';
const HOSTED_OPEN_URL = 'https://astrid.haus/?connect=1';
const LOCAL_OPEN_URL = 'http://127.0.0.1:5180/tools/video-editor?connect=1';
const CONSTANTS = { EDITOR_REPOSITORY, DOOR_HEALTH_URL, HOSTED_OPEN_URL, LOCAL_OPEN_URL };
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
