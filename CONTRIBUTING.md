# Contributing to DeepDeck

Thanks for helping improve DeepDeck. This project is an unofficial desktop shell
around two existing DeepSeek products; it does not reimplement either product UI
or authentication system.

## Ground rules

- Keep the embedded pages intact. Shell changes belong in the Electron main
  process, the shell renderer, or a narrowly scoped preload that does not expose
  privileged APIs to a remote page.
- Never commit API keys, cookies, session snapshots, harness tokens, personal
  filesystem paths, or screenshots that contain conversation data.
- Do not add telemetry.
- Preserve the deny-by-default chat permission model and the local-network
  guard. New permissions or local integrations need an explicit threat-model
  discussion in the pull request.
- The DeepSeek mark is used only to identify the embedded services. Do not
  present DeepDeck as an official DeepSeek product.

## Development setup

Requirements: Node.js 24.9+, npm, and network access for release smoke tests.
A separate DeepSeek Harness checkout is not required.

```bash
npm --prefix frontend ci
npm --prefix shell/electron ci
node shell/electron/node_modules/electron/install.js
npm run check
```

`npm run check` runs the frontend typecheck and build, then the main-process
`node:test` suite. It does not modify `~/.dsh` or start the user's harness.

Useful commands:

```bash
npm run dev       # Vite + Electron development loop
npm run smoke     # throwaway-DSH_HOME harness launch and RPC smoke test
```

## Pull requests

- Keep changes focused and explain the user-visible effect.
- Include tests for pure logic (preferences, security classification, folder
  filtering, RPC helpers) and manual verification notes for UI/native behavior.
- Run `npm run check` before pushing.
- Update `README.md` and `docs/ARCHITECTURE.md` when behavior or trust
  boundaries change.
- Keep local editor state and unreviewed captures out of Git. Screenshots must
  exclude account details, conversation content, and credentials.

## License

By contributing, you agree that your contribution is licensed under the MIT
license in [LICENSE](LICENSE).
