export type TraceType = 'page' | 'action';
export type Classification = 'UNKNOWN' | 'FRONTEND_FAILURE' | 'SERVER_FAILURE' | 'API_FAILURE' | 'UI_SYNC_FAILURE' | 'SILENT_FAILURE' | 'HEALTHY';
export type FindingCode = 'uncaught_exception' | 'console_error' | 'http_4xx' | 'http_5xx' | 'network_failure' | 'state_change_without_ui' | 'rejected_request_without_visible_error' | 'no_observable_result' | 'incomplete_capture' | 'periodic_background_activity' | 'related_background_evidence' | 'visible_error_handling';
export type Finding = { readonly code: FindingCode; readonly evidenceIds: readonly string[]; readonly summary: string; readonly debuggingSteps: readonly string[] };
export type RequestSummary = { readonly evidenceId: string; readonly method: string; readonly status?: number; readonly confidence: 'high' | 'medium' | 'low'; readonly failed?: boolean };
export type TraceAssessment = {
	readonly type: TraceType;
	readonly coverageComplete: boolean;
	readonly truncated?: boolean;
	readonly runtimeExceptionIds?: readonly string[];
	readonly consoleErrorIds?: readonly string[];
	readonly requests?: readonly RequestSummary[];
	readonly meaningfulUiEvidenceIds?: readonly string[];
	readonly visibleErrorUi?: boolean;
	readonly navigationEvidenceIds?: readonly string[];
	readonly webSocketSendIds?: readonly string[];
	readonly periodicBackgroundEvidenceIds?: readonly string[];
	readonly relatedBackgroundEvidenceIds?: readonly string[];
};
export type Evaluation = { readonly classification: Classification; readonly confidence: 'high' | 'medium' | 'low'; readonly findings: readonly Finding[] };

const steps: Readonly<Record<FindingCode, readonly string[]>> = {
	uncaught_exception: ['Inspect the error name and sanitized stack location.', 'Reproduce the action with developer tools open.'],
	console_error: ['Inspect the sanitized console error metadata.', 'Check whether the error is expected validation feedback.'],
	http_4xx: ['Inspect the request status and validation response metadata.', 'Confirm request inputs and authorization state.'],
	http_5xx: ['Inspect the request status and server correlation ID if available.', 'Check server logs for the same time window.'],
	network_failure: ['Inspect the transport failure reason.', 'Check connectivity, CORS, and server availability.'],
	state_change_without_ui: ['Confirm whether the request should update visible UI.', 'Inspect UI state handling after the successful response.'],
	rejected_request_without_visible_error: ['Confirm validation or authorization feedback is visible to the user.', 'Inspect the client error-handling path.'],
	no_observable_result: ['Confirm the action is expected to have an observable result.', 'Inspect event handlers and network activity.'],
	incomplete_capture: ['Repeat the trace after restoring debugger and probe coverage.'],
	periodic_background_activity: ['Compare the factual request interval with the action timeline.'],
	related_background_evidence: ['Review possibly related background evidence separately from the trace.'],
	visible_error_handling: ['Verify the visible error text explains how the user can recover.'],
};
function finding(code: FindingCode, evidenceIds: readonly string[], summary: string): Finding { return { code, evidenceIds, summary, debuggingSteps: steps[code] }; }
function stateChanging(request: RequestSummary): boolean { return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase()); }

export function evaluateTrace(input: TraceAssessment): Evaluation {
	const requests = input.requests ?? []; const ui = input.meaningfulUiEvidenceIds ?? []; const findings: Finding[] = [];
	const exceptions = input.runtimeExceptionIds ?? []; const consoleErrors = input.consoleErrorIds ?? [];
	const clientErrors = requests.filter((request) => request.status !== undefined && request.status >= 400 && request.status < 500);
	const serverErrors = requests.filter((request) => request.status !== undefined && request.status >= 500);
	const transportFailures = requests.filter((request) => request.failed === true);
	const successfulStateChanges = requests.filter((request) => stateChanging(request) && request.status !== undefined && request.status >= 200 && request.status < 300 && request.confidence !== 'low');
	if (!input.coverageComplete || input.truncated) findings.push(finding('incomplete_capture', [], 'Capture coverage was incomplete or truncated.'));
	if (exceptions.length) findings.push(finding('uncaught_exception', exceptions, 'An uncaught runtime exception occurred.'));
	if (consoleErrors.length) findings.push(finding('console_error', consoleErrors, 'An error-level console entry occurred.'));
	if (serverErrors.length) findings.push(finding('http_5xx', serverErrors.map((request) => request.evidenceId), 'An attributed request returned a 5xx response.'));
	if (clientErrors.length) findings.push(finding('http_4xx', clientErrors.map((request) => request.evidenceId), 'An attributed request returned a 4xx response.'));
	if (transportFailures.length) findings.push(finding('network_failure', transportFailures.map((request) => request.evidenceId), 'An attributed request failed before completion.'));
	if (clientErrors.length && ui.length === 0) findings.push(finding('rejected_request_without_visible_error', clientErrors.map((request) => request.evidenceId), 'A rejected request had no meaningful visible error evidence.'));
	if (clientErrors.length && input.visibleErrorUi) findings.push(finding('visible_error_handling', clientErrors.map((request) => request.evidenceId), 'A rejected request had visible error handling evidence.'));
	if (input.type === 'action' && successfulStateChanges.length && ui.length === 0 && !(input.navigationEvidenceIds?.length)) findings.push(finding('state_change_without_ui', successfulStateChanges.map((request) => request.evidenceId), 'A successful state-changing request had no meaningful UI evidence.'));
	const observable = requests.length || exceptions.length || input.navigationEvidenceIds?.length || input.webSocketSendIds?.length || ui.length;
	if (!observable) findings.push(finding('no_observable_result', [], 'No observable result followed the trace trigger.'));
	if (input.periodicBackgroundEvidenceIds?.length) findings.push(finding('periodic_background_activity', input.periodicBackgroundEvidenceIds, 'Background activity repeated at a measured interval.'));
	if (input.relatedBackgroundEvidenceIds?.length) findings.push(finding('related_background_evidence', input.relatedBackgroundEvidenceIds, 'Background evidence was excluded from trace ownership.'));

	const codes = new Set(findings.map((item) => item.code));
	let classification: Classification;
	if (codes.has('incomplete_capture')) classification = 'UNKNOWN';
	else if (codes.has('uncaught_exception')) classification = 'FRONTEND_FAILURE';
	else if (codes.has('http_5xx')) classification = 'SERVER_FAILURE';
	else if (codes.has('http_4xx') || codes.has('network_failure')) classification = 'API_FAILURE';
	else if (input.type === 'action' && codes.has('state_change_without_ui')) classification = 'UI_SYNC_FAILURE';
	else if (input.type === 'action' && codes.has('no_observable_result')) classification = 'SILENT_FAILURE';
	else classification = input.coverageComplete ? 'HEALTHY' : 'UNKNOWN';
	const confidence = classification === 'UNKNOWN' ? 'low' : requests.some((request) => request.confidence === 'medium') ? 'medium' : 'high';
	return { classification, confidence, findings };
}
