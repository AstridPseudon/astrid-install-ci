import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { runTool } from './smoke/process.mjs';

test('smoke commands keep draining a noisy server while waiting for its response', async () => {
  const server = spawn(process.execPath, ['-e', `
    const http = require('node:http');
    const server = http.createServer((_request, response) => {
      process.stdout.write('x'.repeat(2 * 1024 * 1024), () => response.end('ready'));
    });
    server.listen(0, '127.0.0.1', () => process.send(server.address().port));
    process.on('message', () => server.close(() => process.exit(0)));
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const closed = once(server, 'close');
  let drained = 0;
  server.stdout.on('data', (chunk) => { drained += chunk.length; });
  server.stderr.pipe(process.stderr);
  try {
    const [port] = await once(server, 'message');
    const result = await runTool(process.execPath, ['-e', `
      require('node:http').get('http://127.0.0.1:${port}', (response) => {
        response.pipe(process.stdout);
      }).on('error', (error) => { console.error(error); process.exitCode = 1; });
    `], process.env);
    assert.equal(result, 'ready');
    assert.equal(drained, 2 * 1024 * 1024);
  } finally {
    server.send('stop');
    await closed;
  }
});

test('smoke command failures preserve exit status and diagnostics', async () => {
  await assert.rejects(runTool(process.execPath, ['-e', "console.error('fixture failure'); process.exit(7)"], process.env),
    (error) => error.code === 7 && error.stderr.includes('fixture failure'));
});

test('smoke commands receive EOF on stdin', async () => {
  const result = await runTool(process.execPath, ['-e', `
    process.stdin.on('end', () => console.log('EOF'));
    process.stdin.resume();
  `], process.env);
  assert.equal(result.trim(), 'EOF');
});
