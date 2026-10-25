import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import library from '../pinokio/lib.js';
import { commands, installation, runSession, signalGroup } from '../pinokio/session.mjs';

const require = createRequire(import.meta.url);
const repository = path.resolve(import.meta.dirname, '..');
function load(file, app) {
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: (name) => name === './lib' || name === './pinokio/lib' ? app : require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(repository, file), 'utf8'), context, { filename: file });
  return module.exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
function fakeApp(platform, ref = '', mode = 'backend') {
  const base = platform === 'win32' ? "C:\\Pinokio Apps\\O'Malley\\Astrid" : "/Pinokio Apps/O'Malley/Astrid";
  const writes = [];
  const filesystem = {
    readFileSync(file) {
      if (file.endsWith('install-mode.json')) return JSON.stringify({ schema_version: 1, mode });
      throw new Error('absent');
    },
    existsSync: () => false, mkdirSync() {}, writeFileSync(file, content) { writes.push({ file, content }); }, rmSync() {},
  };
  return { ...library.createApp({ platform, appDirectory: base, environment: { ASTRID_APP_REF: ref }, filesystem, probe: async () => ({ kind: 'free' }) }),
    validateExistingEditorCheckout: () => true, writes };
}
const scripts = ['install', 'install-local', 'add-local', 'update', 'start', 'stop', 'reset', 'uninstall', 'uninstall-delete-data'];
const fixtures = JSON.parse(fs.readFileSync(new URL('./commands.json', import.meta.url), 'utf8'));

for (const platform of ['darwin', 'linux', 'win32']) {
  for (const ref of ['', 'feat/pinokio']) {
    for (const mode of ['backend', 'local']) {
      test(`${platform} ${mode} ${ref || 'production'}: every script and exact shell commands`, async () => {
        const app = fakeApp(platform, ref, mode);
        const expected = fixtures[`${platform}:${ref}`];
        const fullLocal = [expected.pull, expected.localInstall, expected.build];
        const map = {
          install: [expected.install], 'install-local': fullLocal,
          'add-local': [expected.pull, expected.localUpdate, expected.build],
          update: mode === 'local' ? [expected.pull, expected.localUpdate, expected.build] : [expected.update],
          start: [expected[mode]], stop: [], reset: [], uninstall: [expected.uninstall],
          'uninstall-delete-data': [expected.delete],
        };
        for (const name of scripts) {
          const module = load(`pinokio/${name}.js`, app);
          if (name === 'add-local' && mode === 'local') {
            await assert.rejects(module({}, {}), /back-end-only/);
            continue;
          }
          const script = typeof module === 'function' ? await module({}, {}) : module;
          const shells = script.run.filter((step) => step.method === 'shell.run');
          assert.deepEqual(plain(shells.map((step) => step.params.message)), map[name], name);
          for (const step of shells) assert.equal(step.params.shell, platform === 'win32' ? 'powershell.exe' : 'bash');
          if (['update', 'add-local', 'uninstall', 'reset', 'stop'].includes(name)) assert.equal(script.run[0].method, app.stopOwnedStart);
          if (name === 'start') {
            assert.equal(script.daemon, true);
            assert.equal(script.run[0].method, app.ensureDoorPortFree);
            assert.deepEqual(plain(script.run[1].params.on), [{ event: '/ASTRID_PINOKIO_FAILURE/', break: true }, { event: '/ASTRID_PINOKIO_READY/', done: true }]);
            assert.deepEqual(plain(script.run.at(-1)), { method: 'local.set', params: app.localSetOpenTarget(mode) });
          }
          if (name === 'reset') assert.equal(shells.length, 0);
          if (name === 'uninstall-delete-data') {
            await assert.rejects(script.run[1].method({ input: { confirmation: 'delete' } }), /cancelled/);
            assert.deepEqual(plain(await script.run[1].method({ input: { confirmation: 'DELETE' } })), { confirmed: true });
            assert.equal(script.run[2].method, app.stopOwnedStart);
          }
          if (['install-local', 'add-local'].includes(name)) {
            const count = app.writes.length;
            await script.run.at(-1).method();
            assert.equal(app.writes.length, count + 1);
            assert.equal(JSON.parse(app.writes.at(-1).content).mode, 'local');
          }
        }
        // Clone path, including a slash ref and shell metacharacters in app paths.
        assert.equal(app.shellStep(app.cloneEditorMessage()).params.message, expected.clone);
      });
    }
  }
}

test('menu: all operation, installation, starting, ready, external and conflict states', async () => {
  for (const mode of [null, 'backend', 'local']) {
    let probeKind = 'free';
    const app = { ...fakeApp('darwin', '', mode), probeDoor: async () => ({ kind: probeKind }) };
    let running = '';
    let local = {};
    const info = { exists: () => Boolean(mode), running: (uri) => uri === running, local: () => local };
    const { menu } = load('pinokio.js', app);
    const labels = async () => plain((await menu({}, info)).map((item) => item.text));
    const idle = mode ? ['Start', 'Update', ...(mode === 'backend' ? ['Add local editor'] : []), 'Reset', 'Uninstall', 'Uninstall and permanently delete all data…'] : ['Install', 'Install fully local'];
    assert.deepEqual(await labels(), idle);
    for (const name of [...scripts.filter((name) => name !== 'start'), 'stop']) {
      running = `pinokio/${name}.js`;
      const items = await menu({}, info);
      assert.equal(items.length, 1);
      assert.equal(items[0].href, undefined);
    }
    running = 'pinokio/start.js';
    assert.deepEqual(await labels(), ['Starting Astrid…', 'Stop']);
    local = app.localSetOpenTarget(mode);
    assert.deepEqual(await labels(), ['Open Astrid', 'Stop']);
    assert.equal((await menu({}, info))[0].popout, mode !== 'local');
    running = '';
    probeKind = 'astrid';
    assert.deepEqual(await labels(), ['Astrid is already running on port 17340.', 'Open Astrid']);
    assert.equal((await menu({}, info))[1].href, library.HOSTED_OPEN_URL);
    probeKind = 'occupied';
    assert.match((await labels())[0], /Another program/);
    assert.equal((await menu({}, info))[0].href, undefined);
  }
});

test('port classification and preflight use injected requests; no live port probes', async () => {
  assert.equal((await library.probeDoor({ portOpen: async () => false })).kind, 'free');
  for (const [status, body, expected] of [[200, { protocol: 'workspace.v1' }, 'astrid'], [503, { error: 'runtime_unavailable' }, 'astrid'], [403, { error: 'hosted_origin_required' }, 'astrid'], [200, { status: 'ok' }, 'occupied'], [404, {}, 'occupied']]) {
    assert.equal((await library.probeDoor({ portOpen: async () => true, request: async () => ({ status, json: async () => body }) })).kind, expected);
  }
  for (const kind of ['astrid', 'occupied']) {
    const app = library.createApp({ probe: async () => ({ kind }) });
    await assert.rejects(app.ensureDoorPortFree({}, () => {}), kind === 'astrid' ? /already running/ : /Another program/);
  }
});

test('Stop awaits the absolute Pinokio script owner before returning', async () => {
  const app = fakeApp('darwin');
  let release;
  let stopped = false;
  const pending = app.stopOwnedStart({}, () => {}, { api: { stop: async (request) => {
    assert.equal(request.params.uri, app.paths.join(app.APP_DIR, 'pinokio', 'start.js'));
    await new Promise((resolve) => { release = resolve; }); stopped = true;
  } } });
  assert.equal(stopped, false);
  release(); await pending; assert.equal(stopped, true);
});

test('installer record selects authoritative Python, data root, Node and npm; no imaginary with-env', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const app = fakeApp(platform);
    const p = app.paths;
    const root = app.BACKEND_ROOT;
    const versionRoot = p.join(root, 'versions', 'v1');
    const node = p.join(versionRoot, 'tools', 'node', platform === 'win32' ? 'node.exe' : 'bin/node');
    const python = p.join(versionRoot, 'py', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const profile = p.join(versionRoot, 'source-profile.json');
    const data = platform === 'win32' ? 'D:\\Astrid Data' : '/retained Astrid data';
    const files = new Map([
      [p.join(root, 'current'), 'v1'],
      [p.join(root, 'versions', 'v1', 'version.json'), JSON.stringify({ root: versionRoot, python, profile, env: { ASTRID_NODE_EXECUTABLE: node } })],
      [p.join(root, 'install.json'), JSON.stringify({ owner: 'haus.astrid.runtime', managed_by: 'pinokio', data_root: data })],
    ]);
    const installed = installation(root, { platform, filesystem: { readFileSync: (f) => files.get(f), existsSync: () => true }, environment: { PATH: '/ambient', ASTRID_RUNTIME_DATA_ROOT: '/wrong', ASTRID_RUNTIME_CHECKOUT: '/wrong', NODE_OPTIONS: '--bad' } });
    assert.equal(installed.env.ASTRID_RUNTIME_DATA_ROOT, data);
    assert.equal(installed.env.ASTRID_RUNTIME_CHECKOUT, '');
    assert.equal(installed.env.NODE_OPTIONS, undefined);
    assert.equal(installed.env.ASTRID_RUNTIME_PYTHON, python);
    assert.equal(installed.env.ASTRID_RUNTIME_SOURCE_MANIFEST, profile);
    const c = commands(root, app.EDITOR_DIR, 'local', installed, platform);
    assert.deepEqual(c.dependencies, { command: node, args: [installed.npm, 'ci', '--no-audit', '--no-fund'] });
    assert.deepEqual(c.build, { command: node, args: ['scripts/dev-local-workspace.mjs', '--build'] });
    assert.deepEqual(c.preview, { command: node, args: ['scripts/dev-local-workspace.mjs', '--preview', '--preview-dir', p.join(app.EDITOR_DIR, 'dist')] });
    assert.deepEqual(c.status, { command: python, args: ['-I', '-m', 'astrid_runtime', 'status', '--data-root', data, '--json'] });
    if (platform === 'win32') assert.deepEqual(c.runtime, { command: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c', `""${p.join(root, 'run.cmd')}" --hosted-origin off"`], windowsVerbatimArguments: true });
    else assert.deepEqual(c.runtime, { command: p.join(root, 'run'), args: ['--hosted-origin', 'off'] });
  }
});

function sessionHarness({ platform = 'darwin', buildCode = 0, dependencyCode = 0, occupied = false, earlyExit = false } = {}) {
  const signals = new EventEmitter();
  const log = [];
  let pid = 5000;
  let statusCount = 0;
  const active = new Map();
  const installed = { node: '/pinned/node', npm: '/pinned/npm-cli.js', python: '/pinned/python', data: '/data', env: {} };
  function close(child, code = 0) { active.delete(child.pid); child.emit('close', code, null); }
  function spawnProcess(command, args, options) {
    const child = new EventEmitter(); child.pid = ++pid; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    log.push({ command, args, options, pid }); active.set(pid, child);
    queueMicrotask(() => {
      if (command.endsWith('taskkill.exe')) { const target = active.get(Number(args[1])); if (target) close(target); close(child); }
      else if (args.includes('status')) { const healthy = statusCount++ > 0; child.stdout.emit('data', JSON.stringify({ support: { healthy }, health: { status: 'ok' }, discovery: { runtime_instance_id: 'instance', active_realm: 'realm' } })); close(child, healthy ? 0 : 1); }
      else if (args.includes('ci')) close(child, dependencyCode);
      else if (args.includes('--build')) close(child, buildCode);
      else if (earlyExit && (command.endsWith('/run') || command.endsWith('cmd.exe'))) close(child, 7);
    });
    return child;
  }
  return { log, active, signals, options: { root: platform === 'win32' ? 'C:\\Astrid' : '/astrid', editor: platform === 'win32' ? 'C:\\editor' : '/editor', platform, installed, spawnProcess, signals,
    portOpen: async () => occupied, pause: async () => {}, killProcess: (group, signal) => { log.push({ group, signal }); const child = active.get(-group); if (child) close(child); } } };
}

test('temporary build Runtime cleanup: success, build failure and npm failure on POSIX and Windows', async () => {
  for (const platform of ['darwin', 'linux', 'win32']) for (const [buildCode, dependencyCode] of [[0, 0], [1, 0], [0, 1]]) {
    const h = sessionHarness({ platform, buildCode, dependencyCode });
    const result = runSession({ ...h.options, action: 'build', mode: 'local' });
    if (buildCode || dependencyCode) await assert.rejects(result, /command failed/);
    else await result;
    assert.equal(h.active.size, 0);
    assert.equal(h.signals.listenerCount('SIGTERM'), 0);
    const runtime = h.log.find((call) => call.command?.endsWith('/run') || call.command?.endsWith('cmd.exe'));
    assert.equal(Boolean(runtime), dependencyCode === 0);
    if (runtime) assert.equal(runtime.options.env.ASTRID_APP_LOOPBACK_ORIGIN, 'off');
  }
});

test('serve only announces ready after correct health; signal/error/conflict cleanup drains every child', async () => {
  for (const mode of ['backend', 'local']) for (const platform of ['darwin', 'linux', 'win32']) {
    const h = sessionHarness({ platform });
    let requests = 0;
    let published = false;
    await assert.rejects(runSession({ ...h.options, action: 'serve', mode,
      request: async (url) => {
        if (url.endsWith('/runtime-config/v1/workspace.json')) return { ok: true, json: async () => ({ schemaVersion: 1, runtimeInstanceId: 'instance', realmId: 'realm' }) };
        requests++;
        assert.equal(url, mode === 'local' ? 'http://127.0.0.1:5180/tools/video-editor' : library.DOOR_HEALTH_URL);
        return { ok: requests > 1, status: requests > 1 ? 200 : 503, json: async () => ({ status: 'ok', protocol: 'workspace.v1' }) };
      }, output: (line) => {
        assert.equal(line, 'ASTRID_PINOKIO_READY'); assert.equal(requests, 2); published = true;
        queueMicrotask(() => h.signals.emit('SIGTERM'));
      },
    }), /stopped/);
    assert.equal(published, true);
    assert.equal(h.active.size, 0);
  }
  for (const setting of [{ occupied: true }, { earlyExit: true }]) {
    const h = sessionHarness(setting);
    await assert.rejects(runSession({ ...h.options, action: 'serve', mode: 'local', output: () => assert.fail('published before readiness') }), /5180|owned process exited/);
    assert.equal(h.active.size, 0);
  }
});


test('macOS vanished/zombie-only groups tolerate EPERM; live groups preserve the failure', () => {
  const killProcess = () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); };
  signalGroup(42, 'SIGKILL', { killProcess, snapshot: () => ({ status: 0, stdout: '42 Z\n43 Ss' }) });
  assert.throws(() => signalGroup(42, 'SIGKILL', { killProcess, snapshot: () => ({ status: 0, stdout: '42 S' }) }), /denied/);
  assert.throws(() => signalGroup(42, 'SIGKILL', { killProcess, snapshot: () => ({ status: 1, stdout: '' }) }), /denied/);
});


test('Stop of an idle/partial install and resolving Start without a mode remain safe', async () => {
  const app = fakeApp('darwin', '', null);
  const result = await app.stopOwnedStart({}, () => {}, { api: { running: {}, stop: () => assert.fail('no owner to stop') } });
  assert.equal(result.stopped, false);
  const script = await load('pinokio/start.js', app)({}, {});
  await assert.rejects(script.run[0].method(), /install mode is missing/);
});
