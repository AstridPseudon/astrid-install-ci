'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const posix = require('./platforms/posix');
const windows = require('./platforms/windows');

const APP_DIR = path.resolve(__dirname, '..');
const PROGRAMS_DIR = path.join(APP_DIR, 'app');
const BACKEND_ROOT = path.join(PROGRAMS_DIR, 'astrid');
const EDITOR_DIR = path.join(PROGRAMS_DIR, 'editor');
const MODE_FILE = path.join(PROGRAMS_DIR, 'install-mode.json');
const INSTALL_URL_DEFAULT = 'https://astrid.haus/install';
const EDITOR_REPOSITORY = 'https://github.com/banodoco/astrid-app';
const DOOR_PORT = 17340;
const DOOR_HEALTH_URL = `http://127.0.0.1:${DOOR_PORT}/api/runtime/v1/health`;
const HOSTED_OPEN_URL = 'https://astrid.haus/?connect=1';
const LOCAL_OPEN_URL = 'http://127.0.0.1:5180/tools/video-editor?connect=1';

const isWindows = process.platform === 'win32';
const shellName = isWindows ? 'powershell.exe' : 'bash';

function getPaths() {
  if (isWindows) return windows.getAppPaths(APP_DIR);
  return {
    root: posix.appRoot(APP_DIR),
    editor: posix.editorDirectory(APP_DIR),
  };
}

function parseEnvironmentFile(name) {
  const filename = path.join(APP_DIR, 'ENVIRONMENT');
  try {
    const content = fs.readFileSync(filename, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] !== name) continue;
      return match[2].replace(/^(?:"(.*)"|'(.*)')$/, (_whole, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
    }
  } catch { /* ENVIRONMENT is optional for Pinokio scripts. */ }
  return undefined;
}

function setting(name, fallback) {
  return process.env[name] ?? parseEnvironmentFile(name) ?? fallback;
}

function bootstrapUrl() {
  const value = setting('ASTRID_INSTALL_URL', INSTALL_URL_DEFAULT);
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
    throw new TypeError('ASTRID_INSTALL_URL must be an http or https URL.');
  }
  // Keep one override variable across platforms while choosing the installer
  // endpoint that serves the PowerShell bootstrap by default.
  return isWindows && value === INSTALL_URL_DEFAULT ? `${value}.ps1` : value;
}

function bootstrapScript(action = 'install', manifest, deleteData = false) {
  const { root } = getPaths();
  if (isWindows) {
    return windows.buildBootstrapScript({
      root,
      installerUrl: bootstrapUrl(),
      action,
      ...(manifest ? { manifest } : {}),
      ...(deleteData ? { deleteData: true } : {}),
    });
  }
  if (manifest) return posix.manifestCommand(bootstrapUrl(), root, manifest, action === 'update' ? 'update' : 'install');
  if (deleteData) return posix.uninstallAndDeleteData(bootstrapUrl(), root);
  if (action === 'update') return posix.update(bootstrapUrl(), root);
  if (action === 'uninstall') return posix.uninstall(bootstrapUrl(), root);
  return posix.install(bootstrapUrl(), root);
}

function runScript(root, args = []) {
  if (isWindows) return windows.buildRunScript(root, args);
  return posix.run(root, args);
}

function shellStep(message, { cwd = APP_DIR, env, on, shell = shellName } = {}) {
  return {
    method: 'shell.run',
    params: {
      shell,
      path: cwd,
      message,
      input: false,
      ...(env ? { env } : {}),
      ...(on ? { on } : {}),
    },
  };
}

function customStep(method) {
  return { method };
}

function ensureProgramDirectory() {
  fs.mkdirSync(PROGRAMS_DIR, { recursive: true });
}

function readInstallMode() {
  try {
    const record = JSON.parse(fs.readFileSync(MODE_FILE, 'utf8'));
    return record?.schema_version === 1 && ['backend', 'local'].includes(record.mode) ? record.mode : null;
  } catch { return null; }
}

function writeInstallMode(mode) {
  if (!['backend', 'local'].includes(mode)) throw new TypeError('Unknown Astrid install mode.');
  ensureProgramDirectory();
  fs.writeFileSync(MODE_FILE, `${JSON.stringify({ schema_version: 1, mode }, null, 2)}\n`, { mode: 0o600 });
}

function removeProgramFiles() {
  const expected = path.resolve(APP_DIR, 'app');
  if (path.resolve(PROGRAMS_DIR) !== expected || path.dirname(expected) !== APP_DIR) {
    throw new Error('Refusing to remove a path outside this Pinokio app.');
  }
  fs.rmSync(expected, { recursive: true, force: true });
}

function validateExistingEditorCheckout(editorDirectory) {
  if (!fs.existsSync(editorDirectory)) return false;
  const gitMetadata = path.join(editorDirectory, '.git');
  if (!fs.existsSync(gitMetadata)) {
    throw new Error(`The editor folder already exists but is not a Git checkout: ${editorDirectory}`);
  }
  const result = spawnSync('git', ['-C', editorDirectory, 'remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const remote = result.status === 0 ? result.stdout.trim().replace(/\.git$/, '').replace(/\/$/, '') : '';
  if (remote.toLowerCase() !== EDITOR_REPOSITORY.toLowerCase()) {
    throw new Error(`The existing editor checkout does not use ${EDITOR_REPOSITORY}.`);
  }
  return true;
}

function cloneEditorMessage(editorDirectory) {
  if (isWindows) {
    return `git clone -- ${windows.quotePowerShell(EDITOR_REPOSITORY)} ${windows.quotePowerShell(editorDirectory)}`;
  }
  return `git clone -- ${posix.quote(EDITOR_REPOSITORY)} ${posix.quote(editorDirectory)}`;
}

function pullEditorMessage(editorDirectory) {
  if (isWindows) {
    return `git -C ${windows.quotePowerShell(editorDirectory)} pull --ff-only`;
  }
  return `git -C ${posix.quote(editorDirectory)} pull --ff-only`;
}

function editorStartCommand(root) {
  return path.join(root, isWindows ? 'start.cmd' : 'start');
}

function pinnedNodeBuildMessage(root, editorDirectory, { installDependencies = true } = {}) {
  if (isWindows) return windowsNodeBuildMessage(root, editorDirectory, installDependencies);
  return posixNodeBuildMessage(root, editorDirectory, installDependencies);
}

function posixNodeBuildMessage(root, editorDirectory, installDependencies) {
  const q = posix.quote;
  const versionDirectory = q(path.join(root, 'versions'));
  const currentFile = q(path.join(root, 'current'));
  const editor = q(editorDirectory);
  const lines = [
    'set -eu',
    `version=$(cat -- ${currentFile})`,
    `case "$version" in ''|*[!A-Za-z0-9._-]*) echo 'Astrid install version pointer is invalid.' >&2; exit 2 ;; esac`,
    `version_root=${versionDirectory}/"$version"`,
    `python="$version_root/py/bin/python"`,
    '[ -x "$python" ] || { echo "Astrid installed Python is missing: $python" >&2; exit 2; }',
    `node=$("$python" -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["env"]["ASTRID_NODE_EXECUTABLE"])' "$version_root/version.json")`,
    'case "$node" in "$version_root"/*) ;; *) echo "Astrid pinned Node is outside its installed version." >&2; exit 2 ;; esac',
    'node_dir=$(dirname -- "$node")',
    'npx="$node_dir/../lib/node_modules/npm/bin/npx-cli.js"',
    '[ -x "$node" ] || { echo "Astrid pinned Node is missing: $node" >&2; exit 2; }',
    '[ -f "$npx" ] || { echo "Astrid pinned npx entrypoint is missing: $npx" >&2; exit 2; }',
    '[ "$("$node" --version)" = "v20.19.4" ] || { echo "Astrid pinned Node is not v20.19.4." >&2; exit 2; }',
    `export ASTRID_START_COMMAND=${q(editorStartCommand(root))}`,
    'export ASTRID_APP_LOOPBACK_ORIGIN=off',
    `cd ${editor}`,
  ];
  if (installDependencies) lines.push('"$node" "$npx" -y npm@11 ci');
  lines.push('"$node" scripts/dev-local-workspace.mjs --build');
  return lines.join('\n');
}

function windowsNodeBuildMessage(root, editorDirectory, installDependencies) {
  const q = windows.quotePowerShell;
  const current = path.win32.join(root, 'current');
  const versions = path.win32.join(root, 'versions');
  const startCommand = editorStartCommand(root);
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$version = (Get-Content -Raw -LiteralPath ${q(current)}).Trim()`,
    "if ($version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') { throw 'Astrid install version pointer is invalid.' }",
    `$versionRoot = Join-Path ${q(versions)} $version`,
    "$record = Get-Content -Raw -LiteralPath (Join-Path $versionRoot 'version.json') | ConvertFrom-Json",
    "$node = [IO.Path]::GetFullPath([string]$record.env.ASTRID_NODE_EXECUTABLE)",
    "$versionPrefix = [IO.Path]::GetFullPath($versionRoot) + [IO.Path]::DirectorySeparatorChar",
    "if (-not $node.StartsWith($versionPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Astrid pinned Node is outside its installed version.' }",
    "$npx = Join-Path (Split-Path -Parent $node) 'node_modules\\npm\\bin\\npx-cli.js'",
    "if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw \"Astrid pinned Node is missing: $node\" }",
    "if (-not (Test-Path -LiteralPath $npx -PathType Leaf)) { throw \"Astrid pinned npx entrypoint is missing: $npx\" }",
    "$actualNode = (& $node --version).Trim()",
    "if ($LASTEXITCODE -ne 0 -or $actualNode -ne 'v20.19.4') { throw 'Astrid pinned Node is not v20.19.4.' }",
    `$env:ASTRID_START_COMMAND = ${q(startCommand)}`,
    "$env:ASTRID_APP_LOOPBACK_ORIGIN = 'off'",
    `Push-Location -LiteralPath ${q(editorDirectory)}`,
    'try {',
  ];
  if (installDependencies) {
    lines.push('  & $node $npx -y npm@11 ci');
    lines.push("  if ($LASTEXITCODE -ne 0) { throw 'Pinned npx npm@11 ci failed.' }");
  }
  lines.push('  & $node scripts/dev-local-workspace.mjs --build');
  lines.push("  if ($LASTEXITCODE -ne 0) { throw 'Astrid local editor build failed.' }");
  lines.push('} finally { Pop-Location }');
  return lines.join('\n');
}

function backendLaunchStep(root, { hostedOriginOff = false } = {}) {
  const command = runScript(root, hostedOriginOff ? ['--hosted-origin', 'off'] : []);
  const message = isWindows
    ? `Write-Output 'Astrid backend process started.'; ${command}`
    : `printf '%s\\n' 'Astrid backend process started.'; ${command}`;
  return shellStep(message, {
    cwd: root,
    env: { ASTRID_INSTALL_MANAGED_BY: 'pinokio' },
    on: [{ event: /Astrid backend process started\./, done: true }],
  });
}

function localEditorLaunchStep(root, editorDirectory) {
  const node = pinnedNodeExecutable(root);
  const dist = path.join(editorDirectory, 'dist');
  const script = 'scripts/dev-local-workspace.mjs';
  const command = isWindows
    ? `& ${windows.quotePowerShell(node)} ${windows.quotePowerShell(script)} --preview --preview-dir ${windows.quotePowerShell(dist)}`
    : `${posix.quote(node)} ${posix.quote(script)} --preview --preview-dir ${posix.quote(dist)}`;
  const message = isWindows
    ? `Write-Output 'Astrid local editor process started.'; ${command}`
    : `printf '%s\\n' 'Astrid local editor process started.'; ${command}`;
  return shellStep(message, {
    cwd: editorDirectory,
    env: {
      ASTRID_APP_LOOPBACK_ORIGIN: 'off',
      ASTRID_START_COMMAND: editorStartCommand(root),
    },
    on: [{ event: /Astrid local editor process started\./, done: true }],
  });
}

function pinnedNodeExecutable(root) {
  const currentPath = path.join(root, 'current');
  let version;
  try { version = fs.readFileSync(currentPath, 'utf8').trim(); }
  catch (error) { throw new Error(`Astrid's installed version pointer is missing: ${error.message}`); }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version)) {
    throw new Error('Astrid install version pointer is invalid.');
  }
  const versionRoot = path.resolve(root, 'versions', version);
  const recordPath = path.join(versionRoot, 'version.json');
  let record;
  try { record = JSON.parse(fs.readFileSync(recordPath, 'utf8')); }
  catch (error) { throw new Error(`Astrid's installed version record is unavailable: ${error.message}`); }
  const executable = record?.env?.ASTRID_NODE_EXECUTABLE;
  const pathApi = isWindows ? path.win32 : path;
  if (typeof executable !== 'string' || !pathApi.isAbsolute(executable)) {
    throw new Error(`Astrid's installed version does not declare its pinned Node executable: ${recordPath}`);
  }
  const normalizedExecutable = pathApi.resolve(executable);
  const normalizedRoot = pathApi.resolve(versionRoot);
  const relative = pathApi.relative(normalizedRoot, normalizedExecutable);
  if (!relative || relative === '..' || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) {
    throw new Error('Astrid pinned Node executable is outside its installed program version.');
  }
  if (!fs.existsSync(normalizedExecutable)) {
    throw new Error(`Astrid pinned Node executable is missing: ${normalizedExecutable}`);
  }
  return normalizedExecutable;
}

function modeOpenTarget(mode) {
  return mode === 'local'
    ? { href: LOCAL_OPEN_URL, popout: false }
    : { href: HOSTED_OPEN_URL, popout: true };
}

function localSetOpenTarget(mode) {
  return {
    url: mode === 'local' ? LOCAL_OPEN_URL : HOSTED_OPEN_URL,
    mode,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tcpPortOpen(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (open) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(open);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function probeDoor() {
  if (!(await tcpPortOpen(DOOR_PORT))) return { kind: 'free' };
  const origins = ['https://astrid.haus', 'http://127.0.0.1:5180', null];
  for (const origin of origins) {
    try {
      const response = await fetch(DOOR_HEALTH_URL, {
        headers: { ...(origin ? { Origin: origin } : {}), Accept: 'application/json' },
        signal: AbortSignal.timeout(1500),
      });
      const body = await response.json().catch(() => null);
      const isAstrid = (response.status === 200 && body?.protocol === 'workspace.v1')
        || (response.status === 503 && ['runtime_unavailable', 'runtime_identity_mismatch'].includes(body?.error))
        || (response.status === 403 && body?.error === 'hosted_origin_required');
      if (isAstrid) return { kind: 'astrid', status: response.status };
      if (response.status === 403) continue;
      return { kind: 'occupied', status: response.status };
    } catch { /* Try the remaining local/hosted-origin forms. */ }
  }
  return { kind: 'occupied' };
}

async function ensureDoorPortFree(_req, ondata) {
  const result = await probeDoor();
  if (result.kind === 'free') return { free: true };
  const message = result.kind === 'astrid'
    ? 'Port 17340 already answers as Astrid. Open the existing Astrid window; stop that one before starting this install.'
    : 'Port 17340 is already in use by another program. Stop it before starting Astrid.';
  ondata({ raw: `Astrid: ${message}` });
  throw new Error(message);
}

async function waitForDoor(_req, ondata) {
  const deadline = Date.now() + 180_000;
  let last = 'no response';
  const origins = ['http://127.0.0.1:5180', null, 'https://astrid.haus'];
  ondata({ raw: 'Waiting for Astrid Runtime health at 127.0.0.1:17340...' });
  while (Date.now() < deadline) {
    for (const origin of origins) {
      try {
        const response = await fetch(DOOR_HEALTH_URL, {
          headers: { ...(origin ? { Origin: origin } : {}), Accept: 'application/json' },
          signal: AbortSignal.timeout(2500),
        });
        const body = await response.json().catch(() => null);
        if (response.status === 200 && body?.status === 'ok' && body?.protocol === 'workspace.v1') {
          return { ready: true };
        }
        if (response.status === 200 && body?.protocol && body.protocol !== 'workspace.v1') {
          throw new Error(`Port ${DOOR_PORT} answers with an incompatible Runtime protocol: ${body.protocol}`);
        }
        if (response.status !== 403 || body?.error !== 'hosted_origin_required') {
          last = `HTTP ${response.status}${body?.error ? ` (${body.error})` : ''}`;
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith(`Port ${DOOR_PORT} answers`)) throw error;
        last = error instanceof Error ? error.message : String(error);
      }
    }
    await delay(1000);
  }
  throw new Error(`Astrid Runtime did not become healthy at ${DOOR_HEALTH_URL} within 180 seconds; last result: ${last}`);
}

async function waitForLocalEditor(_req, ondata) {
  const target = 'http://127.0.0.1:5180/tools/video-editor';
  const deadline = Date.now() + 120_000;
  let last = 'no response';
  ondata({ raw: 'Waiting for the local Astrid editor at 127.0.0.1:5180...' });
  while (Date.now() < deadline) {
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return { ready: true };
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(1000);
  }
  throw new Error(`The local Astrid editor did not become ready at ${target} within 120 seconds; last result: ${last}`);
}

function saveModeStep(mode) {
  return customStep(async () => {
    writeInstallMode(mode);
    return { mode };
  });
}

module.exports = {
  APP_DIR,
  PROGRAMS_DIR,
  BACKEND_ROOT,
  EDITOR_DIR,
  MODE_FILE,
  DOOR_PORT,
  DOOR_HEALTH_URL,
  HOSTED_OPEN_URL,
  LOCAL_OPEN_URL,
  EDITOR_REPOSITORY,
  shellName,
  isWindows,
  getPaths,
  setting,
  bootstrapUrl,
  bootstrapScript,
  runScript,
  shellStep,
  customStep,
  ensureProgramDirectory,
  readInstallMode,
  writeInstallMode,
  removeProgramFiles,
  validateExistingEditorCheckout,
  cloneEditorMessage,
  pullEditorMessage,
  editorStartCommand,
  pinnedNodeBuildMessage,
  backendLaunchStep,
  localEditorLaunchStep,
  pinnedNodeExecutable,
  modeOpenTarget,
  localSetOpenTarget,
  probeDoor,
  ensureDoorPortFree,
  waitForDoor,
  waitForLocalEditor,
  saveModeStep,
};
