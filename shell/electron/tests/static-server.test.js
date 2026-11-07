const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStaticServer, safePath } = require("../lib/static-server");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepdeck-dist-"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>shell</title>");
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "assets", "app.js"), "console.log('shell')");
  return root;
}

test("serves the shell with CSP and no-store on HTML", async () => {
  const root = fixture();
  const server = await createStaticServer({ root });
  try {
    const response = await fetch(`${server.origin}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(await response.text(), /<title>shell<\/title>/);
    const asset = await fetch(`${server.origin}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") || "", /javascript/);
    assert.match(asset.headers.get("cache-control") || "", /immutable/);
  } finally {
    await server.close();
  }
});

test("serves index for extensionless paths and 404s missing files", async () => {
  const root = fixture();
  const server = await createStaticServer({ root });
  try {
    const fallback = await fetch(`${server.origin}/settings`);
    assert.equal(fallback.status, 200);
    const missing = await fetch(`${server.origin}/assets/missing.js`);
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

test("path traversal is rejected", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepdeck-safe-"));
  assert.equal(safePath(root, "/../etc/passwd"), null);
  assert.equal(safePath(root, "/%2e%2e/etc/passwd"), null);
  assert.ok(safePath(root, "/assets/app.js"));
  assert.equal(safePath(root, "/%00bad"), null);
});

test("missing dist fails loudly", async () => {
  await assert.rejects(() => createStaticServer({ root: "/definitely/not/here" }), /shell dist is missing/);
});
