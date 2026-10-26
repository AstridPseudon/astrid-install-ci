import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import library from '../../pinokio/lib.js';

const require = createRequire(import.meta.url);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const windows = process.platform === 'win32';
const paths = windows ? path.win32 : path.posix;
const shell = windows ? 'powershell.exe' : 'bash';
const fixturePath = path.join(repository, 'tests', 'fixtures', 'pinokio-env.mjs');

function log(message) {
  process.stdout.write(`[pinokio-smoke] ${message}\n`);
}

function load(file, app, appDirectory) {
  const filename = path.join(appDirectory, file);
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: (name) => name === './lib' || name === './pinokio/lib' ? app : require(name),
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return module.exports;
}

function pathKey(environment) {
  return windows ? Object.keys(environment).find((key) => key.toLowerCase() === 'path') || 'Path' : 'PATH';
}

function withStepEnvironment(base, extra = {}) {
  const environment = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (windows && key.toLowerCase() === 'path') {
      for (const existing of Object.keys(environment)) if (existing.toLowerCase() === 'path') delete environment[existing];
      environment.Path = value;
    } else environment[key] = value;
  }
  return environment;
}

function assertWithin(candidate, parent, label) {
  const relative = paths.relative(paths.resolve(parent), paths.resolve(candidate));
  assert.ok(relative === '' || (relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative)),
    `${label} is outside ${parent}: ${candidate}`);
}

function isWithin(candidate, parent) {
  const relative = paths.relative(paths.resolve(parent), paths.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative));
}

function tempPath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'astrid-pinokio-ci-'));
}

function makeFfmpegGuard(binDirectory) {
  if (windows) {
    for (const name of ['ffmpeg', 'ffprobe']) {
      fs.writeFileSync(path.join(binDirectory, `${name}.cmd`), '@echo off\r\necho System FFmpeg is hidden; Astrid must use its pinned binary. 1>&2\r\nexit /b 97\r\n');
    }
  } else {
    for (const name of ['ffmpeg', 'ffprobe']) {
      const filename = path.join(binDirectory, name);
      fs.writeFileSync(filename, '#!/bin/sh\necho "System FFmpeg is hidden; Astrid must use its pinned binary." >&2\nexit 97\n', { mode: 0o700 });
    }
  }
}

function quoteBash(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function makeNodeLauncher(binDirectory) {
  if (windows) {
    fs.copyFileSync(process.execPath, path.join(binDirectory, 'node.exe'));
  } else {
    const script = `#!/bin/sh\nexec ${quoteBash(process.execPath)} "$@"\n`;
    fs.writeFileSync(path.join(binDirectory, 'node'), script, { mode: 0o700 });
  }
}

function prepareCheckout(source, appDirectory) {
  const branch = 'ci-smoke';
  execFileSync('git', ['-C', source, 'checkout', '-B', branch, 'HEAD'], { stdio: 'inherit' });
  execFileSync('git', ['clone', '--branch', branch, '--single-branch', source, appDirectory], { stdio: 'inherit' });
}

function processTreeKill(child) {
  if (!child?.pid || child.closed) return;
  if (windows) {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    execFileSync(path.win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true,
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

function launchShell(step, environment, { background = false, onSpawn } = {}) {
  assert.equal(step.method, 'shell.run');
  assert.equal(step.params.shell, shell);
  assert.equal(path.resolve(step.params.path), path.resolve(environment.ASTRID_PINOKIO_APP_DIR),
    'Pinokio shell steps must run from the app checkout');
  const executable = windows
    ? path.win32.join(environment.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : '/bin/bash';
  assert.ok(fs.existsSync(executable), `${shell} is missing from this runner: ${executable}`);
  const child = spawn(executable, windows
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', step.params.message]
    : ['--noprofile', '--norc', '-c', step.params.message], {
    cwd: step.params.path,
    env: withStepEnvironment(environment, step.params.env),
    detached: !windows,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.closed = false;
  child.output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    child.output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    child.output += chunk;
    process.stderr.write(chunk);
  });
  child.exit = new Promise((resolve) => child.once('close', (code, signal) => {
    child.closed = true;
    child.exitCode = code;
    child.signal = signal;
    resolve({ code, signal });
  }));
  child.exit.catch(() => {});
  onSpawn?.(child);

  if (!background) return child.exit.then(({ code, signal }) => {
    assert.equal(code, 0, `${step.params.shell} step failed (${signal || code}):\n${child.output}`);
    return child;
  });

  return new Promise((resolve, reject) => {
    let seen = '';
    const inspect = (chunk) => {
      seen = (seen + chunk).slice(-8192);
      if (seen.includes('ASTRID_PINOKIO_READY')) {
        child.stdout.off('data', inspect);
        child.stderr.off('data', inspect);
        resolve(child);
      } else if (seen.includes('ASTRID_PINOKIO_FAILURE')) {
        child.stdout.off('data', inspect);
        child.stderr.off('data', inspect);
        reject(new Error(`Pinokio Start emitted its failure event:\n${child.output}`));
      }
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.exit.then(({ code, signal }) => {
      if (!seen.includes('ASTRID_PINOKIO_READY')) reject(new Error(`Pinokio Start exited before ready (${signal || code}):\n${child.output}`));
    });
  });
}

async function freePort(port) {
  return new Promise((resolve, reject) => {
    const socket = require('node:net').createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH') resolve(true);
      else reject(error);
    });
  });
}

function runTool(command, args, environment) {
  const executable = windows && command === 'curl' ? 'curl.exe' : command;
  return execFileSync(executable, args, { encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function requestJson(url, { origin, environment }) {
  const result = runTool('curl', ['--silent', '--show-error', '--write-out', '\n%{http_code}', ...(origin ? ['-H', `Origin: ${origin}`] : []), url], environment);
  const newline = result.lastIndexOf('\n');
  assert.notEqual(newline, -1, `curl returned no HTTP status for ${url}: ${result}`);
  return { body: JSON.parse(result.slice(0, newline)), status: Number(result.slice(newline + 1).trim()) };
}

function fakeServices(home, userHome, environment) {
  if (windows) {
    const csv = runTool('schtasks.exe', ['/Query', '/FO', 'CSV', '/NH'], process.env);
    return csv.split(/\r?\n/).filter((line) => /astrid/i.test(line)).sort();
  }
  const serviceRoots = process.platform === 'darwin'
    ? [path.join(userHome, 'Library', 'LaunchAgents'), path.join(home, 'Library', 'LaunchAgents')]
    : [path.join(environment.XDG_CONFIG_HOME || userHome, 'systemd', 'user'),
      path.join(environment.XDG_DATA_HOME || userHome, 'systemd', 'user'),
      path.join(userHome, '.config', 'systemd', 'user'), path.join(userHome, '.local', 'share', 'systemd', 'user')];
  const found = [];
  for (const root of serviceRoots) {
    if (!fs.existsSync(root)) continue;
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(filename);
        else if (process.platform !== 'darwin' || entry.name.endsWith('.plist'))
          found.push(filename);
      }
    };
    visit(root);
  }
  return found.sort();
}

function assertNoServices(home, userHome, environment, before) {
  const after = fakeServices(home, userHome, environment);
  assert.deepEqual(after, before, `Astrid registered a LaunchAgent, systemd unit, or scheduled task: ${after.join(', ')}`);
  assert.deepEqual(after, [], `An Astrid login service is already registered: ${after.join(', ')}`);
}

function cacheAstridPaths(cache) {
  if (!fs.existsSync(cache)) return [];
  const found = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory() && /^\.?astrid(?:[ _-].*)?$/i.test(entry.name)) found.push(filename);
      if (entry.isDirectory()) visit(filename);
      else if (entry.name === 'install.json') {
        try {
          const record = JSON.parse(fs.readFileSync(filename, 'utf8'));
          if (record.owner === 'haus.astrid.runtime' || record.managed_by === 'pinokio') found.push(filename);
        } catch { /* Cache entries that are not Astrid records do not establish ownership. */ }
      }
    }
  };
  visit(cache);
  return [...new Set(found)];
}

function assertRecordedPaths(record, pinokioHome, programDirectory) {
  const home = paths.resolve(pinokioHome);
  const homeNormalized = home.replaceAll('\\', '/').toLowerCase();
  const programRelative = paths.relative(home, programDirectory).replaceAll('\\', '/').toLowerCase();
  const separator = windows ? ';' : ':';
  function inspect(value, label, list = false) {
    if (typeof value !== 'string' || !value) return;
    const values = list ? value.split(separator) : [value];
    for (const item of values) {
      const normalized = item.replaceAll('\\', '/').toLowerCase();
      let at = normalized.indexOf(homeNormalized);
      while (at !== -1) {
        const remainder = normalized.slice(at + homeNormalized.length).replace(/^\/+/, '');
        const token = remainder.split(/[;:\s"']/)[0];
        const candidate = paths.resolve(home, token);
        assertWithin(candidate, programDirectory, `${label} path recorded inside Pinokio home`);
        assert.ok(token === programRelative || token.startsWith(`${programRelative}/`),
          `${label} records a path under fake Pinokio home outside the program root: ${item}`);
        at = normalized.indexOf(homeNormalized, at + homeNormalized.length);
      }
    }
  }
  function visit(value, label) {
    if (Array.isArray(value)) value.forEach((child, index) => visit(child, `${label}[${index}]`));
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, `${label}.${key}`);
    } else inspect(value, label, /(^|_)PATH$/i.test(label.split('.').at(-1)));
  }
  visit(record, 'version.json');
}

function installedRecord(app) {
  const install = JSON.parse(fs.readFileSync(path.join(app.BACKEND_ROOT, 'install.json'), 'utf8'));
  const version = fs.readFileSync(path.join(app.BACKEND_ROOT, 'current'), 'utf8').trim();
  const versionRoot = path.join(app.BACKEND_ROOT, 'versions', version);
  const record = JSON.parse(fs.readFileSync(path.join(versionRoot, 'version.json'), 'utf8'));
  assert.equal(install.owner, 'haus.astrid.runtime');
  assert.equal(install.managed_by, 'pinokio');
  return { install, record, versionRoot };
}

function verifyInstallRecords(app, pinokioHome, mode) {
  const { install, record, versionRoot } = installedRecord(app);
  assert.equal(record.env.ASTRID_INSTALL_FFMPEG_SOURCE, 'download',
    'the system FFmpeg stubs should force Astrid to download its pinned FFmpeg');
  assertWithin(record.env.ASTRID_FFMPEG_EXECUTABLE, app.BACKEND_ROOT, 'pinned FFmpeg');
  assertWithin(record.env.ASTRID_FFPROBE_EXECUTABLE, app.BACKEND_ROOT, 'pinned FFprobe');
  assert.ok(fs.existsSync(record.env.ASTRID_FFMPEG_EXECUTABLE), 'pinned FFmpeg binary is missing');
  assert.ok(fs.existsSync(record.env.ASTRID_FFPROBE_EXECUTABLE), 'pinned FFprobe binary is missing');
  assertRecordedPaths(record, pinokioHome, app.BACKEND_ROOT);
  const dataRoot = paths.resolve(install.data_root);
  assert.ok(!isWithin(dataRoot, pinokioHome), `Astrid data root was placed inside the fake Pinokio home: ${dataRoot}`);
  assert.ok(!isWithin(dataRoot, path.join(pinokioHome, 'cache')),
    `Astrid data root was placed under Pinokio's cache: ${dataRoot}`);
  assert.deepEqual(cacheAstridPaths(path.join(pinokioHome, 'cache')), [],
    `Astrid-owned files were created under Pinokio cache: ${cacheAstridPaths(path.join(pinokioHome, 'cache')).join(', ')}`);
  log(`installed ${mode} version ${path.basename(versionRoot)} with external data root ${dataRoot}`);
}

function kernelFor(app, getDaemon, onStop) {
  const uri = paths.join(app.APP_DIR, 'pinokio', 'start.js');
  return { api: {
    running: getDaemon() ? { [uri]: true } : {},
    stop: async () => onStop(),
  } };
}

async function invokeAction(name, app, appDirectory, environment, home, getDaemon, stopDaemon) {
  const loaded = load(`pinokio/${name}.js`, app, appDirectory);
  const script = typeof loaded === 'function' ? await loaded({}, {}) : loaded;
  const kernel = kernelFor(app, getDaemon, stopDaemon);
  for (const step of script.run) {
    if (step.method === 'shell.run') {
      if (name === 'start' && script.daemon) {
        await launchShell(step, { ...environment, ASTRID_PINOKIO_APP_DIR: appDirectory }, {
          background: true, onSpawn: getDaemon.set,
        });
      } else {
        await launchShell(step, { ...environment, ASTRID_PINOKIO_APP_DIR: appDirectory });
      }
    } else if (step.method === 'local.set') {
      log(`Pinokio published ${JSON.stringify(step.params)}`);
    } else if (typeof step.method === 'function') {
      const result = await step.method({}, (value) => { if (value?.raw) process.stdout.write(value.raw); }, kernel);
      log(`${name}: ${JSON.stringify(result ?? {})}`);
    } else throw new Error(`Unhandled Pinokio step in ${name}: ${String(step.method)}`);
  }
  return script;
}

async function stopDaemon(getDaemon) {
  const child = getDaemon();
  if (!child) return;
  processTreeKill(child);
  await child.exit;
  getDaemon.set(null);
}

function prepareTinyProject(app, install, record, environment) {
  const script = String.raw`
import json, subprocess, sys, tempfile
from pathlib import Path
from runtime_protocol.service import RuntimeService
from astrid.core.dev.reference_realm import ffmpeg_clip_argv, media_only_publication, TINY_CLIP_SECONDS, TINY_CLIP_SIZE

data = Path(sys.argv[1])
profile_path = Path(sys.argv[2])
ffmpeg = Path(sys.argv[3])
catalog = json.loads((data / "runtime" / "catalog.json").read_text())
realm = Path(catalog["realms"][0]["data_root"])
profile = json.loads(profile_path.read_text())
with tempfile.TemporaryDirectory(prefix="astrid-render-source-") as temporary:
    clip = Path(temporary) / "clip1.mp4"
    command = ffmpeg_clip_argv(clip, 0, seconds=TINY_CLIP_SECONDS, size=TINY_CLIP_SIZE)
    command[0] = str(ffmpeg)
    subprocess.run(command, check=True)
    service = RuntimeService(realm)
    try:
        project = service.create_project({"slug": "pinokio-ci", "name": "Pinokio CI"}, idempotency_key="pinokio-ci-project")
        service.create_timeline(project["id"], "main", idempotency_key="pinokio-ci-timeline")
        media = service.ingest(project["id"], clip.read_bytes(), media_type="video/mp4", original_name=clip.name,
                               idempotency_key="pinokio-ci-clip")
        service.publish_parent_composition(project["id"], "main",
                                           media_only_publication(project["id"], [media["data"]], seconds=TINY_CLIP_SECONDS),
                                           idempotency_key="pinokio-ci-publication")
    finally:
        service.close()
print(json.dumps({"realm": str(realm), "project": "pinokio-ci", "timeline": "main", "seconds": 1}))
`;
  const python = record.python || record.env.ASTRID_RUNTIME_PYTHON;
  const profile = record.profile || record.env.ASTRID_RUNTIME_SOURCE_MANIFEST;
  const ffmpeg = record.env.ASTRID_FFMPEG_EXECUTABLE;
  assert.ok(python && fs.existsSync(python), `installed Python is missing: ${python}`);
  assert.ok(profile && fs.existsSync(profile), `installed source profile is missing: ${profile}`);
  const result = execFileSync(python, ['-I', '-c', script, install.data_root, profile, ffmpeg], {
    encoding: 'utf8', env: withStepEnvironment(environment, { ASTRID_INSTALL_MANAGED_BY: 'pinokio' }),
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const fixture = JSON.parse(result.trim().split(/\r?\n/).at(-1));
  assert.equal(fixture.project, 'pinokio-ci');
  log(`seeded one-second media timeline in ${fixture.realm}`);
}

function renderTinyProject(app, install, record, environment) {
  const python = record.python || path.join(record.root, 'py', windows ? 'Scripts/python.exe' : 'bin/python');
  const result = execFileSync(python, ['-I', '-m', 'astrid', 'timelines', 'render', 'main', '--project', 'pinokio-ci',
    '--range', '0', '1', '--backend', 'rendering.ffmpeg', '--output-name', 'pinokio-ci-smoke.mp4', '--wait', '--json'], {
    encoding: 'utf8', env: withStepEnvironment(environment, {
      ASTRID_INSTALL_MANAGED_BY: 'pinokio',
      ASTRID_RUNTIME_DATA_ROOT: install.data_root,
      ASTRID_RUNTIME_SOURCE_MANIFEST: record.profile || record.env.ASTRID_RUNTIME_SOURCE_MANIFEST,
      ASTRID_RUNTIME_PYTHON: record.python,
    }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  log(`Astrid render: ${result.trim()}`);
  const response = JSON.parse(result.trim().split(/\r?\n/).at(-1));
  assert.equal(response.ok, true, `Astrid render failed: ${JSON.stringify(response)}`);
  assert.equal(response.data?.state, 'completed', `Astrid render did not complete: ${JSON.stringify(response)}`);
  assert.ok(response.data?.kernel_task_id, 'Astrid render did not return a task id');
}

async function setup() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This harness runs only on GitHub Actions runners.');
  assert.ok(['darwin', 'linux', 'win32'].includes(process.platform), `unsupported CI platform ${process.platform}`);
  const fixture = await import(pathToFileURL(fixturePath));
  const makeEnvironment = fixture.pinokioEnv || fixture.default;
  assert.equal(typeof makeEnvironment, 'function', 'tests/fixtures/pinokio-env.mjs must export the Pinokio env factory');

  const pinokioHome = tempPath();
  const userHome = tempPath();
  const apiDirectory = path.join(pinokioHome, 'api');
  const cacheDirectory = path.join(pinokioHome, 'cache');
  const binDirectory = path.join(pinokioHome, 'bin');
  const guardDirectory = path.join(userHome, 'guard-bin');
  const appDirectory = path.join(apiDirectory, 'astrid-pinokio.git');
  fs.mkdirSync(apiDirectory, { recursive: true });
  fs.mkdirSync(cacheDirectory, { recursive: true });
  fs.mkdirSync(binDirectory, { recursive: true });
  fs.mkdirSync(guardDirectory, { recursive: true });
  makeNodeLauncher(binDirectory);
  makeFfmpegGuard(guardDirectory);
  prepareCheckout(repository, appDirectory);

  const environment = makeEnvironment(pinokioHome, process.platform);
  assert.ok(environment && typeof environment === 'object', 'Pinokio env fixture must return an environment object');
  // The fixture uses a stable sentinel home; remap it to a per-run directory so
  // the real installer and CLI never write outside this disposable CI tree.
  environment.HOME = userHome;
  if (windows) {
    environment.USERPROFILE = userHome;
    environment.APPDATA = path.join(userHome, 'AppData', 'Roaming');
    environment.LOCALAPPDATA = path.join(userHome, 'AppData', 'Local');
  }
  for (const key of ['TMP', 'TEMP', 'TMPDIR', 'PIP_TMPDIR']) {
    if (environment[key]) fs.mkdirSync(environment[key], { recursive: true });
  }
  const key = pathKey(environment);
  const beforePath = environment[key] || '';
  environment[key] = [binDirectory, guardDirectory, beforePath].filter(Boolean).join(paths.delimiter);
  assert.equal(environment[key].split(paths.delimiter)[0], binDirectory, 'fake Pinokio bin must lead PATH');
  assert.equal(environment.ASTRID_APP_REF, undefined, 'the ref must come from the launcher _ENVIRONMENT file');
  environment.ASTRID_PINOKIO_APP_DIR = appDirectory;
  environment.ASTRID_RUNTIME_DOOR_PORT = '17340';
  const app = library.createApp({ platform: process.platform, appDirectory, environment });
  assert.equal(app.appRef(), 'feat/pinokio', 'Install must select the manifest ref from _ENVIRONMENT');
  const servicesBefore = fakeServices(pinokioHome, userHome, environment);
  return { pinokioHome, userHome, appDirectory, cacheDirectory, binDirectory, environment, app, servicesBefore };
}

async function runHosted() {
  const context = await setup();
  const { pinokioHome, userHome, appDirectory, cacheDirectory, environment, app, servicesBefore } = context;
  let daemon = null;
  const getDaemon = () => daemon;
  getDaemon.set = (value) => { daemon = value; };
  const stop = async () => stopDaemon(getDaemon);
  try {
    log(`platform ${process.platform}; Pinokio home ${pinokioHome}`);
    await invokeAction('install', app, appDirectory, environment, pinokioHome, getDaemon, stop);
    verifyInstallRecords(app, pinokioHome, 'backend');
    assertNoServices(pinokioHome, userHome, environment, servicesBefore);
    prepareTinyProject(app, installedRecord(app).install, installedRecord(app).record, environment);

    await invokeAction('start', app, appDirectory, environment, pinokioHome, getDaemon, stop);
    let health = requestJson(library.DOOR_HEALTH_URL, { origin: 'https://astrid.haus', environment });
    assert.equal(health.status, 200, JSON.stringify(health.body));
    assert.equal(health.body.install?.managed_by, 'pinokio', JSON.stringify(health.body));
    log(`health confirms install.managed_by=${health.body.install.managed_by}`);
    renderTinyProject(app, installedRecord(app).install, installedRecord(app).record, environment);

    await invokeAction('stop', app, appDirectory, environment, pinokioHome, getDaemon, stop);
    assert.equal(await freePort(17340), true, 'port 17340 remained open after Stop');
    assert.equal(await freePort(5180), true, 'port 5180 remained open after Stop');

    await invokeAction('update', app, appDirectory, environment, pinokioHome, getDaemon, stop);
    verifyInstallRecords(app, pinokioHome, 'backend update');
    assertNoServices(pinokioHome, userHome, environment, servicesBefore);
    await invokeAction('start', app, appDirectory, environment, pinokioHome, getDaemon, stop);
    health = requestJson(library.DOOR_HEALTH_URL, { origin: 'https://astrid.haus', environment });
    assert.equal(health.status, 200, JSON.stringify(health.body));
    assert.equal(health.body.install?.managed_by, 'pinokio', JSON.stringify(health.body));

    await invokeAction('stop', app, appDirectory, environment, pinokioHome, getDaemon, stop);
    assert.equal(await freePort(17340), true, 'port 17340 remained open after the second Stop');
    assert.equal(await freePort(5180), true, 'port 5180 remained open after the second Stop');
    await invokeAction('uninstall', app, appDirectory, environment, pinokioHome, getDaemon, stop);
    assert.equal(fs.existsSync(app.PROGRAMS_DIR), false, `Uninstall left the program root: ${app.PROGRAMS_DIR}`);
    assertNoServices(pinokioHome, userHome, environment, servicesBefore);
    assert.deepEqual(cacheAstridPaths(cacheDirectory), [],
      `Astrid-owned files remain under Pinokio cache: ${cacheAstridPaths(cacheDirectory).join(', ')}`);
    log('PASS: hosted install, render, graceful Stop, update, restart, and Uninstall');
  } finally {
    if (daemon) await stop();
    fs.rmSync(pinokioHome, { recursive: true, force: true });
    fs.rmSync(userHome, { recursive: true, force: true });
  }
}

async function runFullyLocal() {
  const context = await setup();
  const { pinokioHome, userHome, appDirectory, cacheDirectory, environment, app, servicesBefore } = context;
  let daemon = null;
  const getDaemon = () => daemon;
  getDaemon.set = (value) => { daemon = value; };
  const stop = async () => stopDaemon(getDaemon);
  try {
    log(`fully local on ${process.platform}; Pinokio home ${pinokioHome}`);
    await invokeAction('install-local', app, appDirectory, environment, pinokioHome, getDaemon, stop);
    verifyInstallRecords(app, pinokioHome, 'fully local');
    assertNoServices(pinokioHome, userHome, environment, servicesBefore);
    await invokeAction('start', app, appDirectory, environment, pinokioHome, getDaemon, stop);

    const page = runTool('curl', ['--silent', '--show-error', '--write-out', '\n%{http_code}',
      'http://127.0.0.1:5180/tools/video-editor'], environment);
    const pageStatus = Number(page.trim().split(/\r?\n/).at(-1));
    assert.equal(pageStatus, 200, `editor page did not load (HTTP ${pageStatus})`);
    assert.match(page, /<html/i, 'editor route did not serve HTML');

    const proxyHealth = requestJson('http://127.0.0.1:5180/api/runtime/v1/health', { environment });
    assert.equal(proxyHealth.status, 200, JSON.stringify(proxyHealth.body));
    assert.equal(proxyHealth.body.protocol, 'workspace.v1', JSON.stringify(proxyHealth.body));

    const hostedOrigin = requestJson(library.DOOR_HEALTH_URL, { origin: 'https://astrid.haus', environment });
    assert.equal(hostedOrigin.status, 403, JSON.stringify(hostedOrigin.body));
    assert.equal(hostedOrigin.body.error, 'hosted_origin_required', JSON.stringify(hostedOrigin.body));
    log('fully local editor and Runtime proxy are ready; hosted origin is refused');

    await invokeAction('stop', app, appDirectory, environment, pinokioHome, getDaemon, stop);
    assert.equal(await freePort(17340), true, 'port 17340 remained open after fully local Stop');
    assert.equal(await freePort(5180), true, 'port 5180 remained open after fully local Stop');
    assertNoServices(pinokioHome, userHome, environment, servicesBefore);
    assert.deepEqual(cacheAstridPaths(cacheDirectory), [],
      `Astrid-owned files were created under Pinokio cache: ${cacheAstridPaths(cacheDirectory).join(', ')}`);
    log('PASS: fully local install, build, editor proxy, hosted-origin refusal, and Stop');
  } finally {
    if (daemon) await stop();
    fs.rmSync(pinokioHome, { recursive: true, force: true });
    fs.rmSync(userHome, { recursive: true, force: true });
  }
}

const flow = process.argv[2] || 'hosted';
if (flow === 'hosted') await runHosted();
else if (flow === 'fully-local') await runFullyLocal();
else throw new Error(`Unknown smoke flow: ${flow}`);
