import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { benchmarkThresholds, createBenchmarkInput, evaluateBenchmark } from '../test-fixtures/benchmark.js';
import { createSafeFixtureSnapshot } from '../test-fixtures/export-snapshot.js';
import { fixtureScenarios, fixtureSecrets } from '../test-fixtures/ground-truth.js';

const requiredScenarios = [
	'healthy-click',
	'uncaught-exception',
	'validation-visible',
	'validation-hidden',
	'patch-without-ui',
	'silent-click',
	'polling-overlap',
	'analytics-overlap',
	'websocket-background-receive',
	'websocket-send',
	'click-submit-chain',
	'rapid-actions',
	'request-outlives-window',
	'same-origin-reload',
	'cross-origin-coverage-loss',
	'child-frame-action',
	'debugger-detach',
	'storage-quota',
	'secret-redaction',
] as const;

describe('deterministic fixture harness', () => {
	it('covers every RFC Section 26.2 scenario with non-page ground truth', async () => {
		expect(fixtureScenarios.map((scenario) => scenario.id)).toEqual(requiredScenarios);

		const pageSource = await Promise.all([
			readFile('test-fixtures/app/app.js', 'utf8'),
			readFile('test-fixtures/app/index.html', 'utf8'),
		])
			.then((sources) => sources.join('\n'));
		for (const scenario of fixtureScenarios) {
			expect(pageSource).toContain(scenario.action);
		}
		expect(pageSource).not.toContain('expectedOwners');
	});

	it('passes the precision, recall, and reason-code release gates for fixture truth', () => {
		const report = evaluateBenchmark(createBenchmarkInput(fixtureScenarios));

		expect(report.precision).toBeGreaterThanOrEqual(benchmarkThresholds.precision);
		expect(report.recall).toBeGreaterThanOrEqual(benchmarkThresholds.recall);
		expect(report.missingReasonCodes).toEqual([]);
		expect(report.passes).toBe(true);
	});

	it('fails the release gate for a false positive, missed trace, or missing reason code', () => {
		const baseline = createBenchmarkInput(fixtureScenarios);
		const falsePositive = baseline.map((result) =>
			result.expected === 'background' ? { ...result, actual: 'trace' as const } : result,
		);
		const missedTrace = baseline.map((result) =>
			result.expected === 'trace' ? { ...result, actual: 'background' as const } : result,
		);
		const missingReason = baseline.map((result, index) => (index === 0 ? { ...result, reasons: [] } : result));

		expect(evaluateBenchmark(falsePositive).passes).toBe(false);
		expect(evaluateBenchmark(missedTrace).passes).toBe(false);
		expect(evaluateBenchmark(missingReason).passes).toBe(false);
	});

	it('redacts every configured fixture secret from export snapshots', () => {
		const snapshot = createSafeFixtureSnapshot(fixtureSecrets.join(' '));

		expect(snapshot).toBe('[REDACTED] [REDACTED] [REDACTED]');
		for (const secret of fixtureSecrets) {
			expect(snapshot).not.toContain(secret);
		}
	});

	it('has a stable export snapshot entry for every fixture scenario', async () => {
		const snapshot = JSON.parse(await readFile('test-fixtures/snapshots/exports.json', 'utf8')) as {
			scenarios: Record<string, unknown>;
		};

		expect(Object.keys(snapshot.scenarios)).toEqual(requiredScenarios);
		const serializedSnapshot = JSON.stringify(snapshot);
		for (const secret of fixtureSecrets) {
			expect(serializedSnapshot).not.toContain(secret);
		}
	});
});
