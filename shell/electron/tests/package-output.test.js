const test = require('node:test');
const assert = require('node:assert/strict');
const { packageFailure } = require('../lib/updates');

test('setup cancellation reports the cancellation cause rather than an unrelated npm warning', () => {
  const failure = Object.assign(new Error('The operation was aborted'), { code: 'ABORT_ERR', stderr: 'npm warn Unknown env config "store-dir"' });
  const reported = packageFailure(failure);
  assert.match(reported.message, /cancelled/i);
  assert.doesNotMatch(reported.message, /^.*failed: npm warn/);
});

test('package timeouts retain their cause even when npm wrote only a warning', () => {
  const failure = Object.assign(new Error('Command timed out'), { killed: true, signal: 'SIGTERM', stderr: 'npm warn warning' });
  assert.match(packageFailure(failure).message, /timed out|deadline/i);
});

test('package setup streams its output into an owner-only log before completion', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepdeck-package-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const command = path.join(directory, 'npm');
  fs.writeFileSync(command, '#!/bin/sh\n[ -z "$npm_config_store_dir" ] || exit 32\nprintf "downloaded test package\\n"\nsleep 0.05\n', { mode: 0o700 });
  const runtime = { root: directory, base: directory, dir: directory, home: path.join(directory, 'home'), agentsHome: path.join(directory, 'agents'), node: process.execPath };
  const { run } = require('../lib/updates');
  let progress = false;
  await run(runtime, command, [], { onProgress: () => { progress = true; } });
  assert.equal(progress, true);
  const log = path.join(directory, 'install.log');
  assert.match(fs.readFileSync(log, 'utf8'), /downloaded test package/);
  assert.equal(fs.statSync(log).mode & 0o777, 0o600);
});
