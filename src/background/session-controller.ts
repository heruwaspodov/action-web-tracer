export const STOP_DRAIN_MS = 1_000;

export type SessionState = 'attaching' | 'recording' | 'draining' | 'stopped' | 'interrupted' | 'error';
export type StopReason = 'user_stopped' | 'debugger_detached' | 'coverage_lost' | 'tab_closed' | 'attach_failed' | 'worker_restarted';

export type CaptureCapabilities = { readonly cdp: boolean; readonly mainFrameProbe: boolean; readonly childFrameProbe: boolean };
export type CoverageSummary = { readonly complete: boolean; readonly reasons: readonly string[] };

export type TraceSession = {
	readonly schemaVersion: 1;
	readonly sessionId: string;
	readonly tabId: number;
	readonly startedAt: string;
	readonly stoppedAt?: string;
	readonly state: SessionState;
	readonly origin: string;
	readonly mainFrameId?: string;
	readonly capabilities: CaptureCapabilities;
	readonly coverage: CoverageSummary;
	readonly stopReason?: StopReason;
	readonly drainDeadlineMs?: number;
};

export type SessionStore = { load(): Promise<TraceSession | undefined>; save(session: TraceSession): Promise<void>; clear(): Promise<void> };
export type SessionAdapters = {
	attach(tabId: number): Promise<void>;
	awaitReadiness(tabId: number): Promise<{ capabilities: CaptureCapabilities; coverage: CoverageSummary; mainFrameId?: string }>;
	detach(tabId: number): Promise<void>;
	isAttached(tabId: number): Promise<boolean>;
};
export type TraceFinalizer = { finalize(session: TraceSession): Promise<void> };
export type SessionClock = {
	nowMs(): number;
	nowIso(): string;
	setTimeout(callback: () => void | Promise<void>, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
};

export type StartSession = { readonly tabId: number; readonly origin: string };

const emptyCapabilities: CaptureCapabilities = { cdp: false, mainFrameProbe: false, childFrameProbe: false };
const emptyCoverage: CoverageSummary = { complete: false, reasons: [] };

export class SessionController {
	#session: TraceSession | undefined;
	#drainTimer: unknown;

	constructor(
		private readonly store: SessionStore,
		private readonly adapters: SessionAdapters,
		private readonly finalizer: TraceFinalizer,
		private readonly clock: SessionClock,
		private readonly createSessionId: () => string,
	) {}

	get current(): TraceSession | undefined { return this.#session; }
	get acceptsNewTraces(): boolean { return this.#session?.state === 'recording'; }

	async start({ tabId, origin }: StartSession): Promise<TraceSession> {
		if (this.#session && !this.isTerminal(this.#session)) throw new Error('A session is already active.');
		this.#session = {
			schemaVersion: 1, sessionId: this.createSessionId(), tabId, origin, startedAt: this.clock.nowIso(), state: 'attaching',
			capabilities: emptyCapabilities, coverage: emptyCoverage,
		};
		await this.store.save(this.#session);
		try {
			await this.adapters.attach(tabId);
			const readiness = await this.adapters.awaitReadiness(tabId);
			return this.transition({ state: 'recording', ...readiness });
		} catch {
			const failed = await this.transition({ state: 'error', stopReason: 'attach_failed', stoppedAt: this.clock.nowIso() });
			await this.safeDetach(failed.tabId);
			await this.finalizeAndClear(failed);
			return failed;
		}
	}

	async stop(): Promise<TraceSession | undefined> {
		if (this.#session?.state !== 'recording') return this.#session;
		const draining = await this.transition({ state: 'draining', drainDeadlineMs: this.clock.nowMs() + STOP_DRAIN_MS });
		this.scheduleDrain(draining);
		return draining;
	}

	async debuggerDetached(): Promise<TraceSession | undefined> { return this.interrupt('debugger_detached'); }
	async coverageLost(): Promise<TraceSession | undefined> { return this.interrupt('coverage_lost', { complete: false, reasons: ['coverage_lost'] }); }

	async tabClosed(tabId: number): Promise<TraceSession | undefined> {
		if (this.#session?.tabId !== tabId || this.isTerminal(this.#session)) return this.#session;
		return this.finish('stopped', 'tab_closed');
	}

	async reconcileAfterWorkerRestart(): Promise<TraceSession | undefined> {
		const checkpoint = await this.store.load();
		if (!checkpoint) return undefined;
		this.#session = checkpoint;
		if (this.isTerminal(checkpoint)) return checkpoint;
		if (!(await this.adapters.isAttached(checkpoint.tabId))) return this.interrupt('worker_restarted');
		if (checkpoint.state === 'draining') this.scheduleDrain(checkpoint);
		return checkpoint;
	}

	private async interrupt(reason: StopReason, coverage?: CoverageSummary): Promise<TraceSession | undefined> {
		if (!this.#session || this.isTerminal(this.#session)) return this.#session;
		return this.finish('interrupted', reason, coverage);
	}

	private scheduleDrain(session: TraceSession): void {
		this.clearDrainTimer();
		const delay = Math.max(0, (session.drainDeadlineMs ?? this.clock.nowMs()) - this.clock.nowMs());
		this.#drainTimer = this.clock.setTimeout(async () => { await this.finish('stopped', 'user_stopped'); }, delay);
	}

	private async finish(state: 'stopped' | 'interrupted', reason: StopReason, coverage?: CoverageSummary): Promise<TraceSession> {
		this.clearDrainTimer();
		const completed = await this.transition({ state, stopReason: reason, stoppedAt: this.clock.nowIso(), drainDeadlineMs: undefined, ...(coverage ? { coverage } : {}) });
		await this.safeDetach(completed.tabId);
		await this.finalizeAndClear(completed);
		return completed;
	}

	private async transition(change: Partial<TraceSession> & Pick<TraceSession, 'state'>): Promise<TraceSession> {
		if (!this.#session) throw new Error('No session to transition.');
		this.#session = { ...this.#session, ...change };
		await this.store.save(this.#session);
		return this.#session;
	}

	private async finalizeAndClear(session: TraceSession): Promise<void> { await this.finalizer.finalize(session); await this.store.clear(); }
	private async safeDetach(tabId: number): Promise<void> { try { await this.adapters.detach(tabId); } catch { /* terminal cleanup is best-effort */ } }
	private clearDrainTimer(): void { if (this.#drainTimer !== undefined) this.clock.clearTimeout(this.#drainTimer); this.#drainTimer = undefined; }
	private isTerminal(session: TraceSession): boolean { return ['stopped', 'interrupted', 'error'].includes(session.state); }
}
