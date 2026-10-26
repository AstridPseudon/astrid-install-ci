import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import library from '../pinokio/lib.js';
import policy from '../pinokio/environment.js';
import { runShell } from '../pinokio/shell.mjs';
import { installation, runSession } from '../pinokio/session.mjs';
import { waitForInstallerLock } from '../pinokio/lifecycle.mjs';
import { pinokioEnv } from './fixtures/pinokio-env.mjs';

const require = createRequire(import.meta.url);
const scripts = ['install', 'install-local', 'update', 'add-local', 'reset', 'uninstall', 'uninstall-delete-data', 'start', 'stop'];
function load(name, app) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL(`../pinokio/${name}.js`, import.meta.url), 'utf8'), {
    module, require: (name) => name === './lib' ? app : require(name),
  });
  return module.exports;
}

// Decode the four quoted arguments actually submitted to Pinokio's shell.
function wrapperArguments(message, win) {
  let i = message.indexOf('node ') + 5;
  const args = [];
  while (args.length < 4) {
    while (/\s/.test(message[i])) i++;
    let value = '', quoted = false;
    while (i < message.length) {
      const char = message[i++];
      if (char === "'") {
        if (win && quoted && message[i] === "'") { value += "'"; i++; }
        else quoted = !quoted;
      } else if (!win && !quoted && char === '\\') value += message[i++];
      else if (!quoted && /\s/.test(char)) break;
      else value += char;
    }
    args.push(value);
  }
  return args;
}

function fixture(platform, mode) {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const home = win ? 'C:\\Pinokio Home' : '/Pinokio Home';
  const appDirectory = p.join(home, 'api', "Astrid O'Malley");
  const root = p.join(appDirectory, 'app', 'astrid');
  const editor = p.join(appDirectory, 'app', 'editor');
  const version = p.join(root, 'versions', 'v1');
  const node = p.join(version, 'tools', 'node', win ? 'node.exe' : 'bin/node');
  const data = win ? 'C:\\fixture\\home\\Astrid' : '/fixture/home/Astrid';
  const environment = { ...pinokioEnv(home, platform), PWD: appDirectory,
    VIRTUAL_ENV: p.join(home, 'bin', 'miniforge'), NODE_OPTIONS: '--bad',
    ASTRID_RUNTIME_DATA_ROOT: p.join(home, 'cache', 'wrong'), ASTRID_CHECKOUT: '/wrong',
    HTTP_PROXY: 'http://proxy.example:8080', https_proxy: 'http://proxy.example:8080', NO_PROXY: 'localhost' };
  const recordEnv = { ASTRID_NODE_EXECUTABLE: node, ASTRID_FFMPEG_EXECUTABLE: p.join(version, 'tools', 'ffmpeg'),
    PATH: [p.dirname(node), win ? 'C:\\recorded-tools' : '/recorded-tools', win ? 'C:\\Windows\\System32' : '/usr/bin'].join(win ? ';' : ':'),
    RECORDED_VALUE: 'kept' };
  const files = new Map([
    [p.join(root, 'current'), 'v1'],
    [p.join(root, 'install.json'), JSON.stringify({ owner: 'haus.astrid.runtime', managed_by: 'pinokio', data_root: data })],
    [p.join(version, 'version.json'), JSON.stringify({ root: version, python: p.join(version, 'py', win ? 'Scripts/python.exe' : 'bin/python'), profile: p.join(version, 'profile.json'), env: recordEnv })],
    [p.join(appDirectory, 'app', 'install-mode.json'), JSON.stringify({ schema_version: 1, mode })],
  ]);
  const filesystem = { readFileSync: (file) => { if (!files.has(file)) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return files.get(file); },
    existsSync: () => true, mkdirSync() {}, writeFileSync() {}, rmSync() {} };
  const getTemp = () => '/var/folders/fixture/T/';
  const installed = installation(root, { platform, environment, filesystem, getTemp });
  return { platform, win, p, home, appDirectory, root, editor, environment, filesystem, getTemp, installed, recordEnv };
}

function checkEnvironment(env, f, installed = false) {
  assert.equal(env.HOME, f.environment.HOME);
  assert.equal(env.HTTP_PROXY, f.environment.HTTP_PROXY);
  assert.equal(env.https_proxy, f.environment.https_proxy);
  assert.equal(env.NO_PROXY, 'localhost');
  assert.ok(env.PATH);
  assert.equal(env.ASTRID_INSTALL_MANAGED_BY, 'pinokio');
  const normalize = (value) => f.win ? value.replace(/\\/g, '/').toLowerCase() : value;
  const home = normalize(f.home);
  for (const [key, value] of Object.entries(env)) {
    // Pinokio's injected values must disappear, even when they contain no path.
    if (key in f.environment && !['HOME', 'USERPROFILE', 'PATH', 'SystemRoot', 'ComSpec', 'PATHEXT', 'LOCALAPPDATA', 'APPDATA', 'HTTP_PROXY', 'https_proxy', 'NO_PROXY'].includes(key)) {
      assert.notEqual(value, f.environment[key], key);
    }
    for (const part of String(value).split(f.win ? ';' : ':')) {
      const normalized = normalize(part);
      if (normalized.includes(home)) {
        assert.ok([f.root, f.editor].some((root) => normalized === normalize(root) || normalized.startsWith(`${normalize(root)}/`)), `${key}=${value}`);
      }
    }
  }
  for (const key of ['XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'PYTHONNOUSERSITE', 'GIT_CONFIG_GLOBAL', 'CONDA_PREFIX', 'PIP_REQUIRE_VIRTUALENV', 'UV_PYTHON_PREFERENCE']) assert.equal(env[key], undefined, key);
  if (f.platform === 'darwin') assert.equal(env.TMPDIR, f.getTemp());
  else assert.equal(env.TMPDIR, undefined);
  if (f.win) assert.equal(env.TEMP, f.p.join(env.LOCALAPPDATA, 'Temp'));
  else { assert.equal(env.TEMP, undefined); assert.equal(env.TMP, undefined); }
  if (installed) {
    assert.equal(env.RECORDED_VALUE, 'kept');
    assert.equal(env.ASTRID_FFMPEG_EXECUTABLE, f.recordEnv.ASTRID_FFMPEG_EXECUTABLE);
    assert.ok(env.PATH.includes(f.win ? 'C:\\recorded-tools' : '/recorded-tools'));
  } else assert.equal(env.RECORDED_VALUE, undefined);
}

async function sessionProcesses(f, action, mode) {
  let pid = 6000, statuses = 0, stop;
  const active = new Map();
  const close = (child) => { active.delete(child.pid); child.emit('close', 0); };
  await runSession({ action, mode, root: f.root, editor: f.editor, platform: f.platform, installed: f.installed,
    signals: new EventEmitter(), pause: async () => {}, portOpen: async () => false,
    spawnProcess(command, args, options) {
      checkEnvironment(options.env, f, true);
      const child = new EventEmitter(); child.pid = ++pid; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); active.set(pid, child);
      queueMicrotask(() => {
        if (args.includes('status')) {
          const healthy = statuses++ > 0;
          child.stdout.emit('data', JSON.stringify({ support: { healthy }, health: { status: 'ok' }, discovery: { runtime_instance_id: 'fixture', active_realm: 'fixture' } }));
          close(child);
        } else if (args.includes('ci') || args.includes('--build')) close(child);
        else if (command.endsWith('taskkill.exe')) { const target = active.get(Number(args[1])); if (target) close(target); close(child); }
      });
      return child;
    },
    killProcess: (group) => { const child = active.get(-group); if (child) close(child); },
    gracefulDown: async (_spec, options) => { checkEnvironment(options.env, f, true); for (const child of [...active.values()]) close(child); },
    openController: async (_root, callback) => { stop = callback; return { close: async () => {} }; },
    request: async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok', protocol: 'workspace.v1', schemaVersion: 1, runtimeInstanceId: 'fixture', realmId: 'fixture' }) }),
    output: () => { void stop(); },
  });
  assert.equal(active.size, 0);
}

for (const platform of ['darwin', 'linux', 'win32']) for (const mode of ['backend', 'local']) {
  test(`${platform} ${mode}: every lifecycle shell and Astrid child uses the environment contract`, async () => {
    const f = fixture(platform, mode);
    let lockChecks = 0;
    const app = { ...library.createApp({ ...f, probe: async () => ({ kind: 'free' }), lifecycle: {
      requestGracefulStop: async () => {},
      waitForInstallerLock: async (root, options) => {
        await waitForInstallerLock(root, { ...options, installed: f.installed, run: async (_spec, options) => { checkEnvironment(options.env, f, true); lockChecks++; } });
      },
    } }), validateExistingEditorCheckout: () => true };
    for (const name of scripts) {
      if (name === 'add-local' && mode === 'local') continue;
      const factory = load(name, app);
      const script = typeof factory === 'function' ? await factory({}, {}) : factory;
      for (const step of [...script.run, ...(script.on?.stop ? [script.on.stop] : [])]) {
        if (typeof step.method === 'function') await step.method({ input: { confirmation: 'DELETE' } }, () => {}, { api: { running: {}, stop: async () => {} } });
        else if (step.method === 'shell.run') {
          const [helper, appDirectory, message, explicit] = wrapperArguments(step.params.message, f.win);
          assert.equal(helper, f.p.join(f.appDirectory, 'pinokio', 'shell.mjs'));
          assert.equal(appDirectory, f.appDirectory);
          await runShell({ appDirectory, message, explicit: JSON.parse(explicit), platform, environment: f.environment, getTemp: f.getTemp,
            spawnProcess(command, args, options) {
              checkEnvironment(options.env, f);
              assert.equal(options.cwd, f.environment.HOME);
              assert.ok(command.endsWith(f.win ? 'powershell.exe' : '/bash'));
              if (!f.win) assert.ok(args.at(-1).includes('unset PWD'));
              const child = new EventEmitter(); queueMicrotask(() => child.emit('close', 0)); return child;
            },
          });
          if (message.includes('session.mjs')) await sessionProcesses(f, message.includes("'build'") ? 'build' : 'serve', message.includes("'local'") ? 'local' : 'backend');
        }
      }
    }
    assert.ok(lockChecks >= 5);
  });
}

test('environment verifies layout, path boundaries, Windows casing, temp failure and recorded paths', () => {
  assert.throws(() => policy.buildEnvironment({ appDirectory: '/not-pinokio/app' }), /home.*api/);
  for (const platform of ['darwin', 'linux', 'win32']) {
    const f = fixture(platform, 'backend');
    const delimiter = f.win ? ';' : ':';
    const outside = `${f.home}-other`;
    const env = policy.buildEnvironment({ ...f, recordEnv: {}, getTemp: () => '', environment: { ...f.environment,
      PATH: [f.p.join(f.home, 'bin'), outside, './node_modules/.bin', f.win ? 'C:\\Windows' : '/bin'].join(delimiter),
      ...(f.win ? { Path: f.p.join(f.home, 'bin') } : {}) } });
    assert.equal(env.TMPDIR, undefined);
    if (f.win) assert.equal(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH').length, 1);
    else assert.ok(env.PATH.includes(outside));
    assert.throws(() => policy.buildEnvironment({ ...f, recordEnv: { ASTRID_FFMPEG_EXECUTABLE: f.p.join(f.home, 'bin', 'ffmpeg') } }), /points into Pinokio/);
  }
});

test('native shell wrapper strips a Pinokio environment at the real child boundary and preserves exit status', async () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'astrid-env-boundary-')));
  try {
    const home = path.join(temp, 'pinokio');
    const appDirectory = path.join(home, 'api', "Astrid O'Malley");
    const userHome = path.join(temp, 'user');
    fs.mkdirSync(appDirectory, { recursive: true }); fs.mkdirSync(userHome);
    const file = path.join(temp, 'environment.json');
    const environment = { ...pinokioEnv(home, process.platform), HOME: userHome,
      ...(process.platform === 'win32' ? { USERPROFILE: userHome, LOCALAPPDATA: path.join(userHome, 'AppData', 'Local'), APPDATA: path.join(userHome, 'AppData', 'Roaming') } : {}), ASTRID_RUNTIME_DOOR_PORT: '17341' };
    if (process.platform === 'win32') fs.mkdirSync(path.join(environment.LOCALAPPDATA, 'Temp'), { recursive: true });
    const app = library.createApp({ appDirectory });
    const q = process.platform === 'win32' ? (value) => `'${value.replace(/'/g, "''")}'` : (value) => `'${value.replace(/'/g, "'\\''")}'`;
    const code = `require('node:fs').writeFileSync(${JSON.stringify(file)},JSON.stringify(process.env));process.exit(7)`;
    const command = `${process.platform === 'win32' ? '& ' : ''}${q(process.execPath)} -e ${q(code)}`;
    const message = process.platform === 'win32' ? command : `sh -c ${q(command)}`;
    assert.equal(await runShell({ appDirectory, environment, message, explicit: { ASTRID_RUNTIME_DOOR_PORT: '17341' } }), 7);
    const env = JSON.parse(fs.readFileSync(file));
    assert.equal(env.HOME, userHome);
    assert.equal(env.ASTRID_RUNTIME_DOOR_PORT, '17341');
    for (const [key, value] of Object.entries(env)) assert.ok(!value.includes(home), `${key}=${value}`);
    for (const key of ['PYTHONNOUSERSITE', 'GIT_CONFIG_GLOBAL', 'CONDA_PREFIX', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'PIP_REQUIRE_VIRTUALENV', 'UV_PYTHON_PREFERENCE']) assert.equal(env[key], undefined);
    assert.ok(env.PATH);
    assert.equal(app.BACKEND_ROOT, path.join(appDirectory, 'app', 'astrid'));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
