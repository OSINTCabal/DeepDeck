/** Tiny owner-only log writer with secret redaction and a size cap. */

const fs = require("node:fs");
const path = require("node:path");
const { redact } = require("./security");

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function createLogger(file, { maxBytes = DEFAULT_MAX_BYTES, echo = false } = {}) {
  let ready = false;
  function rotateIfNeeded() {
    try {
      const stat = fs.statSync(file);
      if (stat.size > maxBytes) {
        fs.renameSync(file, `${file}.1`);
      }
    } catch { /* missing file is the normal case */ }
  }
  function write(level, message) {
    const line = `${new Date().toISOString()} ${level} ${redact(message)}\n`;
    if (echo) process.stderr.write(line);
    try {
      if (!ready) {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        rotateIfNeeded();
        ready = true;
      }
      fs.appendFileSync(file, line, { mode: 0o600 });
    } catch { /* logging must never take the app down */ }
  }
  return {
    info: message => write("info", message),
    warn: message => write("warn", message),
    error: message => write("error", message),
    line: message => write("out", message),
    file,
  };
}

/** Read the tail of a log without loading unbounded data into memory. */
function tail(file, lines = 60) {
  try {
    const text = fs.readFileSync(file, "utf8");
    return text.split("\n").filter(Boolean).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

module.exports = { createLogger, tail };
