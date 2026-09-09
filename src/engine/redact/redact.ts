import type { JsonValue, RedactionSummary } from '../../model/evidence.js';

const allowedHeaders = new Set(['cache-control', 'content-length', 'content-type', 'server-timing']);
const sensitiveQueryKeys = new Set([
	'token', 'access_token', 'refresh_token', 'api_key', 'apikey', 'key', 'secret', 'password', 'passwd',
	'authorization', 'auth', 'session', 'cookie', 'code', 'credit_card', 'card_number', 'cvv',
]);
const prohibitedFields = new Set([
	'authorization', 'body', 'cookie', 'cookies', 'formData', 'inputValue', 'payloadData', 'requestBody', 'responseBody', 'value',
]);

export type RedactionConfig = {
	readonly configuredSecrets?: readonly string[];
};

export type Redacted<T> = {
	readonly value: T;
	readonly redaction: RedactionSummary;
};

function escapePattern(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function redactTextValue(value: string, configuredSecrets: readonly string[]): string {
	let redacted = value;
	for (const secret of configuredSecrets.filter(Boolean)) {
		redacted = redacted.replace(new RegExp(escapePattern(secret), 'gu'), '[REDACTED]');
	}
	return redacted
		.replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/giu, '[REDACTED]')
		.replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/giu, '[REDACTED]');
}

function redactUrlValue(value: string, configuredSecrets: readonly string[]): string {
	try {
		const url = new URL(value);
		url.username = '';
		url.password = '';
		url.hash = '';
		for (const [key, queryValue] of url.searchParams) {
			if (sensitiveQueryKeys.has(key.toLowerCase()) || queryValue.length > 200) url.searchParams.set(key, '[REDACTED]');
		}
		return redactTextValue(url.toString(), configuredSecrets);
	} catch {
		return redactTextValue(value, configuredSecrets);
	}
}

function redactJson(value: JsonValue, path: string, configuredSecrets: readonly string[], fields: string[]): JsonValue {
	if (typeof value === 'string') {
		const redacted = path.toLowerCase().endsWith('url') ? redactUrlValue(value, configuredSecrets) : redactTextValue(value, configuredSecrets);
		if (redacted !== value) fields.push(path);
		return redacted;
	}
	if (value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map((item, index) => redactJson(item, `${path}[${index}]`, configuredSecrets, fields));

	const result: Record<string, JsonValue> = {};
	for (const [key, nested] of Object.entries(value)) {
		const fieldPath = `${path}.${key}`;
		if (prohibitedFields.has(key)) throw new Error(`${fieldPath} is prohibited in canonical evidence.`);
		if (key.toLowerCase() === 'headers') {
			if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) throw new Error(`${fieldPath} must be a header map.`);
			const headers: Record<string, JsonValue> = {};
			for (const [headerName, headerValue] of Object.entries(nested)) {
				if (!allowedHeaders.has(headerName.toLowerCase())) {
					fields.push(`${fieldPath}.${headerName}`);
					continue;
				}
				if (typeof headerValue !== 'string' && typeof headerValue !== 'number') throw new Error(`${fieldPath}.${headerName} must be a string or number.`);
				headers[headerName.toLowerCase()] = redactTextValue(String(headerValue), configuredSecrets);
			}
			result[key] = headers;
			continue;
		}
		result[key] = redactJson(nested, fieldPath, configuredSecrets, fields);
	}
	return result;
}

export function redactAtIngestion(value: JsonValue, config: RedactionConfig = {}): Redacted<JsonValue> {
	const fields: string[] = [];
	const redacted = redactJson(value, 'payload', config.configuredSecrets ?? [], fields);
	return { value: redacted, redaction: { applied: fields.length > 0, fields } };
}

/** Defensive second pass for every export projection. */
export function redactForExport<T extends JsonValue>(value: T, config: RedactionConfig = {}): Redacted<T> {
	return redactAtIngestion(value, config) as Redacted<T>;
}
