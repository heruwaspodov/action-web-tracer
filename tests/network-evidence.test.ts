import { describe, expect, it } from 'vitest';

import { asRawCdpSourceEvent, CdpNetworkEvidenceCollector } from '../src/background/network-evidence.js';
import { calibrateClocks } from '../src/engine/normalize/clock.js';
import { normalizeSourceEvent } from '../src/engine/normalize/evidence.js';

const mainFrame = { frameId: 'main', isMainFrame: true, urlOrigin: 'https://app.test' };

function request(requestId: string, url: string, type: string, timestamp: number, extras: Record<string, unknown> = {}): Record<string, unknown> {
	return { requestId, frameId: 'main', type, timestamp, request: { method: 'GET', url, headers: { authorization: 'discarded' }, postData: 'discarded' }, ...extras };
}

describe('CDP network evidence', () => {
	it('starts page evidence on a main-frame navigation without retaining request bodies or headers', () => {
		const collector = new CdpNetworkEvidenceCollector();
		const events = collector.handle('Network.requestWillBeSent', request('nav', 'https://app.test/home?token=secret', 'Document', 10, { initiator: { type: 'script', url: 'https://app.test/app.js', lineNumber: 12, columnNumber: 4 } }), mainFrame);
		const lifecycle = collector.handle('Page.lifecycleEvent', { frameId: 'main', loaderId: 'nav', name: 'load', timestamp: 10.5 }, mainFrame);

		expect(events.map((event) => event.kind)).toEqual(['page.navigation', 'network.request_started']);
		expect(events[0]?.payload).toMatchObject({ logicalRequestId: 'nav', url: 'https://app.test/home?token=secret' });
		expect(events[1]?.payload).toMatchObject({ logicalRequestId: 'nav', hopId: 'nav:0', method: 'GET', resourceType: 'Document', initiator: { type: 'script', url: 'https://app.test/app.js', line: 12, column: 4 } });
		expect(JSON.stringify(events)).not.toContain('authorization');
		expect(JSON.stringify(events)).not.toContain('postData');
		expect(JSON.stringify(events)).not.toContain('discarded');
		expect(lifecycle).toEqual([expect.objectContaining({ kind: 'page.lifecycle', payload: { name: 'load', loaderId: 'nav' } })]);
	});

	it('retains redirect hops under one logical request and captures waterfall timing and transfer size', () => {
		const collector = new CdpNetworkEvidenceCollector();
		collector.handle('Network.requestWillBeSent', request('request-1', 'https://app.test/old', 'Fetch', 10), mainFrame);
		const redirect = collector.handle('Network.requestWillBeSent', request('request-1', 'https://app.test/new', 'Fetch', 10.02, {
			redirectResponse: { status: 302, mimeType: 'text/html' },
		}), mainFrame);
		const response = collector.handle('Network.responseReceived', {
			requestId: 'request-1', timestamp: 10.045, response: {
				status: 200, mimeType: 'application/json', fromServiceWorker: true,
				timing: { dnsStart: 0, dnsEnd: 5, connectStart: 5, connectEnd: 15, sslStart: 6, sslEnd: 14, sendStart: 15, sendEnd: 17, receiveHeadersEnd: 25 },
			},
		}, mainFrame);
		const finished = collector.handle('Network.loadingFinished', { requestId: 'request-1', timestamp: 10.07, encodedDataLength: 512 }, mainFrame);

		expect(redirect.map((event) => event.payload)).toEqual(expect.arrayContaining([
			expect.objectContaining({ logicalRequestId: 'request-1', hopId: 'request-1:0', status: 302 }),
			expect.objectContaining({ logicalRequestId: 'request-1', hopId: 'request-1:1', url: 'https://app.test/new' }),
		]));
		expect(response[0]?.payload).toMatchObject({ status: 200, fromServiceWorker: true, timing: { dnsMs: 5, connectMs: 10, sslMs: 8, requestMs: 2, waitingMs: 8 } });
		expect(finished[0]?.payload).toMatchObject({ encodedBytes: 512, timing: { downloadMs: 25 } });
	});

	it('filters excluded resource types but admits Other traffic when response metadata identifies an API', () => {
		const collector = new CdpNetworkEvidenceCollector();
		expect(collector.handle('Network.requestWillBeSent', request('image', 'https://app.test/logo.png', 'Image', 1), mainFrame)).toEqual([]);
		expect(collector.handle('Network.requestWillBeSent', request('other', 'https://app.test/unknown', 'Other', 2), mainFrame)).toEqual([]);
		const apiEvents = collector.handle('Network.responseReceived', { requestId: 'other', timestamp: 2.1, response: { status: 200, mimeType: 'application/json' } }, mainFrame);
		expect(apiEvents.map((event) => event.kind)).toEqual(['network.request_started', 'network.response_received']);
		expect(collector.handle('Network.responseReceived', { requestId: 'image', timestamp: 1.1, response: { status: 200, mimeType: 'image/png' } }, mainFrame)).toEqual([]);
	});

	it('records cache and failure metadata for included traffic', () => {
		const collector = new CdpNetworkEvidenceCollector();
		collector.handle('Network.requestWillBeSent', request('cached', 'https://app.test/data', 'XHR', 3), mainFrame);
		collector.handle('Network.requestServedFromCache', { requestId: 'cached' }, mainFrame);
		const cached = collector.handle('Network.responseReceived', { requestId: 'cached', timestamp: 3.1, response: { status: 200, mimeType: 'application/json' } }, mainFrame);
		collector.handle('Network.requestWillBeSent', request('failed', 'https://app.test/data', 'Fetch', 4), mainFrame);
		const failed = collector.handle('Network.loadingFailed', { requestId: 'failed', timestamp: 4.1, errorText: 'net::ERR_FAILED', canceled: true }, mainFrame);

		expect(cached[0]?.payload).toMatchObject({ fromCache: true });
		expect(failed[0]?.payload).toMatchObject({ failureReason: 'net::ERR_FAILED', canceled: true });
	});

	it('normalizes emitted data through the canonical redaction boundary', () => {
		const collector = new CdpNetworkEvidenceCollector();
		const event = collector.handle('Network.requestWillBeSent', request('fetch', 'https://app.test/api?token=secret', 'Fetch', 10), mainFrame)[0]!;
		const calibration = calibrateClocks({ sessionStartedCdpSeconds: 9, cdpHandshakeSeconds: 10, probeEpochMilliseconds: 1_700_000_000_000, roundTripMilliseconds: 2 });
		const normalized = normalizeSourceEvent(asRawCdpSourceEvent(event, 'session', 1), calibration).event;
		expect(normalized.payload).toMatchObject({ url: 'https://app.test/api?token=%5BREDACTED%5D' });
		expect(normalized.redaction.applied).toBe(true);
	});
});
