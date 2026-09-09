export const evidenceKinds = [
	'action.click',
	'action.submit',
	'network.request_started',
	'network.response_received',
	'network.request_finished',
	'network.request_failed',
	'runtime.exception',
	'console.error',
	'ui.change',
	'page.navigation',
	'page.lifecycle',
	'websocket.created',
	'websocket.closed',
	'websocket.frame_sent',
	'websocket.frame_received',
	'capture.coverage_changed',
] as const;

export type EvidenceKind = (typeof evidenceKinds)[number];
export type EvidenceSource = 'probe' | 'cdp' | 'extension';
export type JsonValue = boolean | number | string | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type FrameIdentity = {
	readonly frameId?: string;
	readonly parentFrameId?: string;
	readonly isMainFrame: boolean;
	readonly urlOrigin?: string;
};

export type RedactionSummary = {
	readonly applied: boolean;
	readonly fields: readonly string[];
};

export const canonicalEvidenceBrand: unique symbol = Symbol('canonicalEvidence');

/** A validated, persistence-safe event. Only normalizeSourceEvent can create one. */
export type EvidenceEnvelope<T extends JsonValue = JsonValue> = {
	readonly evidenceId: string;
	readonly sessionId: string;
	readonly source: EvidenceSource;
	readonly sourceSequence: number;
	readonly kind: EvidenceKind;
	readonly timestampUs: number;
	readonly wallTime?: string;
	readonly frame: FrameIdentity;
	readonly payload: T;
	readonly redaction: RedactionSummary;
	readonly [canonicalEvidenceBrand]: true;
};

export type ClockCalibrationQuality = 'high' | 'medium' | 'low';

export type ClockCalibration = {
	readonly cdpEpochOffsetUs: number;
	readonly probeEpochOffsetUs: number;
	readonly quality: ClockCalibrationQuality;
	readonly roundTripUs: number;
};

export type ClockCoverage = {
	readonly clockCalibration: ClockCalibrationQuality;
	readonly complete: boolean;
};

export type RawFrameIdentity = {
	readonly frameId?: unknown;
	readonly parentFrameId?: unknown;
	readonly isMainFrame?: unknown;
	readonly urlOrigin?: unknown;
};

export type RawSourceEvent = {
	readonly sessionId: unknown;
	readonly source: unknown;
	readonly sourceSequence: unknown;
	readonly kind: unknown;
	readonly timestamp: unknown;
	readonly wallTime?: unknown;
	readonly frame?: RawFrameIdentity;
	readonly payload: unknown;
};

export type NormalizationResult = {
	readonly event: EvidenceEnvelope;
	readonly coverage: ClockCoverage;
};
