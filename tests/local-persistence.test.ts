import { describe, expect, it } from 'vitest';

import { ActiveTraceBuffer, CompletedTraceStore, storageLimits, type StoredTrace } from '../src/storage/local-persistence.js';

function trace(id: string, completedAtMs: number, overrides: Partial<StoredTrace> = {}): StoredTrace { return { traceId: id, sessionId: id.startsWith('a') ? 'session-a' : 'session-b', completedAtMs, byteSize: 10, counts: { network: 0, webSocketFrames: 0, uiEvidence: 0, canonicalEvents: 0 }, classification: 'HEALTHY', coverage: { truncated: false }, ...overrides }; }

describe('bounded local persistence', () => {
	it('evicts the oldest completed trace first for count and byte quotas', () => {
		const store = new CompletedTraceStore();
		for (let index = 0; index <= storageLimits.completedTraces; index += 1) store.save(trace(`trace-${index}`, index));
		expect(store.list()).toHaveLength(storageLimits.completedTraces);
		expect(store.list()[0].traceId).toBe('trace-1');
		const bytes = new CompletedTraceStore(); bytes.save(trace('old', 0, { byteSize: storageLimits.totalBytes })); bytes.save(trace('new', 1, { byteSize: 1 }));
		expect(bytes.list().map((item) => item.traceId)).toEqual(['new']);
	});

	it('marks over-limit traces truncated and prevents a HEALTHY classification', () => {
		const stored = new CompletedTraceStore().save(trace('trace', 0, { counts: { network: storageLimits.networkRecords + 1, webSocketFrames: 0, uiEvidence: 0, canonicalEvents: 0 } }));
		expect(stored).toMatchObject({ coverage: { truncated: true }, classification: 'UNKNOWN' });
	});

	it('aggregates repeated active evidence before truncating a bounded buffer', () => {
		const buffer = new ActiveTraceBuffer();
		expect(buffer.append('same')).toMatchObject({ accepted: true, aggregated: false });
		expect(buffer.append('same')).toMatchObject({ accepted: true, aggregated: true });
		for (let index = 0; index < storageLimits.canonicalEvents; index += 1) buffer.append(`event-${index}`);
		expect(buffer.append('overflow')).toEqual({ accepted: false, aggregated: false, truncated: true });
	});

	it('deletes one trace, one session, or all completed local data immediately', () => {
		const store = new CompletedTraceStore(); store.save(trace('a-one', 0)); store.save(trace('a-two', 1)); store.save(trace('b-one', 2));
		store.deleteTrace('a-one'); expect(store.list().map((item) => item.traceId)).toEqual(['a-two', 'b-one']);
		store.deleteSession('session-a'); expect(store.list().map((item) => item.traceId)).toEqual(['b-one']);
		store.deleteAll(); expect(store.list()).toEqual([]);
	});
});
