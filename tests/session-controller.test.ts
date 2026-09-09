import { describe, expect, it } from 'vitest';

import { SessionController, STOP_DRAIN_MS, type SessionAdapters, type SessionClock, type SessionStore, type TraceFinalizer, type TraceSession } from '../src/background/session-controller.js';

class FakeClock implements SessionClock {
	now = 0;
	readonly callbacks = new Map<number, () => void | Promise<void>>();
	#next = 0;
	nowMs(): number { return this.now; }
	nowIso(): string { return new Date(this.now).toISOString(); }
	setTimeout(callback: () => void | Promise<void>, delayMs: number): number { const id = ++this.#next; this.callbacks.set(id, async () => { this.now += delayMs; await callback(); }); return id; }
	clearTimeout(handle: unknown): void { this.callbacks.delete(handle as number); }
	async runTimers(): Promise<void> { for (const callback of [...this.callbacks.values()]) { this.callbacks.clear(); await callback(); } }
}

function setup(options: { attached?: boolean; readinessFails?: boolean } = {}) {
	let checkpoint: TraceSession | undefined;
	const saved: TraceSession[] = [];
	const finalized: TraceSession[] = [];
	const store: SessionStore = { load: async () => checkpoint, save: async (session) => { checkpoint = session; saved.push(session); }, clear: async () => { checkpoint = undefined; } };
	const adapters: SessionAdapters & { detached: number[] } = {
		detached: [], attach: async () => undefined, awaitReadiness: async () => {
			if (options.readinessFails) throw new Error('denied');
			return { capabilities: { cdp: true, mainFrameProbe: true, childFrameProbe: false }, coverage: { complete: true, reasons: [] }, mainFrameId: 'main' };
		}, detach: async (tabId) => { adapters.detached.push(tabId); }, isAttached: async () => options.attached ?? true,
	};
	const finalizer: TraceFinalizer = { finalize: async (session) => { finalized.push(session); } };
	const clock = new FakeClock();
	const controller = new SessionController(store, adapters, finalizer, clock, () => 'session-1');
	return { adapters, clock, controller, finalized, saved, store };
}

describe('session controller', () => {
	it('transitions attaching to recording only after both adapters are ready', async () => {
		const { controller, saved } = setup();
		await controller.start({ tabId: 7, origin: 'https://fixture.test' });
		expect(saved.map((session) => session.state)).toEqual(['attaching', 'recording']);
		expect(controller.acceptsNewTraces).toBe(true);
	});

	it('drains for exactly one second before user-stop finalization and detach', async () => {
		const { adapters, clock, controller, finalized, saved } = setup();
		await controller.start({ tabId: 7, origin: 'https://fixture.test' });
		await controller.stop();
		expect(controller.current?.state).toBe('draining');
		expect(controller.acceptsNewTraces).toBe(false);
		expect(clock.callbacks.size).toBe(1);
		await clock.runTimers();
		expect(saved.map((session) => session.state)).toEqual(['attaching', 'recording', 'draining', 'stopped']);
		expect(finalized[0]).toMatchObject({ state: 'stopped', stopReason: 'user_stopped', drainDeadlineMs: undefined });
		expect(adapters.detached).toEqual([7]);
		expect(clock.now).toBe(STOP_DRAIN_MS);
	});

	it('finalizes rather than silently losing records on debugger detach, coverage loss, and tab close', async () => {
		for (const [method, reason, state] of [
			['debuggerDetached', 'debugger_detached', 'interrupted'], ['coverageLost', 'coverage_lost', 'interrupted'], ['tabClosed', 'tab_closed', 'stopped'],
		] as const) {
			const { controller, finalized } = setup();
			await controller.start({ tabId: 7, origin: 'https://fixture.test' });
			if (method === 'tabClosed') await controller.tabClosed(7); else await controller[method]();
			expect(finalized[0]).toMatchObject({ state, stopReason: reason });
		}
	});

	it('records attach failure as an error and safely detaches', async () => {
		const { adapters, controller, finalized } = setup({ readinessFails: true });
		await controller.start({ tabId: 7, origin: 'https://fixture.test' });
		expect(finalized[0]).toMatchObject({ state: 'error', stopReason: 'attach_failed' });
		expect(adapters.detached).toEqual([7]);
	});

	it('reconciles stale worker-restart attachments and resumes a checkpointed drain', async () => {
		const stale = setup({ attached: false });
		await stale.store.save({ schemaVersion: 1, sessionId: 'old', tabId: 7, origin: 'https://fixture.test', startedAt: '1970-01-01T00:00:00.000Z', state: 'recording', capabilities: { cdp: true, mainFrameProbe: true, childFrameProbe: false }, coverage: { complete: true, reasons: [] } });
		await stale.controller.reconcileAfterWorkerRestart();
		expect(stale.finalized[0]).toMatchObject({ state: 'interrupted', stopReason: 'worker_restarted' });

		const draining = setup();
		await draining.store.save({ schemaVersion: 1, sessionId: 'old', tabId: 7, origin: 'https://fixture.test', startedAt: '1970-01-01T00:00:00.000Z', state: 'draining', drainDeadlineMs: STOP_DRAIN_MS, capabilities: { cdp: true, mainFrameProbe: true, childFrameProbe: false }, coverage: { complete: true, reasons: [] } });
		await draining.controller.reconcileAfterWorkerRestart();
		await draining.clock.runTimers();
		expect(draining.finalized[0]).toMatchObject({ state: 'stopped', stopReason: 'user_stopped' });
	});
});
