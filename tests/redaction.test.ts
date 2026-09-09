import { describe, expect, it } from 'vitest';

import { calibrateClocks } from '../src/engine/normalize/clock.js';
import { normalizeSourceEvent } from '../src/engine/normalize/evidence.js';
import { redactForExport } from '../src/engine/redact/redact.js';
import { TraceRepository } from '../src/storage/trace-repository.js';
import { fixtureSecrets } from '../test-fixtures/ground-truth.js';

const secrets = [...fixtureSecrets];
const calibration = calibrateClocks({
	sessionStartedCdpSeconds: 10,
	cdpHandshakeSeconds: 12,
	probeEpochMilliseconds: 1_700_000_000_000,
	roundTripMilliseconds: 2,
});

describe('ingestion-time redaction', () => {
	it('redacts URL credentials, fragments, sensitive query values, and configured literals', () => {
		const value = redactForExport(
			{ url: 'https://user:pass@example.test/path?token=abc&safe=ok#fragment', message: `failed for ${secrets[2]}` },
			{ configuredSecrets: secrets },
		);

		expect(value.value).toEqual({ url: 'https://example.test/path?token=%5BREDACTED%5D&safe=ok', message: 'failed for [REDACTED]' });
		expect(value.redaction).toEqual({ applied: true, fields: ['payload.url', 'payload.message'] });
	});

	it('keeps only safe allowlisted headers and reports discarded header paths', () => {
		const value = redactForExport(
			{ headers: { 'content-type': 'application/json', authorization: secrets[0], 'x-request-id': 'opaque' } },
			{ configuredSecrets: secrets },
		);

		expect(value.value).toEqual({ headers: { 'content-type': 'application/json' } });
		expect(value.redaction.fields).toEqual(['payload.headers.authorization', 'payload.headers.x-request-id']);
	});

	it('rejects prohibited raw payload fields before storage', () => {
		for (const field of ['body', 'inputValue', 'cookie', 'payloadData'] as const) {
			expect(() => redactForExport({ [field]: secrets[0] })).toThrow('prohibited');
		}
	});

	it('leaves known fixture secrets in neither canonical memory, repository, nor export', () => {
		const normalized = normalizeSourceEvent(
			{
				sessionId: 'secret-session', source: 'cdp', sourceSequence: 1, kind: 'console.error', timestamp: 12,
				payload: { message: `${secrets.join(' ')} Bearer extra-token`, url: `https://fixture.test/?api_key=${secrets[1]}` },
			},
			calibration,
			{ configuredSecrets: secrets },
		).event;
		const repository = new TraceRepository();
		repository.append(normalized);
		const exported = redactForExport({ timeline: repository.list() }, { configuredSecrets: secrets });

		for (const secret of secrets) {
			expect(JSON.stringify(normalized)).not.toContain(secret);
			expect(JSON.stringify(repository.list())).not.toContain(secret);
			expect(JSON.stringify(exported.value)).not.toContain(secret);
		}
		expect(normalized.redaction.fields).toEqual(['payload.message', 'payload.url']);
	});
});
