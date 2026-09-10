import { PROBE_HEARTBEAT_MS, UiMutationBatcher, type UiEvidence, type UiMutation } from './ui-evidence.js';

export const CLICK_SUBMIT_DEDUPE_MS = 250;
export const MAX_ACTION_LABEL_LENGTH = 120;
export const MAX_SELECTOR_HINT_LENGTH = 240;

export type ActionKind = 'click' | 'submit';
export type ActionTarget = { readonly tag: string; readonly role?: string; readonly label?: string; readonly id?: string; readonly name?: string; readonly type?: string; readonly selectorHint: string; readonly framePath: readonly string[] };
export type ObservedAction = { readonly kind: ActionKind; readonly timestamp: number; readonly target: ActionTarget; readonly triggerChain?: readonly ActionKind[]; readonly frame: { readonly isMainFrame: boolean } };
export type ProbeElement = { readonly tagName?: unknown; readonly id?: unknown; readonly name?: unknown; readonly type?: unknown; readonly textContent?: unknown; readonly isContentEditable?: unknown; readonly parentElement?: ProbeElement | null; readonly labels?: Iterable<ProbeElement> | null; getAttribute?(name: string): string | null; closest?(selector: string): ProbeElement | null };
export type ProbeEvent = { readonly isTrusted: boolean; readonly target: EventTarget | ProbeElement | null };
export type ProbeClock = { nowEpochMilliseconds(): number; setTimeout(callback: () => void, delayMs: number): unknown; clearTimeout(handle: unknown): void };
export type ProbeContext = { readonly framePath: readonly string[]; readonly isMainFrame: boolean };
type PendingClick = { readonly timestamp: number; readonly target: ProbeElement; readonly form: ProbeElement | null; readonly timer: unknown };

function normalizeText(value: unknown, maximum: number): string | undefined { if (typeof value !== 'string') return undefined; const normalized = value.replace(/\s+/gu, ' ').trim(); return normalized ? normalized.slice(0, maximum) : undefined; }
function attribute(element: ProbeElement, name: string): string | undefined { return normalizeText(element.getAttribute?.(name), MAX_SELECTOR_HINT_LENGTH); }
function tagName(element: ProbeElement): string { return typeof element.tagName === 'string' && /^[a-z][a-z0-9-]*$/iu.test(element.tagName) ? element.tagName.toLowerCase() : 'unknown'; }
function editable(element: ProbeElement | null): boolean { for (let current = element; current; current = current.parentElement ?? null) { if (current.isContentEditable === true) return true; const tag = tagName(current); if (tag === 'input' || tag === 'textarea' || tag === 'select') return true; } return false; }
function stableValue(value: string | undefined): string | undefined { return value && /^[A-Za-z][A-Za-z0-9_-]{0,119}$/u.test(value) ? value : undefined; }
function quotedAttribute(value: string | undefined): string | undefined { return value && /^[A-Za-z0-9 _.-]{1,120}$/u.test(value) ? value : undefined; }
function semanticRole(element: ProbeElement, tag: string): string | undefined { return attribute(element, 'role') ?? ({ button: 'button', a: 'link', input: 'textbox', select: 'combobox', textarea: 'textbox' } as Record<string, string | undefined>)[tag]; }
function associatedLabel(element: ProbeElement): string | undefined { for (const label of element.labels ?? []) { const text = normalizeText(label.textContent, MAX_ACTION_LABEL_LENGTH); if (text) return text; } return undefined; }
function labelFor(element: ProbeElement, tag: string): string | undefined { const ariaLabel = normalizeText(attribute(element, 'aria-label'), MAX_ACTION_LABEL_LENGTH); if (ariaLabel) return ariaLabel; const label = associatedLabel(element); if (label) return label; if (!editable(element) && (tag === 'button' || tag === 'a' || semanticRole(element, tag) === 'button')) return normalizeText(element.textContent, MAX_ACTION_LABEL_LENGTH); return undefined; }
function selectorHintFor(element: ProbeElement, tag: string, id: string | undefined, name: string | undefined): string { const stableId = stableValue(id); if (stableId) return `#${stableId}`; for (const attributeName of ['data-testid', 'data-test-id', 'data-qa'] as const) { const value = quotedAttribute(attribute(element, attributeName)); if (value) return `${tag}[${attributeName}="${value}"]`.slice(0, MAX_SELECTOR_HINT_LENGTH); } const stableName = quotedAttribute(name); return (stableName ? `${tag}[name="${stableName}"]` : tag).slice(0, MAX_SELECTOR_HINT_LENGTH); }
function asElement(target: ProbeEvent['target']): ProbeElement | undefined { if (!target || typeof target !== 'object') return undefined; const candidate = target as ProbeElement; if (typeof candidate.tagName === 'string') return candidate; return candidate.parentElement ?? undefined; }
function containingForm(element: ProbeElement): ProbeElement | null { return element.closest?.('form') ?? (tagName(element) === 'form' ? element : null); }

export function compactActionTarget(element: ProbeElement, framePath: readonly string[]): ActionTarget {
	const tag = tagName(element); const id = stableValue(normalizeText(element.id, MAX_SELECTOR_HINT_LENGTH)); const name = stableValue(normalizeText(element.name, MAX_SELECTOR_HINT_LENGTH)); const type = stableValue(normalizeText(element.type, MAX_SELECTOR_HINT_LENGTH)); const role = semanticRole(element, tag); const label = labelFor(element, tag);
	return { tag, ...(role ? { role } : {}), ...(label ? { label } : {}), ...(id ? { id } : {}), ...(name ? { name } : {}), ...(type ? { type } : {}), selectorHint: selectorHintFor(element, tag, id, name), framePath: [...framePath] };
}

/** Captures only platform-trusted actions; page code cannot synthesize a trusted event. */
export class TrustedActionObserver {
	#pendingClick: PendingClick | undefined;
	constructor(private readonly clock: ProbeClock, private readonly context: ProbeContext, private readonly emit: (action: ObservedAction) => void) {}
	handleClick(event: ProbeEvent): void { if (!event.isTrusted) return; const target = asElement(event.target); if (!target) return; this.flushPendingClick(); const timestamp = this.clock.nowEpochMilliseconds(); const timer = this.clock.setTimeout(() => this.flushPendingClick(), CLICK_SUBMIT_DEDUPE_MS); this.#pendingClick = { timestamp, target, form: containingForm(target), timer }; }
	handleSubmit(event: ProbeEvent): void { if (!event.isTrusted) return; const target = asElement(event.target); if (!target) return; const pending = this.#pendingClick; const now = this.clock.nowEpochMilliseconds(); if (pending && now - pending.timestamp <= CLICK_SUBMIT_DEDUPE_MS && pending.form !== null && pending.form === containingForm(target)) { this.clock.clearTimeout(pending.timer); this.#pendingClick = undefined; this.emit(this.action('submit', pending.timestamp, pending.target, ['click', 'submit'])); return; } this.flushPendingClick(); this.emit(this.action('submit', now, target)); }
	disconnect(): void { this.flushPendingClick(); }
	private flushPendingClick(): void { const pending = this.#pendingClick; if (!pending) return; this.clock.clearTimeout(pending.timer); this.#pendingClick = undefined; this.emit(this.action('click', pending.timestamp, pending.target)); }
	private action(kind: ActionKind, timestamp: number, target: ProbeElement, triggerChain?: readonly ActionKind[]): ObservedAction { return { kind, timestamp, target: compactActionTarget(target, this.context.framePath), ...(triggerChain ? { triggerChain } : {}), frame: { isMainFrame: this.context.isMainFrame } }; }
}

function installPageProbe(): void {
	if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
	const isMainFrame = window.top === window;
	const clock: ProbeClock = { nowEpochMilliseconds: () => performance.timeOrigin + performance.now(), setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs), clearTimeout: (handle) => globalThis.clearTimeout(handle as number) };
	const observer = new TrustedActionObserver(clock, { framePath: [isMainFrame ? 'top' : 'child'], isMainFrame }, (action) => { chrome.runtime.sendMessage({ type: 'awt.probe.action', action }); });
	const frame = { isMainFrame };
	const emitUiEvidence = (evidence: UiEvidence) => { chrome.runtime.sendMessage({ type: 'awt.probe.ui_evidence', timestamp: clock.nowEpochMilliseconds(), frame, evidence }); };
	const batcher = new UiMutationBatcher(clock, emitUiEvidence);
	const mutationObserver = new MutationObserver((records) => {
		batcher.push(records.map((record): UiMutation => ({ type: record.type, target: record.target as never, attributeName: record.attributeName, addedNodes: Array.from(record.addedNodes), removedNodes: Array.from(record.removedNodes) })));
	});
	mutationObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-selected', 'aria-checked', 'aria-invalid', 'disabled', 'hidden', 'open'] });
	document.addEventListener('click', (event) => observer.handleClick(event), true);
	document.addEventListener('submit', (event) => observer.handleSubmit(event), true);
	document.addEventListener('focusin', () => emitUiEvidence({ signals: ['focus_changed'], count: 1 }), true);
	window.addEventListener('popstate', () => emitUiEvidence({ signals: ['url_changed'], count: 1 }));
	window.addEventListener('hashchange', () => emitUiEvidence({ signals: ['url_changed'], count: 1 }));
	if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => emitUiEvidence({ signals: ['geometry_changed'], count: 1 })).observe(document.documentElement);
	let lastUrl = location.href;
	globalThis.setInterval(() => {
		if (location.href !== lastUrl) { lastUrl = location.href; emitUiEvidence({ signals: ['url_changed'], count: 1 }); }
		chrome.runtime.sendMessage({ type: 'awt.probe.heartbeat', timestamp: clock.nowEpochMilliseconds(), frame });
	}, PROBE_HEARTBEAT_MS);
}

installPageProbe();
