import { redactForExport } from '../engine/redact/redact.js';
import type { JsonValue } from '../model/evidence.js';
import type { TraceExportV1 } from './json-export.js';

function escapeMarkdown(value: unknown): string { return String(value).replace(/[\\`*_{}[\]<>]/gu, (character) => `\\${character}`).replace(/\r?\n/gu, ' '); }
function entries(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : []; }
function section(title: string, content: string): string { return `## ${title}\n\n${content || '_None captured._'}`; }
function list(label: 'Observed' | 'Inferred' | 'Possibly related', value: unknown): string { const items = entries(value); return items.length ? items.map((item) => `- **${label}:** \`${escapeMarkdown(JSON.stringify(item))}\``).join('\n') : '_None captured._'; }

export function markdownFilename(startedAt: string, slug = 'trace'): string { return `action-web-tracer-${startedAt.slice(0, 10)}-${slug.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase() || 'trace'}.md`; }

/** Renders only from the JSON projection, then applies the mandatory defensive second redaction pass. */
export function renderMarkdownReport(exported: TraceExportV1): string {
	const safe = redactForExport(exported as unknown as JsonValue).value as unknown as TraceExportV1;
	const trace = safe.trace; const machine = trace.machineContext as Record<string, unknown>;
	return [
		'---', `schemaVersion: ${safe.schemaVersion}`, `classification: ${escapeMarkdown(trace.classification)}`, '---',
		section('Summary', `**Observed:** Classification ${escapeMarkdown(trace.classification)}; duration ${trace.durationMs} ms.`),
		section(trace.type === 'action' ? 'Action' : 'Page Load', `**Observed:** ${escapeMarkdown(trace.url)}`),
		section('Timeline', list('Observed', trace.timeline)), section('Network', list('Observed', trace.network)),
		section('Console and Runtime Errors', list('Observed', trace.errors)), section('UI Evidence', list('Observed', trace.uiEvidence)),
		section('WebSocket Activity', list('Observed', trace.websocket)), section('Findings', list('Inferred', trace.findings)),
		section('API Patterns', list('Possibly related', (trace as Record<string, unknown>).background)),
		section('Suggested Debugging Steps', '**Inferred:** Follow the debugging steps attached to findings.'),
		section('Machine Context', `**Observed:** ${escapeMarkdown(JSON.stringify(machine))}`),
	].join('\n\n');
}
