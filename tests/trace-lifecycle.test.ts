import { describe, expect, it } from 'vitest';

import { ACTION_INITIAL_WINDOW_MS, ACTION_MAX_DURATION_MS, NETWORK_IDLE_MS, PAGE_MAX_DURATION_MS, STOP_DRAIN_MS, TraceLifecycle, UI_IDLE_MS } from '../src/engine/lifecycle/trace-lifecycle.js';

function setup() { let index = 0; return new TraceLifecycle(() => `trace-${++index}`); }

describe('trace lifecycle', () => {
	it('uses the RFC Section 10 lifecycle constants', () => {
		expect({ ACTION_INITIAL_WINDOW_MS, NETWORK_IDLE_MS, UI_IDLE_MS, ACTION_MAX_DURATION_MS, PAGE_MAX_DURATION_MS, STOP_DRAIN_MS }).toEqual({ ACTION_INITIAL_WINDOW_MS: 2_000, NETWORK_IDLE_MS: 500, UI_IDLE_MS: 300, ACTION_MAX_DURATION_MS: 10_000, PAGE_MAX_DURATION_MS: 15_000, STOP_DRAIN_MS: 1_000 });
	});

	it('settles an action only after its initial, network-idle, and UI-idle windows', () => {
		const lifecycle = setup(); const action = lifecycle.startAction('click', 0);
		lifecycle.assignRequestStart('request-1', 100);
		lifecycle.requestCompleted('request-1', 1_700);
		lifecycle.observeUiEvidence(1_750);
		lifecycle.tick(1_999);
		expect(lifecycle.traces[0].completionReason).toBeUndefined();
		lifecycle.tick(2_250);
		expect(lifecycle.traces[0]).toMatchObject({ traceId: action.traceId, completionReason: 'settled', coverage: { timedOut: false, truncated: false } });
	});

	it('closes prior action attribution but retains ownership through request completion', () => {
		const lifecycle = setup(); const first = lifecycle.startAction('click', 0);
		expect(lifecycle.assignRequestStart('request-1', 10)).toBe(first.traceId);
		const second = lifecycle.startAction('submit', 100);
		expect(lifecycle.assignRequestStart('request-2', 110)).toBe(second.traceId);
		expect(lifecycle.requestCompleted('request-1', 200)).toBe(first.traceId);
		expect(lifecycle.traces.find((trace) => trace.traceId === first.traceId)?.acceptingNewEvents).toBe(false);
	});

	it('settles a page only after main-frame load and deterministic quiet windows', () => {
		const lifecycle = setup(); const page = lifecycle.startPage(0);
		lifecycle.tick(5_000);
		expect(lifecycle.traces[0].completionReason).toBeUndefined();
		lifecycle.markPageLoaded(page.traceId, 5_000);
		lifecycle.observeUiEvidence(5_100);
		lifecycle.tick(5_499);
		expect(lifecycle.traces[0].completionReason).toBeUndefined();
		lifecycle.tick(5_500);
		expect(lifecycle.traces[0].completionReason).toBe('settled');
	});

	it('exposes timeout and drain truncation in coverage', () => {
		const timedOut = setup(); timedOut.startAction('click', 0); timedOut.assignRequestStart('never-finishes', 1);
		timedOut.tick(ACTION_MAX_DURATION_MS);
		expect(timedOut.traces[0]).toMatchObject({ completionReason: 'timed_out', coverage: { timedOut: true, truncated: false } });

		const drained = setup(); drained.startPage(0); drained.beginDrain(100); drained.tick(100 + STOP_DRAIN_MS);
		expect(drained.traces[0]).toMatchObject({ completionReason: 'truncated', coverage: { timedOut: false, truncated: true } });
	});
});
