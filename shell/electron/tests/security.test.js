const test = require("node:test");
const assert = require("node:assert/strict");
const {
  redact, chromeUserAgent, stripElectronToken, isChatNavigationHost,
  isGoogleAuthHost, externalUrl, isLoopbackHost, isPrivateNetworkHost, isDeepSeekHost,
} = require("../lib/security");

test("redact removes launch tokens and bearer credentials", () => {
  const input = "dsh web: http://127.0.0.1:9388/?token=abcDEF_123 and Authorization: Bearer abcdefghijklmnop";
  const out = redact(input);
  assert.doesNotMatch(out, /abcDEF_123/);
  assert.match(out, /token=<redacted>/);
  assert.doesNotMatch(out, /abcdefghijklmnop/);
});

test("redact removes provider env names and known key values", () => {
  const secret = "abcdefghijklmnopqrstuvwxyz123456";
  const input = [
    `ZAI_API_KEY=${secret}`,
    `MISTRAL_API_KEY: ${secret}`,
    "api key: abcdefghijklmnop",
    `bare ${secret}`,
  ].join("\n");
  const out = redact(input, [secret]);
  assert.doesNotMatch(out, new RegExp(secret));
  assert.doesNotMatch(out, /abcdefghijklmnop/);
  assert.match(out, /ZAI_API_KEY=<redacted>/);
});

test("chromeUserAgent contains no Electron token", () => {
  const ua = chromeUserAgent("155.0.8059.84", "linux");
  assert.match(ua, /Chrome\/155\.0\.8059\.84/);
  assert.match(ua, /X11; Linux x86_64/);
  assert.doesNotMatch(ua, /Electron/);
  assert.doesNotMatch(ua, /DeepDeck/);
});

test("stripElectronToken removes only the Electron product token", () => {
  const defaultUa = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) app/1.0 Chrome/155.0.0.0 Electron/44.9.0 Safari/537.36";
  assert.equal(
    stripElectronToken(defaultUa),
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) app/1.0 Chrome/155.0.0.0 Safari/537.36",
  );
});

test("chat navigation allows DeepSeek and auth hosts only", () => {
  assert.equal(isChatNavigationHost("chat.deepseek.com"), true);
  assert.equal(isChatNavigationHost("login.deepseek.com"), true);
  assert.equal(isChatNavigationHost("accounts.google.com"), true);
  assert.equal(isChatNavigationHost("evil.example"), false);
  assert.equal(isChatNavigationHost("deepseek.com.evil.example"), false);
});

test("DeepSeek hosts are allowed for the embedded usage dashboard", () => {
  assert.equal(isDeepSeekHost("platform.deepseek.com"), true);
  assert.equal(isDeepSeekHost("www.deepseek.com"), true);
  assert.equal(isDeepSeekHost("deepseek.com"), true);
  assert.equal(isDeepSeekHost("deepseek.com.evil.example"), false);
  assert.equal(isDeepSeekHost("example.com"), false);
});

test("google auth hosts are identified separately", () => {
  assert.equal(isGoogleAuthHost("accounts.google.com"), true);
  assert.equal(isGoogleAuthHost("chat.deepseek.com"), false);
});

test("externalUrl permits only plain https URLs", () => {
  assert.equal(externalUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(externalUrl("https://platform.deepseek.com/usage"), "https://platform.deepseek.com/usage");
  assert.equal(externalUrl("http://example.com/"), null);
  assert.equal(externalUrl("javascript:alert(1)"), null);
  assert.equal(externalUrl("https://user:pass@example.com/"), null);
});

test("loopback classification", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("10.0.0.1"), false);
});

test("private network classification covers local services but not the internet", () => {
  for (const host of [
    "localhost", "api.localhost", "127.0.0.1", "127.8.9.10", "0.0.0.0",
    "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.20",
    "169.254.10.5", "100.64.0.1", "198.18.0.1", "198.51.100.7",
    "203.0.113.9", "printer.local", "box.localdomain", "box.home.arpa",
    "::1", "[::1]", "fe80::1", "fd00::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:192.168.1.2", "::ffff:7f00:1", "::ffff:c0a8:101",
  ]) {
    assert.equal(isPrivateNetworkHost(host), true, `${host} must be private`);
  }
  for (const host of [
    "deepseek.com", "chat.deepseek.com", "api.deepseek.com",
    "8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.1.1", "11.0.0.1",
    "2001:4860:4860::8888", "example.com", "not.a.real.ip", "::ffff:808:808",
  ]) {
    assert.equal(isPrivateNetworkHost(host), false, `${host} must be public`);
  }
});
