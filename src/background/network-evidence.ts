import type { EvidenceKind, JsonValue, RawFrameIdentity, RawSourceEvent } from '../model/evidence.js';

export type CapturedNetworkEvidence = Readonly<{
	kind: Extract<EvidenceKind, 'page.navigation' | 'page.lifecycle' | 'network.request_started' | 'network.response_received' | 'network.request_finished' | 'network.request_failed'>;
	timestamp: number;
	wallTime?: string;
	frame: RawFrameIdentity;
	payload: Readonly<Record<string, JsonValue>>;
}>;

export type KnownFrame = Readonly<{
	frameId: string;
	parentFrameId?: string;
	isMainFrame: boolean;
	urlOrigin?: string;
}>;

type RequestState = {
	readonly logicalRequestId: string;
	readonly hop: number;
	readonly frame: RawFrameIdentity;
	readonly method: string;
	readonly url: string;
	readonly resourceType: string;
	readonly initiator: Readonly<Record<string, JsonValue>>;
	readonly startedAt: number;
	readonly wallTime?: string;
	readonly isMainFrameNavigation: boolean;
	emitted: boolean;
	fromCache: boolean;
	fromServiceWorker: boolean;
	responseTimestamp?: number;
	responseTiming?: Readonly<Record<string, JsonValue>>;
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

function frameFor(frameId: string | undefined, knownFrame: KnownFrame | undefined, url: string): RawFrameIdentity {
	return {
		frameId,
		parentFrameId: knownFrame?.parentFrameId,
		isMainFrame: knownFrame?.isMainFrame ?? false,
		urlOrigin: knownFrame?.urlOrigin ?? origin(url),
	};
}

function duration(start: unknown, end: unknown): number | undefined {
	const startMs = number(start); const endMs = number(end);
	return startMs === undefined || endMs === undefined || startMs < 0 || endMs < startMs ? undefined : endMs - startMs;
}

function compactTiming(value: unknown): Readonly<Record<string, JsonValue>> | undefined {
	const timing = record(value);
	if (!timing) return undefined;
	const result: Record<string, JsonValue> = {};
	const dnsMs = duration(timing.dnsStart, timing.dnsEnd);
	const connectMs = duration(timing.connectStart, timing.connectEnd);
	const sslMs = duration(timing.sslStart, timing.sslEnd);
	const requestMs = duration(timing.sendStart, timing.sendEnd);
	const waitingMs = duration(timing.sendEnd, timing.receiveHeadersEnd);
	if (dnsMs !== undefined) result.dnsMs = dnsMs;
	if (connectMs !== undefined) result.connectMs = connectMs;
	if (sslMs !== undefined) result.sslMs = sslMs;
	if (requestMs !== undefined) result.requestMs = requestMs;
	if (waitingMs !== undefined) result.waitingMs = waitingMs;
	return Object.keys(result).length === 0 ? undefined : result;
}

function initiator(value: unknown): Readonly<Record<string, JsonValue>> {
	const raw = record(value);
	const result: Record<string, JsonValue> = {};
	const type = string(raw?.type); const url = string(raw?.url); const line = number(raw?.lineNumber); const column = number(raw?.columnNumber);
	if (type) result.type = type;
	if (url) result.url = url;
	if (line !== undefined) result.line = line;
	if (column !== undefined) result.column = column;
	return result;
}

function hasApiMetadata(state: RequestState, mimeType?: string): boolean {
	if (mimeType && /(?:application|text)\/(?:[^;]+\+)?(?:json|graphql)|application\/x-ndjson/iu.test(mimeType)) return true;
	const initiatorUrl = typeof state.initiator.url === 'string' ? state.initiator.url : undefined;
	const apiPath = /\/(?:api|graphql|rpc)(?:\/|$|[?#])/iu;
	return apiPath.test(state.url) || (initiatorUrl !== undefined && apiPath.test(initiatorUrl));
}

function includedImmediately(resourceType: string): boolean {
	return ['Document', 'XHR', 'Fetch', 'EventSource', 'WebSocket'].includes(resourceType);
}

function requestPayload(state: RequestState): Readonly<Record<string, JsonValue>> {
	return {
		logicalRequestId: state.logicalRequestId,
		hopId: `${state.logicalRequestId}:${state.hop}`,
		method: state.method,
		url: state.url,
		resourceType: state.resourceType,
		initiator: state.initiator,
	};
}

function responsePayload(state: RequestState, response: Record<string, unknown>): Readonly<Record<string, JsonValue>> {
	const payload: Record<string, JsonValue> = { logicalRequestId: state.logicalRequestId, hopId: `${state.logicalRequestId}:${state.hop}` };
	const status = number(response.status); const mimeType = string(response.mimeType);
	if (status !== undefined) payload.status = status;
	if (mimeType) payload.mimeType = mimeType;
	if (state.fromCache || response.fromDiskCache === true || response.fromPrefetchCache === true) payload.fromCache = true;
	if (state.fromServiceWorker || response.fromServiceWorker === true) payload.fromServiceWorker = true;
	const timing = compactTiming(response.timing);
	if (timing) payload.timing = timing;
	return payload;
}

/**
 * Converts a deliberately small allowlist of Network/Page protocol fields to
 * source events. It never requests CDP bodies and never copies CDP headers.
 */
export class CdpNetworkEvidenceCollector {
	readonly #requests = new Map<string, RequestState>();

	handle(method: string, params: Record<string, unknown>, knownFrame?: KnownFrame): readonly CapturedNetworkEvidence[] {
		if (method === 'Page.lifecycleEvent') return this.lifecycleEvent(params, knownFrame);
		if (method === 'Network.requestWillBeSent') return this.requestWillBeSent(params, knownFrame);
		if (method === 'Network.requestServedFromCache') return this.requestServedFromCache(params);
		if (method === 'Network.responseReceived') return this.responseReceived(params);
		if (method === 'Network.loadingFinished') return this.loadingFinished(params);
		if (method === 'Network.loadingFailed') return this.loadingFailed(params);
		return [];
	}

	private lifecycleEvent(params: Record<string, unknown>, knownFrame?: KnownFrame): readonly CapturedNetworkEvidence[] {
		const occurredAt = timestamp(params); const name = string(params.name); const frameId = string(params.frameId);
		if (occurredAt === undefined || !name) return [];
		const payload: Record<string, JsonValue> = { name };
		const loaderId = string(params.loaderId);
		if (loaderId) payload.loaderId = loaderId;
		return [{ kind: 'page.lifecycle', timestamp: occurredAt, frame: frameFor(frameId, knownFrame, knownFrame?.urlOrigin ?? ''), payload }];
	}

	private requestWillBeSent(params: Record<string, unknown>, knownFrame?: KnownFrame): readonly CapturedNetworkEvidence[] {
		const requestId = string(params.requestId); const request = record(params.request); const url = string(request?.url); const method = string(request?.method); const startedAt = timestamp(params);
		if (!requestId || !url || !method || startedAt === undefined) return [];
		const previous = this.#requests.get(requestId);
		const resourceType = string(params.type) ?? 'Other'; const frameId = string(params.frameId);
		const state: RequestState = {
			logicalRequestId: previous?.logicalRequestId ?? requestId,
			hop: previous ? previous.hop + 1 : 0,
			frame: frameFor(frameId, knownFrame, url), method, url, resourceType, initiator: initiator(params.initiator), startedAt,
			wallTime: string(params.wallTime), isMainFrameNavigation: resourceType === 'Document' && knownFrame?.isMainFrame === true,
			emitted: includedImmediately(resourceType), fromCache: false, fromServiceWorker: false,
		};
		this.#requests.set(requestId, state);
		const events: CapturedNetworkEvidence[] = [];
		if (previous && previous.emitted) {
			const redirectResponse = record(params.redirectResponse) ?? {};
			events.push({ kind: 'network.response_received', timestamp: startedAt, wallTime: state.wallTime, frame: previous.frame, payload: responsePayload(previous, redirectResponse) });
		}
		if (state.isMainFrameNavigation && !previous) {
			events.push({ kind: 'page.navigation', timestamp: startedAt, wallTime: state.wallTime, frame: state.frame, payload: { logicalRequestId: state.logicalRequestId, url: state.url } });
		}
		if (state.emitted) events.push({ kind: 'network.request_started', timestamp: state.startedAt, wallTime: state.wallTime, frame: state.frame, payload: requestPayload(state) });
		return events;
	}

	private requestServedFromCache(params: Record<string, unknown>): readonly CapturedNetworkEvidence[] {
		const requestId = string(params.requestId); const state = requestId ? this.#requests.get(requestId) : undefined;
		if (state) state.fromCache = true;
		return [];
	}

	private responseReceived(params: Record<string, unknown>): readonly CapturedNetworkEvidence[] {
		const requestId = string(params.requestId); const state = requestId ? this.#requests.get(requestId) : undefined; const receivedAt = timestamp(params); const response = record(params.response);
		if (!state || receivedAt === undefined || !response) return [];
		const mimeType = string(response.mimeType);
		if (!state.emitted && state.resourceType === 'Other' && hasApiMetadata(state, mimeType)) {
			state.emitted = true;
			state.responseTimestamp = receivedAt; state.responseTiming = compactTiming(response.timing);
			return [
				{ kind: 'network.request_started', timestamp: state.startedAt, wallTime: state.wallTime, frame: state.frame, payload: requestPayload(state) },
				{ kind: 'network.response_received', timestamp: receivedAt, wallTime: string(params.wallTime), frame: state.frame, payload: responsePayload(state, response) },
			];
		}
		if (!state.emitted) return [];
		state.responseTimestamp = receivedAt; state.responseTiming = compactTiming(response.timing);
		return [{ kind: 'network.response_received', timestamp: receivedAt, wallTime: string(params.wallTime), frame: state.frame, payload: responsePayload(state, response) }];
	}

	private loadingFinished(params: Record<string, unknown>): readonly CapturedNetworkEvidence[] {
		const requestId = string(params.requestId); const state = requestId ? this.#requests.get(requestId) : undefined; const finishedAt = timestamp(params);
		if (!requestId || !state || finishedAt === undefined) return [];
		this.#requests.delete(requestId);
		if (!state.emitted) return [];
		const payload: Record<string, JsonValue> = { logicalRequestId: state.logicalRequestId, hopId: `${state.logicalRequestId}:${state.hop}` };
		const encodedBytes = number(params.encodedDataLength);
		if (encodedBytes !== undefined && encodedBytes >= 0) payload.encodedBytes = encodedBytes;
		if (state.responseTimestamp !== undefined && finishedAt >= state.responseTimestamp) payload.timing = { ...(state.responseTiming ?? {}), downloadMs: Math.round((finishedAt - state.responseTimestamp) * 1_000_000) / 1_000 };
		return [{ kind: 'network.request_finished', timestamp: finishedAt, wallTime: string(params.wallTime), frame: state.frame, payload }];
	}

	private loadingFailed(params: Record<string, unknown>): readonly CapturedNetworkEvidence[] {
		const requestId = string(params.requestId); const state = requestId ? this.#requests.get(requestId) : undefined; const failedAt = timestamp(params);
		if (!requestId || !state || failedAt === undefined) return [];
		this.#requests.delete(requestId);
		if (!state.emitted && state.resourceType === 'Other' && hasApiMetadata(state)) state.emitted = true;
		if (!state.emitted) return [];
		const payload: Record<string, JsonValue> = { logicalRequestId: state.logicalRequestId, hopId: `${state.logicalRequestId}:${state.hop}` };
		const failureReason = string(params.errorText) ?? string(params.blockedReason);
		if (failureReason) payload.failureReason = failureReason;
		if (params.canceled === true) payload.canceled = true;
		return [{ kind: 'network.request_failed', timestamp: failedAt, wallTime: string(params.wallTime), frame: state.frame, payload }];
	}
}

/** Adds session ownership and deterministic sequencing before canonical normalization. */
export function asRawCdpSourceEvent(event: CapturedNetworkEvidence, sessionId: string, sourceSequence: number): RawSourceEvent {
	return { sessionId, source: 'cdp', sourceSequence, kind: event.kind, timestamp: event.timestamp, wallTime: event.wallTime, frame: event.frame, payload: event.payload };
}
