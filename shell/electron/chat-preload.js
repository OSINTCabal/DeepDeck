// DeepSeek chat preload.
//
// Two jobs, both scoped to the embedded chat page:
//
// 1. Seed the signed-in session (cookies plus localStorage) before the site
//    boots, and mirror DeepDeck's theme into the site's own preference.
// 2. Give the composer's hidden <input type=file> a picker that starts in the
//    DeepDeck workspace. Chromium's native file input cannot choose its own
//    starting folder, so the click is intercepted, the native Electron dialog
//    returns the selected bytes, and the page receives normal File objects and
//    a change event. If anything fails, the original click is replayed so the
//    site keeps working unchanged.
// 3. Add one small, native-looking folder+ button beside the site's paperclip
//    for a filtered code/documents folder sample. Opening the workspace stays
//    the app bar's job, so the composer has no duplicate directory button. The
//    page receives only the selected files, never the directory path.

const { contextBridge, ipcRenderer } = require("electron");

try {
  const seed = ipcRenderer.sendSync("webchat:seed");
  if (seed && seed.origin === location.origin && seed.items && typeof seed.items === "object") {
    for (const [key, value] of Object.entries(seed.items)) {
      if (typeof key !== "string" || typeof value !== "string") continue;
      try { localStorage.setItem(key, value); } catch { /* storage may be full or blocked */ }
    }
  }
} catch {
  // A missing seed is the normal path.
}

try {
  const theme = ipcRenderer.sendSync("webchat:theme");
  if (theme === "dark" || theme === "light" || theme === "system") {
    localStorage.setItem("__appKit_@deepseek/chat_themePreference", JSON.stringify({ value: theme, __version: "0" }));
  }
} catch {
  // A missing theme is the normal path.
}

// The web session denies notifications at the permission layer, and this also
// removes the page-level API so a cached permission grant or a service worker
// cannot surface an OS notification from the embedded site.
try {
  if (typeof contextBridge.executeInMainWorld === "function") {
    contextBridge.executeInMainWorld({
      func: () => {
        try {
          class DeepDeckNotification {
            static permission = "denied";
            static requestPermission() { return Promise.resolve("denied"); }
            constructor() {}
            close() {}
            addEventListener() {}
            removeEventListener() {}
            dispatchEvent() { return false; }
          }
          Object.defineProperty(window, "Notification", {
            configurable: true,
            writable: true,
            value: DeepDeckNotification,
          });
          if (window.ServiceWorkerRegistration) {
            window.ServiceWorkerRegistration.prototype.showNotification = () =>
              Promise.reject(new Error("Notifications are disabled in DeepDeck."));
          }
        } catch { /* the permission layer still denies */ }
      },
    });
  }
} catch { /* older Electron: the permission layer still denies */ }

const CHAT_HOST = "chat.deepseek.com";
const NATIVE_FLAG = "deepdeckNativePicker";

function isFileInput(target) {
  return target instanceof HTMLInputElement && target.type === "file";
}

function replayNatively(input) {
  input.dataset[NATIVE_FLAG] = "1";
  try {
    input.click();
  } finally {
    delete input.dataset[NATIVE_FLAG];
  }
}

function findFileInput() {
  return document.querySelector('input[type="file"]');
}

/** Turn main-process file records into real File objects on the site input. */
function applyFiles(input, records) {
  if (!input || !Array.isArray(records) || records.length === 0) return false;
  const transfer = new DataTransfer();
  for (const file of records) {
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    transfer.items.add(new File([data], file.name, {
      type: file.type || "",
      lastModified: file.lastModified || Date.now(),
    }));
  }
  if (transfer.files.length === 0) return false;
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function applyFilesWhenReady(records, attempts = 20) {
  const input = findFileInput();
  if (input) {
    applyFiles(input, records);
    return;
  }
  if (attempts > 0) setTimeout(() => applyFilesWhenReady(records, attempts - 1), 250);
}

async function attach(input) {
  if (input.dataset.deepdeckPicker === "busy") return;
  input.dataset.deepdeckPicker = "busy";
  try {
    const response = await ipcRenderer.invoke("webchat:pick-files", {
      multiple: input.multiple,
      accept: input.getAttribute("accept") || "",
    });
    if (!response || response.canceled) return;
    if (!response.ok || !Array.isArray(response.files) || response.files.length === 0) {
      // The main process already reported a rejected selection (for example a
      // file over the size limit). Replaying the native click here would open
      // a second chooser on top of that message.
      return;
    }
    applyFiles(input, response.files);
  } catch {
    // A bridge failure must not strand the user with no picker at all.
    replayNatively(input);
  } finally {
    delete input.dataset.deepdeckPicker;
  }
}

ipcRenderer.on("webchat:files", (_event, payload) => {
  if (!payload || !Array.isArray(payload.files)) return;
  applyFilesWhenReady(payload.files);
});

ipcRenderer.on("webchat:directory", (_event, payload) => {
  chatDirectoryName = typeof payload?.name === "string" ? payload.name : "";
  const button = document.querySelector('[data-deepdeck-local-button="folder"]');
  if (!button) return;
  const label = chatDirectoryName
    ? `Chat folder: ${chatDirectoryName}. Click to change.`
    : "Set the folder used by the chat file picker";
  button.setAttribute("aria-label", label);
  button.title = label;
});

const LOCAL_BUTTON_ATTR = "data-deepdeck-local-button";
let chatDirectoryName = "";
const FOLDER_PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v6M9 14h6"/></svg>';

function ensureLocalStyle() {
  if (document.getElementById("deepdeck-local-style")) return;
  const style = document.createElement("style");
  style.id = "deepdeck-local-style";
  style.textContent = `
    .deepdeck-local-group {
      display: inline-flex !important; align-items: center !important;
      margin-left: 4px !important; margin-right: 4px !important; flex: none !important;
    }
    .deepdeck-local-btn {
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      width: 34px !important; height: 34px !important; padding: 0 !important; margin: 0 !important;
      border-radius: 999px !important; border: 1px solid rgba(127,127,127,.22) !important;
      background: transparent !important; cursor: pointer !important;
      line-height: 1 !important; box-sizing: border-box !important;
      transition: background-color .15s ease, border-color .15s ease !important;
      -webkit-appearance: none !important;
    }
    .deepdeck-local-btn:hover { background: rgba(127,127,127,.14) !important; border-color: rgba(127,127,127,.32) !important; }
    .deepdeck-local-btn:focus-visible { outline: 2px solid #4D6BFE !important; outline-offset: 2px !important; }
    .deepdeck-local-btn svg { width: 16px; height: 16px; display: block; }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function makeLocalButton(kind, label, icon, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "deepdeck-local-btn";
  button.setAttribute(LOCAL_BUTTON_ATTR, kind);
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = icon;
  // Inline styles are the fallback if the site's CSP rejects the style element.
  button.style.cssText = [
    "display:inline-flex", "align-items:center", "justify-content:center",
    "width:34px", "height:34px", "padding:0", "margin:0", "border-radius:999px",
    "border:1px solid rgba(127,127,127,.22)", "background:transparent",
    "color:inherit", "cursor:pointer", "line-height:1", "box-sizing:border-box",
    "transition:background-color .15s ease,border-color .15s ease",
    "-webkit-appearance:none",
  ].join(";");
  button.addEventListener("mouseenter", () => {
    button.style.background = "rgba(127,127,127,.14)";
    button.style.borderColor = "rgba(127,127,127,.32)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "transparent";
    button.style.borderColor = "rgba(127,127,127,.22)";
  });
  button.addEventListener("click", event => {
    // A real click in the remote page must initiate local access; a scripted
    // click must not be able to pop a file or directory picker.
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

/**
 * The site's composer is React-owned, so the group is re-attached if a render
 * removes it. The site still owns its paperclip; these are additional explicit
 * local-access controls.
 */
function ensureComposerButtons() {
  if (location.hostname !== CHAT_HOST) return;
  const input = findFileInput();
  if (!input) return;
  let group = document.querySelector("[data-deepdeck-local-group]");
  if (group && !group.isConnected) group = null;
  // Keep the group after the hidden input, not between React's paperclip and
  // input siblings. The input's previous sibling therefore remains the site's
  // paperclip, and React's reconciliation of its two children is untouched.
  let paperclip = input.previousElementSibling;
  if (!(paperclip instanceof HTMLElement) || paperclip.getAttribute("role") !== "button") {
    paperclip = input.parentElement ? input.parentElement.querySelector('[role="button"]') : null;
  }
  if (!(paperclip instanceof HTMLElement)) return;
  // Give the site's icon-only paperclip an accessible name and a tooltip.
  paperclip.setAttribute("aria-label", "Attach files from the chat folder");
  paperclip.title = "Attach files from the chat folder";
  ensureLocalStyle();
  if (group) group.querySelector('[data-deepdeck-local-button="workspace"]')?.remove();
  const complete = group && group.querySelector('[data-deepdeck-local-button="folder"]') === group.firstElementChild
    && group.children.length === 1;
  if (!complete) {
    if (group) group.remove();
    group = document.createElement("span");
    group.className = "deepdeck-local-group";
    group.setAttribute("data-deepdeck-local-group", "1");
    group.style.cssText = "display:inline-flex;align-items:center;margin-left:4px;margin-right:4px;flex:none;";
    group.append(
      makeLocalButton(
        "folder",
        chatDirectoryName
          ? `Chat folder: ${chatDirectoryName}. Click to change.`
          : "Set the folder used by the chat file picker",
        FOLDER_PLUS_ICON,
        () => {
          void ipcRenderer.invoke("webchat:grant-directory").catch(() => {});
        },
      ),
    );
    input.after(group);
  } else if (group.previousElementSibling !== input) {
    input.after(group);
  }
  // The composer's parent may use an accent color. Match the paperclip's
  // actual computed color so the extra control reads as native, and update it
  // when the site theme changes.
  const color = getComputedStyle(paperclip).color;
  if (color) {
    for (const button of group.querySelectorAll("button")) {
      button.style.setProperty("color", color, "important");
    }
  }
}

if (location.hostname === CHAT_HOST) {
  document.addEventListener("click", event => {
    const target = event.target;
    if (!isFileInput(target)) return;
    if (target.dataset[NATIVE_FLAG] === "1") return;
    // The site's paperclip calls input.click() from a trusted click handler, so
    // transient activation is still active here. A page script cannot open the
    // local picker on its own.
    if (!navigator.userActivation || navigator.userActivation.isActive !== true) return;
    // The click is the file chooser's default action. Cancelling it here keeps
    // Chromium's chooser (last-used folder, no workspace) from opening on top
    // of DeepDeck's own dialog.
    event.preventDefault();
    event.stopImmediatePropagation();
    void attach(target);
  }, true);
}

function bootLocalAccess() {
  ensureComposerButtons();
  // The composer survives most chat interactions, but a React remount can
  // replace the paperclip. Re-check cheaply rather than observing the whole
  // document during streaming.
  setInterval(ensureComposerButtons, 1500);
}

if (location.hostname === CHAT_HOST) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootLocalAccess, { once: true });
  } else {
    bootLocalAccess();
  }
}
