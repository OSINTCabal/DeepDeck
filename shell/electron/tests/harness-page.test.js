const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const { waitForCodePage } = require('../lib/harness-page');

function page({ graph = true, boot = false, failed = false, mounted = false } = {}) {
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.executeJavaScript = async source => vm.runInNewContext(source, {
    window: { __DSH_BOOT__: graph ? { entries: [{ id: '@deepseek-ai/dsh-client-ui' }], batches: [], rev: 'test' } : undefined },
    document: { querySelector(selector) {
      if (selector === '[data-dsh-boot]') return boot ? { textContent: failed ? 'HARNESS Failed to load plugins: missing-client-module' : 'HARNESS Loading plugins…' } : null;
      if (selector === '[data-dsh-boot-spinner]') return boot && !failed ? {} : null;
      return mounted ? {} : null;
    } },
  });
  return contents;
}

test('a loaded document with no mounted harness is not accepted', async () => {
  await assert.rejects(() => waitForCodePage(page(), { timeoutMs: 10 }), /finish|ready|render|timed out/i);
});
test('readiness accepts an upstream layout with interactive controls but no composer selector', async () => {
  await waitForCodePage(page({ mounted: true }), { timeoutMs: 100 });
});
test('upstream plugin boot failures are reported with their actual diagnostics', async () => {
  await assert.rejects(() => waitForCodePage(page({ boot: true, failed: true }), { timeoutMs: 100 }), /missing-client-module/);
});
test('a hung renderer evaluation cannot hang validation forever', async () => {
  const contents = page();
  contents.executeJavaScript = () => new Promise(() => {});
  await assert.rejects(() => waitForCodePage(contents, { timeoutMs: 10 }), /finish|ready|render|timed out/i);
});
test('renderer crashes fail validation instead of promoting the candidate', async () => {
  const contents = page();
  const validation = waitForCodePage(contents, { timeoutMs: 1000 });
  contents.emit('render-process-gone', {}, { reason: 'crashed' });
  await assert.rejects(validation, /crash|stopped/i);
});
