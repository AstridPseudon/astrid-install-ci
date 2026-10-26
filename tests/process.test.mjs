import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import library from '../pinokio/lib.js';
import { runSession } from '../pinokio/session.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function execute(command, env) {
  const child = spawn('bash', ['--noprofile', '--norc', '-c', command], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  return { code, stdout, stderr };
}
const writeExecutable = (file, text) => fs.writeFileSync(file, text, { mode: 0o700 });

test('POSIX failed shell commands emit a Pinokio break event and do not run later commands', { skip: process.platform === 'win32' }, async () => {
  const app = library.createApp();
  const step = app.shellStep('false\necho MUST_NOT_RUN');
  const result = await execute(step.params.message, process.env);
  assert.match(result.stdout, /ASTRID_PINOKIO_FAILURE/);
  assert.doesNotMatch(result.stdout, /MUST_NOT_RUN/);
  assert.deepEqual(step.params.on, [{ event: '/ASTRID_PINOKIO_FAILURE/', break: true }]);
});

test('POSIX ref bootstrap downloads matching files, forwards manifest, and removes temporary files', { skip: process.platform === 'win32' }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'astrid-launcher-bootstrap-'));
  try {
    const evidence = path.join(temp, 'evidence.json');
    const bin = path.join(temp, 'bin'); fs.mkdirSync(bin);
    // Fake curl supplies inert bootstrap bytes rather than accessing a network.
    writeExecutable(path.join(bin, 'curl'), `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);const url=a[1];const file=a[a.indexOf('-o')+1];\nfs.appendFileSync(process.env.URL_LOG,url+'\\n');\nfs.writeFileSync(file,url.endsWith('/install')?\`#!/bin/sh\\npython3 -c 'import json,os,sys;json.dump(sys.argv[1:],open(os.environ["EVIDENCE"],"w"))' "$@"\\n\`:'{}');\n`);
    const app = library.createApp({ platform: 'darwin', appDirectory: path.join(temp, "O'Malley app"), environment: { ASTRID_APP_REF: 'feat/pinokio' } });
    const result = await execute(app.shellStep(app.bootstrapScript()).params.message, { ...process.env, TMPDIR: temp, PATH: `${bin}:${process.env.PATH}`, EVIDENCE: evidence, URL_LOG: path.join(temp, 'urls') });
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /ASTRID_PINOKIO_FAILURE/);
    const argv = JSON.parse(fs.readFileSync(evidence));
    assert.deepEqual(argv.slice(0, 4), ['--root', app.BACKEND_ROOT, '--managed-by', 'pinokio']);
    assert.equal(argv[4], '--manifest');
    assert.equal(fs.existsSync(path.dirname(argv[5])), false);
    assert.deepEqual(fs.readFileSync(path.join(temp, 'urls'), 'utf8').trim().split('\n'), [
      'https://raw.githubusercontent.com/banodoco/astrid-app/feat/pinokio/public/install',
      'https://raw.githubusercontent.com/banodoco/astrid-app/feat/pinokio/public/install-manifest.json',
    ]);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('real POSIX fake Runtime/build processes leave no live descendants after success, failure or interrupt', { skip: process.platform === 'win32' }, async () => {
  for (const outcome of ['success', 'failure', 'interrupt']) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'astrid-launcher-tree-'));
    const signals = new EventEmitter();
    const children = new Set();
    try {
      const root = path.join(temp, 'root'); const editor = path.join(temp, 'editor');
      fs.mkdirSync(root); fs.mkdirSync(path.join(editor, 'scripts'), { recursive: true });
      writeExecutable(path.join(root, 'run'), `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(process.env.PID_FILE,String(process.pid));process.on('SIGTERM',()=>{fs.rmSync(process.env.PID_FILE,{force:true});process.exit(0)});setInterval(()=>{},1000);\n`);
      const python = path.join(temp, 'fake-python');
      writeExecutable(python, `#!${process.execPath}\nconst fs=require('node:fs');const healthy=fs.existsSync(process.env.PID_FILE);if(process.argv.includes('down')){if(healthy)process.kill(Number(fs.readFileSync(process.env.PID_FILE)),'SIGTERM');}else{console.log(JSON.stringify({support:{healthy},health:{status:'ok'},discovery:{runtime_instance_id:'fixture',active_realm:'fixture'}}));process.exitCode=healthy?0:1;}\n`);
      const npm = path.join(temp, 'npm-cli.cjs'); fs.writeFileSync(npm, 'process.exit(0)');
      const npx = path.join(temp, 'npx-cli.cjs'); fs.writeFileSync(npx, 'process.exit(0)');
      fs.writeFileSync(path.join(editor, 'scripts', 'dev-local-workspace.mjs'), `import fs from 'node:fs';import {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.env.GRANDCHILD_FILE,String(child.pid));\n${outcome === 'success' ? 'child.kill();process.exit(0);' : outcome === 'failure' ? 'process.exit(9);' : 'setInterval(()=>{},1000);'}\n`);
      const pidFile = path.join(temp, 'runtime.pid'); const grandchildFile = path.join(temp, 'grandchild.pid');
      const installed = { node: process.execPath, npm, npx, python, profile: path.join(temp, 'profile.json'), data: path.join(temp, 'data'), env: { ...process.env, PID_FILE: pidFile, GRANDCHILD_FILE: grandchildFile } };
      const pending = runSession({ action: 'build', root, editor, mode: 'local', installed, signals, pause, startupDeadlineMs: Infinity,
        spawnProcess: (...args) => { const child = spawn(...args); children.add(child); child.once('close', () => children.delete(child)); return child; },
      });
      if (outcome === 'interrupt') {
        while (!fs.existsSync(grandchildFile)) await pause(10);
        signals.emit('SIGTERM');
      }
      if (outcome === 'success') await pending;
      else await assert.rejects(pending, /command failed|stopped/);
      assert.equal(children.size, 0);
      assert.equal(fs.existsSync(pidFile), false);
      const grandchild = Number(fs.readFileSync(grandchildFile, 'utf8'));
      // The kernel may need a scheduling turn to reap a killed descendant.
      while (true) {
        try { process.kill(grandchild, 0); await pause(10); }
        catch (error) { assert.equal(error.code, 'ESRCH'); break; }
      }
    } finally {
      for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
});


test('checkout bootstrap cache is removed on installer failure before a local build', { skip: process.platform === 'win32' }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'astrid-bootstrap-failure-'));
  try {
    const app = library.createApp({ platform: 'darwin', appDirectory: temp, environment: {} });
    const publicDir = path.join(app.EDITOR_DIR, 'public');
    fs.mkdirSync(path.join(publicDir, 'bootstrap-venv'), { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'install'), 'exit 7\n');
    const step = app.shellStep(app.bootstrapScript('install', path.join(publicDir, 'install-manifest.json')));
    const result = await execute(step.params.message, process.env);
    assert.match(result.stdout, /ASTRID_PINOKIO_FAILURE/);
    assert.equal(fs.existsSync(path.join(publicDir, 'bootstrap-venv')), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('real controlled Stop drains the editor before down and releases the foreground temp lock', { skip: process.platform === 'win32' }, async () => {
  const { requestGracefulStop } = await import('../pinokio/lifecycle.mjs');
  const { spawnSync } = await import('node:child_process');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'astrid-graceful-stop-'));
  const root = path.join(temp, 'root'); const editor = path.join(temp, 'editor');
  const signals = new EventEmitter();
  const children = new Set();
  let stop;
  try {
    fs.mkdirSync(root); fs.mkdirSync(path.join(editor, 'scripts'), { recursive: true });
    const realPython = spawnSync('python3', ['-I', '-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).stdout.trim();
    const env = { ...process.env, PID_FILE: path.join(temp, 'runtime.pid'), EDITOR_PID: path.join(temp, 'editor.pid'), EVENTS: path.join(temp, 'events'), TEST_LOCK: path.join(temp, 'installer.lock') };
    writeExecutable(path.join(root, 'run'), `#!${realPython}\nimport os,sys,fcntl,signal,time\nfrom pathlib import Path\nlock=open(os.environ['TEST_LOCK'],'w+b')\nfcntl.flock(lock,fcntl.LOCK_EX)\nPath(os.environ['PID_FILE']).write_text(str(os.getpid()))\ndef stop(*args):\n    with open(os.environ['EVENTS'],'a') as out: out.write('runtime-clean\\n')\n    Path(os.environ['PID_FILE']).unlink()\n    sys.exit(0)\nsignal.signal(signal.SIGTERM,stop)\nwhile True: time.sleep(1)\n`);
    const python = path.join(temp, 'python-cli');
    writeExecutable(python, `#!${process.execPath}\nconst fs=require('node:fs');const live=fs.existsSync(process.env.PID_FILE);if(process.argv.includes('down')){fs.appendFileSync(process.env.EVENTS,'down\\n');process.kill(Number(fs.readFileSync(process.env.PID_FILE)),'SIGTERM');}else{console.log(JSON.stringify({support:{healthy:live},health:{status:'ok'},discovery:{runtime_instance_id:'fixture',active_realm:'fixture'}}));process.exitCode=live?0:1;}\n`);
    fs.writeFileSync(path.join(editor, 'scripts', 'dev-local-workspace.mjs'), `import fs from 'node:fs';fs.writeFileSync(process.env.EDITOR_PID,String(process.pid));process.on('SIGTERM',()=>{fs.appendFileSync(process.env.EVENTS,'editor-stop\\n');process.exit(0)});setInterval(()=>{},1000);`);
    await runSession({ action: 'serve', root, editor, mode: 'local', signals, pause, startupDeadlineMs: Infinity,
      installed: { node: process.execPath, python, profile: path.join(temp, 'profile.json'), data: path.join(temp, 'data'), env },
      spawnProcess: (...args) => { const child = spawn(...args); children.add(child); child.once('close', () => children.delete(child)); return child; },
      portOpen: async () => false,
      request: async (url) => url.endsWith('workspace.json')
        ? { ok: true, json: async () => ({ schemaVersion: 1, runtimeInstanceId: 'fixture', realmId: 'fixture' }) }
        : { ok: fs.existsSync(env.EDITOR_PID) },
      output: () => { stop = requestGracefulStop(root); },
    });
    assert.equal((await stop).ok, true);
    assert.deepEqual(fs.readFileSync(env.EVENTS, 'utf8').trim().split('\n'), ['editor-stop', 'down', 'runtime-clean']);
    assert.equal(children.size, 0);
    assert.equal(fs.existsSync(path.join(root, 'pinokio-control.json')), false);
    assert.equal(spawnSync(realPython, ['-I', '-c', 'import fcntl,sys\nf=open(sys.argv[1],"r+b")\nfcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)', env.TEST_LOCK]).status, 0);
  } finally {
    for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
