import { describe, expect, it } from 'vitest';

import { CORRELATION_RULES_VERSION, DeterministicCorrelator, correlateEvent, correlationRules, scoreCorrelation, traceCorrelationConfidence, validateCorrelationRules, type CorrelationEvent, type CorrelationTrace } from '../src/engine/correlation/correlate.js';
import { benchmarkThresholds, evaluateBenchmark, type OwnershipResult } from '../test-fixtures/benchmark.js';

const trace: CorrelationTrace = { traceId: 'trace-1', startedAtMs: 1_000, frameId: 'main' };
function event(overrides: Partial<CorrelationEvent> = {}): CorrelationEvent { return { evidenceId: 'evidence-1', kind: 'request', timestampMs: 1_100, frameId: 'main', ...overrides }; }

describe('deterministic event correlation', () => {
	it('uses versioned RFC weights and provides reproducible attribution reasons', () => {
		expect(CORRELATION_RULES_VERSION).toBe(1);
		expect(scoreCorrelation(event({ hasUserGesture: true }), trace)).toEqual({ owner: { type: 'trace', traceId: 'trace-1' }, confidence: 'high', score: 9, reasons: ['user_gesture', 'request_near_action', 'same_frame'] });
		expect(() => validateCorrelationRules({ ...correlationRules, requestNearAction: 4 })).toThrow('version change');
	});

	it('keeps low-confidence, pre-trace, later-action, periodic, and temporal WebSocket receive evidence in background', () => {
		expect(scoreCorrelation(event({ timestampMs: 999 }), trace).reasons).toEqual(['before_trace_start']);
		expect(scoreCorrelation(event({ timestampMs: 1_300 }), { ...trace, closedForNewEventsAtMs: 1_250 }).reasons).toEqual(['newer_foreground_action']);
		expect(scoreCorrelation(event({ periodicBackground: true }), trace).owner).toEqual({ type: 'background' });
		expect(scoreCorrelation(event({ kind: 'websocket_receive' }), trace).reasons).toEqual(['websocket_receive_temporal_only']);
	});

	it('selects one owner deterministically and preserves request ownership through completion', () => {
		const traces = [trace, { traceId: 'trace-2', startedAtMs: 1_050, frameId: 'main' }];
		expect(correlateEvent(event({ hasUserGesture: true }), traces).owner).toEqual({ type: 'trace', traceId: 'trace-1' });
		const correlator = new DeterministicCorrelator();
		const started = correlator.correlate(event({ requestId: 'request-1', requestPhase: 'started', hasUserGesture: true }), [trace]);
		const finished = correlator.correlate(event({ requestId: 'request-1', requestPhase: 'finished', timestampMs: 9_000 }), []);
		expect(finished).toMatchObject({ owner: started.owner, confidence: started.confidence, score: started.score });
		expect(finished.reasons).toContain('request_owner_inherited');
	});

	it('derives trace confidence from the lowest coverage or assignment confidence', () => {
		expect(traceCorrelationConfidence(['high', 'medium', 'high'])).toBe('medium');
		expect(traceCorrelationConfidence(['high', 'low'])).toBe('low');
	});

	it('meets the precision and recall fixture thresholds with controlled outcomes', () => {
		const cases: readonly [string, 'trace' | 'background', CorrelationEvent][] = [
			['gesture', 'trace', event({ hasUserGesture: true })], ['navigation', 'trace', event({ kind: 'navigation', navigationFromAction: true })],
			['ui', 'trace', event({ kind: 'ui', nearActionTarget: true })], ['runtime', 'trace', event({ kind: 'runtime' })],
			['poll', 'background', event({ periodicBackground: true })], ['receive', 'background', event({ kind: 'websocket_receive' })],
		];
		const results: OwnershipResult[] = cases.map(([evidenceId, expected, input]) => ({ evidenceId, expected, actual: correlateEvent(input, [trace]).owner.type === 'trace' ? 'trace' : 'background', reasons: ['controlled-correlation'] }));
		const report = evaluateBenchmark(results);
		expect(report.precision).toBeGreaterThanOrEqual(benchmarkThresholds.precision);
		expect(report.recall).toBeGreaterThanOrEqual(benchmarkThresholds.recall);
		expect(report.passes).toBe(true);
	});
});
