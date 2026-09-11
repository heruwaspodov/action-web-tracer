import type { SessionStore, TraceSession } from './session-controller.js';

const checkpointKey = 'awt.active-session';

/** Service-worker-only checkpoint adapter; probes never receive this storage capability. */
export class ChromeSessionStore implements SessionStore {
	async load(): Promise<TraceSession | undefined> { return (await chrome.storage.session.get(checkpointKey))[checkpointKey] as TraceSession | undefined; }
	async save(session: TraceSession): Promise<void> { await chrome.storage.session.set({ [checkpointKey]: session }); }
	async clear(): Promise<void> { await chrome.storage.session.remove(checkpointKey); }
}
