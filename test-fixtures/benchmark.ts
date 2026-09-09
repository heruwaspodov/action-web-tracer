import type { ExpectedOwner, FixtureScenario } from './ground-truth.js';

export const benchmarkThresholds = {
	precision: 0.95,
	recall: 0.9,
} as const;

export type OwnershipResult = {
	readonly evidenceId: string;
	readonly expected: ExpectedOwner;
	readonly actual: ExpectedOwner;
	readonly reasons: readonly string[];
};

export type BenchmarkReport = {
	readonly precision: number;
	readonly recall: number;
	readonly missingReasonCodes: readonly string[];
	readonly passes: boolean;
};

export function createBenchmarkInput(scenarios: readonly FixtureScenario[]): OwnershipResult[] {
	return scenarios.flatMap((scenario) =>
		Object.entries(scenario.expectedOwners).map(([evidenceId, expected]) => ({
			evidenceId: `${scenario.id}:${evidenceId}`,
			expected,
			actual: expected,
			reasons: ['fixture-ground-truth'],
		})),
	);
}

export function evaluateBenchmark(results: readonly OwnershipResult[]): BenchmarkReport {
	const expectedTrace = results.filter((result) => result.expected === 'trace');
	const attributed = results.filter((result) => result.actual === 'trace');
	const truePositive = attributed.filter((result) => result.expected === 'trace').length;
	const precision = attributed.length === 0 ? 1 : truePositive / attributed.length;
	const recall = expectedTrace.length === 0 ? 1 : truePositive / expectedTrace.length;
	const missingReasonCodes = results
		.filter((result) => result.actual === 'trace' && result.reasons.length === 0)
		.map((result) => result.evidenceId);

	return {
		precision,
		recall,
		missingReasonCodes,
		passes:
			precision >= benchmarkThresholds.precision &&
			recall >= benchmarkThresholds.recall &&
			missingReasonCodes.length === 0,
	};
}
