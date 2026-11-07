const test = require('node:test');
const assert = require('node:assert/strict');
const { HarnessManager } = require('../lib/harness');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('startup reports preparation while the initial runtime install is pending', async () => {
  const install = deferred();
  const manager = new HarnessManager({ getPreferences: () => ({ harness: {} }), getRuntime: () => null,
    prepare: () => install.promise, logger: { info() {}, line() {} } });
  const running = manager.start().catch(() => {});
  try { assert.equal(manager.status().state, 'preparing'); }
  finally { install.reject(new Error('test cancelled setup')); await running; }
});

test('an invalid workspace ends preparation with a retryable error', async () => {
  const manager = new HarnessManager({ getPreferences: () => ({ harness: { workdir: '/deepdeck-nonexistent-workspace' } }),
    getRuntime: () => null, logger: { info() {}, line() {} } });
  await assert.rejects(manager.start(), /workspace not found/);
  assert.equal(manager.status().state, 'error');
});

test('repeated Start joins setup and a failed setup can be explicitly retried', async () => {
  const { HarnessStartup } = require('../lib/harness-startup');
  const gate = deferred();
  let attempt = 0, active = null, busy = false;
  const runtime = {
    current: () => active,
    prepare: async () => { attempt++; await gate.promise; throw new Error('setup cancelled'); },
    update: async () => { attempt++; active = { id: 'verified-private-version' }; },
  };
  const harness = { state: 'stopped', setState(state, error) { this.state = state; this.error = error; },
    async start() { this.setState('ready'); return { state: this.state }; } };
  const startup = new HarnessStartup({ harness, runtime, getAutoUpdate: () => true, validate: async () => {},
    onBusy: value => { busy = value; } });
  const first = startup.start();
  assert.strictEqual(startup.start(), first);
  assert.equal(harness.state, 'preparing');
  assert.equal(busy, true);
  gate.resolve();
  await assert.rejects(first, /setup cancelled/);
  assert.equal(busy, false);
  assert.equal(harness.state, 'error');
  const recovered = await startup.start({ retry: true });
  assert.equal(recovered.state, 'ready');
  assert.equal(active.id, 'verified-private-version');
  assert.equal(attempt, 2);
});
