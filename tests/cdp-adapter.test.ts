import { describe, expect, it } from 'vitest';
import { CdpAdapter, type DebuggerTransport } from '../src/background/cdp-adapter.js';

class FakeTransport implements DebuggerTransport {
	readonly commands: { method: string; sessionId?: string }[] = []; readonly events: ((tabId: number, method: string, params: Record<string, unknown> | undefined, sessionId?: string) => void)[] = []; readonly detachEvents: ((tabId: number) => void)[] = [];
	fail = new Set<string>();
	async attach(): Promise<void> { if (this.fail.has('attach')) throw new Error('Another debugger is already attached'); }
	async detach(): Promise<void> {}
	async send(_tab: number, method: string, _params?: object, sessionId?: string): Promise<unknown> { this.commands.push({ method, sessionId }); if (this.fail.has(method)) throw new Error('Method not found'); return {}; }
	onEvent(listener: (tabId: number, method: string, params: Record<string, unknown> | undefined, sessionId?: string) => void): void { this.events.push(listener); }
	onDetach(listener: (tabId: number) => void): void { this.detachEvents.push(listener); }
	emit(method: string, params: Record<string, unknown>, sessionId?: string): void { this.events.forEach((listener) => listener(4, method, params, sessionId)); }
}

describe('CDP target orchestration', () => {
	it('enables only approved domains and normalizes same-process, main, and OOPIF identities', async () => {
		const transport = new FakeTransport(); const adapter = new CdpAdapter(transport); await adapter.attach(4);
		expect(transport.commands.map((command) => command.method)).toEqual(['Network.enable', 'Runtime.enable', 'Log.enable', 'Page.enable', 'Page.setLifecycleEventsEnabled', 'Target.setAutoAttach']);
		transport.emit('Page.frameNavigated', { frame: { id: 'main', url: 'https://main.test/a' } });
		transport.emit('Page.frameNavigated', { frame: { id: 'same', parentId: 'main', url: 'https://main.test/frame' } });
		transport.emit('Runtime.executionContextCreated', { context: { id: 9, auxData: { frameId: 'same' } } });
		transport.emit('Target.attachedToTarget', { sessionId: 'child', targetInfo: { type: 'iframe', targetId: 'oop', url: 'https://child.test' } });
		for (let tick = 0; tick < 3; tick += 1) await Promise.resolve();
		expect(adapter.frames).toEqual(expect.arrayContaining([{ frameId: 'main', isMainFrame: true, urlOrigin: 'https://main.test', process: 'same_process' }, { frameId: 'same', parentFrameId: 'main', isMainFrame: false, urlOrigin: 'https://main.test', process: 'same_process' }, { frameId: 'oop', isMainFrame: false, urlOrigin: 'https://child.test', process: 'out_of_process' }]));
		expect(adapter.executionContexts.get(9)).toBe('same');
		expect(transport.commands.filter((command) => command.sessionId === 'child').map((command) => command.method)).toEqual(['Network.enable', 'Runtime.enable', 'Log.enable', 'Page.enable', 'Page.setLifecycleEventsEnabled']);
	});
	it('degrades only an unsupported capability and exposes structured attach errors', async () => {
		const transport = new FakeTransport(); transport.fail.add('Log.enable'); const adapter = new CdpAdapter(transport); await adapter.attach(4);
		expect(adapter.capabilities).toMatchObject({ Network: true, Log: false, Page: true }); expect(adapter.failures).toEqual([{ code: 'protocol_error', capability: 'Log' }]);
		const denied = new CdpAdapter(Object.assign(new FakeTransport(), { fail: new Set(['attach']) })); await expect(denied.attach(4)).rejects.toEqual({ code: 'competing_debugger' });
	});
	it('emits safe network evidence from the attached main frame without requesting bodies', async () => {
		const transport = new FakeTransport(); const adapter = new CdpAdapter(transport); const evidence: unknown[] = [];
		adapter.onEvidence((event) => evidence.push(event)); await adapter.attach(4);
		transport.emit('Page.frameNavigated', { frame: { id: 'main', url: 'https://app.test' } });
		transport.emit('Network.requestWillBeSent', { requestId: 'navigation', frameId: 'main', type: 'Document', timestamp: 10, request: { method: 'GET', url: 'https://app.test/home', postData: 'never retain', headers: { authorization: 'never retain' } } });
		for (let tick = 0; tick < 2; tick += 1) await Promise.resolve();
		expect(evidence).toEqual(expect.arrayContaining([
			expect.objectContaining({ kind: 'page.navigation' }),
			expect.objectContaining({ kind: 'network.request_started', payload: expect.objectContaining({ logicalRequestId: 'navigation' }) }),
		]));
		expect(JSON.stringify(evidence)).not.toContain('never retain');
		expect(transport.commands.map((command) => command.method)).not.toEqual(expect.arrayContaining(['Network.getResponseBody', 'Network.getRequestPostData']));
	});
	it('emits runtime exceptions with their execution-context frame and no remote-object data', async () => {
		const transport = new FakeTransport(); const adapter = new CdpAdapter(transport); const evidence: unknown[] = [];
		adapter.onEvidence((event) => evidence.push(event)); await adapter.attach(4);
		transport.emit('Page.frameNavigated', { frame: { id: 'main', url: 'https://app.test' } });
		transport.emit('Runtime.executionContextCreated', { context: { id: 9, auxData: { frameId: 'main' } } });
		transport.emit('Runtime.exceptionThrown', { timestamp: 1_700_000_000_000, exceptionDetails: { executionContextId: 9, text: 'Uncaught', exception: { className: 'TypeError', description: 'cannot read', objectId: 'never retain' } } });
		for (let tick = 0; tick < 3; tick += 1) await Promise.resolve();
		expect(evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'runtime.exception', frame: expect.objectContaining({ frameId: 'main' }) })]));
		expect(JSON.stringify(evidence)).not.toContain('never retain');
	});
});
