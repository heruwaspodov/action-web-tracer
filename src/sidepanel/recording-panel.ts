export type PanelSessionProjection = {
	readonly state: 'idle' | 'attaching' | 'recording' | 'draining' | 'stopped' | 'interrupted' | 'error';
	readonly cdpReady: boolean;
	readonly probeReady: boolean;
	readonly coverageComplete: boolean;
	readonly coverageReasons: readonly string[];
	readonly errorCode?: 'restricted_target' | 'competing_debugger' | 'probe_unavailable';
};

export type PanelView = {
	readonly status: string;
	readonly detail: string;
	readonly badge: string;
	readonly startDisabled: boolean;
	readonly stopDisabled: boolean;
	readonly isRecording: boolean;
};

export function projectRecordingPanel(session: PanelSessionProjection): PanelView {
	if (session.errorCode === 'restricted_target') return { status: 'This page cannot be traced', detail: 'Open an HTTP(S) page instead of a Chrome, extension, or Chrome Web Store page.', badge: '', startDisabled: true, stopDisabled: true, isRecording: false };
	if (session.errorCode === 'competing_debugger') return { status: 'Another debugger is using this tab', detail: 'Close DevTools or the competing debugger, then try again.', badge: '', startDisabled: false, stopDisabled: true, isRecording: false };
	if (session.errorCode === 'probe_unavailable') return { status: 'Page probe is unavailable', detail: 'Reload the page or choose another eligible HTTP(S) tab, then try again.', badge: '', startDisabled: false, stopDisabled: true, isRecording: false };
	if (session.state === 'attaching') return { status: 'Preparing recording…', detail: 'Waiting for the debugger and main-frame page probe.', badge: '', startDisabled: true, stopDisabled: true, isRecording: false };
	if (session.state === 'recording' && session.cdpReady && session.probeReady) {
		const detail = session.coverageComplete ? 'Capturing local browser evidence for this tab.' : `Recording with partial coverage: ${session.coverageReasons.join(', ') || 'some frames are unavailable'}.`;
		return { status: 'Recording', detail, badge: '● Recording', startDisabled: true, stopDisabled: false, isRecording: true };
	}
	if (session.state === 'draining') return { status: 'Stopping recording…', detail: 'Finishing active requests for up to one second.', badge: '● Stopping', startDisabled: true, stopDisabled: true, isRecording: false };
	if (session.state === 'interrupted') return { status: 'Recording was interrupted', detail: 'Captured evidence was finalized. Start a new recording when this tab is ready.', badge: '', startDisabled: false, stopDisabled: true, isRecording: false };
	return { status: 'Ready to trace this tab', detail: 'ActionWebTracer uses Chrome debugger access to observe local browser evidence. It never uploads captured data.', badge: '', startDisabled: false, stopDisabled: true, isRecording: false };
}
