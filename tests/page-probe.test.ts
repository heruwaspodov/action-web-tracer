import { describe, expect, it } from 'vitest';

import { CLICK_SUBMIT_DEDUPE_MS, MAX_ACTION_LABEL_LENGTH, TrustedActionObserver, compactActionTarget, type ProbeClock, type ProbeElement } from '../src/probe/page-probe.js';

class FakeClock implements ProbeClock {
	now = 1_000; #callbacks = new Map<number, () => void>(); #next = 0;
	nowEpochMilliseconds(): number { return this.now; }
	setTimeout(callback: () => void): number { const id = ++this.#next; this.#callbacks.set(id, callback); return id; }
	clearTimeout(handle: unknown): void { this.#callbacks.delete(handle as number); }
	advance(milliseconds: number): void { this.now += milliseconds; }
	runTimers(): void { for (const callback of [...this.#callbacks.values()]) { this.#callbacks.clear(); callback(); } }
}
function element(overrides: Partial<ProbeElement> = {}): ProbeElement { return { tagName: 'BUTTON', getAttribute: () => null, closest: () => null, ...overrides }; }

describe('trusted action observer', () => {
	it('ignores untrusted events and attaches frame identity to trusted actions', () => { const clock = new FakeClock(); const actions: unknown[] = []; const observer = new TrustedActionObserver(clock, { framePath: ['top'], isMainFrame: true }, (action) => actions.push(action)); const button = element({ id: 'save-button', textContent: ' Save changes ' }); observer.handleClick({ isTrusted: false, target: button }); clock.runTimers(); expect(actions).toEqual([]); observer.handleClick({ isTrusted: true, target: button }); clock.runTimers(); expect(actions).toEqual([expect.objectContaining({ kind: 'click', frame: { isMainFrame: true }, target: expect.objectContaining({ framePath: ['top'], id: 'save-button', selectorHint: '#save-button', label: 'Save changes' }) })]); });
	it('merges a related click and submit inside 250 ms, preserving the click timestamp', () => { const clock = new FakeClock(); const actions: unknown[] = []; const form = element({ tagName: 'FORM' }); const button = element({ closest: (selector) => selector === 'form' ? form : null }); const observer = new TrustedActionObserver(clock, { framePath: ['child'], isMainFrame: false }, (action) => actions.push(action)); observer.handleClick({ isTrusted: true, target: button }); clock.advance(CLICK_SUBMIT_DEDUPE_MS); observer.handleSubmit({ isTrusted: true, target: form }); expect(actions).toEqual([expect.objectContaining({ kind: 'submit', timestamp: 1_000, triggerChain: ['click', 'submit'], frame: { isMainFrame: false } })]); });
	it('keeps unrelated or late submits as separate actions', () => { const clock = new FakeClock(); const actions: { kind: string }[] = []; const firstForm = element({ tagName: 'FORM' }); const secondForm = element({ tagName: 'FORM' }); const button = element({ closest: (selector) => selector === 'form' ? firstForm : null }); const observer = new TrustedActionObserver(clock, { framePath: ['top'], isMainFrame: true }, (action) => actions.push(action)); observer.handleClick({ isTrusted: true, target: button }); clock.advance(CLICK_SUBMIT_DEDUPE_MS + 1); observer.handleSubmit({ isTrusted: true, target: secondForm }); expect(actions.map((action) => action.kind)).toEqual(['click', 'submit']); });
	it('never reads editable values or content, while bounding stable metadata', () => { const editable = element({ tagName: 'INPUT', id: 'email-input', name: 'email', type: 'email', textContent: 'secret value', isContentEditable: false }); const target = compactActionTarget(editable, ['top']); expect(JSON.stringify(target)).not.toContain('secret value'); expect(target).toMatchObject({ tag: 'input', id: 'email-input', name: 'email', type: 'email', selectorHint: '#email-input', framePath: ['top'] }); expect(target.label).toBeUndefined(); const longButton = element({ textContent: 'x'.repeat(MAX_ACTION_LABEL_LENGTH + 40) }); expect(compactActionTarget(longButton, ['top']).label).toHaveLength(MAX_ACTION_LABEL_LENGTH); });
});
