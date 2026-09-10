import {
	canonicalEvidenceBrand,
	evidenceKinds,
	type ClockCalibration,
	type EvidenceEnvelope,
	type EvidenceKind,
	type EvidenceSource,
	type FrameIdentity,
	type JsonValue,
	type NormalizationResult,
	type RedactionSummary,
	type RawSourceEvent,
	} from '../../model/evidence.js';
import { cdpTimestampToSessionUs, probeTimestampToSessionUs } from './clock.js';
import { redactAtIngestion, type RedactionConfig } from '../redact/redact.js';

const forbiddenPayloadKeys = new Set([
	'authorization', 'body', 'cookie', 'cookies', 'formData', 'inputValue', 'payloadData', 'requestBody', 'responseBody', 'value',
]);

const sourceKinds: Readonly<Record<EvidenceSource, readonly EvidenceKind[]>> = {
	probe: ['action.click', 'action.submit', 'ui.change', 'capture.coverage_changed'],
	cdp: [
		'network.request_started', 'network.response_received', 'network.request_finished', 'network.request_failed',
		'runtime.exception', 'console.error', 'page.navigation', 'page.lifecycle', 'websocket.created', 'websocket.closed',
		'websocket.frame_sent', 'websocket.frame_received', 'capture.coverage_changed',
	],
	extension: ['capture.coverage_changed', 'page.navigation', 'page.lifecycle'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a non-empty string.`);
	return value;
}

function optionalString(value: unknown, name: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
	return value;
}

function safeJson(value: unknown, path = 'payload'): JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (Array.isArray(value)) return value.map((item, index) => safeJson(item, `${path}[${index}]`));
	if (!isRecord(value)) throw new Error(`${path} must contain only JSON values.`);

	const safe: Record<string, JsonValue> = {};
	for (const [key, nested] of Object.entries(value)) {
		if (forbiddenPayloadKeys.has(key)) throw new Error(`${path}.${key} is prohibited in canonical evidence.`);
		safe[key] = safeJson(nested, `${path}.${key}`);
	}
	return safe;
}

function normalizeFrame(frame: RawSourceEvent['frame']): FrameIdentity {
	if (frame !== undefined && !isRecord(frame)) throw new Error('frame must be an object.');
	const isMainFrame = frame?.isMainFrame;
	if (isMainFrame !== undefined && typeof isMainFrame !== 'boolean') throw new Error('frame.isMainFrame must be a boolean.');
	return {
		frameId: optionalString(frame?.frameId, 'frame.frameId'),
		parentFrameId: optionalString(frame?.parentFrameId, 'frame.parentFrameId'),
		isMainFrame: isMainFrame ?? false,
		urlOrigin: optionalString(frame?.urlOrigin, 'frame.urlOrigin'),
	};
}

function normalizeTimestamp(event: RawSourceEvent, calibration: ClockCalibration): number {
	if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp) || event.timestamp < 0) {
		throw new Error('timestamp must be a finite non-negative number.');
	}
	if (event.timestampOrigin !== undefined && event.timestampOrigin !== 'cdp_monotonic' && event.timestampOrigin !== 'epoch_milliseconds') throw new Error('timestampOrigin is invalid.');
	if (event.timestampOrigin === 'epoch_milliseconds') return probeTimestampToSessionUs(event.timestamp, calibration);
	if (event.source === 'cdp') return cdpTimestampToSessionUs(event.timestamp, calibration);
	if (event.source === 'probe') return probeTimestampToSessionUs(event.timestamp, calibration);
	return Math.round(event.timestamp * 1_000);
}

function normalizePreRedaction(value: unknown): RedactionSummary {
	if (value === undefined) return { applied: false, fields: [] };
	if (!isRecord(value) || typeof value.applied !== 'boolean' || !Array.isArray(value.fields) || value.fields.some((field) => typeof field !== 'string')) {
		throw new Error('preRedaction must be a redaction summary.');
	}
	return { applied: value.applied, fields: value.fields as readonly string[] };
}

export function normalizeSourceEvent(event: RawSourceEvent, calibration: ClockCalibration, redactionConfig?: RedactionConfig): NormalizationResult {
	const sessionId = requiredString(event.sessionId, 'sessionId');
	if (event.source !== 'probe' && event.source !== 'cdp' && event.source !== 'extension') throw new Error('Unsupported evidence source.');
	if (!evidenceKinds.includes(event.kind as EvidenceKind)) throw new Error('Unsupported evidence kind.');
	if (!sourceKinds[event.source].includes(event.kind as EvidenceKind)) throw new Error('Evidence kind is not emitted by this source.');
	if (typeof event.sourceSequence !== 'number' || !Number.isSafeInteger(event.sourceSequence) || event.sourceSequence < 0) {
		throw new Error('sourceSequence must be a non-negative safe integer.');
	}

	const source = event.source as EvidenceSource;
	const kind = event.kind as EvidenceKind;
	const preRedaction = normalizePreRedaction(event.preRedaction);
	const redactedPayload = redactAtIngestion(safeJson(event.payload), redactionConfig);
	const canonical: EvidenceEnvelope = {
		evidenceId: `${sessionId}:${source}:${event.sourceSequence}`,
		sessionId,
		source,
		sourceSequence: event.sourceSequence,
		kind,
		timestampUs: normalizeTimestamp(event, calibration),
		wallTime: optionalString(event.wallTime, 'wallTime'),
		frame: normalizeFrame(event.frame),
		payload: redactedPayload.value,
		redaction: { applied: preRedaction.applied || redactedPayload.redaction.applied, fields: [...new Set([...preRedaction.fields, ...redactedPayload.redaction.fields])] },
		// The brand prevents raw adapter input from satisfying EvidenceEnvelope at compile time.
		[canonicalEvidenceBrand]: true,
	};

	return {
		event: canonical,
		coverage: { clockCalibration: calibration.quality, complete: calibration.quality !== 'low' },
	};
}

export function compareEvidence(left: EvidenceEnvelope, right: EvidenceEnvelope): number {
	return left.timestampUs - right.timestampUs || left.sourceSequence - right.sourceSequence || left.evidenceId.localeCompare(right.evidenceId);
}
