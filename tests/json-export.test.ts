import { describe, expect, it } from 'vitest';

import { createTraceExport, validateTraceExportV1, type TraceExportInput } from '../src/export/json-export.js';

function input(): TraceExportInput { return { actionWebTracerVersion: '0.1.0', trace: { traceId: 'trace-1', type: 'action', startedAt: '2026-01-01T00:00:00.000Z', durationMs: 42, url: 'https://fixture.test/api?token=secret', classification: 'HEALTHY', classificationConfidence: 'high', coverage: {}, timeline: [{ kind: 'action.click', tabId: 7, payloadData: 'never' }], network: [], errors: [], uiEvidence: [], websocket: [], findings: [], machineContext: { requestCount: 0, deviceId: 'laptop' } } }; }

describe('TraceExportV1', () => {
	it('matches the checked-in v1 contract and includes all version fields', () => {
		const exported = createTraceExport(input());
		expect(validateTraceExportV1(exported)).toBe(true);
		expect(exported).toMatchObject({ actionWebTracerVersion: '0.1.0', schemaVersion: 1, correlationRulesVersion: 1, trace: { traceId: 'trace-1', type: 'action' } });
	});
	it('omits tab/device/prohibited payload data and applies defensive URL redaction', () => {
		const text = JSON.stringify(createTraceExport(input()));
		for (const secret of ['tabId', 'deviceId', 'payloadData', 'secret']) expect(text).not.toContain(secret);
		expect(text).toContain('%5BREDACTED%5D');
	});
	it('permits unknown fields for forward-compatible consumers', () => {
		const exported = { ...createTraceExport(input()), futureField: { allowed: true } };
		expect(validateTraceExportV1(exported)).toBe(true);
	});
	it('exports maximum fixture-sized data within one second', () => {
		const fixture = input(); const maximum: TraceExportInput = { ...fixture, trace: { ...fixture.trace, timeline: Array.from({ length: 5_000 }, (_, index) => ({ id: index, kind: 'safe' })) } };
		const started = performance.now(); const exported = createTraceExport(maximum); const elapsed = performance.now() - started;
		expect(validateTraceExportV1(exported)).toBe(true); expect(elapsed).toBeLessThan(1_000);
	});
});
