# Develop DeepDeck

Use Node 24.9 or newer. Install dependencies with `npm ci` in `frontend` and `shell/electron`, then run `bash scripts/check.sh` from the repository root.

The installer supports `DEEPDECK_INSTALL_HOME`, `XDG_BIN_HOME`, `XDG_DATA_HOME`, and `XDG_CONFIG_HOME` for disposable checks. Set `DEEPDECK_WORKDIR` to an existing temporary directory. Do not test updates or sign-out against a working profile.

See [contributing](../CONTRIBUTING.md) and [architecture](ARCHITECTURE.md) for the runtime and trust boundaries.
