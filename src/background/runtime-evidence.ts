import type { EvidenceKind, JsonValue, RawFrameIdentity, RawSourceEvent, RedactionSummary } from '../model/evidence.js';
import { redactAtIngestion, type RedactionConfig } from '../engine/redact/redact.js';
import type { KnownFrame } from './network-evidence.js';

const REPEAT_WINDOW_MS = 250;
const MAX_MESSAGE_LENGTH = 1_024;
const MAX_STACK_FRAMES = 20;

export type CapturedRuntimeEvidence = Readonly<{
	kind: Extract<EvidenceKind, 'runtime.exception' | 'console.error'>;
	timestamp: number;
	timestampOrigin: 'epoch_milliseconds';
	wallTime: string;
	frame: RawFrameIdentity;
	payload: Readonly<Record<string, JsonValue>>;
	preRedaction: RedactionSummary;
}>;

type MutableCapturedRuntimeEvidence = {
	kind: CapturedRuntimeEvidence['kind'];
	timestamp: number;
	timestampOrigin: 'epoch_milliseconds';
	wallTime: string;
	frame: RawFrameIdentity;
	payload: Record<string, JsonValue>;
	preRedaction: RedactionSummary;
};

type ErrorAggregate = { readonly event: MutableCapturedRuntimeEvidence; lastTimestamp: number };

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function string(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function epochTimestamp(value: unknown): number | undefined {
	const milliseconds = number(value);
	return milliseconds === undefined || milliseconds < 0 ? undefined : milliseconds;
}

function origin(url: string | undefined): string | undefined {
	try { return url === undefined ? undefined : new URL(url).origin; } catch { return undefined; }
}

function frameFor(frame: KnownFrame | undefined, url?: string): RawFrameIdentity {
	return { frameId: frame?.frameId, parentFrameId: frame?.parentFrameId, isMainFrame: frame?.isMainFrame ?? false, urlOrigin: frame?.urlOrigin ?? origin(url) };
}

function capped(value: string | undefined): string {
	return (value ?? 'Unknown error').slice(0, MAX_MESSAGE_LENGTH);
}

function safeLocation(value: Record<string, unknown> | undefined): Readonly<Record<string, JsonValue>> | undefined {
	if (!value) return undefined;
	const location: Record<string, JsonValue> = {};
	const url = string(value.url); const line = number(value.lineNumber); const column = number(value.columnNumber);
	if (url) location.url = url;
	if (line !== undefined && line >= 0) location.line = line;
	if (column !== undefined && column >= 0) location.column = column;
	return Object.keys(location).length === 0 ? undefined : location;
}

function safeStack(value: unknown): readonly JsonValue[] {
	const frames = record(value)?.callFrames;
	if (!Array.isArray(frames)) return [];
	return frames.slice(0, MAX_STACK_FRAMES).flatMap((frame) => {
		const location = safeLocation(record(frame));
		return location ? [location] : [];
	});
}

function fingerprint(payload: Readonly<Record<string, JsonValue>>, frame: RawFrameIdentity): string {
	const stable = JSON.stringify({ kind: payload.kind, name: payload.name, message: payload.message, location: payload.location, frame: frame.frameId, origin: frame.urlOrigin });
	let hash = 2_166_136_261;
	for (let index = 0; index < stable.length; index += 1) { hash ^= stable.charCodeAt(index); hash = Math.imul(hash, 16_777_619); }
	return `error:${(hash >>> 0).toString(16)}`;
}

/** Captures only redacted error text and location metadata; never RemoteObject values or arguments. */
export class CdpRuntimeEvidenceCollector {
	readonly #aggregates = new Map<string, ErrorAggregate>();

	constructor(private readonly redactionConfig: RedactionConfig = {}) {}

	handle(method: string, params: Record<string, unknown>, frame?: KnownFrame): readonly CapturedRuntimeEvidence[] {
		if (method === 'Runtime.exceptionThrown') return this.exception(params, frame);
		if (method === 'Log.entryAdded') return this.logEntry(params, frame);
		if (method === 'Runtime.consoleAPICalled') return this.consoleError(params, frame);
		return [];
	}

	private exception(params: Record<string, unknown>, frame?: KnownFrame): readonly CapturedRuntimeEvidence[] {
		const occurredAt = epochTimestamp(params.timestamp); const details = record(params.exceptionDetails);
		if (occurredAt === undefined || !details) return [];
		const exception = record(details.exception);
		return this.capture('runtime.exception', occurredAt, frameFor(frame, string(details.url)), {
			kind: 'runtime.exception', name: string(exception?.className) ?? 'UnhandledException', message: capped(string(exception?.description) ?? string(details.text)),
			...(safeLocation(details) ? { location: safeLocation(details)! } : {}), stack: safeStack(details.stackTrace),
		});
	}

	private logEntry(params: Record<string, unknown>, frame?: KnownFrame): readonly CapturedRuntimeEvidence[] {
		const entry = record(params.entry); const occurredAt = epochTimestamp(entry?.timestamp);
		if (!entry || occurredAt === undefined || entry.level !== 'error') return [];
		return this.capture('console.error', occurredAt, frameFor(frame, string(entry.url)), {
			kind: 'console.error', name: 'LogError', message: capped(string(entry.text)),
			...(safeLocation(entry) ? { location: safeLocation(entry)! } : {}), stack: safeStack(entry.stackTrace),
		});
	}

	private consoleError(params: Record<string, unknown>, frame?: KnownFrame): readonly CapturedRuntimeEvidence[] {
		const occurredAt = epochTimestamp(params.timestamp);
		if (occurredAt === undefined || params.type !== 'error') return [];
		return this.capture('console.error', occurredAt, frameFor(frame), {
			kind: 'console.error', name: 'ConsoleError', message: 'console.error', stack: safeStack(params.stackTrace),
		});
	}

	private capture(kind: CapturedRuntimeEvidence['kind'], occurredAt: number, frame: RawFrameIdentity, unsafePayload: Record<string, JsonValue>): readonly CapturedRuntimeEvidence[] {
		const redacted = redactAtIngestion(unsafePayload, this.redactionConfig);
		const payload = { ...(redacted.value as Record<string, JsonValue>) };
		const key = fingerprint(payload, frame); const previous = this.#aggregates.get(key);
		if (previous && occurredAt - previous.lastTimestamp >= 0 && occurredAt - previous.lastTimestamp <= REPEAT_WINDOW_MS) {
			previous.lastTimestamp = occurredAt;
			previous.event.payload.repeatCount = (typeof previous.event.payload.repeatCount === 'number' ? previous.event.payload.repeatCount : 1) + 1;
			return [];
		}
		payload.repeatCount = 1;
		const event: MutableCapturedRuntimeEvidence = { kind, timestamp: occurredAt, timestampOrigin: 'epoch_milliseconds', wallTime: new Date(occurredAt).toISOString(), frame, payload, preRedaction: redacted.redaction };
		this.#aggregates.set(key, { event, lastTimestamp: occurredAt });
		return [event];
	}
}

export function asRawRuntimeSourceEvent(event: CapturedRuntimeEvidence, sessionId: string, sourceSequence: number): RawSourceEvent {
	return { sessionId, source: 'cdp', sourceSequence, kind: event.kind, timestamp: event.timestamp, timestampOrigin: event.timestampOrigin, wallTime: event.wallTime, frame: event.frame, payload: event.payload, preRedaction: event.preRedaction };
}
