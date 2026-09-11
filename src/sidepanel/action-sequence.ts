import type { WaterfallRow } from './waterfall.js';
export type SequenceNode = { readonly evidenceId?: string; readonly status: 'observed' | 'possibly_related' | 'missing_ui'; readonly offsetMs: number; readonly label: string };
export function projectActionSequence(rows: readonly WaterfallRow[], classification: string, expandedBackground = false): readonly SequenceNode[] {
	const visible = rows.filter((row) => expandedBackground || row.lane !== 'background');
	const nodes: SequenceNode[] = visible.map((row) => ({ evidenceId: row.evidenceId, status: row.lane === 'background' ? 'possibly_related' : 'observed', offsetMs: row.offsetMs, label: `${row.lane}: ${row.state}` }));
	if (classification === 'UI_SYNC_FAILURE' && !rows.some((row) => row.lane === 'ui')) nodes.push({ status: 'missing_ui', offsetMs: Math.max(0, ...rows.map((row) => row.offsetMs)), label: 'No meaningful UI evidence observed' });
	return nodes.sort((left, right) => left.offsetMs - right.offsetMs || (left.evidenceId ?? '').localeCompare(right.evidenceId ?? ''));
}
