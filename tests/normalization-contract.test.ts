import { describe, expect, it } from 'vitest';

import { calibrateClocks } from '../src/engine/normalize/clock.js';
import { compareEvidence, normalizeSourceEvent } from '../src/engine/normalize/evidence.js';
import { evidenceKinds, type EvidenceKind, type EvidenceSource, type RawSourceEvent } from '../src/model/evidence.js';
import { TraceRepository } from '../src/storage/trace-repository.js';

const calibration = calibrateClocks({
	sessionStartedCdpSeconds: 10,
	cdpHandshakeSeconds: 12,
	probeEpochMilliseconds: 1_700_000_000_000,
	roundTripMilliseconds: 2,
});

const sourceForKind: Readonly<Record<EvidenceKind, EvidenceSource>> = {
	'action.click': 'probe',
	'action.submit': 'probe',
	'network.request_started': 'cdp',
	'network.response_received': 'cdp',
	'network.request_finished': 'cdp',
	'network.request_failed': 'cdp',
	'runtime.exception': 'cdp',
	'console.error': 'cdp',
	'ui.change': 'probe',
	'page.navigation': 'cdp',
	'page.lifecycle': 'cdp',
	'websocket.created': 'cdp',
	'websocket.closed': 'cdp',
	'websocket.frame_sent': 'cdp',
	'websocket.frame_received': 'cdp',
	'capture.coverage_changed': 'probe',
};

function contractEvent(kind: EvidenceKind, sourceSequence: number): RawSourceEvent {
	const source = sourceForKind[kind];
	return {
		sessionId: 'session-1',
		source,
		sourceSequence,
		kind,
		timestamp: source === 'probe' ? 1_700_000_000_002 : 12,
		frame: { frameId: 'frame-1', isMainFrame: true, urlOrigin: 'https://fixture.test' },
		payload: { fixtureKind: kind, status: 'safe metadata only' },
	};
}

describe('canonical evidence normalization', () => {
	it('normalizes a contract fixture for every v0.1 evidence kind', () => {
		const normalized = evidenceKinds.map((kind, index) => normalizeSourceEvent(contractEvent(kind, index), calibration).event);

		expect(normalized.map((event) => event.kind)).toEqual(evidenceKinds);
		for (const event of normalized) {
			expect(event.evidenceId).toBe(`session-1:${event.source}:${event.sourceSequence}`);
			expect(event.frame).toEqual({ frameId: 'frame-1', isMainFrame: true, urlOrigin: 'https://fixture.test' });
			expect(event.redaction).toEqual({ applied: false, fields: [] });
		}
	});

	it('orders equal timestamps by source sequence, independent of wall-clock text', () => {
		const later = normalizeSourceEvent({ ...contractEvent('network.request_started', 2), wallTime: '2099-01-01T00:00:00Z' }, calibration).event;
		const earlier = normalizeSourceEvent({ ...contractEvent('network.response_received', 1), wallTime: '2000-01-01T00:00:00Z' }, calibration).event;

		expect([later, earlier].sort(compareEvidence)).toEqual([earlier, later]);
	});

	it('contributes clock calibration quality to coverage', () => {
		const degradedCalibration = calibrateClocks({
			sessionStartedCdpSeconds: 10,
			cdpHandshakeSeconds: 12,
			probeEpochMilliseconds: 1_700_000_000_000,
			roundTripMilliseconds: 30,
		});

		expect(normalizeSourceEvent(contractEvent('action.click', 1), calibration).coverage).toEqual({ clockCalibration: 'high', complete: true });
		expect(normalizeSourceEvent(contractEvent('action.click', 1), degradedCalibration).coverage).toEqual({ clockCalibration: 'low', complete: false });
	});

	it('rejects raw sensitive payload fields and prevents raw events entering the repository', () => {
		expect(() => normalizeSourceEvent({ ...contractEvent('network.request_started', 1), payload: { body: 'never persist' } }, calibration)).toThrow('prohibited');

		const repository = new TraceRepository();
		expect(() => repository.append(contractEvent('network.request_started', 1) as never)).toThrow('normalized canonical evidence');
		const normalized = normalizeSourceEvent(contractEvent('network.request_started', 1), calibration).event;
		repository.append(normalized);
		expect(repository.list()).toEqual([normalized]);
	});

	it('rejects unknown kinds and invalid frame identity', () => {
		expect(() => normalizeSourceEvent({ ...contractEvent('action.click', 1), kind: 'raw.cdp.message' }, calibration)).toThrow('Unsupported evidence kind');
		expect(() => normalizeSourceEvent({ ...contractEvent('action.click', 1), frame: { isMainFrame: 'yes' } }, calibration)).toThrow('frame.isMainFrame');
	});
});
