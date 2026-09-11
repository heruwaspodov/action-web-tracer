export const MAX_PROBE_MESSAGE_BYTES = 32_768;
export type ProbeSender = { readonly tab?: { readonly id?: number }; readonly frameId?: number; readonly id?: string };
export type ProbeMessage = { readonly type: 'awt.probe.action' | 'awt.probe.ui_evidence' | 'awt.probe.heartbeat'; readonly timestamp?: number; readonly frame?: { readonly isMainFrame: boolean } };
export function validateProbeMessage(message: unknown, sender: ProbeSender, extensionId: string): message is ProbeMessage {
	if (sender.id !== extensionId || sender.tab?.id === undefined || typeof sender.frameId !== 'number' || !message || typeof message !== 'object') return false;
	const size = (() => { try { return new TextEncoder().encode(JSON.stringify(message)).byteLength; } catch { return undefined; } })();
	if (size === undefined) return false;
	if (size > MAX_PROBE_MESSAGE_BYTES) return false;
	const candidate = message as Record<string, unknown>;
	if (!['awt.probe.action', 'awt.probe.ui_evidence', 'awt.probe.heartbeat'].includes(candidate.type as string)) return false;
	return candidate.timestamp === undefined || typeof candidate.timestamp === 'number' && Number.isFinite(candidate.timestamp);
}
