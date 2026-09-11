import { describe, expect, it } from 'vitest';
import { categoryState, findingLinks } from '../src/sidepanel/trace-detail.js';
describe('trace detail projection', () => {
	it('distinguishes pass, empty, and incomplete categories', () => { expect(categoryState([{ id: 'e1', label: 'Request' }], true).tone).toBe('pass'); expect(categoryState([], true).tone).toBe('empty'); expect(categoryState([], false).tone).toBe('incomplete'); });
	it('links findings only to supporting evidence and preserves background distinction', () => { const detail = { traceId: 't', classification: 'API_FAILURE', categories: { network: [{ id: 'n1', label: '422' }], background: [{ id: 'b1', label: 'Polling', background: true }] }, findings: [{ code: 'http_4xx', evidenceIds: ['n1', 'missing'] }] } as const; expect(findingLinks(detail)).toEqual({ http_4xx: ['n1'] }); expect(detail.categories.background[0].background).toBe(true); });
});
