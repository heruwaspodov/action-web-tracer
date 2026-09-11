export const MIN_PERIODIC_OCCURRENCES = 3;
export const PERIODIC_INTERVAL_TOLERANCE = 0.2;
export const MAX_OBSERVATIONS_PER_FINGERPRINT = 100;

export type RequestObservation = { readonly requestId: string; readonly method: string; readonly url: string; readonly timestampMs: number };
export type BackgroundPattern = { readonly fingerprint: string; readonly requestIds: readonly string[]; readonly timestampsMs: readonly number[]; readonly medianIntervalMs: number; readonly intervalTolerance: number; readonly predatesAction: boolean };
export type BackgroundFinding = { readonly code: 'periodic_background_activity'; readonly fingerprint: string; readonly occurrenceCount: number; readonly medianIntervalMs: number; readonly intervalTolerance: number };

function normalizedSegment(segment: string): string {
	return /^(?:\d+|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|[0-9a-f]{16,})$/iu.test(segment) ? ':id' : segment;
}

/** Contains method, stable path, and query names only—never URL credentials, fragments, or query values. */
export function requestFingerprint(method: string, url: string): string {
	try {
		const parsed = new URL(url);
		const path = parsed.pathname.split('/').map(normalizedSegment).join('/') || '/';
		const queryNames = [...new Set([...parsed.searchParams.keys()].map((key) => key.toLowerCase()))].sort();
		return `${method.toUpperCase()} ${path}${queryNames.length ? `?${queryNames.join('&')}` : ''}`;
	} catch { return `${method.toUpperCase()} /invalid-url`; }
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function detectPeriodicPattern(observations: readonly RequestObservation[], actionStartedAtMs: number): BackgroundPattern | undefined {
	if (observations.length < MIN_PERIODIC_OCCURRENCES) return undefined;
	const ordered = [...observations].sort((left, right) => left.timestampMs - right.timestampMs);
	const intervals = ordered.slice(1).map((observation, index) => observation.timestampMs - ordered[index].timestampMs);
	if (intervals.some((interval) => interval <= 0)) return undefined;
	const medianIntervalMs = median(intervals);
	if (intervals.some((interval) => Math.abs(interval - medianIntervalMs) / medianIntervalMs > PERIODIC_INTERVAL_TOLERANCE)) return undefined;
	return {
		fingerprint: requestFingerprint(ordered[0].method, ordered[0].url), requestIds: ordered.map((observation) => observation.requestId), timestampsMs: ordered.map((observation) => observation.timestampMs),
		medianIntervalMs, intervalTolerance: PERIODIC_INTERVAL_TOLERANCE, predatesAction: ordered.some((observation) => observation.timestampMs < actionStartedAtMs),
	};
}

/** Session-local, bounded background history. It stores no raw URL projection beyond the incoming observation lifetime. */
export class BackgroundActivityStore {
	#observations = new Map<string, RequestObservation[]>();
	record(observation: RequestObservation): string {
		const fingerprint = requestFingerprint(observation.method, observation.url);
		const entries = this.#observations.get(fingerprint) ?? [];
		entries.push(observation);
		if (entries.length > MAX_OBSERVATIONS_PER_FINGERPRINT) entries.splice(0, entries.length - MAX_OBSERVATIONS_PER_FINGERPRINT);
		this.#observations.set(fingerprint, entries);
		return fingerprint;
	}
	patterns(actionStartedAtMs: number): readonly BackgroundPattern[] {
		return [...this.#observations.values()].map((entries) => detectPeriodicPattern(entries, actionStartedAtMs)).filter((pattern): pattern is BackgroundPattern => pattern !== undefined);
	}
	classify(fingerprint: string, actionStartedAtMs: number, structuralScore: number): 'background' | 'eligible_for_trace' {
		const pattern = detectPeriodicPattern(this.#observations.get(fingerprint) ?? [], actionStartedAtMs);
		return pattern?.predatesAction === true && structuralScore < 5 ? 'background' : 'eligible_for_trace';
	}
	findings(actionStartedAtMs: number): readonly BackgroundFinding[] {
		return this.patterns(actionStartedAtMs).filter((pattern) => pattern.predatesAction).map((pattern) => ({ code: 'periodic_background_activity', fingerprint: pattern.fingerprint, occurrenceCount: pattern.requestIds.length, medianIntervalMs: pattern.medianIntervalMs, intervalTolerance: pattern.intervalTolerance }));
	}
}
