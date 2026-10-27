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
function shellMessage(step, platform) {
  if (platform !== 'win32') return step.params.message;
  const payload = step.params.message.match(/--pinokio-payload=([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(payload, 'Windows shell step must carry its encoded Pinokio payload');
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).message;
}
function fakeApp(platform, ref = '', mode = 'backend') {
  const base = platform === 'win32'
    ? "C:\\Users\\Test Home\\pinokio\\api\\Astrid O'Malley"
    : "/Users/testhome/pinokio/api/Astrid O'Malley";
  const writes = [];
  const filesystem = {
    readFileSync(file) {
      if (file.endsWith('install-mode.json')) return JSON.stringify({ schema_version: 1, mode });
      throw new Error('absent');
    },
    existsSync: () => false, mkdirSync() {}, writeFileSync(file, content) { writes.push({ file, content }); }, rmSync() {},
  };
  return { ...library.createApp({ platform, appDirectory: base, environment: { ASTRID_APP_REF: ref }, filesystem, lifecycle: { preflightStop: async () => ({ safe: true }), requestGracefulStop: async () => {}, waitForInstallerLock: async () => {} }, probe: async () => ({ kind: 'free' }) }),
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
          update: [app.shellStep(app.launcherPullMessage()).params.message,
            ...(mode === 'local' ? [expected.pull, expected.localUpdate, expected.build] : [expected.update])],
          start: [expected[mode]], stop: [], reset: [], uninstall: [expected.uninstall],
          'uninstall-delete-data': [expected.delete],
        };
        for (const name of scripts) {
          const module = load(`pinokio/${name}.js`, app);
          if (name === 'add-local' && mode === 'local') {
            await assert.rejects(module({}, {}), /already fully local/);
            continue;
          }
          const script = typeof module === 'function' ? await module({}, {}) : module;
          const shells = script.run.filter((step) => step.method === 'shell.run');
          assert.deepEqual(plain(shells.map((step) => step.params.message)), map[name], name);
          for (const step of shells) assert.equal(step.params.shell, platform === 'win32' ? 'powershell.exe' : 'bash');
          if (['install-local', 'add-local', 'uninstall', 'reset', 'stop'].includes(name) || (name === 'update' && mode === 'local')) assert.equal(script.run[0].method, app.stopOwnedStart);
          if (name === 'start') {
            assert.equal(script.daemon, true);
            assert.deepEqual(plain(script.on.stop), plain(app.stopHook()));
            assert.equal(script.on.stop.method, 'shell.run');
            assert.equal(script.on.stop.params.message, expected.stopHook);
            assert.equal(script.on.stop.uri, undefined);
            assert.equal(script.run[0].method, app.ensureDoorPortFree);
            assert.deepEqual(plain(script.run[1].params.on), [{ event: '/ASTRID_PINOKIO_FAILURE/', break: true }, { event: '/ASTRID_PINOKIO_READY/', done: true }]);
            assert.deepEqual(plain(script.run.at(-1)), { method: 'local.set', params: app.localSetOpenTarget(mode) });
          }
          if (name === 'reset') assert.equal(shells.length, 0);
          if (name === 'uninstall-delete-data') {
            await assert.rejects(script.run[1].method({ input: { confirmation: 'delete' } }), /Cancelled, so nothing was deleted/);
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
    const idle = mode ? ['Start', 'Update', ...(mode === 'backend' ? ['Switch to fully local'] : []), 'Reset', 'Uninstall', 'Uninstall and delete all Astrid data…'] : ['Install', 'Install fully local'];
    const idleItems = await menu({}, info);
    assert.deepEqual(plain(idleItems.map((item) => item.text)), idle);
    assert.equal(idleItems.filter((item) => item.default).length, mode ? 1 : 0);
    if (mode) assert.equal(idleItems[0].default, true);
    for (const name of [...scripts.filter((name) => name !== 'start'), 'stop']) {
      running = `pinokio/${name}.js`;
      const items = await menu({}, info);
      assert.equal(items.length, 1);
      assert.equal(items[0].href, undefined);
      assert.equal(items[0].default, undefined);
    }
    running = 'pinokio/start.js';
    const pending = await menu({}, info);
    assert.deepEqual(plain(pending.map((item) => item.text)), ['Starting Astrid…', 'Stop']);
    assert.equal(pending.some((item) => item.default), false);
    local = app.localSetOpenTarget(mode);
    const ready = await menu({}, info);
    assert.deepEqual(plain(ready.map((item) => item.text)), ['Open Astrid', ...(mode === 'backend' ? ['Update and restart'] : []), 'Stop']);
    assert.equal(ready[0].default, true);
    assert.equal(ready[0].popout, mode !== 'local');
    assert.equal(ready[0].target_full, mode === 'local' ? undefined : local.url);
    assert.equal(ready[0].href, mode === 'local' ? local.url : '/');
    assert.equal(ready[1].default, undefined);
    running = '';
    probeKind = 'astrid';
    const external = await menu({}, info);
    assert.deepEqual(plain(external.map((item) => item.text)), ['Astrid is already running on this computer. Use Open Astrid, or stop that copy to run Astrid from Pinokio.', 'Open Astrid']);
    assert.equal(external[1].href, library.HOSTED_OPEN_URL);
    assert.equal(external.some((item) => item.default), false);
    probeKind = 'occupied';
    const conflict = await menu({}, info);
    assert.match(conflict[0].text, /Another program/);
    assert.equal(conflict[0].href, undefined);
    assert.equal(conflict[0].default, undefined);
  }
});

test('Update delegates hosted lifecycle to one app updater and retains full local lifecycle', async () => {
  for (const platform of ['darwin', 'linux', 'win32']) for (const mode of ['backend', 'local']) {
    const app = fakeApp(platform, 'feat/pinokio', mode);
    const script = await load('pinokio/update.js', app)({}, {});
    const [stop, pull, portCheck] = mode === 'local' ? script.run : [null, script.run[1], null];
    if (mode === 'local') assert.equal(stop.method, app.stopOwnedStart);
    else {
      assert.equal(script.run.length, 3);
      assert.equal(script.run[0].method, app.preflightStop);
      assert.equal(script.run[1].method, 'shell.run');
      assert.equal(script.run[2].method, 'shell.run');
      assert.match(shellMessage(script.run[2], platform), /--update-app/);
    }
    assert.equal(pull.method, 'shell.run');
    assert.equal(pull.params.path, app.APP_DIR);
    const pullMessage = shellMessage(pull, platform);
    assert.match(pullMessage, /pull --ff-only/);
    assert.match(pullMessage, /update the Pinokio launcher\./);
    assert.match(pullMessage, /undo those edits, then choose Update again\./);
    assert.ok(pull.params.on.some((event) => event.event === '/ASTRID_PINOKIO_FAILURE/' && event.break));
    if (mode === 'local') assert.equal(portCheck.method, app.ensureDoorPortFree);
    const astridUpdate = script.run.findIndex((step) => step.method === 'shell.run' && shellMessage(step, platform).includes('--update'));
    assert.ok(astridUpdate > (mode === 'local' ? 2 : 0), `Astrid update follows the launcher pull (${platform}, ${mode})`);
  }
  assert.equal(library.LAUNCHER_PULL_FAILURE, "Couldn't update the Pinokio launcher. If you edited its files, undo those edits, then choose Update again.");
});

test('hosted Update refuses at read-only preflight before the launcher pull', async () => {
  const base = fakeApp('linux', '', 'backend');
  const app = library.createApp({ platform: 'linux', appDirectory: base.APP_DIR, environment: {},
    filesystem: { readFileSync: (file) => { if (file.endsWith('install-mode.json')) return JSON.stringify({ schema_version: 1, mode: 'backend' }); throw new Error('absent'); }, existsSync: () => false },
    lifecycle: { preflightStop: async () => { throw new Error('Astrid is busy (1 tasks running). Try again when they finish.'); },
      waitForInstallerLock: async () => {} } });
  app.validateExistingEditorCheckout = () => true;
  const script = await load('pinokio/update.js', app)({}, {});
  const executed = [];
  await assert.rejects(async () => {
    for (const step of script.run) {
      if (typeof step.method === 'function') await step.method({}, () => {});
      else executed.push(step);
    }
  }, /Astrid is busy \(1 tasks running\)/);
  assert.deepEqual(executed, []);
  assert.equal(script.run[0].method, app.preflightStop);
  assert.equal(script.run[1].method, 'shell.run');
});

test('local Update runs the same refusal gate before editor pull and installer mutation', async () => {
  const base = fakeApp('linux', '', 'local');
  const app = library.createApp({ platform: 'linux', appDirectory: base.APP_DIR, environment: {},
    filesystem: { readFileSync: (file) => { if (file.endsWith('install-mode.json')) return JSON.stringify({ schema_version: 1, mode: 'local' }); throw new Error('absent'); }, existsSync: () => false },
    lifecycle: { preflightStop: async () => { throw new Error('Astrid is busy (1 tasks running). Try again when they finish.'); } } });
  app.validateExistingEditorCheckout = () => true;
  const script = await load('pinokio/update.js', app)({}, {});
  const executed = [];
  await assert.rejects(async () => {
    for (const step of script.run) {
      if (typeof step.method === 'function') await step.method({}, () => {}, { api: {
        running: { [app.paths.join(app.APP_DIR, 'pinokio', 'start.js')]: true },
        stop: async () => assert.fail('busy Update must not close the Start tree'),
      } });
      else executed.push(step);
    }
  }, /Astrid is busy \(1 tasks running\)/);
  assert.deepEqual(executed, []);
  assert.equal(script.run[0].method, app.stopOwnedStart);
});

test('Stop and every maintenance caller preserve busy and unknown failures before mutation', async () => {
  for (const platform of ['darwin', 'linux', 'win32']) for (const mode of ['backend', 'local'])
    for (const stage of ['preflight', 'controller']) for (const reason of ['busy', 'transport', 'timeout', 'generic']) {
    for (const name of ['stop', 'update', 'install-local', 'reset', 'uninstall', 'uninstall-delete-data', ...(mode === 'backend' ? ['add-local'] : [])]) {
      // Hosted Update's final fence is inside the existing Python app updater.
      if (mode === 'backend' && name === 'update' && stage === 'controller') continue;
      const base = fakeApp(platform, '', mode);
      const calls = [];
      const message = reason === 'busy' ? 'Astrid is busy (1 tasks running). Try again when they finish.\ntask-caller [render; running; age 4s]'
        : reason === 'transport' ? 'Controller transport failed.' : reason === 'timeout' ? 'Runtime stop timed out.' : 'Runtime stop failed.';
      const fail = () => {
        const error = new Error(message);
        if (reason === 'busy') error.details = { task_count: 1, blockers: [{ task_id: 'task-caller' }] };
        throw error;
      };
      const app = library.createApp({ platform, appDirectory: base.APP_DIR, environment: {},
        filesystem: {
          existsSync: () => true,
          readFileSync: (file) => JSON.stringify(file.endsWith('install-mode.json') ? { schema_version: 1, mode } : { schema: 1, pid: 123, port: 1234 }),
          rmSync: () => calls.push('remove'), writeFileSync: () => calls.push('write'), mkdirSync: () => calls.push('mkdir'),
        },
        lifecycle: {
          preflightStop: async () => { calls.push('preflight'); if (stage === 'preflight') fail(); return { safe: true }; },
          requestGracefulStop: async () => { calls.push('controller'); fail(); },
          waitForInstallerLock: async () => calls.push('lock'),
        },
      });
      app.validateExistingEditorCheckout = () => true;
      const module = load(`pinokio/${name}.js`, app);
      const script = typeof module === 'function' ? await module({}, {}) : module;
      const kernel = { api: { running: { [app.paths.join(app.APP_DIR, 'pinokio', 'start.js')]: true },
        stop: async () => calls.push('kernel-stop') } };
      await assert.rejects(async () => {
        for (const step of script.run) {
          if (typeof step.method === 'function') await step.method({ input: { confirmation: 'DELETE' } }, () => {}, kernel);
          else if (step.method !== 'input') calls.push(step.method);
        }
      }, (error) => {
        assert.ok(error.message.includes(message), `${platform}/${mode}/${name}/${stage}/${reason}: ${error.message}`);
        if (reason === 'busy') assert.equal(error.details.task_count, 1);
        return true;
      });
      assert.deepEqual(calls, stage === 'preflight' ? ['preflight'] : ['preflight', 'controller']);
    }
  }
});

test('settings use ENVIRONMENT first and fall back to the shipped _ENVIRONMENT template', () => {
  const p = process.platform === 'win32' ? path.win32 : path.posix;
  const base = p.join(p.parse(process.platform === 'win32' ? 'C:\\' : '/').root, 'Pinokio Apps', 'Astrid');
  const values = new Map([
    [p.join(base, '_ENVIRONMENT'), 'ASTRID_APP_REF=feat/pinokio\nOTHER=default'],
  ]);
  const app = library.createApp({ appDirectory: base, environment: {}, filesystem: {
    readFileSync(file) { if (!values.has(file)) throw new Error('absent'); return values.get(file); },
  } });
  assert.equal(app.setting('ASTRID_APP_REF'), 'feat/pinokio');
  values.set(p.join(base, 'ENVIRONMENT'), 'ASTRID_APP_REF=\nOTHER=generated');
  assert.equal(app.setting('ASTRID_APP_REF'), '');
  assert.equal(app.setting('OTHER'), 'generated');
  values.set(p.join(base, 'ENVIRONMENT'), 'OTHER=generated');
  assert.equal(app.setting('ASTRID_APP_REF'), 'feat/pinokio');
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
  let entered;
  const invoked = new Promise((resolve) => { entered = resolve; });
  let stopped = false;
  const pending = app.stopOwnedStart({}, () => {}, { api: { stop: async (request) => {
    assert.equal(request.params.uri, app.paths.join(app.APP_DIR, 'pinokio', 'start.js'));
    await new Promise((resolve) => { release = resolve; entered(); }); stopped = true;
  } } });
  assert.equal(stopped, false);
  await invoked; release(); await pending; assert.equal(stopped, true);
});

test('an active Start with a missing controller refuses before Pinokio tree cleanup', async () => {
  const base = fakeApp('linux');
  const calls = [];
  const app = library.createApp({ platform: 'linux', appDirectory: base.APP_DIR,
    filesystem: { ...base.filesystem, existsSync: () => true }, lifecycle: {
      preflightStop: async () => ({ safe: true }),
      requestGracefulStop: async () => ({ ok: true, absent: true }),
      waitForInstallerLock: async () => calls.push('lock'),
    } });
  await assert.rejects(app.stopOwnedStart({}, () => {}, { api: {
    running: { [app.paths.join(app.APP_DIR, 'pinokio', 'start.js')]: true },
    stop: async () => calls.push('kernel-stop'),
  } }), /no responsive stop controller/);
  assert.deepEqual(calls, []);
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
    const installed = installation(root, { platform, filesystem: { readFileSync: (f) => files.get(f), existsSync: () => true, realpathSync: (f) => f }, environment: { PATH: '/ambient', ASTRID_RUNTIME_DATA_ROOT: '/wrong', ASTRID_RUNTIME_CHECKOUT: '/wrong', NODE_OPTIONS: '--bad', PYTHONNOUSERSITE: '1', GIT_CONFIG_GLOBAL: '/pinokio/gitconfig' } });
    assert.equal(installed.env.ASTRID_RUNTIME_DATA_ROOT, data);
    assert.equal(installed.env.ASTRID_RUNTIME_CHECKOUT, '');
    assert.equal(installed.env.NODE_OPTIONS, undefined);
    assert.equal(installed.env.PYTHONNOUSERSITE, undefined);
    assert.equal(installed.env.GIT_CONFIG_GLOBAL, undefined);
    assert.equal(installed.env.ASTRID_RUNTIME_PYTHON, python);
    assert.equal(installed.env.ASTRID_RUNTIME_SOURCE_MANIFEST, profile);
    const c = commands(root, app.EDITOR_DIR, 'local', installed, platform);
    assert.deepEqual(c.dependencies, { command: node, args: [installed.npx, '-y', 'npm@11', 'ci', '--no-audit', '--no-fund'] });
    assert.deepEqual(c.build, { command: node, args: ['scripts/dev-local-workspace.mjs', '--build'] });
    assert.deepEqual(c.preview, { command: node, args: ['scripts/dev-local-workspace.mjs', '--preview', '--preview-dir', p.join(app.EDITOR_DIR, 'dist')] });
    assert.deepEqual(c.status, { command: python, args: ['-I', '-m', 'astrid_runtime', 'status', '--data-root', data, '--json'] });
    assert.deepEqual(c.down, { command: python, args: ['-I', '-m', 'astrid_runtime', 'down', '--profile', 'astrid', '--data-root', data, '--source-manifest', profile, '--json'] });
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
  const installed = { node: '/pinned/node', npm: '/pinned/npm-cli.js', npx: '/pinned/npx-cli.js', python: '/pinned/python', profile: '/pinned/profile.json', data: '/data', env: {} };
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
    checkStop: async () => ({ safe: true }),
    openController: async () => ({ close: async () => {} }),
    gracefulDown: async (spec) => {
      log.push({ down: spec });
      const runtime = log.find((call) => call.command?.endsWith('/run') || call.command?.endsWith('cmd.exe'));
      const child = runtime && active.get(runtime.pid);
      if (child) close(child);
    },
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

test('build failure with busy cleanup keeps its controller open until the same session retries', async () => {
  const h = sessionHarness({ platform: 'linux', buildCode: 1 });
  let stop; let retryWork; let checks = 0; let controllerClosed = false;
  await assert.rejects(runSession({ ...h.options, action: 'build', mode: 'local',
    checkStop: async () => {
      if (checks++ === 0) throw new Error('Astrid is busy (1 tasks running). Try again when they finish.');
      return { safe: true, blockers: [] };
    },
    openController: async (_root, callback) => { stop = callback; return { close: async () => { controllerClosed = true; } }; },
    output: (line) => {
      if (!line.includes('Astrid is busy')) return;
      retryWork = (async () => {
        assert.equal(controllerClosed, false);
        assert.equal(h.active.size, 1);
        const retried = await stop();
        assert.equal(retried.ok, true);
      })();
    },
  }), /command failed/);
  await retryWork;
  assert.equal(controllerClosed, true);
  assert.equal(h.active.size, 0);
  assert.equal(checks, 2);
});

test('serve only announces ready after correct health; signal/error/conflict cleanup drains every child', async () => {
  for (const mode of ['backend', 'local']) for (const platform of ['darwin', 'linux', 'win32']) {
    const h = sessionHarness({ platform });
    let requests = 0;
    let published = false;
    await runSession({ ...h.options, action: 'serve', mode,
      request: async (url) => {
        if (url.endsWith('/runtime-config/v1/workspace.json')) return { ok: true, json: async () => ({ schemaVersion: 1, runtimeInstanceId: 'instance', realmId: 'realm' }) };
        requests++;
        assert.equal(url, mode === 'local' ? 'http://127.0.0.1:5180/tools/video-editor' : library.DOOR_HEALTH_URL);
        return { ok: requests > 1, status: requests > 1 ? 200 : 503, json: async () => ({ status: 'ok', protocol: 'workspace.v1' }) };
      }, output: (line) => {
        assert.equal(line, 'ASTRID_PINOKIO_READY'); assert.equal(requests, 2); published = true;
        queueMicrotask(() => h.signals.emit('SIGTERM'));
      },
    });
    assert.equal(published, true);
    assert.equal(h.active.size, 0);
  }
  for (const setting of [{ occupied: true }, { earlyExit: true }]) {
    const h = sessionHarness(setting);
    await assert.rejects(runSession({ ...h.options, action: 'serve', mode: 'local', output: () => assert.fail('published before readiness') }), /5180|quit unexpectedly/);
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
  await assert.rejects(script.run[0].method(), /isn't fully installed/);
  const freshLocal = await load('pinokio/install-local.js', app)({}, {});
  assert.equal(freshLocal.run[0].method, app.ensureDoorPortFree);
});


test('controlled Stop runs fenced down before editor cleanup and releases Runtime on every platform and mode', async () => {
  for (const platform of ['darwin', 'linux', 'win32']) for (const mode of ['backend', 'local']) {
    const h = sessionHarness({ platform });
    let stop;
    let response;
    let downCalled = 0;
    await runSession({ ...h.options, action: 'serve', mode,
      openController: async (_root, callback) => { stop = callback; return { close: async () => {} }; },
      gracefulDown: async (spec, options) => {
        downCalled++;
        assert.deepEqual(spec.args, ['-I', '-m', 'astrid_runtime', 'down', '--profile', 'astrid', '--data-root', '/data', '--source-manifest', '/pinned/profile.json', '--json']);
        assert.equal(options.timeoutMs, 25_000);
        const preview = h.log.find((call) => call.args?.includes('--preview'));
        if (preview) assert.equal(h.active.has(preview.pid), true);
        await h.options.gracefulDown(spec);
      },
      request: async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok', protocol: 'workspace.v1', schemaVersion: 1, runtimeInstanceId: 'instance', realmId: 'realm' }) }),
      output: () => { response = stop(); assert.equal(stop(), response); },
    });
    assert.equal((await response).ok, true);
    assert.equal(downCalled, 1);
    assert.equal(h.active.size, 0);
  }
});

test('busy and unknown preflight/down failures preserve both live modes on every platform for retry', async () => {
  for (const platform of ['darwin', 'linux', 'win32']) for (const mode of ['backend', 'local'])
    for (const stage of ['preflight', 'down']) for (const reason of ['busy', 'transport', 'timeout', 'generic']) {
    const h = sessionHarness({ platform });
    let stop;
    let response;
    let attempts = 0; let downCalls = 0; let controllerClosed = false;
    const message = reason === 'busy' ? 'Astrid is busy (1 tasks running). Try again when they finish.\ntask-matrix [running]'
      : reason === 'transport' ? 'Controller transport failed.' : reason === 'timeout' ? 'Command timed out' : 'Runtime stop failed.';
    const details = { task_count: 1, blockers: [{ task_id: 'task-matrix', state: 'running' }] };
    const refuseOnce = () => {
      if (attempts++ === 0) {
        const error = new Error(message);
        if (reason === 'busy') error.details = details;
        throw error;
      }
    };
    await runSession({ ...h.options, action: 'serve', mode,
      openController: async (_root, callback) => { stop = callback; return { close: async () => { controllerClosed = true; } }; },
      checkStop: async () => { if (stage === 'preflight') refuseOnce(); return { safe: true }; },
      gracefulDown: async (_spec, options) => {
        downCalls++;
        if (stage === 'down') refuseOnce();
        await h.options.gracefulDown(_spec, options);
      },
      request: async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok', protocol: 'workspace.v1',
        schemaVersion: 1, runtimeInstanceId: 'instance', realmId: 'realm' }) }),
      output: () => { const before = h.log.length; response = stop().then(async (first) => {
        assert.deepEqual(first, { ok: false, errors: [message], ...(reason === 'busy' ? { details } : {}) });
        assert.equal(h.active.size, mode === 'local' ? 2 : 1);
        assert.equal(controllerClosed, false);
        assert.deepEqual(h.log.slice(before), []); // no signals, taskkill or other cleanup
        return stop();
      }); },
    });
    assert.equal((await response).ok, true);
    assert.equal(attempts, 2);
    assert.equal(downCalls, stage === 'preflight' ? 1 : 2);
    assert.equal(h.active.size, 0);
    assert.equal(controllerClosed, true);
    assert.equal((await stop()).ok, true);
    assert.equal(downCalls, stage === 'preflight' ? 1 : 2);
  }
});

test('cleanup retry after a completed down does not issue a second Runtime stop', async () => {
  const h = sessionHarness({ platform: 'linux' });
  let stop; let response; let downs = 0; let cleanupAttempts = 0;
  await runSession({ ...h.options, action: 'serve', mode: 'local',
    openController: async (_root, callback) => { stop = callback; return { close: async () => {} }; },
    gracefulDown: async () => {
      downs++;
      const runtime = h.log.find((call) => call.command?.endsWith('/run'));
      const child = h.active.get(runtime.pid);
      h.active.delete(runtime.pid); child.emit('close', 0, null);
    },
    killProcess: (group, signal) => {
      const editor = h.log.find((call) => call.args?.includes('--preview'));
      if (editor?.pid === -group && cleanupAttempts++ === 0) throw new Error('editor cleanup unavailable');
      h.options.killProcess(group, signal);
    },
    request: async () => ({ ok: true, status: 200, json: async () => ({ schemaVersion: 1, runtimeInstanceId: 'instance', realmId: 'realm' }) }),
    output: () => { response = stop().then(async (first) => {
      assert.equal(first.ok, false);
      assert.equal(h.active.size, 1);
      assert.equal(downs, 1);
      return stop();
    }); },
  });
  assert.equal((await response).ok, true);
  assert.equal(downs, 1);
  assert.equal(h.active.size, 0);
});

test('hosted updater handoff accepts an orderly Runtime exit after a safe report without a second down', async () => {
  const h = sessionHarness({ platform: 'linux' });
  let downCalls = 0; let controllerClosed = false;
  await runSession({ ...h.options, action: 'serve', mode: 'backend',
    checkStop: async () => ({ safe: true, blockers: [] }),
    gracefulDown: async () => { downCalls++; },
    openController: async () => ({ close: async () => { controllerClosed = true; } }),
    request: async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok', protocol: 'workspace.v1' }) }),
    output: (line) => {
      if (line !== 'ASTRID_PINOKIO_READY') return;
      const runtime = h.log.find((call) => call.command?.endsWith('/run'));
      const child = h.active.get(runtime.pid);
      h.active.delete(runtime.pid); child.emit('close', 0, null);
    },
  });
  assert.equal(downCalls, 0);
  assert.equal(controllerClosed, true);
  assert.equal(h.active.size, 0);
});

test('Stop before Runtime launch prevents child creation and cannot down external discovery', async () => {
  const h = sessionHarness();
  let down = false;
  await runSession({ ...h.options, action: 'serve', mode: 'local',
    openController: async (_root, callback) => { await callback(); return { close: async () => {} }; },
    gracefulDown: async () => { down = true; },
  });
  assert.equal(down, false);
  assert.equal(h.active.size, 0);
});

test('maintenance never mutates after failed grace, forced stop or held installer lock', async () => {
    for (const platform of ['darwin', 'linux', 'win32']) for (const reason of ['busy', 'unknown', 'force', 'lock']) {
    const log = [];
    const base = fakeApp(platform);
    const filesystem = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ schema_version: 1, mode: 'backend' }),
      rmSync: () => log.push('remove'),
    };
    const app = { ...library.createApp({ platform, appDirectory: base.APP_DIR, filesystem, environment: {}, probe: async () => ({ kind: 'free' }),
      lifecycle: {
        preflightStop: async () => { log.push('preflight'); if (reason === 'busy') throw new Error('Astrid is busy (1 tasks running). Try again when they finish.'); if (reason === 'unknown') throw new Error('Runtime stop timed out.'); },
        requestGracefulStop: async () => { log.push('grace'); },
        waitForInstallerLock: async () => { log.push('lock'); if (reason === 'lock') throw new Error('Astrid is still running. Stop it in Pinokio, then try again.'); },
      },
    }), validateExistingEditorCheckout: () => false };
    for (const name of ['reset', 'uninstall', 'uninstall-delete-data', 'add-local']) {
      log.length = 0;
      const module = await load(`pinokio/${name}.js`, app)({}, {});
      const kernel = { api: { running: { [app.paths.join(app.APP_DIR, 'pinokio', 'start.js')]: true }, stop: async () => {
        log.push('force'); if (reason === 'force') throw new Error('force failed');
      } } };
      const run = async () => {
        for (const step of module.run) {
          if (typeof step.method === 'function') await step.method({ input: { confirmation: 'DELETE' } }, () => {}, kernel);
          else if (step.method === 'shell.run') log.push('mutation');
        }
      };
      await assert.rejects(run(), reason === 'busy' ? /Astrid is busy \(1 tasks running\)/ : reason === 'unknown' ? /Runtime stop timed out/ : /Astrid is still running\. Stop it in Pinokio, then try again\./);
      assert.deepEqual(log, reason === 'busy' || reason === 'unknown' ? ['preflight']
        : reason === 'force' ? ['preflight', 'grace', 'force'] : ['preflight', 'grace', 'force', 'lock'], `${reason}: ${name}`);
    }
  }
});

test('maintenance waits for delayed lock release after forced cleanup, including idle installs', async () => {
  for (const active of [false, true]) {
    const order = [];
    let release;
    const locked = new Promise((resolve) => { release = resolve; });
    const base = fakeApp('darwin');
    const app = library.createApp({ appDirectory: base.APP_DIR, lifecycle: {
      preflightStop: async () => {},
      requestGracefulStop: async () => { order.push('grace'); },
      waitForInstallerLock: async () => { order.push('probe'); await locked; order.push('free'); },
    } });
    const pending = app.stopOwnedStart({}, () => {}, { api: { running: active ? { [app.paths.join(app.APP_DIR, 'pinokio', 'start.js')]: true } : {}, stop: async () => { order.push('force'); } } });
    while (!order.includes('probe')) await Promise.resolve();
    assert.deepEqual(order, active ? ['grace', 'force', 'probe'] : ['probe']);
    release(); await pending;
    assert.equal(order.at(-1), 'free');
  }
});

test('app updater supervisor remains controllable outside the native Start script', async () => {
  const base = fakeApp('darwin');
  const order = [];
  const app = library.createApp({ platform: 'darwin', appDirectory: base.APP_DIR, environment: {},
    filesystem: { readFileSync: () => JSON.stringify({ schema: 1, pid: 123, port: 9876 }) },
    lifecycle: { preflightStop: async () => order.push('preflight'), requestGracefulStop: async () => order.push('grace'), waitForInstallerLock: async () => order.push('lock') },
  });
  assert.equal(app.hasOwnedSupervisor(), true);
  await app.stopOwnedStart({}, () => {}, { api: { running: {}, stop: async () => order.push('force') } });
  assert.deepEqual(order, ['preflight', 'grace', 'lock']);
  const { menu } = load('pinokio.js', { ...app, readInstallMode: () => 'backend', probeDoor: async () => ({ kind: 'astrid' }) });
  const items = await menu({}, { exists: () => true, running: () => false });
  assert.deepEqual(plain(items.map((item) => item.text)), ['Open Astrid', 'Update and restart', 'Stop']);
});
