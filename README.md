# action-web-tracer
A browser extension for developers that correlates a user interaction with everything it causes: JavaScript errors, network requests, API responses, DOM updates, rendering signals, performance issues, and silent failures.

## Development

Requires Node.js 24 LTS and pnpm 10.8.1.

```sh
pnpm install
pnpm build
```

Load `dist/` from `chrome://extensions` with Developer Mode enabled. On an HTTP(S) tab, click the ActionWebTracer toolbar icon to open the tab-specific Side Panel.

Use `pnpm typecheck`, `pnpm lint`, and `pnpm test` before submitting changes.
GitHub Actions runs those checks, builds the unpacked extension, and uploads `dist/` as a CI artifact.

## Deterministic fixtures

Run `pnpm fixtures` to serve the local fixture app at `http://127.0.0.1:4173`.
It provides the scenarios from RFC Section 26.2 for extension integration tests. Fixture
ground truth and benchmark assertions remain in `test-fixtures/` and are not exposed by
the fixture page. The test suite gates benchmark precision (95%), recall (90%), reason
codes, and fixture-secret redaction; product capture and export tickets supply the
observations that the harness will evaluate.

## MVP release and unpacked installation

1. Run `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` with Node.js 24 LTS.
2. In `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/`.
3. On an HTTP(S) tab open the toolbar action, choose **Trace This Tab**, perform an action, stop, inspect, and export. Use `pnpm fixtures` for the PRD success flows.

### Permissions and privacy

`activeTab` provides temporary access to the tab you explicitly trace; `scripting` injects the isolated probe; `debugger` observes allowlisted CDP evidence; `sidePanel` renders controls; and `storage` keeps local data. There is no host-wide permission, telemetry, account, remote code, analytics SDK, or upload endpoint. Data stays on-device; request/response bodies, cookies, authorization values, form values, editable content, screenshots, and WebSocket payloads are not captured. Exports are redacted again.

### Meaning of HEALTHY

`HEALTHY` means adequate capture coverage and no captured failure signal under the configured rules. It does not prove business correctness, user intent, or that every application effect was observed.

### Supported environments and limitations

Chrome 125+ is supported. Restricted Chrome/extension/Web Store pages and policy-blocked pages cannot be traced. Close DevTools or another debugger if Chrome reports a competing debugger. Cross-origin navigation or inaccessible child frames can reduce coverage. Closed shadow DOM, canvas/WebGL, and browser-native UI cannot be semantically inspected. WebSocket payload contents are discarded; only lifecycle/frame metadata is available.

### Diagnostics and release checklist

Diagnostics contain only structured capability/error codes, timing, counts, and coverage state—never trace content, URLs, payloads, labels, or secrets.

- Verify `dist/` loads in Chrome 125+ and the toolbar opens the Side Panel.
- Run healthy-click, API failure, runtime error, no-result, polling, and export fixture flows.
- Confirm permission/privacy, restricted-target, and competing-debugger states are understandable.
- Confirm `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` pass; exclude generated artifacts and credentials from git.
