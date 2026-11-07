/**
 * Minimal loopback static server for the DeepDeck shell.
 *
 * The shell document is local, but serving it over HTTP gives the IPC trust
 * check a real origin (file:// documents have an opaque origin) and matches
 * how the embedded applications are hosted. The server binds 127.0.0.1 on an
 * OS-assigned port, serves only `dist`, and adds a strict CSP.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function safePath(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const relative = decoded.replace(/^\/+/, "");
  const resolved = path.resolve(root, relative);
  const boundary = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return resolved === root || resolved.startsWith(boundary) ? resolved : null;
}

function createStaticServer({ root, index = "index.html", host = "127.0.0.1", port = 0 }) {
  const rootPath = path.resolve(root);
  const indexFile = path.join(rootPath, index);
  if (!fs.existsSync(indexFile)) {
    return Promise.reject(new Error(`shell dist is missing: ${indexFile}`));
  }

  const server = http.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end();
      return;
    }
    let pathname;
    try {
      pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    let file = pathname === "/" ? indexFile : safePath(rootPath, pathname);
    if (file && !fs.existsSync(file) && !path.extname(file)) file = indexFile;
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const extension = path.extname(file).toLowerCase();
    const isHtml = extension === ".html";
    const headers = {
      "content-type": MIME[extension] || "application/octet-stream",
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": isHtml ? "no-store" : "public, max-age=31536000, immutable",
    };
    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const stream = fs.createReadStream(file);
    stream.on("error", () => response.destroy());
    stream.pipe(response);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        origin: `http://${host}:${actualPort}`,
        port: actualPort,
        server,
        close: () => new Promise(done => server.close(() => done())),
      });
    });
  });
}

module.exports = { createStaticServer, safePath, CSP, MIME };
