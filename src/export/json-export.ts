import { redactForExport } from '../engine/redact/redact.js';
import { CORRELATION_RULES_VERSION } from '../engine/correlation/correlate.js';
import type { JsonValue } from '../model/evidence.js';

export const TRACE_EXPORT_SCHEMA_VERSION = 1;
const forbiddenKeys = new Set(['tabId', 'deviceId', 'deviceIdentifier', 'authorization', 'body', 'cookie', 'cookies', 'formData', 'inputValue', 'payloadData', 'requestBody', 'responseBody', 'value']);

export type TraceExportInput = {
	readonly actionWebTracerVersion: string;
	readonly trace: { readonly traceId: string; readonly type: 'page' | 'action'; readonly startedAt: string; readonly durationMs: number; readonly url: string; readonly classification: string; readonly classificationConfidence: string; readonly coverage: JsonValue; readonly timeline: JsonValue; readonly network: JsonValue; readonly errors: JsonValue; readonly uiEvidence: JsonValue; readonly websocket: JsonValue; readonly findings: JsonValue; readonly machineContext: JsonValue; readonly action?: JsonValue };
};
export type TraceExportV1 = { readonly actionWebTracerVersion: string; readonly schemaVersion: 1; readonly correlationRulesVersion: number; readonly trace: TraceExportInput['trace'] };

function omitForbidden(value: JsonValue): JsonValue {
	if (value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map(omitForbidden);
	return Object.fromEntries(Object.entries(value).filter(([key]) => !forbiddenKeys.has(key)).map(([key, nested]) => [key, omitForbidden(nested)]));
}

/** Projects stable, portable data only; tab/device IDs and prohibited capture fields never cross this boundary. */
export function createTraceExport(input: TraceExportInput): TraceExportV1 {
	const safe = redactForExport(omitForbidden(input.trace) as JsonValue).value as TraceExportInput['trace'];
	return { actionWebTracerVersion: input.actionWebTracerVersion, schemaVersion: TRACE_EXPORT_SCHEMA_VERSION, correlationRulesVersion: CORRELATION_RULES_VERSION, trace: safe };
}

export function validateTraceExportV1(value: unknown): value is TraceExportV1 {
	if (!value || typeof value !== 'object') return false;
	const exportValue = value as Record<string, unknown>; const trace = exportValue.trace as Record<string, unknown> | undefined;
	return exportValue.schemaVersion === 1 && typeof exportValue.actionWebTracerVersion === 'string' && typeof exportValue.correlationRulesVersion === 'number' && !!trace && typeof trace.traceId === 'string' && (trace.type === 'page' || trace.type === 'action') && typeof trace.startedAt === 'string' && typeof trace.durationMs === 'number' && typeof trace.url === 'string';
}
