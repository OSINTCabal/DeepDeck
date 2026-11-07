# Security policy

DeepDeck embeds the remote `chat.deepseek.com` page, the local DeepSeek Harness
Web GUI, and (inside Settings) the remote `platform.deepseek.com` usage
dashboard. The shell exists to keep those trust domains separate.

## Reporting a vulnerability

Please use the repository's private security advisory feature rather than a
public issue. Include the affected version, reproduction steps, and the trust
boundary you believe is crossed. Do not paste live API keys, cookies, harness
tokens, or personal file contents into a report.

## Security model

- The shell document is served from a random loopback origin and every IPC
  handler checks both the sending `webContents` and the shell frame origin.
- The remote chat page runs sandboxed with context isolation and no Node
  integration. It receives only `clipboard-sanitized-write` on its own origin;
  camera, microphone, geolocation, notifications, fullscreen, clipboard reads,
  file-system access, and display capture are denied without site-triggered OS
  dialogs.
- Requests from the chat partition to loopback, private, CGNAT, link-local, and
  mDNS hostnames are cancelled. This is a hostname filter; Chromium's origin and
  CORS rules still apply underneath.
- Attachments are explicit: the page gets only files the user selected, never an
  absolute path. The chat folder control stores a local picker root without
  reading or uploading it; the remote page still cannot browse a directory.
  Local file/folder pickers require a trusted user activation; scripted clicks
  from the remote page are ignored.
- The API usage dashboard uses the isolated `persist:deepseek-platform`
  partition with no preload, sandboxed rendering, denied permissions except
  sanitized clipboard writes, private-network blocking, and navigation limited
  to `deepseek.com`. Its login/cookies are separate from chat and harness
  credentials.
- The managed harness launch token lives in main-process memory only. It is not
  exposed to the shell renderer, written to disk, or logged unredacted.
- API keys live in DeepDeck’s private harness credential store or the user’s
  environment, never shell preferences. First-time migration copies existing
  credentials into owner-only private files without changing the source.
- Runtime/package operations and profiles are private to DeepDeck. The downloaded
  harness and official Desktop profile are never update targets. This is state
  isolation; user-installed plugins and permitted coding tools retain their
  normal workspace capabilities.

## Out of scope

- A compromised DeepSeek account, a malicious DeepSeek server response, or a
  Chromium zero-day.
- Malicious local users who can already read the user's home directory.
- Arbitrary behavior of user-installed harness plugins or model output. The
  harness is an agent with its own permission model; review its configuration
  before pointing it at sensitive directories.
