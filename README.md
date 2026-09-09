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
