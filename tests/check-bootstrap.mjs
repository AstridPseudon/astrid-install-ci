// Optional source qualification: no network, packages, login service or Runtime.
// node tests/check-bootstrap.mjs /path/to/astrid-app/public/install
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import library from '../pinokio/lib.js';
const source = path.resolve(process.argv[2]);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'astrid-bootstrap-source-'));
try {
  const python = spawnSync('python3', ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(python);
  const bin = path.join(temp, 'bin'); fs.mkdirSync(bin);
  const uv = path.join(temp, 'home', '.local', 'share', 'astrid', 'bootstrap', 'uv');
  fs.mkdirSync(path.dirname(uv), { recursive: true });
  const executable = (file, body) => fs.writeFileSync(file, `#!${process.execPath}\n${body}`, { mode: 0o700 });
  executable(uv, `const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');const a=process.argv.slice(2);
if(a[0]==='--version'){console.log('uv 0.11.32');}
else if(a[0]==='venv'){fs.mkdirSync(path.join(a[1],'bin'),{recursive:true});fs.symlinkSync(process.env.REAL_PYTHON,path.join(a[1],'bin','python'));}
else if(a[0]==='run'&&a.includes('-c')){const index=a.indexOf('python');const r=spawnSync(process.env.REAL_PYTHON,a.slice(index+1),{env:process.env,stdio:'inherit'});process.exit(r.status??1);}
else if(a.includes('astrid')&&a.includes('install')){fs.writeFileSync(process.env.EVIDENCE,JSON.stringify(a));}
else if(!['python','pip'].includes(a[0])){throw new Error('unexpected uv arguments: '+a);}
`);
  executable(path.join(bin, 'curl'), `const fs=require('node:fs');const a=process.argv.slice(2);const url=a[1];const file=a[a.indexOf('-o')+1];
fs.appendFileSync(process.env.URL_LOG,url+'\\n');
if(url.endsWith('/public/install'))fs.copyFileSync(process.env.BOOTSTRAP_SOURCE,file);
else if(url.endsWith('/public/install-manifest.json'))fs.writeFileSync(file,JSON.stringify({tools:{uv:{version:'0.11.32'},python:{version:'3.11.13'}},agent:{sha:'a'.repeat(40)},runtime:{sha:'b'.repeat(40)}}));
else throw new Error('unexpected download '+url);
`);
  const app = library.createApp({ platform: process.platform, appDirectory: path.join(temp, 'app'), environment: { ASTRID_APP_REF: 'feat/pinokio' } });
  const evidence = path.join(temp, 'evidence.json');
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', app.shellStep(app.bootstrapScript()).params.message], {
    encoding: 'utf8', env: { ...process.env, HOME: path.join(temp, 'home'), XDG_DATA_HOME: path.join(temp, 'home', '.local', 'share'), XDG_STATE_HOME: path.join(temp, 'state'), TMPDIR: temp,
      PATH: `${bin}:${process.env.PATH}`, REAL_PYTHON: python, EVIDENCE: evidence, URL_LOG: path.join(temp, 'urls'), BOOTSTRAP_SOURCE: source },
  });
  assert.doesNotMatch(result.stdout, /ASTRID_PINOKIO_FAILURE/, result.stdout + result.stderr);
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(fs.readFileSync(evidence, 'utf8'));
  assert.ok(args.includes('--managed-by') && args.includes('pinokio'));
  const manifest = args[args.indexOf('--manifest') + 1];
  assert.equal(path.basename(manifest), 'install-manifest.json');
  assert.equal(fs.existsSync(manifest), false);
  const urls = fs.readFileSync(path.join(temp, 'urls'), 'utf8').trim().split('\n');
  assert.equal(urls.length, 2); // No request to astrid.haus or real package tools.
  assert.ok(urls.every((url) => url.startsWith('https://raw.githubusercontent.com/banodoco/astrid-app/feat/pinokio/public/')));
  const publicDir = path.join(app.EDITOR_DIR, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.copyFileSync(source, path.join(publicDir, 'install'));
  const localManifest = path.join(publicDir, 'install-manifest.json');
  fs.writeFileSync(localManifest, JSON.stringify({ tools: { uv: { version: '0.11.32' }, python: { version: '3.11.13' } }, agent: { sha: 'a'.repeat(40) }, runtime: { sha: 'b'.repeat(40) } }));
  const local = spawnSync('bash', ['--noprofile', '--norc', '-c', app.shellStep(app.bootstrapScript('install', localManifest)).params.message], {
    encoding: 'utf8', env: { ...process.env, HOME: path.join(temp, 'home'), XDG_DATA_HOME: path.join(temp, 'home', '.local', 'share'), XDG_STATE_HOME: path.join(temp, 'state'), TMPDIR: temp,
      PATH: `${bin}:${process.env.PATH}`, REAL_PYTHON: python, EVIDENCE: evidence, URL_LOG: path.join(temp, 'urls'), BOOTSTRAP_SOURCE: source },
  });
  assert.doesNotMatch(local.stdout, /ASTRID_PINOKIO_FAILURE/, local.stdout + local.stderr);
  assert.equal(local.status, 0, local.stderr);
  const localArgs = JSON.parse(fs.readFileSync(evidence));
  assert.equal(localArgs[localArgs.indexOf('--manifest') + 1], localManifest);
  assert.equal(fs.existsSync(localManifest), true);
  assert.equal(fs.existsSync(path.join(publicDir, 'bootstrap-venv')), false);
  assert.equal(fs.readFileSync(path.join(temp, 'urls'), 'utf8').trim().split('\n').length, 2);
  console.log('PASS: actual POSIX bootstrap, raw-ref and checkout manifests, fake package operations, temporary/cache cleanup.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
