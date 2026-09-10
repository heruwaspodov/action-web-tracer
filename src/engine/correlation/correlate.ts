export const CORRELATION_RULES_VERSION = 1;

export type CorrelationConfidence = 'high' | 'medium' | 'low';
export type CorrelationReason =
	| 'before_trace_start' | 'newer_foreground_action' | 'websocket_receive_temporal_only'
	| 'user_gesture' | 'action_navigation' | 'request_near_action' | 'request_in_action_window'
	| 'same_frame' | 'attributed_initiator' | 'runtime_in_action_window'
	| 'ui_near_target' | 'ui_in_action_window' | 'periodic_background' | 'request_owner_inherited';
export type CorrelationOwner = { readonly type: 'trace'; readonly traceId: string } | { readonly type: 'background' };
export type Correlation = { readonly owner: CorrelationOwner; readonly confidence: CorrelationConfidence; readonly score: number; readonly reasons: readonly CorrelationReason[] };

export type CorrelationRules = {
	readonly version: number;
	readonly userGesture: number; readonly actionNavigation: number; readonly requestNearAction: number; readonly requestInActionWindow: number;
	readonly sameFrame: number; readonly attributedInitiator: number; readonly runtimeInActionWindow: number;
	readonly uiNearTarget: number; readonly uiInActionWindow: number; readonly periodicBackground: number;
	readonly highThreshold: number; readonly mediumThreshold: number; readonly nearActionMs: number; readonly actionWindowMs: number;
};

export const correlationRules: CorrelationRules = {
	version: CORRELATION_RULES_VERSION,
	userGesture: 5, actionNavigation: 5, requestNearAction: 3, requestInActionWindow: 1,
	sameFrame: 1, attributedInitiator: 2, runtimeInActionWindow: 2,
	uiNearTarget: 3, uiInActionWindow: 1, periodicBackground: -5,
	highThreshold: 5, mediumThreshold: 3, nearActionMs: 250, actionWindowMs: 2_000,
};
export type CorrelationTrace = { readonly traceId: string; readonly startedAtMs: number; readonly frameId?: string; readonly closedForNewEventsAtMs?: number };
export type CorrelationEvent = {
	readonly evidenceId: string;
	readonly kind: 'request' | 'navigation' | 'runtime' | 'ui' | 'websocket_send' | 'websocket_receive' | 'other';
	readonly timestampMs: number;
	readonly frameId?: string;
	readonly requestId?: string;
	readonly requestPhase?: 'started' | 'response' | 'finished' | 'failed';
	readonly hasUserGesture?: boolean;
	readonly navigationFromAction?: boolean;
	readonly initiatorAttributed?: boolean;
	readonly nearActionTarget?: boolean;
	readonly periodicBackground?: boolean;
};

function reason(score: { value: number; reasons: CorrelationReason[] }, weight: number, code: CorrelationReason): void { score.value += weight; score.reasons.push(code); }
function confidence(score: number, rules: CorrelationRules): CorrelationConfidence { return score >= rules.highThreshold ? 'high' : score >= rules.mediumThreshold ? 'medium' : 'low'; }

/** Fails closed if weights change without also changing the persisted rules version. */
export function validateCorrelationRules(rules: CorrelationRules): void {
	const baseline = correlationRules as Record<string, number>;
	const candidate = rules as Record<string, number>;
	const weightsChanged = Object.keys(baseline).some((key) => key !== 'version' && candidate[key] !== baseline[key]);
	if (weightsChanged && rules.version === CORRELATION_RULES_VERSION) throw new Error('Correlation rule weights require a correlation-rules version change.');
}

export function scoreCorrelation(event: CorrelationEvent, trace: CorrelationTrace, rules: CorrelationRules = correlationRules): Correlation {
	if (event.timestampMs < trace.startedAtMs) return { owner: { type: 'background' }, confidence: 'low', score: 0, reasons: ['before_trace_start'] };
	if (trace.closedForNewEventsAtMs !== undefined && event.timestampMs >= trace.closedForNewEventsAtMs) return { owner: { type: 'background' }, confidence: 'low', score: 0, reasons: ['newer_foreground_action'] };
	const elapsed = event.timestampMs - trace.startedAtMs;
	if (event.kind === 'websocket_receive' && !event.initiatorAttributed) return { owner: { type: 'background' }, confidence: 'low', score: 0, reasons: ['websocket_receive_temporal_only'] };
	const result = { value: 0, reasons: [] as CorrelationReason[] };
	if (event.hasUserGesture) reason(result, rules.userGesture, 'user_gesture');
	if (event.kind === 'navigation' && event.navigationFromAction) reason(result, rules.actionNavigation, 'action_navigation');
	if (event.kind === 'request' && elapsed <= rules.nearActionMs) reason(result, rules.requestNearAction, 'request_near_action');
	else if (event.kind === 'request' && elapsed <= rules.actionWindowMs) reason(result, rules.requestInActionWindow, 'request_in_action_window');
	if (event.frameId && event.frameId === trace.frameId) reason(result, rules.sameFrame, 'same_frame');
	if (event.initiatorAttributed) reason(result, rules.attributedInitiator, 'attributed_initiator');
	if (event.kind === 'runtime' && elapsed <= rules.actionWindowMs && event.frameId === trace.frameId) reason(result, rules.runtimeInActionWindow, 'runtime_in_action_window');
	if (event.kind === 'ui' && elapsed <= rules.actionWindowMs && event.frameId === trace.frameId) reason(result, event.nearActionTarget ? rules.uiNearTarget : rules.uiInActionWindow, event.nearActionTarget ? 'ui_near_target' : 'ui_in_action_window');
	if (event.periodicBackground) reason(result, rules.periodicBackground, 'periodic_background');
	const level = confidence(result.value, rules);
	return level === 'low'
		? { owner: { type: 'background' }, confidence: level, score: result.value, reasons: result.reasons }
		: { owner: { type: 'trace', traceId: trace.traceId }, confidence: level, score: result.value, reasons: result.reasons };
}

export function correlateEvent(event: CorrelationEvent, traces: readonly CorrelationTrace[], rules: CorrelationRules = correlationRules): Correlation {
	validateCorrelationRules(rules);
	const candidates = traces.map((trace) => scoreCorrelation(event, trace, rules));
	const assigned = candidates
		.filter((candidate): candidate is Correlation & { readonly owner: { readonly type: 'trace'; readonly traceId: string } } => candidate.owner.type === 'trace')
		.sort((left, right) => right.score - left.score || left.owner.traceId.localeCompare(right.owner.traceId));
	return assigned[0] ?? candidates.sort((left, right) => right.score - left.score)[0] ?? { owner: { type: 'background' }, confidence: 'low', score: 0, reasons: [] };
}

/** Stateful request-owner map layered over the pure scorer; responses never get re-scored. */
export class DeterministicCorrelator {
	#requestOwners = new Map<string, Correlation>();
	constructor(private readonly rules: CorrelationRules = correlationRules) { validateCorrelationRules(rules); }
	correlate(event: CorrelationEvent, traces: readonly CorrelationTrace[]): Correlation {
		if (event.requestId && event.requestPhase !== undefined && event.requestPhase !== 'started') {
			const owner = this.#requestOwners.get(event.requestId);
			if (owner?.owner.type === 'trace') return { ...owner, reasons: [...owner.reasons, 'request_owner_inherited'] };
		}
		const result = correlateEvent(event, traces, this.rules);
		if (event.requestId && event.requestPhase === 'started') this.#requestOwners.set(event.requestId, result);
		return result;
	}
}

export function traceCorrelationConfidence(coverage: readonly CorrelationConfidence[]): CorrelationConfidence {
	return coverage.includes('low') ? 'low' : coverage.includes('medium') ? 'medium' : 'high';
}
