void chrome.sidePanel.setPanelBehavior({
	openPanelOnActionClick: true,
});

// AWT-007 owns rendering only; capture tickets replace this projection source with
// the tab-specific SessionController instance without moving state into the panel.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.type !== 'awt.panel') return undefined;
	sendResponse({ state: 'idle', cdpReady: false, probeReady: false, coverageComplete: true, coverageReasons: [] });
	return false;
});
