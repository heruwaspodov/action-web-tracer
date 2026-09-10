import type { EvidenceKind, JsonValue, RawFrameIdentity, RawSourceEvent } from '../model/evidence.js';
import type { KnownFrame } from './network-evidence.js';

export type CapturedWebSocketEvidence = Readonly<{
	kind: Extract<EvidenceKind, 'websocket.created' | 'websocket.closed' | 'websocket.frame_sent' | 'websocket.frame_received'>;
	timestamp: number;
	wallTime?: string;
	frame: RawFrameIdentity;
	payload: Readonly<Record<string, JsonValue>>;
}>;

export type WebSocketFrameCounts = Readonly<{ sent: number; received: number }>;
export type WebSocketMachineContext = Readonly<{
	websocketConnectionCount: number;
	websocketSentFrameCount: number;
	websocketReceivedFrameCount: number;
}>;

type SocketState = {
	readonly requestId: string;
	url?: string;
	initiator: Readonly<Record<string, JsonValue>>;
	frame: RawFrameIdentity;
	createdEmitted: boolean;
};

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function string(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function timestamp(params: Record<string, unknown>): number | undefined {
	const value = number(params.timestamp);
	return value === undefined || value < 0 ? undefined : value;
}

function origin(url: string | undefined): string | undefined {
	try { return url === undefined ? undefined : new URL(url).origin; } catch { return undefined; }
}

function frameFor(frame: KnownFrame | undefined, url?: string): RawFrameIdentity {
	return { frameId: frame?.frameId, parentFrameId: frame?.parentFrameId, isMainFrame: frame?.isMainFrame ?? false, urlOrigin: frame?.urlOrigin ?? origin(url) };
}

function initiator(value: unknown): Readonly<Record<string, JsonValue>> {
	const raw = record(value); const result: Record<string, JsonValue> = {};
	const type = string(raw?.type); const url = string(raw?.url); const line = number(raw?.lineNumber); const column = number(raw?.columnNumber);
	if (type) result.type = type;
	if (url) result.url = url;
	if (line !== undefined) result.line = line;
	if (column !== undefined) result.column = column;
	return result;
}

function opcodeCategory(opcode: unknown): string {
	switch (opcode) {
		case 0: return 'continuation';
		case 1: return 'text';
		case 2: return 'binary';
		case 8: return 'close';
		case 9: return 'ping';
		case 10: return 'pong';
		default: return 'other';
	}
}

function base64ByteLength(value: string): number {
	const compact = value.replace(/\s/gu, '');
	if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) return 0;
	const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor(compact.length * 3 / 4) - padding);
}

function payloadByteLength(frame: Record<string, unknown>): number {
	const data = string(frame.payloadData) ?? '';
	return frame.opcode === 1 ? new TextEncoder().encode(data).byteLength : base64ByteLength(data);
}

/** Captures WebSocket lifecycle and frame metadata while discarding payloadData at the boundary. */
export class CdpWebSocketEvidenceCollector {
	readonly #sockets = new Map<string, SocketState>();
	#sent = 0;
	#received = 0;
	#connections = 0;

	get frameCounts(): WebSocketFrameCounts { return { sent: this.#sent, received: this.#received }; }
	get machineContext(): WebSocketMachineContext {
		return { websocketConnectionCount: this.#connections, websocketSentFrameCount: this.#sent, websocketReceivedFrameCount: this.#received };
	}

	handle(method: string, params: Record<string, unknown>, frame?: KnownFrame): readonly CapturedWebSocketEvidence[] {
		if (method === 'Network.requestWillBeSent') return this.requestWillBeSent(params, frame);
		if (method === 'Network.webSocketCreated') return this.created(params, frame);
		if (method === 'Network.webSocketWillSendHandshakeRequest') return this.handshakeStarted(params);
		if (method === 'Network.webSocketHandshakeResponseReceived') return this.handshakeResponse(params);
		if (method === 'Network.webSocketFrameSent') return this.frame(params, 'sent');
		if (method === 'Network.webSocketFrameReceived') return this.frame(params, 'received');
		if (method === 'Network.webSocketFrameError') return this.error(params);
		if (method === 'Network.webSocketClosed') return this.closed(params);
		return [];
	}

	private requestWillBeSent(params: Record<string, unknown>, frame?: KnownFrame): readonly CapturedWebSocketEvidence[] {
		if (params.type !== 'WebSocket') return [];
		const requestId = string(params.requestId); const request = record(params.request); const url = string(request?.url);
		if (!requestId) return [];
		if (!this.#sockets.has(requestId)) this.#connections += 1;
		this.#sockets.set(requestId, { requestId, url, initiator: initiator(params.initiator), frame: frameFor(frame, url), createdEmitted: false });
		return [];
	}

	private created(params: Record<string, unknown>, frame?: KnownFrame): readonly CapturedWebSocketEvidence[] {
		const requestId = string(params.requestId); if (!requestId) return [];
		const previous = this.#sockets.get(requestId); const url = string(params.url) ?? previous?.url;
		if (!previous) this.#connections += 1;
		this.#sockets.set(requestId, { requestId, url, initiator: Object.keys(previous?.initiator ?? {}).length > 0 ? previous!.initiator : initiator(params.initiator), frame: previous?.frame ?? frameFor(frame, url), createdEmitted: previous?.createdEmitted ?? false });
		return [];
	}

	private handshakeStarted(params: Record<string, unknown>): readonly CapturedWebSocketEvidence[] {
		const requestId = string(params.requestId); const occurredAt = timestamp(params); if (!requestId || occurredAt === undefined) return [];
		const state = this.socket(requestId); if (state.createdEmitted) return [];
		state.createdEmitted = true;
		return [{ kind: 'websocket.created', timestamp: occurredAt, wallTime: string(params.wallTime), frame: state.frame, payload: { socketId: requestId, ...(state.url ? { url: state.url } : {}), initiator: state.initiator, phase: 'handshake_started', activity: 'background' } }];
	}

	private handshakeResponse(params: Record<string, unknown>): readonly CapturedWebSocketEvidence[] {
		const requestId = string(params.requestId); const occurredAt = timestamp(params); const response = record(params.response);
		if (!requestId || occurredAt === undefined || !response) return [];
		const state = this.socket(requestId); const payload: Record<string, JsonValue> = { socketId: requestId, phase: 'handshake_completed', activity: 'background' };
		const status = number(response.status); if (status !== undefined) payload.status = status;
		return [{ kind: 'websocket.created', timestamp: occurredAt, frame: state.frame, payload }];
	}

	private frame(params: Record<string, unknown>, direction: 'sent' | 'received'): readonly CapturedWebSocketEvidence[] {
		const requestId = string(params.requestId); const occurredAt = timestamp(params); const socketFrame = record(params.response);
		if (!requestId || occurredAt === undefined || !socketFrame) return [];
		const state = this.socket(requestId); if (direction === 'sent') this.#sent += 1; else this.#received += 1;
		return [{ kind: direction === 'sent' ? 'websocket.frame_sent' : 'websocket.frame_received', timestamp: occurredAt, frame: state.frame, payload: { socketId: requestId, direction, opcode: opcodeCategory(socketFrame.opcode), payloadBytes: payloadByteLength(socketFrame), activity: 'background' } }];
	}

	private error(params: Record<string, unknown>): readonly CapturedWebSocketEvidence[] {
		const requestId = string(params.requestId); const occurredAt = timestamp(params); if (!requestId || occurredAt === undefined) return [];
		const state = this.socket(requestId); const errorMessage = string(params.errorMessage);
		return [{ kind: 'websocket.closed', timestamp: occurredAt, frame: state.frame, payload: { socketId: requestId, phase: 'error', ...(errorMessage ? { errorMessage } : {}), activity: 'background' } }];
	}

	private closed(params: Record<string, unknown>): readonly CapturedWebSocketEvidence[] {
		const requestId = string(params.requestId); const occurredAt = timestamp(params); if (!requestId || occurredAt === undefined) return [];
		const state = this.socket(requestId); this.#sockets.delete(requestId);
		return [{ kind: 'websocket.closed', timestamp: occurredAt, frame: state.frame, payload: { socketId: requestId, phase: 'closed', activity: 'background' } }];
	}

	private socket(requestId: string): SocketState {
		const existing = this.#sockets.get(requestId);
		if (existing) return existing;
		const state: SocketState = { requestId, initiator: {}, frame: { isMainFrame: false }, createdEmitted: false };
		this.#connections += 1;
		this.#sockets.set(requestId, state);
		return state;
	}
}

export function asRawWebSocketSourceEvent(event: CapturedWebSocketEvidence, sessionId: string, sourceSequence: number): RawSourceEvent {
	return { sessionId, source: 'cdp', sourceSequence, kind: event.kind, timestamp: event.timestamp, wallTime: event.wallTime, frame: event.frame, payload: event.payload };
}
