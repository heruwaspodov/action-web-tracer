import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('toolbar side panel behavior', () => {
	it('delegates toolbar clicks to Chrome side-panel behavior', async () => {
		const serviceWorker = await readFile('src/background/service-worker.ts', 'utf8');

		expect(serviceWorker).toContain('chrome.sidePanel.setPanelBehavior');
		expect(serviceWorker).toContain('openPanelOnActionClick: true');
		expect(serviceWorker).not.toContain('chrome.sidePanel.open(');
	});

	it('provides native, labelled and keyboard-accessible recording controls', async () => {
		const panel = await readFile('sidepanel.html', 'utf8');
		expect(panel).toContain('href="./sidepanel.css"');
		expect(panel).toContain('id="start-recording" type="button"');
		expect(panel).toContain('id="stop-recording" type="button"');
		expect(panel).toContain('role="status"');
		expect(panel).toContain('<details class="privacy">');
		expect(panel).toContain('<summary>Permission and privacy</summary>');
	});
});
