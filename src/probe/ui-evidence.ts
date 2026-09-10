export const UI_MUTATION_BATCH_MS = 50;
export const MAX_UI_MUTATIONS_PER_BATCH = 500;
export const PROBE_HEARTBEAT_MS = 5_000;
export const PROBE_HEARTBEAT_MISSES_BEFORE_DEGRADED = 2;

export type UiSignal =
	| 'visible_added'
	| 'visible_removed'
	| 'text_changed'
	| 'accessibility_state_changed'
	| 'focus_changed'
	| 'url_changed'
	| 'title_changed'
	| 'geometry_changed';

export type UiEvidence = { readonly signals: readonly UiSignal[]; readonly count: number };
export type UiElement = {
	readonly tagName?: unknown;
	readonly parentElement?: UiElement | null;
	readonly hidden?: unknown;
	getAttribute?(name: string): string | null;
	closest?(selector: string): UiElement | null;
	getBoundingClientRect?(): { readonly top: number; readonly left: number; readonly bottom: number; readonly right: number };
};
export type UiMutation = {
	readonly type: 'childList' | 'attributes' | 'characterData';
	readonly target: UiElement;
	readonly attributeName?: string | null;
	readonly addedNodes?: Iterable<unknown>;
	readonly removedNodes?: Iterable<unknown>;
};

const ignoredTags = new Set(['script', 'style', 'link', 'meta']);
const accessibilityAttributes = new Set(['aria-expanded', 'aria-selected', 'aria-checked', 'aria-invalid', 'disabled', 'hidden', 'open']);

function elementFrom(value: unknown): UiElement | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const element = value as UiElement;
	return typeof element.tagName === 'string' ? element : element.parentElement ?? undefined;
}

function tagName(element: UiElement): string { return typeof element.tagName === 'string' ? element.tagName.toLowerCase() : ''; }
function isTitleElement(element: UiElement): boolean { return tagName(element) === 'title' || tagName(element.parentElement ?? {} as UiElement) === 'title'; }

export function isSemanticVisible(element: UiElement, viewport = { width: 1_024, height: 768 }): boolean {
	for (let current: UiElement | null = element; current; current = current.parentElement ?? null) {
		if (current.hidden === true || current.getAttribute?.('aria-hidden') === 'true' || ignoredTags.has(tagName(current))) return false;
		if (current.closest?.('[data-action-web-tracer]')) return false;
	}
	const rectangle = element.getBoundingClientRect?.();
	return !rectangle || (rectangle.bottom >= 0 && rectangle.right >= 0 && rectangle.top <= viewport.height && rectangle.left <= viewport.width);
}

export function reduceUiMutations(records: readonly UiMutation[]): UiEvidence | undefined {
	const signals = new Set<UiSignal>();
	let count = 0;
	for (const record of records) {
		if (!isSemanticVisible(record.target)) continue;
		if (record.type === 'attributes') {
			if (record.attributeName && accessibilityAttributes.has(record.attributeName)) { signals.add('accessibility_state_changed'); count += 1; }
			continue;
		}
		if (record.type === 'characterData') { signals.add(isTitleElement(record.target) ? 'title_changed' : 'text_changed'); count += 1; continue; }
		if (isTitleElement(record.target)) { signals.add('title_changed'); count += 1; continue; }
		for (const node of record.addedNodes ?? []) if (elementFrom(node) && isSemanticVisible(elementFrom(node)!)) { signals.add('visible_added'); count += 1; }
		for (const node of record.removedNodes ?? []) { if (elementFrom(node) || isSemanticVisible(record.target)) { signals.add('visible_removed'); count += 1; } }
	}
	return count ? { signals: [...signals].sort(), count } : undefined;
}

export type UiBatchClock = { setTimeout(callback: () => void, delayMs: number): unknown; clearTimeout(handle: unknown): void };

/** Holds raw mutation inputs only until the next bounded 50 ms reduction. */
export class UiMutationBatcher {
	#records: UiMutation[] = [];
	#timer: unknown;
	constructor(private readonly clock: UiBatchClock, private readonly emit: (evidence: UiEvidence) => void) {}
	push(records: readonly UiMutation[]): void {
		this.#records.push(...records.slice(0, Math.max(0, MAX_UI_MUTATIONS_PER_BATCH - this.#records.length)));
		if (this.#timer === undefined) this.#timer = this.clock.setTimeout(() => this.flush(), UI_MUTATION_BATCH_MS);
	}
	flush(): void {
		if (this.#timer !== undefined) this.clock.clearTimeout(this.#timer);
		this.#timer = undefined;
		const records = this.#records;
		this.#records = [];
		const evidence = reduceUiMutations(records);
		if (evidence) this.emit(evidence);
	}
	disconnect(): void { this.#records = []; if (this.#timer !== undefined) this.clock.clearTimeout(this.#timer); this.#timer = undefined; }
}

export type Heartbeat = { readonly frameKey: string; readonly timestamp: number };
export class ProbeHeartbeatMonitor {
	#lastSeen = new Map<string, number>();
	observe(heartbeat: Heartbeat): void { this.#lastSeen.set(heartbeat.frameKey, heartbeat.timestamp); }
	degradedFrames(now: number): readonly string[] {
		const deadline = PROBE_HEARTBEAT_MS * PROBE_HEARTBEAT_MISSES_BEFORE_DEGRADED;
		return [...this.#lastSeen].filter(([, lastSeen]) => now - lastSeen > deadline).map(([frameKey]) => frameKey);
	}
}
