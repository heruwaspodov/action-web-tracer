import { describe, expect, it } from 'vitest';

import { createTraceExport } from '../src/export/json-export.js';
import { markdownFilename, renderMarkdownReport } from '../src/export/markdown-report.js';

function exported() { return createTraceExport({ actionWebTracerVersion: '0.1.0', trace: { traceId: 'trace-1', type: 'action', startedAt: '2026-09-11T00:00:00.000Z', durationMs: 10, url: 'https://fixture.test?token=secret', classification: 'API_FAILURE', classificationConfidence: 'high', coverage: {}, timeline: [{ label: '<script>bad</script>' }], network: [{ status: 422 }], errors: [], uiEvidence: [], websocket: [], findings: [{ code: 'http_4xx' }], machineContext: { requestCount: 1 }, background: [{ id: 'poll' }] } as never }); }

describe('Markdown trace reports', () => {
	it('uses the RFC section order and filename convention', () => {
		const report = renderMarkdownReport(exported()); const positions = ['Summary', 'Action', 'Timeline', 'Network', 'Console and Runtime Errors', 'UI Evidence', 'WebSocket Activity', 'Findings', 'API Patterns', 'Suggested Debugging Steps', 'Machine Context'].map((title) => report.indexOf(`## ${title}`));
		expect(positions.every((position, index) => position > (positions[index - 1] ?? -1))).toBe(true);
		expect(markdownFilename('2026-09-11T00:00:00.000Z', 'My Action')).toBe('action-web-tracer-2026-09-11-my-action.md');
	});
	it('uses the same classification/count projection, labels evidence, escapes hostile text, and redacts again', () => {
		const source = exported(); const report = renderMarkdownReport(source);
		expect(report).toContain('API\\_FAILURE'); expect(report).toContain('requestCount');
		for (const label of ['Observed', 'Inferred', 'Possibly related']) expect(report).toContain(`**${label}:**`);
		expect(report).not.toContain('<script>'); expect(report).not.toContain('secret'); expect(report).toContain('%5BREDACTED%5D');
	});
});
