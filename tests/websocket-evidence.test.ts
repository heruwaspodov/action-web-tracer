import { describe, expect, it } from 'vitest';

import { asRawWebSocketSourceEvent, CdpWebSocketEvidenceCollector } from '../src/background/websocket-evidence.js';
import { calibrateClocks } from '../src/engine/normalize/clock.js';
import { normalizeSourceEvent } from '../src/engine/normalize/evidence.js';

const mainFrame = { frameId: 'main', isMainFrame: true, urlOrigin: 'https://app.test' };

describe('CDP WebSocket evidence', () => {
	it('captures lifecycle and frame metadata while discarding payload contents', () => {
		const collector = new CdpWebSocketEvidenceCollector();
		expect(collector.handle('Network.requestWillBeSent', { requestId: 'socket-1', type: 'WebSocket', frameId: 'main', request: { url: 'wss://app.test/socket?token=secret', postData: 'never retain' }, initiator: { type: 'script', url: 'https://app.test/app.js' } }, mainFrame)).toEqual([]);
		expect(collector.handle('Network.webSocketCreated', { requestId: 'socket-1', url: 'wss://app.test/socket?token=secret' }, mainFrame)).toEqual([]);
		const handshake = collector.handle('Network.webSocketWillSendHandshakeRequest', { requestId: 'socket-1', timestamp: 10, wallTime: '2026-01-01T00:00:00Z', request: { headers: { authorization: 'never retain' } } });
		const accepted = collector.handle('Network.webSocketHandshakeResponseReceived', { requestId: 'socket-1', timestamp: 10.1, response: { status: 101, headers: { 'set-cookie': 'never retain' } } });
		const sent = collector.handle('Network.webSocketFrameSent', { requestId: 'socket-1', timestamp: 10.2, response: { opcode: 1, payloadData: 'é' } });
		const received = collector.handle('Network.webSocketFrameReceived', { requestId: 'socket-1', timestamp: 10.3, response: { opcode: 2, payloadData: 'AAECAw==' } });
		const error = collector.handle('Network.webSocketFrameError', { requestId: 'socket-1', timestamp: 10.4, errorMessage: 'connection reset' });
		const closed = collector.handle('Network.webSocketClosed', { requestId: 'socket-1', timestamp: 10.5 });

		expect(handshake[0]).toMatchObject({ kind: 'websocket.created', payload: { socketId: 'socket-1', phase: 'handshake_started', activity: 'background', initiator: { type: 'script', url: 'https://app.test/app.js' } } });
		expect(accepted[0]).toMatchObject({ kind: 'websocket.created', payload: { phase: 'handshake_completed', status: 101 } });
		expect(sent[0]).toMatchObject({ kind: 'websocket.frame_sent', payload: { direction: 'sent', opcode: 'text', payloadBytes: 2, activity: 'background' } });
		expect(received[0]).toMatchObject({ kind: 'websocket.frame_received', payload: { direction: 'received', opcode: 'binary', payloadBytes: 4, activity: 'background' } });
		expect(error[0]).toMatchObject({ kind: 'websocket.closed', payload: { phase: 'error', errorMessage: 'connection reset' } });
		expect(closed[0]).toMatchObject({ kind: 'websocket.closed', payload: { phase: 'closed' } });
		expect(collector.frameCounts).toEqual({ sent: 1, received: 1 });
		expect(collector.machineContext).toEqual({ websocketConnectionCount: 1, websocketSentFrameCount: 1, websocketReceivedFrameCount: 1 });
		expect(JSON.stringify([handshake, accepted, sent, received, error, closed])).not.toContain('payloadData');
		expect(JSON.stringify([handshake, accepted, sent, received, error, closed])).not.toContain('never retain');
	});

	it('normalizes the safe WebSocket event through canonical URL redaction', () => {
		const collector = new CdpWebSocketEvidenceCollector();
		collector.handle('Network.webSocketCreated', { requestId: 'socket-2', url: 'wss://app.test/socket?token=secret' }, mainFrame);
		const event = collector.handle('Network.webSocketWillSendHandshakeRequest', { requestId: 'socket-2', timestamp: 10 })[0]!;
		const calibration = calibrateClocks({ sessionStartedCdpSeconds: 9, cdpHandshakeSeconds: 10, probeEpochMilliseconds: 1_700_000_000_000, roundTripMilliseconds: 2 });
		const normalized = normalizeSourceEvent(asRawWebSocketSourceEvent(event, 'session', 1), calibration).event;
		expect(normalized.payload).toMatchObject({ url: 'wss://app.test/socket?token=%5BREDACTED%5D' });
		expect(normalized.redaction.applied).toBe(true);
	});
});
