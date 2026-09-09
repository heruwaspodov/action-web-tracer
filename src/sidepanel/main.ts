import { projectRecordingPanel, type PanelSessionProjection } from './recording-panel.js';

const initialProjection: PanelSessionProjection = { state: 'idle', cdpReady: false, probeReady: false, coverageComplete: true, coverageReasons: [] };
const status = document.querySelector<HTMLParagraphElement>('#recording-status');
const detail = document.querySelector<HTMLParagraphElement>('#recording-detail');
const badge = document.querySelector<HTMLParagraphElement>('#recording-badge');
const start = document.querySelector<HTMLButtonElement>('#start-recording');
const stop = document.querySelector<HTMLButtonElement>('#stop-recording');

function render(projection: PanelSessionProjection): void {
	const view = projectRecordingPanel(projection);
	if (!status || !detail || !badge || !start || !stop) return;
	status.textContent = view.status; detail.textContent = view.detail; badge.textContent = view.badge;
	start.disabled = view.startDisabled; stop.disabled = view.stopDisabled;
	document.documentElement.dataset.actionWebTracer = view.isRecording ? 'recording' : projection.state;
}

async function requestProjection(command: 'get' | 'start' | 'stop'): Promise<void> {
	const response = await chrome.runtime.sendMessage({ type: 'awt.panel', command }) as PanelSessionProjection;
	render(response);
}

start?.addEventListener('click', () => { void requestProjection('start'); });
stop?.addEventListener('click', () => { void requestProjection('stop'); });
render(initialProjection);
void requestProjection('get').catch(() => render({ ...initialProjection, state: 'error', errorCode: 'probe_unavailable' }));
