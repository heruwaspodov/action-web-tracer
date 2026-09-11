export const storageLimits = {
	completedTraces: 50,
	totalBytes: 10 * 1024 * 1024,
	networkRecords: 500,
	webSocketFrames: 1_000,
	uiEvidence: 1_000,
	canonicalEvents: 5_000,
} as const;

export type StoredTrace = {
	readonly traceId: string;
	readonly sessionId: string;
	readonly completedAtMs: number;
	readonly byteSize: number;
	readonly counts: { readonly network: number; readonly webSocketFrames: number; readonly uiEvidence: number; readonly canonicalEvents: number };
	readonly classification: 'HEALTHY' | 'UNKNOWN' | string;
	readonly coverage: { readonly truncated: boolean };
};
export type ActiveBufferResult = { readonly accepted: boolean; readonly aggregated: boolean; readonly truncated: boolean };

function bounded(trace: StoredTrace): StoredTrace {
	const truncated = trace.coverage.truncated || trace.counts.network > storageLimits.networkRecords || trace.counts.webSocketFrames > storageLimits.webSocketFrames || trace.counts.uiEvidence > storageLimits.uiEvidence || trace.counts.canonicalEvents > storageLimits.canonicalEvents;
	return { ...trace, coverage: { truncated }, classification: truncated && trace.classification === 'HEALTHY' ? 'UNKNOWN' : trace.classification };
}

/** In-memory model of the IndexedDB completed-trace repository; browser adapters own durable I/O. */
export class CompletedTraceStore {
	#traces = new Map<string, StoredTrace>();
	list(): readonly StoredTrace[] { return [...this.#traces.values()].sort((left, right) => left.completedAtMs - right.completedAtMs); }
	save(trace: StoredTrace): StoredTrace {
		this.#traces.set(trace.traceId, bounded(trace));
		this.evict();
		return this.#traces.get(trace.traceId) ?? bounded(trace);
	}
	deleteTrace(traceId: string): void { this.#traces.delete(traceId); }
	deleteSession(sessionId: string): void { for (const trace of this.#traces.values()) if (trace.sessionId === sessionId) this.#traces.delete(trace.traceId); }
	deleteAll(): void { this.#traces.clear(); }
	private evict(): void {
		while (this.#traces.size > storageLimits.completedTraces || this.totalBytes() > storageLimits.totalBytes) {
			const oldest = this.list()[0];
			if (!oldest) return;
			this.#traces.delete(oldest.traceId);
		}
	}
	private totalBytes(): number { return [...this.#traces.values()].reduce((total, trace) => total + trace.byteSize, 0); }
}

/** Bounded active evidence buffer that aggregates duplicate signatures before dropping new records. */
export class ActiveTraceBuffer {
	#entries = new Map<string, number>();
	#truncated = false;
	append(signature: string): ActiveBufferResult {
		const repeats = this.#entries.get(signature);
		if (repeats !== undefined) { this.#entries.set(signature, repeats + 1); return { accepted: true, aggregated: true, truncated: this.#truncated }; }
		if (this.#entries.size >= storageLimits.canonicalEvents) { this.#truncated = true; return { accepted: false, aggregated: false, truncated: true }; }
		this.#entries.set(signature, 1);
		return { accepted: true, aggregated: false, truncated: this.#truncated };
	}
	get truncated(): boolean { return this.#truncated; }
}
