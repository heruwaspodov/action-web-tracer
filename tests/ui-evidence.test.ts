import { describe, expect, it } from 'vitest';

import { MAX_UI_MUTATIONS_PER_BATCH, PROBE_HEARTBEAT_MS, ProbeHeartbeatMonitor, UI_MUTATION_BATCH_MS, UiMutationBatcher, isSemanticVisible, reduceUiMutations, type UiBatchClock, type UiElement } from '../src/probe/ui-evidence.js';

function element(overrides: Partial<UiElement> = {}): UiElement { return { tagName: 'DIV', getAttribute: () => null, ...overrides }; }
class Clock implements UiBatchClock {
	callback: (() => void) | undefined; delay = 0;
	setTimeout(callback: () => void, delayMs: number): number { this.callback = callback; this.delay = delayMs; return 1; }
	clearTimeout(): void { this.callback = undefined; }
	flush(): void { const callback = this.callback; this.callback = undefined; callback?.(); }
}

describe('semantic UI evidence', () => {
	it('emits visible, accessibility, and text signals without retaining text or nodes', () => {
		const target = element(); const added = element();
		const evidence = reduceUiMutations([
			{ type: 'childList', target, addedNodes: [added] },
			{ type: 'attributes', target, attributeName: 'aria-expanded' },
			{ type: 'characterData', target },
		]);
		expect(evidence).toEqual({ signals: ['accessibility_state_changed', 'text_changed', 'visible_added'], count: 3 });
		expect(JSON.stringify(evidence)).not.toContain('textContent');
	});

	it('emits a title signal rather than persisting title text', () => {
		const title = element({ tagName: 'TITLE' });
		expect(reduceUiMutations([{ type: 'characterData', target: element({ parentElement: title }) }])).toEqual({ signals: ['title_changed'], count: 1 });
	});

	it('filters hidden, extension-owned, non-semantic, and off-screen noise', () => {
		const hidden = element({ hidden: true });
		const extensionOwned = element({ closest: (selector) => selector === '[data-action-web-tracer]' ? element() : null });
		const script = element({ tagName: 'SCRIPT' });
		const offscreen = element({ getBoundingClientRect: () => ({ top: 900, left: 0, bottom: 920, right: 10 }) });
		expect(isSemanticVisible(hidden)).toBe(false);
		expect(isSemanticVisible(extensionOwned)).toBe(false);
		expect(reduceUiMutations([{ type: 'attributes', target: script, attributeName: 'class' }, { type: 'attributes', target: offscreen, attributeName: 'class' }])).toBeUndefined();
	});

	it('reduces and discards raw records once per 50 ms batch', () => {
		const clock = new Clock(); const emitted: unknown[] = []; const batcher = new UiMutationBatcher(clock, (evidence) => emitted.push(evidence));
		batcher.push([{ type: 'attributes', target: element(), attributeName: 'hidden' }]);
		batcher.push([{ type: 'characterData', target: element() }]);
		expect(clock.delay).toBe(UI_MUTATION_BATCH_MS);
		clock.flush();
		expect(emitted).toEqual([{ signals: ['accessibility_state_changed', 'text_changed'], count: 2 }]);
		batcher.flush();
		expect(emitted).toHaveLength(1);
	});

	it('bounds the temporary mutation batch to protect observer work', () => {
		const clock = new Clock(); const emitted: { count: number }[] = []; const batcher = new UiMutationBatcher(clock, (evidence) => emitted.push(evidence));
		batcher.push(Array.from({ length: MAX_UI_MUTATIONS_PER_BATCH + 1 }, () => ({ type: 'characterData' as const, target: element() })));
		clock.flush();
		expect(emitted[0].count).toBe(MAX_UI_MUTATIONS_PER_BATCH);
	});

	it('marks a frame degraded after two missed heartbeats', () => {
		const monitor = new ProbeHeartbeatMonitor(); monitor.observe({ frameKey: 'child-1', timestamp: 100 });
		expect(monitor.degradedFrames(100 + PROBE_HEARTBEAT_MS * 2)).toEqual([]);
		expect(monitor.degradedFrames(101 + PROBE_HEARTBEAT_MS * 2)).toEqual(['child-1']);
	});
});
