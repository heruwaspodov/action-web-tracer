# RFC — ActionWebTracer v0.1 Architecture

**Status:** Proposed  
**Target:** MVP v0.1  
**Date:** 2026-09-04  
**Product:** ActionWebTracer  
**Platform:** Chrome 125+, Manifest V3  
**Source PRD:** [PRD-ActionWebTracer-v0.3.md](./PRD-ActionWebTracer-v0.3.md)

## 1. Summary

ActionWebTracer v0.1 will be a local-first Chrome extension that records browser evidence around page loads and explicit user actions, correlates that evidence into a trace, applies deterministic findings and classification, and exports the result as Markdown or JSON.

The implementation will combine:

- `chrome.debugger` and Chrome DevTools Protocol (CDP) for network, runtime, page lifecycle, and WebSocket evidence;
- an isolated-world page probe for trusted click/submit events and compact UI-change evidence;
- a Manifest V3 service worker for capture orchestration, normalization, correlation, classification, and persistence;
- a tab-specific Side Panel for recording controls and trace inspection;
- local extension storage only, with redaction at the ingestion boundary.

The central architectural constraint is that temporal proximity alone does not prove causation. Every attributed event therefore carries an explainable correlation result and confidence level. Events that cannot be attributed safely remain session background activity.

## 2. Decisions

This RFC makes the following decisions for v0.1:

1. The primary UI is a tab-specific Chrome Side Panel.
2. The extension targets Chrome 125 or newer and Manifest V3.
3. One browser tab may have one recording session and one foreground trace window at a time.
4. CDP is the authoritative source for network, runtime, page, and WebSocket evidence.
5. An isolated-world probe is the authoritative source for user actions and UI evidence.
6. A service worker owns session and trace state; UI pages never classify evidence independently.
7. Request and response bodies, cookie values, authorization values, form values, and WebSocket payload contents are not captured in v0.1.
8. Events are redacted before entering trace state or persistent storage.
9. Correlation is deterministic, explainable, and conservative. Uncertain evidence is placed in background activity.
10. Completed traces are stored locally in a bounded repository and can be exported explicitly by the user.
11. API-smell detection in v0.1 is limited to repeating/polling patterns. The broader smell detector remains v0.3 work.
12. AI, cloud storage, accounts, replay, waterfall UI, and code-agent handoff are outside this RFC.

## 3. Goals

The v0.1 implementation must let a developer:

- explicitly start and stop tracing for the current tab;
- receive Page Traces for reloads and main-frame navigations;
- receive Action Traces for trusted click and submit interactions;
- inspect associated HTTP requests, statuses, durations, runtime errors, console errors, WebSocket activity, and meaningful UI evidence;
- distinguish attributed evidence from session background activity;
- receive a deterministic classification and evidence-backed findings;
- export a trace as stable Markdown and versioned JSON;
- use the extension without sending captured data outside the browser.

The primary technical success metric is action-correlation precision. Incorrectly assigning background activity to an action is considered more harmful than leaving ambiguous activity unassigned.

## 4. Non-goals

This RFC does not design:

- browser automation or action replay;
- a Playwright or Selenium replacement;
- full session replay or full DOM snapshots;
- request or response body inspection;
- exact JavaScript handler or timer call-site attribution;
- distributed backend tracing;
- a cloud ingestion service;
- AI explanations;
- team accounts, collaboration, or billing;
- the P1 waterfall and sequence visualizations;
- all future API-smell rules.

## 5. Product-scope interpretation

The source PRD filename says `v0.3`, its metadata says `Draft v0.1`, and its release section defines an MVP `v0.1`. This RFC treats the release section named **v0.1 — What happened after my click?** as authoritative.

The PRD includes repeating/polling detection in v0.1 while placing the general API Smell Detector in v0.3. Therefore v0.1 implements only repeating/polling detection and the evidence plumbing needed by later rules.

## 6. User experience

### 6.1 Start recording

1. The user opens a debuggable HTTP(S) page.
2. The user clicks the ActionWebTracer toolbar action.
3. Chrome opens the tab-specific Side Panel.
4. The panel explains the debugger permission and local-data policy.
5. The user clicks **Trace This Tab**.
6. The service worker attaches CDP, injects the page probe, and begins a session.
7. A persistent `● Recording` indicator appears in the panel and extension badge.

The product must never imply that recording is active until both the CDP adapter and main-frame page probe report readiness. Partial frame coverage is allowed but must be shown explicitly.

### 6.2 Stop recording

When the user clicks **Stop**:

1. no new actions or Page Traces are opened;
2. active requests receive a short drain period of 1 second;
3. the active trace is finalized with stop reason `user_stopped`;
4. CDP detaches and the page probe disconnects;
5. session state becomes `stopped`.

### 6.3 Unsupported targets

Tracing is rejected with a specific explanation for restricted pages such as `chrome://`, extension pages, the Chrome Web Store, or any target where debugger attachment or script injection is denied.

Cross-origin top-level navigation ends the current recording if temporary host access no longer permits probe injection. The completed Page Trace records `coverage_lost` and the panel asks the user to start tracing again on the new origin.

### 6.4 Trace detail projection

The Side Panel presents one canonical completed-trace projection. Its summary contains:

```text
Action/Page
Total duration
Interaction evidence
JavaScript evidence
API evidence
UI evidence
Performance/timing status
Primary classification and confidence
```

Below the summary, v0.1 provides timeline, network, console/runtime, UI evidence, WebSocket, findings, background activity, and export sections. Waterfall and sequence visualizations are intentionally deferred, but the canonical event model preserves the timing required to add them later.

The summary uses `pass`, `fail`, `no evidence`, and `incomplete` states rather than treating every empty category as success. For example, no console error is a pass under complete runtime coverage; no UI change is `no evidence` until the classifier establishes that a visible update was expected.

### 6.5 Datadog-style waterfall

The waterfall is a planned P1 view, not a v0.1 release gate. Its data requirements are part of v0.1 so it can be added without changing trace semantics or recapturing traces.

The view uses one horizontal time axis relative to trace start:

```text
             0 ms       100        200        300        400

Action       ◆ Click Save
Network        ├── PATCH /users/123 ───────────────────┤ 200
Network          ├── GET /permissions ────────┤ 200
UI                                              ├─ toast ─┤
Runtime                                             ◆ error
```

Rows are grouped into these lanes:

1. action or page lifecycle;
2. attributed network requests;
3. runtime and console errors;
4. meaningful UI evidence;
5. attributed WebSocket activity;
6. possibly related/background activity in a collapsed, visually distinct group.

Rendering rules:

- `0 ms` is the Action Trace trigger or Page Trace navigation start;
- request bars run from request start through finish/failure;
- where available, a request bar distinguishes waiting-for-response from response download;
- UI batches render as short spans from first to last mutation in the semantic batch;
- actions, errors, WebSocket frames, and navigation milestones render as point markers;
- concurrent requests occupy separate rows and align on the same time axis;
- redirects render as connected request-hop segments;
- unfinished work ends with an open edge at the trace timeout;
- low-confidence evidence is never mixed into attributed lanes without a `possibly related` label;
- status uses text/icon plus color, never color alone.

Default sorting preserves event start time. The user may group network rows by host or normalized endpoint and may expand a row to see correlation confidence, timing, status, initiator, cache/service-worker flags, and linked findings.

The waterfall visualizes observed timing; it does not claim causal dependency or a critical path. Sequential layout may produce a finding such as `possible sequential dependency`, but only the later critical-path feature may summarize a possible critical path.

P1 acceptance criteria for this view are:

- parallel and sequential requests are visually distinguishable;
- the action-to-first-request and response-to-UI gaps can be read directly;
- slow requests, errors, missing UI evidence, and timed-out work are visible;
- every visual row links to the same canonical evidence used by exports;
- a 500-event trace remains interactive within the Side Panel performance budget.

## 7. High-level architecture

```text
┌───────────────────────┐
│ Tab-specific Side     │
│ Panel                 │
│ controls + projections│
└───────────┬───────────┘
            │ typed extension messages
            ▼
┌─────────────────────────────────────────────────────────┐
│ Manifest V3 Service Worker                              │
│                                                         │
│ Session Controller ── Trace State Machine               │
│          │                    │                          │
│          ├── CDP Adapter      ├── Normalizer             │
│          ├── Probe Adapter    ├── Redactor               │
│          │                    ├── Correlator              │
│          │                    ├── Finding Rules           │
│          │                    └── Classifier              │
│          │                                               │
│          └──────────────────────► Trace Repository        │
└───────────────┬──────────────────────────┬───────────────┘
                │ chrome.debugger / CDP    │ runtime port
                ▼                          ▼
┌──────────────────────────┐   ┌──────────────────────────┐
│ Browser target           │   │ Isolated-world page probe│
│ Network / Runtime / Page │   │ actions + UI evidence    │
│ Log / WebSocket events   │   │ no application patching  │
└──────────────────────────┘   └──────────────────────────┘
```

### 7.1 Component ownership

| Component | Responsibility | Must not do |
|---|---|---|
| Side Panel | Start/stop controls, session status, trace list/detail, export | Capture raw page data or derive classifications |
| Session Controller | Attach/detach, capability negotiation, adapter lifecycle, recovery | Interpret product health |
| CDP Adapter | Convert supported CDP events to raw evidence | Persist unredacted headers or payloads |
| Page Probe | Observe trusted actions and compact UI signals | Monkey-patch application APIs or retain raw DOM |
| Normalizer | Convert source clocks and payloads to canonical events | Attribute events |
| Redactor | Remove or transform sensitive values | Depend on UI rendering for safety |
| Correlator | Assign each event to a trace or background with reasons | Invent causal certainty |
| Finding Engine | Produce evidence-backed warnings | Call external services |
| Classifier | Produce one primary classification plus confidence | Hide conflicting evidence |
| Trace Repository | Persist bounded, schema-versioned records | Sync data or upload it |

## 8. Chrome platform choices

### 8.1 Manifest and minimum browser

The extension uses Manifest V3 with `minimum_chrome_version: "125"`.

Chrome 125 is selected because `chrome.debugger` flat sessions can attach related targets such as out-of-process iframes from that version. Side Panel itself is available earlier, and active debugger sessions keep an extension service worker alive from Chrome 118, but using one Chrome 125 baseline reduces frame-coverage branches in the MVP.

### 8.2 Permissions

Required manifest permissions:

```json
{
  "permissions": [
    "activeTab",
    "debugger",
    "scripting",
    "sidePanel",
    "storage"
  ]
}
```

There is no `<all_urls>` host permission in v0.1. `activeTab` provides temporary access after the toolbar gesture, while `scripting` injects the probe into eligible frames. The `debugger` permission cannot be optional, so onboarding must explain why Chrome presents a powerful permission warning.

No permission is requested for cookies, clipboard, history, downloads, or remote hosts. Exports are generated from an extension page using a local Blob download.

### 8.3 CDP domains

The adapter enables only:

- `Network` for requests, responses, failures, transfer size, Server-Sent Events where available, and WebSocket lifecycle/frames;
- `Runtime` for uncaught exceptions and execution-context metadata;
- `Log` for browser and console error entries;
- `Page` for navigation and lifecycle evidence;
- `Target` for related iframe targets using flat sessions.

The adapter does not enable `Debugger`, `DOMSnapshot`, `Fetch`, `Profiler`, or `Tracing` in v0.1. ActionWebTracer observes; it does not pause, intercept, mutate, or throttle the target.

## 9. Session model

### 9.1 Session state machine

```text
IDLE
  └─ start requested ─► ATTACHING
                         ├─ adapters ready ─► RECORDING
                         └─ failure ─────────► ERROR

RECORDING
  ├─ stop requested ─► DRAINING ─► STOPPED
  ├─ debugger detached ──────────► INTERRUPTED
  ├─ permission/coverage lost ───► INTERRUPTED
  └─ tab closed ─────────────────► STOPPED
```

The active session descriptor is checkpointed in `chrome.storage.session`; it is not held only in service-worker globals. Completed traces are written to the persistent repository. An active debugger session keeps the worker alive on the supported Chrome baseline, but the implementation must still tolerate worker restart and reconcile attachment state.

### 9.2 Session record

```ts
type TraceSession = {
  schemaVersion: 1;
  sessionId: string;
  tabId: number;
  startedAt: string;
  stoppedAt?: string;
  state: "attaching" | "recording" | "draining" | "stopped" | "interrupted" | "error";
  origin: string;
  mainFrameId?: string;
  capabilities: CaptureCapabilities;
  coverage: CoverageSummary;
  stopReason?: StopReason;
};
```

Tab IDs are operational identifiers and are excluded from exports.

## 10. Trace lifecycle

### 10.1 Trace types

```ts
type TraceType = "page" | "action";
type ActionKind = "click" | "submit";
```

A Page Trace begins on a main-frame navigation request. An Action Trace begins when the probe observes a trusted click or submit.

Starting recording on an already-loaded page does not synthesize a Page Trace. The session begins with background observation and waits for a reload/navigation or user action.

### 10.2 Action de-duplication

A click on a submit control commonly causes a submit event. If a submit occurs within 250 ms of a click and the click target belongs to the submitted form, the two signals form one Action Trace:

- primary kind: `submit`;
- trigger chain: `click → submit`;
- trace start: original click timestamp.

Otherwise they create separate traces.

### 10.3 Concurrent actions

Only one foreground action window is active per tab.

When a new action occurs:

- the previous trace stops accepting newly-started events at the new action timestamp;
- requests already assigned to the previous trace retain ownership through response/failure;
- the previous trace may continue settling while the new trace opens;
- DOM/runtime events after the boundary belong to the new trace only when they meet its correlation rules; otherwise they remain ambiguous/background.

An evidence event has at most one owner. The UI may show related background evidence but may not duplicate it into multiple traces.

### 10.4 Settling and timeout

Default constants:

```ts
const ACTION_INITIAL_WINDOW_MS = 2_000;
const NETWORK_IDLE_MS = 500;
const UI_IDLE_MS = 300;
const ACTION_MAX_DURATION_MS = 10_000;
const PAGE_MAX_DURATION_MS = 15_000;
const STOP_DRAIN_MS = 1_000;
```

An Action Trace completes when:

1. at least `ACTION_INITIAL_WINDOW_MS` has elapsed;
2. no assigned request is pending;
3. network has been idle for `NETWORK_IDLE_MS`;
4. meaningful UI evidence has been idle for `UI_IDLE_MS`.

It completes at the maximum duration even if work remains and records `timed_out: true`. A Page Trace uses the same quiet conditions after the main-frame load lifecycle but has its own maximum duration.

These constants are versioned configuration, not user settings in v0.1. Fixture-test results may change them before release.

## 11. Canonical evidence model

All source events are normalized before correlation.

```ts
type EvidenceEnvelope<T> = {
  evidenceId: string;
  sessionId: string;
  source: "probe" | "cdp" | "extension";
  kind: EvidenceKind;
  timestampUs: number;
  wallTime?: string;
  frame: {
    frameId?: string;
    parentFrameId?: string;
    isMainFrame: boolean;
    urlOrigin?: string;
  };
  payload: T;
  redaction: {
    applied: boolean;
    fields: string[];
  };
};
```

`timestampUs` uses one session-relative monotonic clock. CDP monotonic timestamps are mapped to that clock when attachment begins. Probe events include `performance.timeOrigin + performance.now()` and are calibrated by a handshake. Ordering ties are resolved by source sequence number, never wall-clock strings.

### 11.1 Evidence kinds

- `action.click`
- `action.submit`
- `network.request_started`
- `network.response_received`
- `network.request_finished`
- `network.request_failed`
- `runtime.exception`
- `console.error`
- `ui.change`
- `page.navigation`
- `page.lifecycle`
- `websocket.created`
- `websocket.closed`
- `websocket.frame_sent`
- `websocket.frame_received`
- `capture.coverage_changed`

Raw CDP messages and raw MutationRecords are not part of the persisted schema.

## 12. Page probe

The probe runs in Chrome's isolated world in every eligible frame. It uses platform observers and capturing listeners without patching application functions.

### 12.1 Action capture

The probe listens for `click` and `submit` in the capture phase and accepts only events where `event.isTrusted === true`.

For each action it emits compact target metadata:

```ts
type ActionTarget = {
  tag: string;
  role?: string;
  label?: string;
  id?: string;
  name?: string;
  type?: string;
  selectorHint: string;
  framePath: string[];
};
```

Rules:

- `label` is derived from accessible-name hints, associated label text, button text, or a short text fallback;
- labels are whitespace-normalized and capped at 120 characters;
- input values, text-area values, selected values, `contenteditable` content, and form payloads are never captured;
- selector hints prefer stable IDs and semantic attributes and are capped at 240 characters;
- selector hints are diagnostic hints, not replay selectors.

### 12.2 UI evidence extraction

A `MutationObserver` collects mutations into 50 ms batches. The probe immediately reduces each batch to semantic evidence and discards the raw nodes and MutationRecords.

A change is meaningful when at least one of the following is observed in or near the visible viewport:

- a visible element is added or removed;
- visible text changes, represented only by before/after hashes, lengths, and a redacted excerpt where safe;
- `aria-expanded`, `aria-selected`, `aria-checked`, `aria-invalid`, `disabled`, `hidden`, or dialog/open state changes;
- an element with role `alert`, `status`, or `dialog` becomes visible;
- focus moves to a different interactive element;
- the document title or URL changes;
- a target's visible geometry changes materially.

The following are ignored by default:

- mutations under `script`, `style`, `link`, `meta`, or hidden subtrees;
- extension-owned nodes;
- attribute changes limited to generated class names unless visibility or geometry changes;
- repeated mutations that collapse to the same semantic signature;
- changes wholly outside the viewport with no accessibility-state effect.

UI evidence is a heuristic. The persisted record includes signal types and counts, not a claim that the application's intended outcome occurred.

### 12.3 Probe health

The probe sends a heartbeat every 5 seconds while recording. Missing two heartbeats marks that frame's coverage `degraded`. Heartbeats contain no page data and are not evidence events.

## 13. Network and WebSocket capture

### 13.1 Included HTTP traffic

The default trace view includes resource types:

- `Document`;
- `XHR`;
- `Fetch`;
- `EventSource`;
- `WebSocket`;
- `Other` only when response MIME type or initiator metadata indicates API traffic.

Stylesheets, images, fonts, media, manifests, and source maps are excluded from trace detail by default. Their aggregate count and duration may be retained for Page Trace diagnostics, but their URLs and headers are not persisted.

Redirect hops retain a shared logical request ID and separate hop timing/status.

### 13.2 Request record

```ts
type NetworkRequest = {
  requestId: string;
  method: string;
  sanitizedUrl: string;
  resourceType: string;
  frameId?: string;
  initiator: {
    type?: string;
    sanitizedUrl?: string;
    line?: number;
    column?: number;
  };
  startedAtUs: number;
  responseAtUs?: number;
  finishedAtUs?: number;
  status?: number;
  mimeType?: string;
  encodedBytes?: number;
  timing?: {
    dnsMs?: number;
    connectMs?: number;
    sslMs?: number;
    requestMs?: number;
    waitingMs?: number;
    downloadMs?: number;
  };
  fromCache?: boolean;
  fromServiceWorker?: boolean;
  failureReason?: string;
};
```

Only safe, allowlisted headers may be stored: `content-type`, `content-length`, `cache-control`, and `server-timing`. All other request and response headers are discarded at ingestion.

### 13.3 WebSockets

For each connection, v0.1 records:

- sanitized URL;
- creation, handshake status, close, and error timing;
- frame direction, opcode category, timestamp, and payload byte length.

`payloadData` is discarded before normalization. A pre-existing socket is background activity by default. A sent frame within an action window may be related to that action at low confidence; received frames remain background unless a deterministic request/response pairing rule is available. The UI must not claim that a received frame was caused by an action based only on proximity.

## 14. Runtime and console capture

Uncaught exceptions come from `Runtime.exceptionThrown`. Error-level log entries come from `Log.entryAdded` and supported console events.

The normalized error contains:

- error class/name where available;
- redacted and capped message;
- sanitized stack frames;
- source URL, line, and column;
- timestamp and frame/execution context;
- repeat count for identical fingerprints.

Arbitrary remote-object inspection is prohibited. Object graphs and console argument values are not serialized. Identical errors within 250 ms collapse into one record with an incremented count.

## 15. Redaction and privacy boundary

### 15.1 Capture policy

The safest data is data never collected. In v0.1:

- no HTTP request bodies;
- no HTTP response bodies;
- no WebSocket payload contents;
- no cookie values;
- no authorization header values;
- no form or input values;
- no screenshots;
- no full DOM or HTML snapshots.

### 15.2 URL redaction

URLs are parsed before storage.

- fragments are removed;
- username and password components are removed;
- query values are replaced with `[REDACTED]` when the key matches a case-insensitive sensitive-key dictionary;
- configured secret literals are replaced everywhere;
- query values longer than 200 characters are truncated even when not classified as secrets.

Initial sensitive keys include:

```text
token, access_token, refresh_token, api_key, apikey, key,
secret, password, passwd, authorization, auth, session,
cookie, code, credit_card, card_number, cvv
```

The original URL is never retained after sanitization.

### 15.3 Text redaction

Console messages, action labels, UI excerpts, failure reasons, and stack text pass through the same redactor. Rules cover bearer/basic credentials, JWT-shaped tokens, common API-key patterns, email-like configured secrets, and user-configured literal values.

Redaction runs before correlation because correlation state may later be persisted. Export performs a second defensive redaction pass.

### 15.4 External transfer

The extension contains no telemetry or application-data upload endpoint in v0.1. Export requires an explicit click and produces a local file. Extension update traffic through Chrome is outside trace data flow.

## 16. Correlation engine

### 16.1 Principles

- Prefer precision over recall.
- Strong structural evidence outweighs timestamp proximity.
- Every decision is reproducible from persisted evidence.
- Every attributed event stores reason codes and confidence.
- Low-confidence evidence remains background unless a trace detail view explicitly shows it as “possibly related.”

### 16.2 Correlation result

```ts
type Correlation = {
  owner: { type: "trace"; traceId: string } | { type: "background" };
  confidence: "high" | "medium" | "low";
  score: number;
  reasons: CorrelationReason[];
};
```

### 16.3 Initial scoring rules

| Evidence | Condition | Score |
|---|---|---:|
| Any | Occurs before trace start | reject |
| Request | CDP reports `hasUserGesture` during the trace trigger | +5 |
| Navigation | Main-frame navigation begins from the action | +5 |
| Request | Starts within 250 ms of action | +3 |
| Request | Starts within 251–2,000 ms of action | +1 |
| Request | Initiator frame equals action frame | +1 |
| Request | Initiator stack descends from an already attributed request/script context | +2 |
| Runtime error | Same frame and within active action window | +2 |
| UI change | Same frame, within active window, and near action target | +3 |
| UI change | Same frame and within active window | +1 |
| Any | Matches learned periodic/background fingerprint | −5 |
| Any | Begins after a newer foreground action | reject for older trace |
| WebSocket receive | Only temporal proximity is available | background |

Assignment thresholds:

- score `>= 5`: high confidence, assign to trace;
- score `3–4`: medium confidence, assign to trace;
- score `<= 2`: background, optionally show as possibly related;
- any reject rule: background or eligible newer trace.

Weights are constants covered by fixture tests. A change to weights or thresholds requires updating the correlation-rules version and benchmark results.

### 16.4 Request ownership

A request is assigned at `request_started`. All response, finish, and failure events inherit that request's owner regardless of when they arrive. Redirect hops inherit the logical request's owner.

### 16.5 Background fingerprints

The session builds fingerprints from method plus normalized URL path, with volatile path segments and query values replaced. A request pattern becomes periodic when at least three occurrences have intervals within 20% of their median and at least one occurrence predates the action.

Periodic patterns remain background unless strong structural evidence scores at least 5. This prevents polling that happens near a click from being silently absorbed into the Action Trace.

### 16.6 Coverage and confidence

Trace-level correlation confidence is the minimum of:

- adapter coverage;
- frame coverage;
- clock-calibration quality;
- evidence-assignment confidence.

A trace with lost debugger/probe coverage cannot be classified `HEALTHY`; it becomes `UNKNOWN` with an incomplete-capture finding.

## 17. Finding engine

Findings are pure functions over a completed trace and nearby background evidence. Each finding contains a stable code, severity, summary, evidence IDs, and optional debugging steps.

Required v0.1 findings:

- uncaught runtime exception;
- console error;
- HTTP 4xx response;
- HTTP 5xx response;
- network transport failure;
- successful state-changing request without meaningful UI evidence;
- rejected request without visible error UI;
- no observable result;
- incomplete capture or debugger detachment;
- repeating/polling request pattern;
- potentially related background evidence excluded from the trace.

Repeating/polling detection reports facts: fingerprint, count, interval distribution, and observation window. It does not call a pattern wasteful unless a future rule has sufficient evidence.

## 18. Classification

Every completed trace receives one primary classification and a confidence level. Findings preserve additional problems that do not become primary.

### 18.1 Classification rules

Rules are evaluated in this order:

| Priority | Condition | Classification |
|---:|---|---|
| 1 | Capture is materially incomplete or evidence conflicts | `UNKNOWN` |
| 2 | Uncaught exception occurs before any stronger external failure and stops observable progress | `FRONTEND_FAILURE` |
| 3 | An attributed request returns 5xx | `SERVER_FAILURE` |
| 4 | An attributed request returns 4xx or has a transport/protocol failure | `API_FAILURE` |
| 5 | A qualifying successful state-changing request has no meaningful UI evidence before settlement | `UI_SYNC_FAILURE` |
| 6 | No request, runtime error, navigation, WebSocket send, or meaningful UI evidence occurs | `SILENT_FAILURE` |
| 7 | Expected evidence completes without failure findings | `HEALTHY` |
| 8 | None of the above is justified | `UNKNOWN` |

A “qualifying state-changing request” uses method `POST`, `PUT`, `PATCH`, or `DELETE`, receives 2xx, and is correlated at medium or high confidence. A `GET` followed by no UI update does not produce `UI_SYNC_FAILURE` in v0.1.

`HEALTHY` means no captured failure signal under adequate coverage. It does not prove business correctness.

### 18.2 Special cases

- Multiple failures: the earliest plausibly causal failure wins; later failures remain findings.
- 401/403/422 plus visible error UI: remains `API_FAILURE`, with a finding that error handling was visible.
- 4xx/5xx plus no visible error UI: add `silent_error_handling` finding.
- Successful navigation/download-like action without DOM mutation: may be `HEALTHY` when navigation or download evidence is the visible outcome.
- Page Trace: uses `FRONTEND_FAILURE`, `API_FAILURE`, `SERVER_FAILURE`, `HEALTHY`, or `UNKNOWN`; it does not use `UI_SYNC_FAILURE` or `SILENT_FAILURE`.

## 19. Persistence

### 19.1 Storage areas

- `chrome.storage.session`: active session checkpoint, adapter health, active trace indexes, and bounded event buffers needed for recovery;
- IndexedDB in the extension origin: completed sessions, traces, background summaries, and export-ready projections;
- `chrome.storage.local`: user preferences, redaction configuration, and schema metadata.

Content scripts have no direct access to stored traces. All writes go through validated service-worker messages.

### 19.2 Limits

Default limits:

```text
50 completed traces
10 MB total completed-trace storage
500 network records per trace
1,000 WebSocket frame metadata records per trace
1,000 UI evidence records per trace before aggregation
5,000 canonical evidence records per trace
```

When a limit is reached, the repository evicts the oldest completed trace first. Within an active trace, repeated evidence is aggregated before dropping data. Any truncation adds a coverage finding and prevents `HEALTHY` classification.

Users can delete one trace, one session, or all local data. Deletion is immediate and does not affect already-exported files.

## 20. Trace schema

The JSON export envelope is versioned independently of the extension version.

```ts
type TraceExportV1 = {
  actionWebTracerVersion: string;
  schemaVersion: 1;
  correlationRulesVersion: 1;
  trace: {
    traceId: string;
    type: "page" | "action";
    startedAt: string;
    durationMs: number;
    url: string;
    action?: {
      kind: "click" | "submit";
      target: ActionTarget;
      triggerChain?: ("click" | "submit")[];
    };
    classification: Classification;
    classificationConfidence: "high" | "medium" | "low";
    coverage: CoverageSummary;
    timeline: TimelineEvent[];
    network: NetworkRequest[];
    errors: RuntimeError[];
    uiEvidence: UiEvidence[];
    websocket: WebSocketSummary[];
    findings: Finding[];
    machineContext: MachineContext;
  };
};
```

The v0.1 machine context is deliberately compact and derived from the same canonical records:

```ts
type MachineContext = {
  classification: Classification;
  classificationConfidence: "high" | "medium" | "low";
  correlationConfidence: "high" | "medium" | "low";
  requestCount: number;
  failedRequestCount: number;
  consoleErrorCount: number;
  runtimeExceptionCount: number;
  meaningfulUiChange: boolean;
  websocketConnectionCount: number;
  websocketSentFrameCount: number;
  websocketReceivedFrameCount: number;
  backgroundEventCount: number;
  timedOut: boolean;
  captureComplete: boolean;
};
```

Unknown fields must be ignored by readers. Breaking field changes require a new `schemaVersion`. IDs are stable within one export but contain no tab ID or device identifier.

## 21. Markdown export

Suggested filename:

```text
action-web-tracer-YYYY-MM-DD-action-slug.md
```

Required order:

1. YAML front matter
2. Summary
3. Action or Page Load
4. Timeline
5. Network
6. Console and Runtime Errors
7. UI Evidence
8. WebSocket Activity
9. Findings
10. API Patterns
11. Suggested Debugging Steps
12. Machine Context

The report distinguishes facts from heuristics using explicit labels:

- **Observed:** direct normalized evidence;
- **Inferred:** deterministic rule output;
- **Possibly related:** low-confidence/background evidence.

Markdown generation consumes the same export projection as JSON so the two formats cannot disagree on classification or counts.

## 22. Failure handling

| Failure | Behavior |
|---|---|
| Debugger attach denied | No session starts; explain likely conflict/policy |
| Debugger detaches | Finalize active traces as `UNKNOWN`; preserve captured evidence |
| Probe injection fails in main frame | No recording; detach debugger |
| Probe injection fails in child frame | Continue with degraded coverage indicator |
| Service worker restarts | Restore checkpoint, query attachment state, reconcile or interrupt |
| Storage quota reached | Evict oldest completed traces; never export partial data silently |
| CDP method unsupported | Disable that capability and surface coverage gap |
| Cross-origin navigation loses access | Finalize and ask user to restart on new origin |
| Tab closes | Finalize possible records and stop without error notification |
| Event buffer overflows | Aggregate/drop by policy, add truncation finding, classify `UNKNOWN` |

All adapter failures use structured codes. Raw exception messages may be shown in a diagnostic section after redaction, but user-facing status uses actionable language.

## 23. Performance budgets

MVP engineering targets on the fixture application and a reference developer laptop:

- page-probe observer work: p95 under 2 ms per 50 ms batch;
- action dispatch to service-worker receipt: p95 under 50 ms;
- Side Panel incremental render: p95 under 100 ms for a 500-event trace;
- classification after settlement: under 100 ms;
- export generation for a maximum-size trace: under 1 second;
- no unbounded arrays, raw DOM retention, or payload retention.

If observation threatens page responsiveness, the probe increases batching, aggregates repeated signals, and finally marks coverage degraded. It must not block the application to preserve trace completeness.

## 24. Security model

Threats considered in v0.1:

- a hostile page sends forged extension messages;
- captured strings contain secrets;
- page content attempts to discover or mutate probe state;
- exported reports expose credentials;
- stale debugger attachment records unintended activity;
- extension UI renders hostile text as HTML.

Required controls:

- isolated-world probe and private runtime port;
- sender tab/frame validation for every probe message;
- runtime schema validation and size limits;
- no window-level `postMessage` bridge;
- text-only rendering or strict escaping in the Side Panel and Markdown generator;
- redaction before state insertion and again before export;
- explicit per-tab start and stop;
- automatic detach on stop, tab close, fatal error, or extension shutdown path;
- Content Security Policy with packaged scripts only;
- no remote code, analytics SDK, or externally loaded UI asset.

## 25. Implementation structure

The implementation should use TypeScript and keep browser adapters separate from the pure trace engine.

```text
src/
  background/
    service-worker.ts
    session-controller.ts
  adapters/
    cdp/
    probe/
  probe/
    action-observer.ts
    ui-observer.ts
  engine/
    normalize/
    redact/
    correlate/
    findings/
    classify/
    settle/
  model/
    evidence.ts
    trace.ts
    export-v1.ts
  storage/
    session-store.ts
    trace-repository.ts
  sidepanel/
  export/
  test-fixtures/
```

The `engine` package must remain free of Chrome APIs and DOM globals. Given canonical evidence and versioned configuration, it must return identical trace ownership, findings, and classification. This enables fast deterministic unit and fixture testing.

UI framework and styling choices do not affect this architecture and may be selected during project scaffolding. The exported model and engine may not import UI code.

## 26. Validation strategy

### 26.1 Test layers

1. **Unit tests:** normalization, redaction, fingerprints, correlation rules, settlement, findings, classification, exporters.
2. **Contract tests:** recorded CDP/probe fixtures into canonical evidence.
3. **Extension integration tests:** unpacked extension against a local deterministic fixture app.
4. **Manual browser matrix:** supported Chrome stable on macOS, Windows, and Linux before release.

Using browser automation to test the extension is allowed; the product itself remains non-automation software.

### 26.2 Required fixture scenarios

- healthy click → request → 2xx → UI update;
- click → uncaught exception → no request;
- submit → 422 → visible validation message;
- submit → 422 → no visible error;
- click → PATCH 200 → no UI evidence;
- click → no observable evidence;
- background polling overlaps a healthy action;
- analytics request overlaps an action;
- pre-existing WebSocket receives unrelated frames during an action;
- action sends a WebSocket frame;
- duplicate click/submit trigger chain;
- two rapid independent actions;
- request outlives the action window;
- same-origin reload creates a Page Trace;
- cross-origin navigation loses probe coverage;
- child iframe action and out-of-process iframe traffic;
- debugger detaches mid-trace;
- storage/event limits are exceeded;
- every configured secret category is redacted from UI, storage, Markdown, and JSON.

### 26.3 Correlation benchmark

Fixture events carry hidden ground-truth ownership. For action-related versus background evidence, release targets are:

```text
precision >= 95%
recall    >= 90%
100% of attributed events include reason codes
0 known secret fixtures survive redaction
```

Precision is the release gate. If precision and recall trade off, thresholds are tuned toward leaving more evidence in background.

## 27. Delivery phases

### Phase 1 — Capture spike

- attach/detach one tab;
- collect CDP network/runtime/page/WebSocket events;
- inject the probe and collect actions/UI batches;
- verify clock alignment and frame identity;
- measure known platform gaps.

Exit condition: the fixture app produces a raw, redacted event stream through reload and action scenarios.

### Phase 2 — Deterministic trace engine

- canonical schemas;
- correlation and background separation;
- trace settlement;
- findings and classifications;
- correlation benchmark harness.

Exit condition: required fixtures meet precision and recall targets without UI.

### Phase 3 — Persistence and exports

- session checkpointing and bounded repository;
- JSON schema v1;
- Markdown report;
- deletion and quota behavior;
- redaction regression suite.

Exit condition: restart, quota, export, and privacy tests pass.

### Phase 4 — Side Panel product slice

- onboarding and permission explanation;
- recording indicator and controls;
- trace list/detail and background activity;
- export actions and failure states.

Exit condition: all PRD v0.1 success-metric flows can be completed from an unpacked extension.

### Phase 5 — Hardening

- multi-frame and cross-origin coverage;
- performance budgets;
- supported-OS manual checks;
- detach/recovery behavior;
- release checklist and known limitations.

Exit condition: no open release-blocking privacy, correlation, or data-loss defect.

## 28. Observability of ActionWebTracer itself

Because v0.1 has no telemetry backend, the extension maintains a local diagnostic log containing only:

- state transitions;
- adapter capability results;
- structured internal error codes;
- counts, durations, and dropped-event totals;
- extension version and Chrome major version.

It excludes page URLs, labels, console messages, headers, and trace content. Users may explicitly copy this diagnostic log when reporting an ActionWebTracer bug.

## 29. Alternatives considered

### DevTools panel instead of Side Panel

A DevTools panel naturally fits developer workflows but makes the product subordinate to an open DevTools window and complicates the “open extension, trace this tab” flow. Side Panel remains visible beside the page and is the v0.1 choice. A DevTools surface can be reconsidered later.

### `webRequest` instead of CDP

`webRequest` provides useful request observation but does not provide the unified runtime, page lifecycle, and WebSocket evidence model required by the PRD. Using CDP avoids stitching together more partially overlapping browser APIs.

### Main-world monkey-patching

Patching `fetch`, `XMLHttpRequest`, WebSocket, timers, or event handlers could add causality hints but changes application runtime behavior and is vulnerable to framework variations. v0.1 remains observational. A future opt-in instrumentation mode would require a separate RFC.

### Full DOM snapshots

Snapshots simplify before/after comparison but carry high privacy and memory cost. Semantic UI evidence is less complete but aligns with the PRD and local-first privacy posture.

### Capture bodies and redact later

This would improve debugging detail but creates unnecessary secret exposure before redaction. Metadata-only capture is the v0.1 decision.

## 30. Known limitations

- Correlation is heuristic and cannot prove JavaScript causality.
- `HEALTHY` means no observed technical failure, not business correctness.
- UI evidence may miss canvas, WebGL, video, shadow-root, or application-specific visual changes.
- Closed shadow roots cannot be inspected by the page probe.
- Existing WebSocket request/response semantics may remain background.
- Browser/enterprise policy can block debugger attachment.
- Another debugger client may cause attachment or detachment failures.
- Cross-origin navigation may require the user to start a new session.
- Restricted Chrome pages cannot be traced.
- Exact timer origins and framework component ownership are unavailable.

These limitations must be documented in the product UI and exports when relevant; they must not be hidden behind confident classifications.

## 31. Open implementation questions

The following do not block architectural acceptance but must be resolved during Phase 1:

1. Which CDP protocol version string provides the best supported negotiation behavior across Chrome 125+?
2. How reliably can probe and CDP monotonic clocks be calibrated across out-of-process frames?
3. Which CDP console events avoid duplicate records across `Runtime` and `Log`?
4. Which shadow-root cases can be covered safely without patching `attachShadow`?
5. What geometry threshold best separates layout noise from meaningful visible change?
6. Which URL fingerprint rules avoid grouping distinct API resources too aggressively?

Answers that change data collection, privacy, permissions, or correlation semantics require an amendment to this RFC. Pure adapter details can be recorded as implementation notes.

## 32. Acceptance criteria

This RFC is ready to move to implementation when stakeholders accept:

- [ ] v0.1 scope interpretation in Section 5;
- [ ] Side Panel as the primary UI;
- [ ] Chrome 125+ and Manifest V3;
- [ ] required `debugger` permission and onboarding implications;
- [ ] CDP + isolated-world probe architecture;
- [ ] metadata-only capture policy;
- [ ] conservative single-owner correlation model;
- [ ] lifecycle constants as benchmark-tunable defaults;
- [ ] classification precedence in Section 18;
- [ ] local bounded persistence and explicit export;
- [ ] correlation precision and redaction release gates;
- [ ] known limitations in Section 30.

## 33. References

- [ActionWebTracer Product Requirements](./PRD-ActionWebTracer-v0.3.md)
- [Chrome `debugger` API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome `scripting` API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome `activeTab` permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Extension service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome DevTools Protocol Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/)

## 34. Implementation backlog

This section is the source for GitHub implementation tickets. All tickets start in the project `Backlog` status. Ticket IDs below are planning identifiers; GitHub issue numbers remain authoritative after creation.

| Planning ID | GitHub issue |
|---|---|
| AWT-001 | [#1](https://github.com/heruwaspodov/action-web-tracer/issues/1) |
| AWT-002 | [#2](https://github.com/heruwaspodov/action-web-tracer/issues/2) |
| AWT-003 | [#3](https://github.com/heruwaspodov/action-web-tracer/issues/3) |
| AWT-004 | [#4](https://github.com/heruwaspodov/action-web-tracer/issues/4) |
| AWT-005 | [#5](https://github.com/heruwaspodov/action-web-tracer/issues/5) |
| AWT-006 | [#6](https://github.com/heruwaspodov/action-web-tracer/issues/6) |
| AWT-007 | [#7](https://github.com/heruwaspodov/action-web-tracer/issues/7) |
| AWT-008 | [#8](https://github.com/heruwaspodov/action-web-tracer/issues/8) |
| AWT-009 | [#9](https://github.com/heruwaspodov/action-web-tracer/issues/9) |
| AWT-010 | [#10](https://github.com/heruwaspodov/action-web-tracer/issues/10) |
| AWT-011 | [#11](https://github.com/heruwaspodov/action-web-tracer/issues/11) |
| AWT-012 | [#12](https://github.com/heruwaspodov/action-web-tracer/issues/12) |
| AWT-013 | [#13](https://github.com/heruwaspodov/action-web-tracer/issues/13) |
| AWT-014 | [#14](https://github.com/heruwaspodov/action-web-tracer/issues/14) |
| AWT-015 | [#15](https://github.com/heruwaspodov/action-web-tracer/issues/15) |
| AWT-016 | [#16](https://github.com/heruwaspodov/action-web-tracer/issues/16) |
| AWT-017 | [#17](https://github.com/heruwaspodov/action-web-tracer/issues/17) |
| AWT-018 | [#18](https://github.com/heruwaspodov/action-web-tracer/issues/18) |
| AWT-019 | [#19](https://github.com/heruwaspodov/action-web-tracer/issues/19) |
| AWT-020 | [#20](https://github.com/heruwaspodov/action-web-tracer/issues/20) |
| AWT-021 | [#21](https://github.com/heruwaspodov/action-web-tracer/issues/21) |
| AWT-022 | [#22](https://github.com/heruwaspodov/action-web-tracer/issues/22) |
| AWT-023 | [#23](https://github.com/heruwaspodov/action-web-tracer/issues/23) |
| AWT-024 | [#24](https://github.com/heruwaspodov/action-web-tracer/issues/24) |

### AWT-001 — [P0] Scaffold the Manifest V3 extension

**Scope:** Create the TypeScript extension workspace, Manifest V3 entry points, Side Panel page, service worker, page-probe bundle, formatting, linting, unit-test command, and production build.

**Acceptance criteria:**

- unpacked extension installs on Chrome 125+;
- toolbar action opens a tab-specific Side Panel;
- packaged scripts satisfy the extension CSP;
- build, type-check, lint, and unit-test commands pass;
- no remote script or runtime dependency is loaded.

**Dependencies:** None.

### AWT-002 — [P0] Build the deterministic fixture app and test harness

**Scope:** Implement every Section 26.2 scenario with hidden ground-truth ownership, integration capture, export snapshots, and benchmark reporting.

**Acceptance criteria:**

- fixtures cover healthy, failure, concurrency, polling, WebSocket, frame, coverage-loss, quota, and redaction cases;
- benchmark reports precision and recall separately;
- CI fails below 95% precision, 90% recall, or complete secret redaction;
- fixture timing is deterministic enough to avoid flaky threshold tests.

**Dependencies:** AWT-001; integration coverage expands as the capture, engine, export, and UI tickets land.

### AWT-003 — [P0] Implement canonical evidence normalization

**Scope:** Define TypeScript schemas, evidence IDs, frame identity, source sequence, monotonic timestamp conversion, and probe/CDP clock calibration.

**Acceptance criteria:**

- every source event becomes a validated canonical envelope;
- ordering is deterministic across equal timestamps;
- clock-calibration quality contributes to coverage;
- raw source payloads cannot enter the trace repository;
- contract fixtures cover every v0.1 evidence kind.

**Dependencies:** AWT-001.

### AWT-004 — [P0] Implement ingestion-time redaction

**Scope:** Build URL, header, text, stack, and configured-secret redaction with a second defensive export pass.

**Acceptance criteria:**

- sensitive headers use discard-by-default allowlisting;
- URL credentials, fragments, sensitive query values, and configured literals are removed;
- body, input value, cookie, and WebSocket-payload fields are rejected by schema;
- known secret fixtures survive neither memory checkpoint nor persistent storage nor export;
- redaction reports affected field paths without retaining original values.

**Dependencies:** AWT-003.

### AWT-005 — [P0] Implement the session controller

**Scope:** Own attach, recording, drain, stop, interruption, and error transitions; checkpoint active state; reconcile service-worker restart; detach safely on every terminal path.

**Acceptance criteria:**

- all Section 9 state transitions have deterministic tests;
- a user stop applies the one-second drain period;
- debugger detach and tab close finalize records without silent loss;
- stale attachments are detected and reconciled after worker restart.

**Dependencies:** AWT-001.

### AWT-006 — [P0] Implement CDP target and frame orchestration

**Scope:** Attach `chrome.debugger`, negotiate the protocol, enable approved domains, track execution contexts, and recursively attach eligible out-of-process child frames using flat sessions.

**Acceptance criteria:**

- main-frame, same-process-frame, and out-of-process-frame identities are normalized;
- unsupported CDP commands degrade one capability without crashing the session;
- restricted target and competing-debugger failures use structured error codes;
- only domains approved in Section 8.3 are enabled.

**Dependencies:** AWT-005.

### AWT-007 — [P0] Build the recording control and status shell

**Scope:** Implement onboarding, permission explanation, `Trace This Tab`, `Stop`, recording badge, adapter readiness, unsupported-target messaging, and degraded-coverage state.

**Acceptance criteria:**

- the UI never shows `Recording` before the main CDP and probe adapters are ready;
- start/stop controls are tab-specific and keyboard accessible;
- unsupported and partial-coverage states are actionable;
- the panel consumes controller projections rather than deriving trace state.

**Dependencies:** AWT-001, AWT-005.

### AWT-008 — [P0] Capture page lifecycle and HTTP network evidence

**Scope:** Normalize navigation, request, response, redirect, completion, failure, size, cache/service-worker, initiator, and timing data from CDP.

**Acceptance criteria:**

- Page Trace starts on main-frame navigation;
- redirects retain one logical request with distinct hops;
- API resource types follow Section 13.1 filtering;
- request timing supports the future waterfall breakdown;
- request and response bodies are never requested or retained.

**Dependencies:** AWT-006, AWT-003, AWT-004.

### AWT-009 — [P0] Capture runtime exceptions and console errors

**Scope:** Normalize uncaught exceptions and error-level log/console evidence without remote-object graph inspection.

**Acceptance criteria:**

- error name, redacted message, safe stack location, frame, and time are recorded;
- duplicate CDP error signals are collapsed by fingerprint;
- repeated errors within 250 ms increment a count;
- console arguments and object graphs are not serialized.

**Dependencies:** AWT-006, AWT-003, AWT-004.

### AWT-010 — [P0] Capture WebSocket lifecycle and frame metadata

**Scope:** Record socket creation, handshake, errors, close, direction, opcode category, timestamp, and payload byte length.

**Acceptance criteria:**

- payload contents are discarded before normalization;
- pre-existing socket traffic defaults to background;
- sent and received frame counts appear in machine context;
- temporal proximity alone never assigns received frames to an action.

**Dependencies:** AWT-006, AWT-003, AWT-004.

### AWT-011 — [P0] Capture trusted click and submit actions

**Scope:** Build the isolated-world action observer and compact target metadata, including click-to-submit de-duplication.

**Acceptance criteria:**

- only trusted click and submit events create actions;
- click followed by related submit within 250 ms produces one trigger chain;
- values and editable content are never captured;
- labels and selector hints follow length and stability rules;
- eligible frame identity is attached to every action.

**Dependencies:** AWT-001, AWT-006, AWT-004.

### AWT-012 — [P0] Extract semantic UI evidence

**Scope:** Observe DOM changes in 50 ms batches and reduce them to visible, semantic UI evidence without retaining raw DOM or MutationRecords.

**Acceptance criteria:**

- supported visibility, accessibility-state, focus, URL/title, and geometry signals are emitted;
- hidden, extension-owned, and non-semantic mutation noise is filtered;
- raw nodes and MutationRecords are discarded after each batch;
- probe heartbeat and degraded-frame coverage are implemented;
- observer work meets the Section 23 budget on fixtures.

**Dependencies:** AWT-001, AWT-006, AWT-003, AWT-004.

### AWT-013 — [P0] Implement trace lifecycle and settlement

**Scope:** Create Page and Action Trace state machines, foreground-action boundaries, request ownership retention, quiet windows, timeout, drain, and completion reasons.

**Acceptance criteria:**

- lifecycle constants match Section 10 defaults;
- a newer action closes attribution for newly-started older-trace events;
- assigned requests retain ownership through completion;
- timeout and truncation are visible in trace coverage;
- Page and Action fixtures settle deterministically.

**Dependencies:** AWT-003.

### AWT-014 — [P0] Implement deterministic event correlation

**Scope:** Apply single-owner correlation scores, reason codes, confidence thresholds, reject rules, and trace-level confidence.

**Acceptance criteria:**

- Section 16 rules are pure, versioned, and unit-tested;
- every attributed event contains score, confidence, and reasons;
- low-confidence evidence remains background;
- rule changes require a correlation-rules version change;
- controlled fixtures achieve at least 95% precision and 90% recall.

**Dependencies:** AWT-008, AWT-009, AWT-010, AWT-011, AWT-012, AWT-013.

### AWT-015 — [P0] Separate background activity and detect polling

**Scope:** Build normalized request fingerprints, session background storage, periodic-pattern detection, and related-background projections.

**Acceptance criteria:**

- patterns require at least three occurrences and interval tolerance from Section 16.5;
- activity predating an action is not absorbed by proximity alone;
- strong structural evidence may override a background fingerprint;
- findings report factual count and interval evidence without calling polling wasteful;
- analytics, polling, and background-refresh fixtures remain separated.

**Dependencies:** AWT-008, AWT-014.

### AWT-016 — [P0] Implement findings and classification

**Scope:** Implement pure finding rules, primary-classification precedence, confidence, debugging-step templates, and special cases.

**Acceptance criteria:**

- all seven PRD classifications are covered;
- Page Traces use only their permitted classification subset;
- multiple failures preserve secondary findings;
- `HEALTHY` requires complete capture;
- successful state-changing request without UI evidence follows Section 18 conditions;
- all required Section 17 findings have fixtures.

**Dependencies:** AWT-014, AWT-015.

### AWT-017 — [P0] Implement bounded local persistence and recovery

**Scope:** Store active checkpoints in session storage, completed traces in IndexedDB, preferences locally, enforce quotas, evict safely, and provide deletion operations.

**Acceptance criteria:**

- limits and eviction order match Section 19;
- content scripts cannot read stored traces directly;
- worker restart restores or interrupts active capture deterministically;
- truncation prevents `HEALTHY` classification;
- delete-one, delete-session, and delete-all operations are tested.

**Dependencies:** AWT-005, AWT-003, AWT-013.

### AWT-018 — [P0] Implement JSON export schema v1

**Scope:** Produce the versioned `TraceExportV1`, compact machine context, stable IDs, and defensive redaction.

**Acceptance criteria:**

- exported JSON validates against checked-in schema fixtures;
- extension, schema, and correlation-rule versions are present;
- tab/device identifiers and prohibited payloads are absent;
- consumers may ignore unknown fields;
- maximum-size export completes within one second.

**Dependencies:** AWT-004, AWT-016, AWT-017.

### AWT-019 — [P0] Implement Markdown trace reports

**Scope:** Generate the required report sections and fact/inference labels from the same projection used by JSON.

**Acceptance criteria:**

- section order and filename follow Section 21;
- Markdown and JSON classifications/counts cannot diverge;
- observed, inferred, and possibly-related content are visibly distinct;
- hostile text is escaped safely;
- a second redaction pass runs before download.

**Dependencies:** AWT-018.

### AWT-020 — [P0] Build trace list, health summary, and detail UI

**Scope:** Render completed traces, health categories, classification, timeline, network, errors, UI evidence, WebSockets, findings, background activity, and export actions.

**Acceptance criteria:**

- empty categories distinguish pass, no evidence, and incomplete;
- every finding links to its supporting evidence;
- background evidence is visually distinct from attributed evidence;
- 500-event traces meet the Side Panel render budget;
- all core inspection flows are keyboard and screen-reader accessible.

**Dependencies:** AWT-007, AWT-016, AWT-017, AWT-018, AWT-019.

### AWT-021 — [P0] Harden security, performance, and accessibility

**Scope:** Execute the Section 23 and 24 controls, validate hostile-page boundaries, profile observers and UI, and close accessibility gaps.

**Acceptance criteria:**

- runtime messages validate sender, schema, and size;
- CSP, escaping, detach, and no-remote-code controls are verified;
- observer, classification, render, and export budgets pass;
- recording and trace inspection meet keyboard and screen-reader checks;
- no release-blocking privacy, correlation, or data-loss defect remains.

**Dependencies:** AWT-020, AWT-002.

### AWT-022 — [P0] Package the MVP and document limitations

**Scope:** Prepare unpacked-release instructions, privacy behavior, permission explanation, diagnostic-log workflow, supported environments, and known limitations.

**Acceptance criteria:**

- a new developer can install and complete every PRD success flow;
- documentation states what `HEALTHY` does and does not mean;
- restricted pages, competing debugger, cross-origin, shadow DOM, canvas, and WebSocket limitations are documented;
- local diagnostics contain no trace content;
- the MVP release checklist is complete.

**Dependencies:** AWT-021.

### AWT-023 — [P1] Implement the Datadog-style waterfall

**Scope:** Build the Section 6.5 waterfall using canonical evidence and request timing captured by v0.1.

**Acceptance criteria:**

- action/page, network, runtime, UI, WebSocket, and collapsed background lanes render on one time axis;
- parallel, sequential, redirected, failed, and unfinished work are distinguishable;
- waiting and download phases render where evidence exists;
- rows link to canonical evidence and correlation explanations;
- no visual claims causal dependency or critical path;
- a 500-event trace remains interactive within the UI budget.

**Dependencies:** AWT-020, AWT-002.

### AWT-024 — [P1] Implement the action sequence view

**Scope:** Render a compact evidence sequence from the same canonical timeline, including explicit missing-UI and possibly-related states.

**Acceptance criteria:**

- healthy and failure sequences match PRD examples without inventing missing steps;
- evidence order is deterministic;
- every node opens its source evidence;
- background evidence is excluded unless explicitly expanded;
- sequence and waterfall agree on timing, ownership, and status.

**Dependencies:** AWT-020, AWT-023.
