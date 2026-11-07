// The launch token arrives over stdin and is never put in argv, logs, or a file.
const { app } = require("electron");
const path = require("node:path");
const { verifyCodePage } = require("../shell/electron/lib/harness-page");
if (!process.env.DEEPDECK_SMOKE_ROOT) throw new Error("A private smoke directory is required");
app.setPath("userData", path.join(process.env.DEEPDECK_SMOKE_ROOT, "electron"));
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
const request = new Promise(resolve => process.stdin.on("end", resolve));
Promise.all([app.whenReady(), request]).then(async () => {
  const { url } = JSON.parse(input);
  input = "";
  await verifyCodePage(url, new AbortController().signal);
  app.exit(0);
}).catch(() => { console.error("The private Code page failed verification"); app.exit(1); });
