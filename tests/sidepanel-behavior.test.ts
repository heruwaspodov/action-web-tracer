import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('toolbar side panel behavior', () => {
	it('delegates toolbar clicks to Chrome side-panel behavior', async () => {
		const serviceWorker = await readFile('src/background/service-worker.ts', 'utf8');

		expect(serviceWorker).toContain('chrome.sidePanel.setPanelBehavior');
		expect(serviceWorker).toContain('openPanelOnActionClick: true');
		expect(serviceWorker).not.toContain('chrome.sidePanel.open(');
	});
});
