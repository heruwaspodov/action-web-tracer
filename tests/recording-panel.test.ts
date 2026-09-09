import { describe, expect, it } from 'vitest';
import { projectRecordingPanel } from '../src/sidepanel/recording-panel.js';

describe('recording panel projections', () => {
	it('never presents Recording before both required adapters are ready', () => {
		const view = projectRecordingPanel({ state: 'recording', cdpReady: true, probeReady: false, coverageComplete: true, coverageReasons: [] });
		expect(view.isRecording).toBe(false); expect(view.status).not.toBe('Recording'); expect(view.stopDisabled).toBe(true);
	});
	it('shows actionable unsupported and partial-coverage states from controller projections', () => {
		expect(projectRecordingPanel({ state: 'error', cdpReady: false, probeReady: false, coverageComplete: false, coverageReasons: [], errorCode: 'restricted_target' }).detail).toContain('HTTP(S)');
		const partial = projectRecordingPanel({ state: 'recording', cdpReady: true, probeReady: true, coverageComplete: false, coverageReasons: ['child frame unavailable'] });
		expect(partial).toMatchObject({ status: 'Recording', isRecording: true, stopDisabled: false }); expect(partial.detail).toContain('child frame unavailable');
	});
});
