# ActionWebTracer contributor guidance

## Scope and architecture

- Follow `RFC-ActionWebTracer-v0.1.md` for product and architecture decisions.
- Target Chrome 125+ with Manifest V3.
- Keep browser-specific code in `src/background/` or `src/probe/`.
- Keep future trace-engine logic independent of Chrome APIs and DOM globals.
- Do not implement functionality assigned to a later AWT ticket unless the task explicitly requests it.

## Tooling

- Use Node.js 24 LTS and pnpm 10.8.1.
- Use the commands in `package.json`: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- Add or update focused tests for behavior changes.
- Do not commit generated `dist/`, `node_modules/`, or coverage output.

## Extension safety

- Do not load remote scripts, runtime dependencies, analytics, or UI assets.
- Keep extension-page CSP compatible with packaged scripts only.
- Do not add broad host permissions, cookie access, clipboard access, history access, or downloads access without an explicit RFC amendment.
- Treat captured browser data as sensitive; do not introduce request/response bodies, cookies, authorization values, form values, or WebSocket payload capture.

## Validation

- Ensure the unpacked `dist/` artifact remains loadable in Chrome.
- Manually verify the toolbar action opens the Side Panel after changes to manifest, service-worker, or Side Panel wiring.
