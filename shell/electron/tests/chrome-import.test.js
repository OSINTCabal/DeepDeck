const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const {
  filterCookies, filterLocalStorage, electronCookie, sameSiteForElectron,
  isDeepSeekDomain, isWafName, findChrome,
} = require("../lib/chrome-import");
const { SIGNED_IN_EXPRESSION } = require("../lib/deepseek-session");

test("filterCookies keeps DeepSeek cookies and drops WAF, Google, and partitioned entries", () => {
  const cookies = [
    { domain: ".deepseek.com", name: "session", value: "secret", path: "/", secure: true, httpOnly: true, sameSite: "Lax", expires: 1900000000 },
    { domain: "chat.deepseek.com", name: "pref", value: "dark", path: "/", secure: true },
    { domain: ".deepseek.com", name: "aws-waf-token", value: "waf", path: "/" },
    { domain: ".deepseek.com", name: "aws_waf_session", value: "waf", path: "/" },
    { domain: ".google.com", name: "SID", value: "google", path: "/" },
    { domain: ".deepseek.com", name: "partitioned", value: "x", partitionKey: { topLevelSite: "x" } },
    { domain: "evil.example", name: "nope", value: "x", path: "/" },
  ];
  const filtered = filterCookies(cookies);
  assert.deepEqual(filtered.map(cookie => cookie.name), ["session", "pref"]);
  assert.equal(filtered[0].domain, ".deepseek.com");
  assert.equal(filtered[0].httpOnly, true);
});

test("filterLocalStorage drops WAF state and enforces string values", () => {
  const out = filterLocalStorage({
    userToken: "abc",
    "aws-waf-token": "nope",
    aws_waf_challenge: "nope",
    awswaf: "nope",
    number: 42,
    theme: "dark",
  });
  assert.deepEqual(out, { userToken: "abc", theme: "dark" });
});

test("electronCookie maps domain, security, and sameSite", () => {
  const detail = electronCookie({
    domain: ".deepseek.com", name: "session", value: "v", path: "/", secure: true,
    httpOnly: true, sameSite: "Strict", expires: 1900000000,
  });
  assert.equal(detail.url, "https://deepseek.com/");
  assert.equal(detail.domain, ".deepseek.com");
  assert.equal(detail.sameSite, "strict");
  assert.equal(detail.secure, true);
  assert.equal(detail.httpOnly, true);
  assert.equal(detail.expirationDate, 1900000000);
  const hostOnly = electronCookie({ domain: "chat.deepseek.com", name: "a", value: "b", path: "/" });
  assert.equal(hostOnly.domain, undefined);
  assert.equal(hostOnly.url, "https://chat.deepseek.com/");
  assert.ok(hostOnly.expirationDate > Date.now() / 1000 + 29 * 24 * 60 * 60);
  assert.equal(electronCookie({ domain: "", name: "x", value: "y" }), null);
});

test("sameSite mapping covers Chromium spellings", () => {
  assert.equal(sameSiteForElectron("Strict"), "strict");
  assert.equal(sameSiteForElectron("Lax"), "lax");
  assert.equal(sameSiteForElectron("None"), "no_restriction");
  assert.equal(sameSiteForElectron(""), "unspecified");
});

test("domain and WAF predicates", () => {
  assert.equal(isDeepSeekDomain("deepseek.com"), true);
  assert.equal(isDeepSeekDomain(".deepseek.com"), true);
  assert.equal(isDeepSeekDomain("chat.deepseek.com"), true);
  assert.equal(isDeepSeekDomain("deepseek.com.evil"), false);
  assert.equal(isWafName("aws-waf-token"), true);
  assert.equal(isWafName("aws_waf_anything"), true);
  assert.equal(isWafName("awswaf"), true);
  assert.equal(isWafName("session"), false);
});

test("the signed-in probe uses the site token and user endpoint, not cookies", () => {
  assert.match(SIGNED_IN_EXPRESSION, /userToken/);
  assert.match(SIGNED_IN_EXPRESSION, /api\/v0\/users\/current/);
  assert.match(SIGNED_IN_EXPRESSION, /Bearer/);
  assert.match(SIGNED_IN_EXPRESSION, /signedIn/);
});

test("the signed-in probe keeps trying after a stale token is rejected", async () => {
  const storage = new Map([
    ["userToken", JSON.stringify({ value: null, __version: "0" })],
    ["settingsJwt", JSON.stringify({ value: "stale-token-value-12345", __version: "0" })],
    ["extraAuthToken", JSON.stringify({ value: "good-token-value-67890", __version: "0" })],
  ]);
  const localStorage = {
    get length() { return storage.size; },
    key(index) { return [...storage.keys()][index] ?? null; },
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  };
  const seen = [];
  const fetch = async (_url, options = {}) => {
    const authorization = options.headers?.authorization || "";
    seen.push(authorization);
    if (authorization === "Bearer good-token-value-67890") {
      return { status: 200, json: async () => ({ code: 0, data: { id: "user" } }) };
    }
    return { status: 401, json: async () => ({ code: 401, data: null }) };
  };
  const context = {
    localStorage, fetch, location: { href: "https://chat.deepseek.com/" },
    Set, Object, JSON, console,
  };
  const result = await vm.runInNewContext(SIGNED_IN_EXPRESSION, context);
  assert.equal(result.signedIn, true);
  assert.ok(seen.some(header => header.includes("stale-token")));
  assert.ok(seen.some(header => header.includes("good-token")));
});

test("findChrome returns an executable path or null", () => {
  const found = findChrome();
  assert.ok(found === null || typeof found === "string");
});
