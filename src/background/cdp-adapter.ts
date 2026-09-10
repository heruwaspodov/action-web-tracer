import { CdpNetworkEvidenceCollector, type CapturedNetworkEvidence } from './network-evidence.js';
import { CdpRuntimeEvidenceCollector, type CapturedRuntimeEvidence } from './runtime-evidence.js';

export const approvedCdpDomains = ['Network', 'Runtime', 'Log', 'Page', 'Target'] as const;
export type ApprovedCdpDomain = (typeof approvedCdpDomains)[number];
export type CdpErrorCode = 'restricted_target' | 'competing_debugger' | 'protocol_error';
export type AdapterFailure = { readonly code: CdpErrorCode; readonly capability?: ApprovedCdpDomain };
export type FrameIdentity = { readonly frameId: string; readonly parentFrameId?: string; readonly isMainFrame: boolean; readonly urlOrigin?: string; readonly process: 'same_process' | 'out_of_process' };
export type CdpCapabilities = Readonly<Record<ApprovedCdpDomain, boolean>>;
export type CapturedCdpEvidence = CapturedNetworkEvidence | CapturedRuntimeEvidence;

export interface DebuggerTransport {
	attach(tabId: number, protocolVersion: string): Promise<void>;
	detach(tabId: number): Promise<void>;
	send(tabId: number, method: string, params?: object, sessionId?: string): Promise<unknown>;
	onEvent(listener: (tabId: number, method: string, params: Record<string, unknown> | undefined, sessionId?: string) => void): void;
	onDetach(listener: (tabId: number) => void): void;
}

function origin(url: unknown): string | undefined { try { return typeof url === 'string' ? new URL(url).origin : undefined; } catch { return undefined; } }
function asRecord(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function failure(error: unknown, capability?: ApprovedCdpDomain): AdapterFailure {
	const message = error instanceof Error ? error.message.toLowerCase() : '';
	if (/another debugger|already attached|debugger.*attached/u.test(message)) return { code: 'competing_debugger', capability };
	if (/cannot attach|not allowed|restricted|chrome:/u.test(message)) return { code: 'restricted_target', capability };
	return { code: 'protocol_error', capability };
}

export class CdpAdapter {
	readonly #frames = new Map<string, FrameIdentity>();
	readonly #contexts = new Map<number, string>();
	readonly #failures: AdapterFailure[] = [];
	readonly #networkEvidence = new CdpNetworkEvidenceCollector();
	readonly #runtimeEvidence = new CdpRuntimeEvidenceCollector();
	readonly #evidenceListeners: ((event: CapturedCdpEvidence) => void)[] = [];
	#tabId: number | undefined;
	#capabilities: CdpCapabilities = { Network: false, Runtime: false, Log: false, Page: false, Target: false };

	constructor(private readonly transport: DebuggerTransport) {
		transport.onEvent((tabId, method, params, sessionId) => { if (tabId === this.#tabId) void this.handleEvent(method, params, sessionId); });
		transport.onDetach((tabId) => { if (tabId === this.#tabId) this.#tabId = undefined; });
	}

	get frames(): readonly FrameIdentity[] { return [...this.#frames.values()]; }
	get executionContexts(): ReadonlyMap<number, string> { return this.#contexts; }
	get failures(): readonly AdapterFailure[] { return this.#failures; }
	get capabilities(): CdpCapabilities { return this.#capabilities; }
	onEvidence(listener: (event: CapturedCdpEvidence) => void): void { this.#evidenceListeners.push(listener); }

	async attach(tabId: number): Promise<void> {
		try { await this.transport.attach(tabId, '1.3'); } catch (error) { throw failure(error); }
		this.#tabId = tabId;
		for (const domain of approvedCdpDomains) await this.enable(domain);
	}
	async detach(): Promise<void> { if (this.#tabId !== undefined) await this.transport.detach(this.#tabId); this.#tabId = undefined; }

	private async enable(domain: ApprovedCdpDomain, sessionId?: string): Promise<void> {
		if (this.#tabId === undefined) return;
		const command = domain === 'Target' ? 'Target.setAutoAttach' : `${domain}.enable`;
		const params = domain === 'Target' ? { autoAttach: true, waitForDebuggerOnStart: false, flatten: true } : undefined;
		try {
			await this.transport.send(this.#tabId, command, params, sessionId);
			if (domain === 'Page') await this.transport.send(this.#tabId, 'Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);
			this.#capabilities = { ...this.#capabilities, [domain]: true };
		}
		catch (error) { this.#failures.push(failure(error, domain)); }
	}

	private async handleEvent(method: string, params: Record<string, unknown> | undefined, sessionId?: string): Promise<void> {
		if (!params) return;
		if (method === 'Page.frameNavigated') {
			const frame = asRecord(params.frame); const frameId = frame?.id;
			if (typeof frameId === 'string' && frame) this.#frames.set(frameId, { frameId, parentFrameId: typeof frame.parentId === 'string' ? frame.parentId : undefined, isMainFrame: typeof frame.parentId !== 'string', urlOrigin: origin(frame.url), process: 'same_process' });
		}
		if (method === 'Runtime.executionContextCreated') {
			const context = asRecord(params.context); const auxData = asRecord(context?.auxData);
			if (typeof context?.id === 'number' && typeof auxData?.frameId === 'string') this.#contexts.set(context.id, auxData.frameId);
		}
		if (method === 'Target.attachedToTarget') {
			const targetInfo = asRecord(params.targetInfo); const childSession = typeof params.sessionId === 'string' ? params.sessionId : sessionId;
			if (targetInfo?.type === 'iframe' && childSession) {
				const frameId = typeof targetInfo.targetId === 'string' ? targetInfo.targetId : childSession;
				this.#frames.set(frameId, { frameId, isMainFrame: false, urlOrigin: origin(targetInfo.url), process: 'out_of_process' });
				await Promise.all(approvedCdpDomains.filter((domain) => domain !== 'Target').map(async (domain) => this.enable(domain, childSession)));
			}
		}
		const frameId = typeof params.frameId === 'string' ? params.frameId : undefined;
		const networkEvidence = this.#networkEvidence.handle(method, params, frameId ? this.#frames.get(frameId) : undefined);
		const exceptionDetails = asRecord(params.exceptionDetails);
		const contextId = typeof params.executionContextId === 'number' ? params.executionContextId : typeof exceptionDetails?.executionContextId === 'number' ? exceptionDetails.executionContextId : undefined;
		const contextFrame = contextId === undefined ? undefined : this.#frames.get(this.#contexts.get(contextId) ?? '');
		const runtimeEvidence = this.#runtimeEvidence.handle(method, params, contextFrame);
		const evidence = [...networkEvidence, ...runtimeEvidence];
		for (const event of evidence) this.#evidenceListeners.forEach((listener) => listener(event));
	}
}

/** Thin Chrome API bridge; no CDP payload is persisted here. */
export class ChromeDebuggerTransport implements DebuggerTransport {
	#eventListeners: ((tabId: number, method: string, params: Record<string, unknown> | undefined, sessionId?: string) => void)[] = [];
	#detachListeners: ((tabId: number) => void)[] = [];
	constructor() {
		chrome.debugger.onEvent.addListener((source, method, params) => { if (source.tabId !== undefined) this.#eventListeners.forEach((listener) => listener(source.tabId!, method, params as Record<string, unknown> | undefined, source.sessionId)); });
		chrome.debugger.onDetach.addListener((source) => { if (source.tabId !== undefined) this.#detachListeners.forEach((listener) => listener(source.tabId!)); });
	}
	attach(tabId: number, protocolVersion: string): Promise<void> { return chrome.debugger.attach({ tabId }, protocolVersion); }
	detach(tabId: number): Promise<void> { return chrome.debugger.detach({ tabId }); }
	send(tabId: number, method: string, params?: object, sessionId?: string): Promise<unknown> { return chrome.debugger.sendCommand({ tabId, sessionId }, method, params as Record<string, unknown> | undefined); }
	onEvent(listener: (tabId: number, method: string, params: Record<string, unknown> | undefined, sessionId?: string) => void): void { this.#eventListeners.push(listener); }
	onDetach(listener: (tabId: number) => void): void { this.#detachListeners.push(listener); }
}
