export const ACTION_INITIAL_WINDOW_MS = 2_000;
export const NETWORK_IDLE_MS = 500;
export const UI_IDLE_MS = 300;
export const ACTION_MAX_DURATION_MS = 10_000;
export const PAGE_MAX_DURATION_MS = 15_000;
export const STOP_DRAIN_MS = 1_000;

export type TraceKind = 'page' | 'action';
export type TraceCompletionReason = 'settled' | 'timed_out' | 'truncated';
export type TraceCoverage = { readonly timedOut: boolean; readonly truncated: boolean };
export type ManagedTrace = {
	readonly traceId: string;
	readonly kind: TraceKind;
	readonly startedAtMs: number;
	readonly actionKind?: 'click' | 'submit';
	readonly acceptingNewEvents: boolean;
	readonly pendingRequestIds: readonly string[];
	readonly completedAtMs?: number;
	readonly completionReason?: TraceCompletionReason;
	readonly coverage: TraceCoverage;
};

type MutableTrace = {
	traceId: string;
	kind: TraceKind;
	startedAtMs: number;
	actionKind?: 'click' | 'submit';
	acceptingNewEvents: boolean;
	pendingRequestIds: Set<string>;
	completedAtMs?: number;
	completionReason?: TraceCompletionReason;
	coverage: TraceCoverage;
	lastNetworkAtMs: number;
	lastUiAtMs: number;
	pageLoaded: boolean;
};

function publicTrace(trace: MutableTrace): ManagedTrace {
	return { ...trace, pendingRequestIds: [...trace.pendingRequestIds].sort() };
}

/** Pure-clock state machine: correlation selects evidence ownership later, but request ownership never moves. */
export class TraceLifecycle {
	#traces = new Map<string, MutableTrace>();
	#requestOwners = new Map<string, string>();
	#foregroundTraceId: string | undefined;
	#drainDeadlineMs: number | undefined;

	constructor(private readonly createTraceId: () => string) {}

	get traces(): readonly ManagedTrace[] { return [...this.#traces.values()].map(publicTrace); }
	get foregroundTraceId(): string | undefined { return this.#foregroundTraceId; }

	startPage(timestampMs: number): ManagedTrace { return this.start('page', timestampMs); }
	startAction(actionKind: 'click' | 'submit', timestampMs: number): ManagedTrace { return this.start('action', timestampMs, actionKind); }

	assignRequestStart(requestId: string, timestampMs: number): string | undefined {
		const trace = this.activeForeground();
		if (!trace || !trace.acceptingNewEvents || this.#drainDeadlineMs !== undefined) return undefined;
		trace.pendingRequestIds.add(requestId);
		trace.lastNetworkAtMs = timestampMs;
		this.#requestOwners.set(requestId, trace.traceId);
		return trace.traceId;
	}

	requestCompleted(requestId: string, timestampMs: number): string | undefined {
		const traceId = this.#requestOwners.get(requestId);
		if (!traceId) return undefined;
		this.#requestOwners.delete(requestId);
		const trace = this.#traces.get(traceId);
		if (!trace || trace.completedAtMs !== undefined) return traceId;
		trace.pendingRequestIds.delete(requestId);
		trace.lastNetworkAtMs = timestampMs;
		return traceId;
	}

	observeUiEvidence(timestampMs: number): string | undefined {
		const trace = this.activeForeground();
		if (!trace || !trace.acceptingNewEvents || this.#drainDeadlineMs !== undefined) return undefined;
		trace.lastUiAtMs = timestampMs;
		return trace.traceId;
	}

	markPageLoaded(traceId: string, timestampMs: number): void {
		const trace = this.#traces.get(traceId);
		if (trace?.kind === 'page' && trace.completedAtMs === undefined) { trace.pageLoaded = true; trace.lastNetworkAtMs = timestampMs; }
	}

	beginDrain(timestampMs: number): void {
		if (this.#drainDeadlineMs !== undefined) return;
		this.#drainDeadlineMs = timestampMs + STOP_DRAIN_MS;
		this.closeForeground();
	}

	tick(timestampMs: number): readonly ManagedTrace[] {
		for (const trace of this.#traces.values()) {
			if (trace.completedAtMs !== undefined) continue;
			if (this.#drainDeadlineMs !== undefined && timestampMs >= this.#drainDeadlineMs) this.complete(trace, timestampMs, 'truncated');
			else if (timestampMs - trace.startedAtMs >= (trace.kind === 'action' ? ACTION_MAX_DURATION_MS : PAGE_MAX_DURATION_MS)) this.complete(trace, timestampMs, 'timed_out');
			else if (this.canSettle(trace, timestampMs)) this.complete(trace, timestampMs, 'settled');
		}
		return this.traces;
	}

	private start(kind: TraceKind, timestampMs: number, actionKind?: 'click' | 'submit'): ManagedTrace {
		this.closeForeground();
		const trace: MutableTrace = { traceId: this.createTraceId(), kind, startedAtMs: timestampMs, ...(actionKind ? { actionKind } : {}), acceptingNewEvents: true, pendingRequestIds: new Set(), lastNetworkAtMs: timestampMs, lastUiAtMs: timestampMs, pageLoaded: false, coverage: { timedOut: false, truncated: false } };
		this.#traces.set(trace.traceId, trace);
		this.#foregroundTraceId = trace.traceId;
		return publicTrace(trace);
	}

	private activeForeground(): MutableTrace | undefined { return this.#foregroundTraceId ? this.#traces.get(this.#foregroundTraceId) : undefined; }
	private closeForeground(): void { const trace = this.activeForeground(); if (trace) trace.acceptingNewEvents = false; this.#foregroundTraceId = undefined; }
	private canSettle(trace: MutableTrace, nowMs: number): boolean {
		if (trace.kind === 'page' && !trace.pageLoaded) return false;
		if (trace.kind === 'action' && nowMs - trace.startedAtMs < ACTION_INITIAL_WINDOW_MS) return false;
		return trace.pendingRequestIds.size === 0 && nowMs - trace.lastNetworkAtMs >= NETWORK_IDLE_MS && nowMs - trace.lastUiAtMs >= UI_IDLE_MS;
	}
	private complete(trace: MutableTrace, timestampMs: number, reason: TraceCompletionReason): void {
		trace.acceptingNewEvents = false;
		trace.completedAtMs = timestampMs;
		trace.completionReason = reason;
		trace.coverage = { timedOut: reason === 'timed_out', truncated: reason === 'truncated' };
		if (this.#foregroundTraceId === trace.traceId) this.#foregroundTraceId = undefined;
	}
}
