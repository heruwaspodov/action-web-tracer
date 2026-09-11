import { describe, expect, it } from 'vitest';
import { MAX_PROBE_MESSAGE_BYTES, validateProbeMessage } from '../src/background/probe-message.js';
const sender = { id: 'extension', tab: { id: 7 }, frameId: 0 };
describe('probe message boundary', () => {
	it('accepts only extension-owned, tab/frame-scoped schema-valid messages', () => { expect(validateProbeMessage({ type: 'awt.probe.heartbeat', timestamp: 1 }, sender, 'extension')).toBe(true); expect(validateProbeMessage({ type: 'forged' }, sender, 'extension')).toBe(false); expect(validateProbeMessage({ type: 'awt.probe.action' }, { ...sender, id: 'other' }, 'extension')).toBe(false); });
	it('rejects oversized and malformed hostile input', () => { expect(validateProbeMessage({ type: 'awt.probe.action', text: 'x'.repeat(MAX_PROBE_MESSAGE_BYTES) }, sender, 'extension')).toBe(false); expect(validateProbeMessage({ type: 'awt.probe.action', timestamp: 'now' }, sender, 'extension')).toBe(false); });
});
