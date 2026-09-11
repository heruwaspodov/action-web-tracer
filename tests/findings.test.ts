import { describe, expect, it } from 'vitest';

import { evaluateTrace, type Classification, type TraceAssessment } from '../src/engine/findings/evaluate.js';

function assessment(overrides: Partial<TraceAssessment> = {}): TraceAssessment { return { type: 'action', coverageComplete: true, ...overrides }; }
function codes(input: TraceAssessment): readonly string[] { return evaluateTrace(input).findings.map((finding) => finding.code); }

describe('findings and classification', () => {
	it('covers all seven PRD classifications with RFC precedence', () => {
		const scenarios: readonly [Classification, TraceAssessment][] = [
			['UNKNOWN', assessment({ coverageComplete: false })], ['FRONTEND_FAILURE', assessment({ runtimeExceptionIds: ['exception'] })],
			['SERVER_FAILURE', assessment({ requests: [{ evidenceId: '500', method: 'GET', status: 500, confidence: 'high' }] })],
			['API_FAILURE', assessment({ requests: [{ evidenceId: '422', method: 'POST', status: 422, confidence: 'high' }] })],
			['UI_SYNC_FAILURE', assessment({ requests: [{ evidenceId: 'patch', method: 'PATCH', status: 200, confidence: 'medium' }] })],
			['SILENT_FAILURE', assessment()], ['HEALTHY', assessment({ navigationEvidenceIds: ['navigation'] })],
		];
		for (const [expected, input] of scenarios) expect(evaluateTrace(input).classification).toBe(expected);
	});

	it('preserves secondary failures and visible error handling findings', () => {
		const result = evaluateTrace(assessment({ runtimeExceptionIds: ['exception'], visibleErrorUi: true, meaningfulUiEvidenceIds: ['error-ui'], requests: [{ evidenceId: '500', method: 'POST', status: 500, confidence: 'high' }, { evidenceId: '422', method: 'POST', status: 422, confidence: 'high', failed: true }] }));
		expect(result.classification).toBe('FRONTEND_FAILURE');
		expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(['uncaught_exception', 'http_5xx', 'http_4xx', 'network_failure', 'visible_error_handling']));
	});

	it('limits page traces to their permitted classifications and never marks incomplete capture healthy', () => {
		expect(evaluateTrace(assessment({ type: 'page', requests: [{ evidenceId: 'post', method: 'POST', status: 200, confidence: 'high' }] })).classification).toBe('HEALTHY');
		expect(evaluateTrace(assessment({ type: 'page' })).classification).toBe('HEALTHY');
		expect(evaluateTrace(assessment({ navigationEvidenceIds: ['navigation'], truncated: true })).classification).toBe('UNKNOWN');
	});

	it('requires a qualifying state-changing request before reporting UI sync failure', () => {
		expect(codes(assessment({ requests: [{ evidenceId: 'get', method: 'GET', status: 200, confidence: 'high' }] }))).not.toContain('state_change_without_ui');
		expect(codes(assessment({ requests: [{ evidenceId: 'low', method: 'POST', status: 200, confidence: 'low' }] }))).not.toContain('state_change_without_ui');
		expect(codes(assessment({ requests: [{ evidenceId: 'navigate', method: 'POST', status: 200, confidence: 'high' }], navigationEvidenceIds: ['nav'] }))).not.toContain('state_change_without_ui');
	});

	it('has fixtures for every required RFC Section 17 finding', () => {
		const allCodes = new Set([...codes(assessment({ coverageComplete: false, runtimeExceptionIds: ['exception'], consoleErrorIds: ['console'], requests: [{ evidenceId: '500', method: 'POST', status: 500, confidence: 'high' }, { evidenceId: '422', method: 'POST', status: 422, confidence: 'high', failed: true }, { evidenceId: 'patch', method: 'PATCH', status: 200, confidence: 'high' }], periodicBackgroundEvidenceIds: ['poll'], relatedBackgroundEvidenceIds: ['related'] })), ...codes(assessment())]);
		expect([...allCodes]).toEqual(expect.arrayContaining(['uncaught_exception', 'console_error', 'http_4xx', 'http_5xx', 'network_failure', 'state_change_without_ui', 'rejected_request_without_visible_error', 'no_observable_result', 'incomplete_capture', 'periodic_background_activity', 'related_background_evidence']));
		for (const finding of evaluateTrace(assessment({ runtimeExceptionIds: ['exception'] })).findings) expect(finding.debuggingSteps.length).toBeGreaterThan(0);
	});
});
