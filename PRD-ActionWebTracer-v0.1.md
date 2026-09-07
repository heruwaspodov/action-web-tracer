# PRD — ActionWebTracer

**Status:** Draft v0.1  
**Product:** ActionWebTracer  
**Repository:** `action-web-tracer`  
**Primary Platform:** Chrome Extension  
**Primary Users:** Frontend engineers, full-stack engineers, QA engineers, and software engineers debugging web applications

## 1. Product Overview

ActionWebTracer is a browser extension that traces what actually happens after a user performs an action on a web application.

Its core question is:

> **What happened after I clicked this?**

Instead of forcing developers to manually correlate DevTools Network, Console, Elements, and Performance data, ActionWebTracer groups browser signals into a single action-centered trace.

```text
User action
→ JavaScript/runtime behavior
→ API requests
→ API responses
→ DOM/UI changes
→ performance signals
→ result classification
```

The experience should feel like a lightweight Datadog/APM trace centered on frontend interactions rather than backend services.

## 2. Problem Statement

When a UI interaction fails or behaves strangely, developers usually need to investigate several surfaces manually:

```text
User clicks Save
↓
Did the event handler run?
↓
Was an API request sent?
↓
What did the API return?
↓
Did JavaScript throw?
↓
Did the UI update?
↓
Was the action slow?
↓
Were duplicate requests triggered?
```

Today, this requires manually correlating Network, Console, Elements, Performance, and sometimes backend logs.

ActionWebTracer should collapse this into one trace:

```text
Click Save
↓
PATCH /users/123
↓
200 OK
↓
No UI change

Classification:
UI_SYNC_FAILURE
```

## 3. Product Goal

Allow a developer to understand the effect of one browser interaction in seconds.

For every traced action, the user should quickly see:

- what action happened;
- which API requests were triggered;
- API status and timing;
- JavaScript/runtime errors;
- whether the page visibly changed;
- whether the interaction appears healthy;
- suspicious API/network behavior;
- an exportable report for other tools or AI agents.

## 4. Non-Goals

The initial product is **not** intended to be:

- a generic AI browser assistant;
- a Playwright replacement;
- a browser automation platform;
- a Selenium alternative;
- a session replay product;
- a full frontend APM SaaS;
- a backend distributed tracing platform;
- a coding agent;
- an autonomous QA agent;
- a cloud logging service;
- a JavaScript timer profiler that identifies exact `setInterval()` call sites.

## 5. Target Users

### Primary Persona — Software Engineer

Typical workflow:

```text
Develop feature
↓
open localhost/staging
↓
click UI
↓
something behaves strangely
↓
inspect DevTools
```

Pain points:

- repeatedly switching Network/Console/Elements;
- manually identifying which request came from which interaction;
- API returns success but UI does not update;
- unclear whether a failure is frontend or backend;
- duplicate or slow API calls are easy to miss.

### Secondary Persona — QA Engineer

Typical workflow:

```text
Test feature
↓
interaction fails
↓
report bug
↓
developer asks for request/response/console details
```

ActionWebTracer should produce a technical report without requiring manual DevTools collection.

## 6. Core Product Concept

ActionWebTracer has two primary trace types:

```text
Page Trace
Action Trace
```

## Page Trace

Created for:

```text
initial page load
reload
```

A Page Trace captures the loading behavior of the current page, including network requests, runtime errors, WebSocket connections, DOM changes, and background request patterns.

## Action Trace

Created for meaningful user interactions such as:

```text
click
submit
```

Both trace types share the same evidence model and timeline.


## Session Background Activity

Some browser activity may not belong to a specific trace.

Examples:

```text
polling
WebSocket messages
analytics
background refresh requests
```

ActionWebTracer should keep these as **session/background activity** unless there is strong evidence that they were triggered by a specific Page Trace or Action Trace.

This distinction is important for correlation accuracy.


Healthy example:

```text
Action: Click "Save Changes"

0 ms      Click
18 ms     submit handler
42 ms     PATCH /api/users/123
391 ms    200 OK
420 ms    DOM mutation
451 ms    success toast visible

✅ HEALTHY
Total duration: 451 ms
```

Failure example:

```text
Action: Click "Save Changes"

0 ms      Click
31 ms     PATCH /api/users/123
402 ms    200 OK
900 ms    Trace completed

No meaningful DOM change detected.

⚠ UI_SYNC_FAILURE
```

## 7. Product Principles

### Action First
The unit of debugging is a **user action**, not a request or log entry.

### Evidence Before Guessing
Findings must be grounded in observed browser evidence.

Bad:

```text
The frontend is inefficient.
```

Good:

```text
GET /feature_flags executed 4 times within 510 ms.
```

### Deterministic Before AI
The core product must work without an LLM. AI is optional and only enhances explanation, debugging guidance, issue creation, or coding-agent handoff.

### Local First
For MVP, captured debugging data remains inside the user's browser unless explicitly exported or sent to an external provider.

### Portable Output
Every completed trace must be exportable as Markdown and JSON.

## 8. MVP Scope — P0

### Trace Current Tab
User explicitly starts tracing the active tab.

### Capture User Action
Initial actions:

```text
click
submit
```

Store compact target metadata such as tag, role, visible label, id, and selector hint.

### Capture API / Network Activity
For requests associated with the action, capture:

- method;
- URL;
- status;
- duration;
- response type;
- response size where available;
- useful initiator metadata.

Ignore static assets by default.

### Capture Runtime Errors
Capture JavaScript exceptions, uncaught errors, and console errors.

### Detect UI / DOM Changes
Detect whether the page meaningfully changed after the action. Do not store the full DOM.

### Basic Classification
Initial classifications:

```text
HEALTHY
FRONTEND_FAILURE
API_FAILURE
SERVER_FAILURE
UI_SYNC_FAILURE
SILENT_FAILURE
UNKNOWN
```

### Trace Detail View
Display:

```text
action
network
response status
console/runtime errors
UI update state
timing
classification
findings
```

### Markdown Report
Every trace can be exported as `.md` for humans and external tools such as Claude Code, Codex, Cursor, Aider, Cline, Roo, GitHub Issues, Jira, CI, and custom agents.

### JSON Report
Structured export for machine integrations.

## 9. P1 — Datadog-Style Waterfall

Visualize events over time:

```text
0ms      100      200      300      400      500

Click
██

PATCH /users
   █████████████████

GET /permissions
     ███████

DOM update
                       ████
```

The waterfall should reveal parallel requests, sequential requests, slow requests, render delay, and timing gaps.

## 10. P1 — Sequence View

Healthy:

```text
Click Save
  ↓
PATCH /users
  ↓
200 OK
  ↓
DOM mutation
  ↓
Toast visible
```

Failure:

```text
Click Save
  ↓
PATCH /users
  ↓
200 OK
  ↓
❌ no visible UI update
```

## 11. P1 — Frontend API Smell Detector

ActionWebTracer should analyze network behavior associated with an action.

### Duplicate Requests

```text
GET /feature_flags
GET /feature_flags
GET /feature_flags
```

Finding:

```text
⚠ GET /feature_flags was requested 3 times within 420 ms.
```

### Slow Request

```text
GET /dashboard
3.2 seconds
```

Finding:

```text
⚠ Slow request: 3.2 s
```

### Retry Storm

```text
POST /rates → 500
POST /rates → 500
POST /rates → 500
POST /rates → 500
```

Finding:

```text
⚠ 4 retries occurred within 2 seconds.
```

### Large Payload

```text
GET /customers
4.8 MB
```

Finding:

```text
⚠ Large API response payload.
```

### Possible Missing Debounce

```text
GET /search?q=J
GET /search?q=Jo
GET /search?q=Joh
GET /search?q=John
```

Finding:

```text
⚠ Requests appear to fire on every keystroke.
Possible missing or ineffective debounce.
```

### Request Waterfall

```text
GET /profile
    ↓
GET /team
    ↓
GET /projects
```

Finding:

```text
⚠ Possible sequential request waterfall.
```

## 12. Silent Failure Detection

Silent failure detection is a core capability.

### Scenario A — JavaScript failure

```text
Click
↓
TypeError
↓
No request
```

Classification: `FRONTEND_FAILURE`

### Scenario B — API rejected

```text
Click
↓
POST /users
↓
422
↓
No visible validation error
```

Classification: `API_FAILURE`

Additional finding: possible silent error-handling failure.

### Scenario C — API successful but UI stale

```text
Click
↓
PATCH /users
↓
200
↓
No visible UI update
```

Classification: `UI_SYNC_FAILURE`

### Scenario D — No observable result

```text
Click
↓
nothing
```

Classification: `SILENT_FAILURE`

## 13. Action Health Summary

Example:

```text
Save Changes

Interaction     ✅
JavaScript      ✅
API             ✅
UI Evidence     ❌
Performance     ✅

Overall:
⚠ PARTIALLY WORKING

Classification:
UI_SYNC_FAILURE
```

## 14. Critical Path — Later P1/P2

ActionWebTracer should eventually estimate which events contribute most to user-visible latency.

```text
Click
↓
GET /permissions     240 ms
↓
GET /projects        380 ms
↓
DOM render           170 ms

Possible critical path:
790 ms
```

Because browser evidence may not prove true dependency, use cautious language:

```text
Possible sequential dependency
Possible critical path
Potential parallelization opportunity
```

## 15. Report Requirements

Markdown export is a first-class feature.

Suggested filename:

```text
action-web-tracer-2026-09-04-save-changes.md
```

Required sections:

```text
YAML front matter
Summary
Action
Timeline
Network
Console
UI Evidence
Findings
API Smells
Suggested Debugging Steps
Machine Context
```

Example front matter:

```yaml
action_web_tracer_version: 1
trace_id: awt_01...
status: UI_SYNC_FAILURE
url: https://staging.example.com/users/123/edit
duration_ms: 472
```

Machine context example:

```json
{
  "classification": "UI_SYNC_FAILURE",
  "request_count": 1,
  "failed_request_count": 0,
  "console_error_count": 0,
  "meaningful_dom_mutation": false
}
```

## 16. AI / External Tool Integration

AI is optional.

Future action:

```text
Explain with AI
```

Provider direction:

```text
OpenAI-compatible
Anthropic
OpenRouter
Ollama
custom compatible endpoint
```

Prefer BYOK.

Potential AI jobs:

- explain failure;
- suggest likely source area;
- create bug report;
- create debugging checklist;
- generate Playwright reproduction draft;
- hand trace to coding agent.

## 17. Security & Privacy

ActionWebTracer can observe sensitive application data.

Default redaction must cover:

```text
Authorization
Cookie
Set-Cookie
API keys
access tokens
refresh tokens
passwords
credit-card fields
configured secrets
```

The extension must not silently upload browser data.

Data may leave the browser only when the user explicitly exports it or explicitly invokes an external AI/integration.

## 18. Permissions UX

Preferred model:

```text
Open website
↓
Open ActionWebTracer
↓
Click "Trace This Tab"
↓
debugger attaches
↓
Recording indicator appears
```

Always show:

```text
● Recording
```

User must be able to stop tracing explicitly.

Avoid unnecessary permanent access to every website.

## 19. UX Concept

```text
┌────────────────────────────────────┐
│ ActionWebTracer                    │
│ ● Recording                        │
├────────────────────────────────────┤
│ ✓ Save Changes            472 ms   │
│ ⚠ Search "john"            1.2 s   │
│ ✕ Checkout                 830 ms  │
├────────────────────────────────────┤
│ Save Changes                       │
│                                    │
│ API        ✅                       │
│ UI         ❌                       │
│ Console    ✅                       │
│                                    │
│ UI_SYNC_FAILURE                    │
│                                    │
│ [Waterfall] [Sequence] [Network]   │
│                                    │
│ ⚠ API succeeded but the UI did not│
│   visibly update.                  │
│                                    │
│ [Export .md] [Export JSON]         │
└────────────────────────────────────┘
```

## 20. Success Metrics

MVP is validated if a developer can:

```text
1. Install the extension locally.
2. Trace the current tab.
3. Reload/open a page and receive a Page Trace.
4. Click or submit a UI action and receive an Action Trace.
5. See associated HTTP/API requests.
6. See response status and timing.
7. See JavaScript errors.
8. See meaningful UI evidence rather than raw DOM mutations.
9. See WebSocket activity when present.
10. See repeating/polling request patterns when present.
11. Receive a useful failure classification.
12. Export the result as Markdown.
```

Most important technical quality metric:

> **Correlation accuracy.**

## 21. Key Product Risk

The hardest technical problem is determining which browser events were actually caused by the user action.

Example ambiguity:

```text
User clicks Save

At the same time:
- background polling fires;
- analytics request fires;
- WebSocket receives data;
- Save API request fires.
```

Initial correlation may use:

```text
timestamp proximity
same tab/frame
request initiator
navigation relationship
network settling
DOM timing
known-noise filtering
```

This must be validated early.

## 22. MVP Release

### v0.1 — What happened after my click?

Required:

```text
Chrome extension
Trace current tab
Page load / reload trace
Click capture
Submit capture
HTTP/network correlation
Response status
Request duration
Console/runtime errors
UI evidence extraction from DOM observation
WebSocket lifecycle + frames
Repeating/polling request detection
Background activity separation
Basic classification
Trace detail
Markdown export
JSON export
Secret redaction
```

Not required:

```text
AI
waterfall
critical path
Playwright generation
cloud backend
accounts
billing
team collaboration
```

## 23. Future Roadmap

### v0.2

```text
Waterfall
Sequence
Improved action correlation
```

### v0.3

```text
Duplicate request detector
Slow request detector
Retry storm
Missing debounce
Large payload
Request waterfall
```

### v0.4

```text
Critical-path heuristics
Before/after trace comparison
```

### v0.5

```text
AI explanation
BYOK multi-provider support
AI-oriented report export
```

### Future

```text
Trace → coding agent → fix → replay → verify
```

## 24. Product Differentiator

ActionWebTracer should not compete as another AI browser agent.

Its strongest positioning is:

> **Action-centered frontend observability.**

Traditional debugging surfaces are organized around:

```text
requests
logs
DOM
pages
sessions
```

ActionWebTracer organizes them around:

```text
what the user just did
```

That is the central product idea.

## 25. Product Tagline

Primary:

> **Trace every web action from click → API → UI.**

Alternative:

> **See what every user action actually did.**

Debugging-oriented:

> **Why did this click fail?**

## 26. Definition of Product Ready for RFC

The PRD is ready to move into RFC when these decisions are accepted:

```text
[ ] Product name: ActionWebTracer
[ ] Primary platform: Chrome Extension
[ ] Primary user: software engineer
[ ] Action-centered trace is the core model
[ ] MVP works without AI
[ ] page load/reload + click + submit are initial trace triggers
[ ] Network + console + DOM observation + WebSocket are initial evidence sources
[ ] Raw DOM mutations are not shown by default; UI Evidence is the user-facing model
[ ] repeating/polling request detection is included in MVP
[ ] background activity can be separated from action-related activity
[ ] Markdown + JSON are required exports
[ ] API smell detection belongs inside the product
[ ] Datadog-style waterfall is P1
[ ] Correlation accuracy is the highest technical risk
[ ] No backend/cloud service in v0.1
```

Once accepted, the RFC should define the technical architecture and implementation details without redefining product scope.
