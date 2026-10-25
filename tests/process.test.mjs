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
      writeExecutable(python, `#!${process.execPath}\nconst fs=require('node:fs');const healthy=fs.existsSync(process.env.PID_FILE);console.log(JSON.stringify({support:{healthy},health:{status:'ok'}}));process.exitCode=healthy?0:1;\n`);
      const npm = path.join(temp, 'npm-cli.cjs'); fs.writeFileSync(npm, 'process.exit(0)');
      fs.writeFileSync(path.join(editor, 'scripts', 'dev-local-workspace.mjs'), `import fs from 'node:fs';import {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.env.GRANDCHILD_FILE,String(child.pid));\n${outcome === 'success' ? 'child.kill();process.exit(0);' : outcome === 'failure' ? 'process.exit(9);' : 'setInterval(()=>{},1000);'}\n`);
      const pidFile = path.join(temp, 'runtime.pid'); const grandchildFile = path.join(temp, 'grandchild.pid');
      const installed = { node: process.execPath, npm, python, data: path.join(temp, 'data'), env: { ...process.env, PID_FILE: pidFile, GRANDCHILD_FILE: grandchildFile } };
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
