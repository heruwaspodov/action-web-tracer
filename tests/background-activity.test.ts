import { describe, expect, it } from 'vitest';

import { MIN_PERIODIC_OCCURRENCES, PERIODIC_INTERVAL_TOLERANCE, BackgroundActivityStore, detectPeriodicPattern, requestFingerprint, type RequestObservation } from '../src/engine/background/activity.js';

function observation(requestId: string, timestampMs: number, url = 'https://fixture.test/api/jobs/42?cursor=secret&page=2', method = 'GET'): RequestObservation { return { requestId, timestampMs, url, method }; }

describe('background activity', () => {
	it('normalizes volatile path segments and query values without retaining them', () => {
		const fingerprint = requestFingerprint('get', 'https://fixture.test/api/jobs/123e4567-e89b-12d3-a456-426614174000?token=secret&page=2#fragment');
		expect(fingerprint).toBe('GET /api/jobs/:id?page&token');
		expect(fingerprint).not.toContain('secret');
		expect(fingerprint).not.toContain('fragment');
	});

	it('requires three occurrences within the RFC median interval tolerance', () => {
		expect(detectPeriodicPattern([observation('one', 0), observation('two', 1_000)], 2_000)).toBeUndefined();
		const pattern = detectPeriodicPattern([observation('one', 0), observation('two', 1_000), observation('three', 2_150)], 2_200);
		expect(pattern).toMatchObject({ requestIds: ['one', 'two', 'three'], medianIntervalMs: 1_075, intervalTolerance: PERIODIC_INTERVAL_TOLERANCE, predatesAction: true });
		expect(MIN_PERIODIC_OCCURRENCES).toBe(3);
		expect(detectPeriodicPattern([observation('one', 0), observation('two', 1_000), observation('three', 1_500)], 2_000)).toBeUndefined();
	});

	it('keeps predating periodic activity background unless structural evidence is strong', () => {
		const store = new BackgroundActivityStore();
		for (const [id, at] of [['one', 0], ['two', 1_000], ['three', 2_000]] as const) store.record(observation(id, at));
		const fingerprint = requestFingerprint('GET', 'https://fixture.test/api/jobs/99?cursor=other&page=100');
		expect(store.classify(fingerprint, 1_500, 3)).toBe('background');
		expect(store.classify(fingerprint, 1_500, 5)).toBe('eligible_for_trace');
		expect(store.findings(1_500)).toEqual([{ code: 'periodic_background_activity', fingerprint, occurrenceCount: 3, medianIntervalMs: 1_000, intervalTolerance: PERIODIC_INTERVAL_TOLERANCE }]);
	});

	it('keeps analytics, polling, and refresh activity in separate projections', () => {
		const store = new BackgroundActivityStore();
		for (const [prefix, url] of [['poll', 'https://fixture.test/api/poll'], ['analytics', 'https://fixture.test/analytics/events'], ['refresh', 'https://fixture.test/api/refresh']] as const) {
			for (const [index, at] of [0, 1_000, 2_000].entries()) store.record(observation(`${prefix}-${index}`, at, url, prefix === 'analytics' ? 'POST' : 'GET'));
		}
		expect(store.patterns(1_500).map((pattern) => pattern.fingerprint)).toEqual(['GET /api/poll', 'POST /analytics/events', 'GET /api/refresh']);
	});
});
