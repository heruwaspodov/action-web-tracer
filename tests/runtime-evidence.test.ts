import { describe, expect, it } from 'vitest';

import { asRawRuntimeSourceEvent, CdpRuntimeEvidenceCollector } from '../src/background/runtime-evidence.js';
import { calibrateClocks } from '../src/engine/normalize/clock.js';
import { normalizeSourceEvent } from '../src/engine/normalize/evidence.js';

const mainFrame = { frameId: 'main', isMainFrame: true, urlOrigin: 'https://app.test' };
const secret = 'top-secret-token';

describe('CDP runtime evidence', () => {
	it('captures a redacted exception with bounded safe stack locations and epoch clock calibration', () => {
		const collector = new CdpRuntimeEvidenceCollector({ configuredSecrets: [secret] });
		const event = collector.handle('Runtime.exceptionThrown', {
			timestamp: 1_700_000_000_002,
			exceptionDetails: {
				text: 'Uncaught', url: `https://app.test/app.js?token=${secret}`, lineNumber: 4, columnNumber: 2,
				exception: { className: 'TypeError', description: `Bad ${secret} Bearer abc.def.ghi`, objectId: 'never-retain', preview: { properties: ['never-retain'] } },
				stackTrace: { callFrames: [{ url: `https://app.test/app.js?token=${secret}`, lineNumber: 4, columnNumber: 2, functionName: 'never-retain' }] },
			},
		}, mainFrame)[0]!;
		const calibration = calibrateClocks({ sessionStartedCdpSeconds: 10, cdpHandshakeSeconds: 12, probeEpochMilliseconds: 1_700_000_000_000, roundTripMilliseconds: 2 });
		const normalized = normalizeSourceEvent(asRawRuntimeSourceEvent(event, 'session', 1), calibration, { configuredSecrets: [secret] }).event;

		expect(event.payload).toMatchObject({ name: 'TypeError', message: 'Bad [REDACTED] [REDACTED]', location: { url: 'https://app.test/app.js?token=%5BREDACTED%5D', line: 4, column: 2 }, repeatCount: 1 });
		expect(event.timestampOrigin).toBe('epoch_milliseconds');
		expect(normalized.timestampUs).toBe(2_002_000);
		expect(normalized.redaction.fields).toEqual(expect.arrayContaining(['payload.message', 'payload.location.url', 'payload.stack[0].url']));
		expect(JSON.stringify(event)).not.toContain('never-retain');
	});

	it('collapses matching errors within 250 ms and starts a new aggregate afterwards', () => {
		const collector = new CdpRuntimeEvidenceCollector();
		const first = collector.handle('Log.entryAdded', { entry: { level: 'error', timestamp: 1_000, text: 'database unavailable', url: 'https://app.test/db.js' } }, mainFrame)[0]!;
		expect(collector.handle('Log.entryAdded', { entry: { level: 'error', timestamp: 1_249, text: 'database unavailable', url: 'https://app.test/db.js' } }, mainFrame)).toEqual([]);
		expect(first.payload.repeatCount).toBe(2);
		const later = collector.handle('Log.entryAdded', { entry: { level: 'error', timestamp: 1_500, text: 'database unavailable', url: 'https://app.test/db.js' } }, mainFrame)[0]!;
		expect(later.payload.repeatCount).toBe(1);
	});

	it('records error-level log and console metadata without serializing arguments or object graphs', () => {
		const collector = new CdpRuntimeEvidenceCollector();
		const log = collector.handle('Log.entryAdded', { entry: { level: 'error', timestamp: 1_000, text: 'request failed', url: 'https://app.test/api', args: [{ value: secret, objectId: 'never-retain' }] } }, mainFrame)[0]!;
		const console = collector.handle('Runtime.consoleAPICalled', { type: 'error', timestamp: 2_000, args: [{ value: secret, objectId: 'never-retain', preview: {} }], stackTrace: { callFrames: [{ url: 'https://app.test/main.js', lineNumber: 1, columnNumber: 2 }] } }, mainFrame)[0]!;

		expect(log.payload).toMatchObject({ name: 'LogError', message: 'request failed' });
		expect(console.payload).toMatchObject({ name: 'ConsoleError', message: 'console.error', stack: [{ url: 'https://app.test/main.js', line: 1, column: 2 }] });
		expect(JSON.stringify([log, console])).not.toContain(secret);
		expect(JSON.stringify([log, console])).not.toContain('objectId');
	});
});
