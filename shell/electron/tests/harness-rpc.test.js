const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { exchangeSession, createRpcClient, HarnessRpcError } = require("../lib/harness-rpc");

function startMock() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      requests.push({ url: request.url, headers: request.headers, body });
      if (request.method === "GET" && request.url.startsWith("/?token=launch-token")) {
        response.writeHead(303, {
          location: "/",
          "set-cookie": "dsh-auth-test=secret; Path=/; HttpOnly; SameSite=Strict",
        });
        response.end();
        return;
      }
      if (request.method === "GET") {
        response.writeHead(401);
        response.end("unauthorized");
        return;
      }
      if (!String(request.headers.cookie || "").includes("dsh-auth-test=secret")) {
        response.writeHead(401);
        response.end("unauthorized");
        return;
      }
      const method = body ? body.method : null;
      const rpcId = body ? body.rpcId : "none";
      const send = result => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ type: "server-response", rpcId, result }));
      };
      if (method === "settings/describe") {
        send({ ok: true, value: { writable: true, hasDocument: true, namespaces: [] } });
      } else if (method === "settings/mutate") {
        send({ ok: true, value: { ns: body.payload.args.ns, revision: 4 } });
      } else if (method === "fail") {
        send({ ok: false, error: { code: "settings/conflict", message: "revision changed", details: { revision: 9 } } });
      } else {
        response.writeHead(404);
        response.end("no");
      }
    });
  });
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        tokenUrl: `http://127.0.0.1:${port}/?token=launch-token`,
        requests,
        close: () => new Promise(done => server.close(done)),
      });
    });
  });
}

test("exchanges the launch token for a cookie and calls unary RPC", async () => {
  const mock = await startMock();
  try {
    const session = await exchangeSession(mock.tokenUrl);
    assert.equal(session.origin, mock.origin);
    assert.match(session.cookie, /dsh-auth-test=secret/);
    const client = createRpcClient(session);
    const described = await client.describeSettings();
    assert.equal(described.writable, true);
    const mutated = await client.mutateSettings("llm-pi-ai", [{ op: "set", path: ["providers", "x"], value: {} }], 3);
    assert.equal(mutated.ns, "llm-pi-ai");
    const call = mock.requests.find(request => request.body && request.body.method === "settings/mutate");
    assert.deepEqual(call.body.payload.args, {
      ns: "llm-pi-ai",
      ops: [{ op: "set", path: ["providers", "x"], value: {} }],
      expectedRevision: 3,
    });
    assert.equal(call.headers.origin, mock.origin);
  } finally {
    await mock.close();
  }
});

test("rejects a missing cookie and maps harness failures", async () => {
  const mock = await startMock();
  try {
    const session = await exchangeSession(mock.tokenUrl);
    const client = createRpcClient(session);
    await assert.rejects(
      () => client.call("fail"),
      error => error instanceof HarnessRpcError && error.code === "settings/conflict" && error.details.revision === 9,
    );
    await assert.rejects(() => exchangeSession(`${mock.origin}/?token=wrong`), /without a session cookie/);
  } finally {
    await mock.close();
  }
});

test("rejects non-loopback launch URLs", async () => {
  await assert.rejects(() => exchangeSession("http://example.com/?token=x"), /not loopback/);
});
