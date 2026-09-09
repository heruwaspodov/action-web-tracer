export type ExpectedOwner = 'background' | 'trace';

export type FixtureScenario = {
	readonly id: string;
	readonly description: string;
	readonly action: string;
	readonly expectedOwners: Readonly<Record<string, ExpectedOwner>>;
	readonly controls?: readonly ('debugger-detach' | 'storage-quota')[];
};

export const fixtureScenarios = [
	{
		id: 'healthy-click',
		description: 'Click, successful request, then visible UI update.',
		action: 'healthy',
		expectedOwners: { 'request:healthy': 'trace', 'ui:healthy-result': 'trace' },
	},
	{
		id: 'uncaught-exception',
		description: 'Click produces an uncaught exception and no request.',
		action: 'uncaught',
		expectedOwners: { 'runtime:fixture-error': 'trace' },
	},
	{
		id: 'validation-visible',
		description: 'Submit receives 422 and renders a validation message.',
		action: 'validation-visible',
		expectedOwners: { 'request:validation': 'trace', 'ui:validation-message': 'trace' },
	},
	{
		id: 'validation-hidden',
		description: 'Submit receives 422 without visible validation feedback.',
		action: 'validation-hidden',
		expectedOwners: { 'request:validation': 'trace' },
	},
	{
		id: 'patch-without-ui',
		description: 'Click receives PATCH 200 without visible UI evidence.',
		action: 'patch-without-ui',
		expectedOwners: { 'request:patch': 'trace' },
	},
	{
		id: 'silent-click',
		description: 'Click produces no observable evidence.',
		action: 'silent',
		expectedOwners: {},
	},
	{
		id: 'polling-overlap',
		description: 'Background polling overlaps a healthy action.',
		action: 'polling-overlap',
		expectedOwners: {
			'request:poll': 'background',
			'request:healthy': 'trace',
			'ui:healthy-result': 'trace',
		},
	},
	{
		id: 'analytics-overlap',
		description: 'Analytics traffic overlaps an otherwise healthy action.',
		action: 'analytics-overlap',
		expectedOwners: {
			'request:analytics': 'background',
			'request:healthy': 'trace',
			'ui:healthy-result': 'trace',
		},
	},
	{
		id: 'websocket-background-receive',
		description: 'A pre-existing WebSocket receives unrelated data during an action.',
		action: 'websocket-background-receive',
		expectedOwners: { 'websocket:receive': 'background', 'request:healthy': 'trace' },
	},
	{
		id: 'websocket-send',
		description: 'An action sends a WebSocket frame.',
		action: 'websocket-send',
		expectedOwners: { 'websocket:send': 'trace' },
	},
	{
		id: 'click-submit-chain',
		description: 'A related click and submit form one trigger chain.',
		action: 'click-submit-chain',
		expectedOwners: { 'request:chain-submit': 'trace' },
	},
	{
		id: 'rapid-actions',
		description: 'Two rapid actions retain independent ownership.',
		action: 'rapid-actions',
		expectedOwners: { 'request:rapid-one': 'trace', 'request:rapid-two': 'trace' },
	},
	{
		id: 'request-outlives-window',
		description: 'A request begins with an action but settles after its action window.',
		action: 'request-outlives-window',
		expectedOwners: { 'request:slow': 'trace' },
	},
	{
		id: 'same-origin-reload',
		description: 'A same-origin reload creates a Page Trace.',
		action: 'same-origin-reload',
		expectedOwners: { 'page:reload': 'trace' },
	},
	{
		id: 'cross-origin-coverage-loss',
		description: 'Navigation to the alternate local origin loses probe coverage.',
		action: 'cross-origin-coverage-loss',
		expectedOwners: { 'page:cross-origin': 'trace', 'coverage:probe': 'trace' },
	},
	{
		id: 'child-frame-action',
		description: 'A child-frame action produces cross-origin iframe traffic.',
		action: 'child-frame-action',
		expectedOwners: { 'action:child-frame': 'trace', 'request:child-frame': 'trace' },
	},
	{
		id: 'debugger-detach',
		description: 'The integration harness detaches the debugger during a trace.',
		action: 'debugger-detach',
		expectedOwners: { 'capture:debugger-detached': 'trace' },
		controls: ['debugger-detach'],
	},
	{
		id: 'storage-quota',
		description: 'The integration harness exhausts configured trace storage limits.',
		action: 'storage-quota',
		expectedOwners: { 'storage:quota-exceeded': 'trace' },
		controls: ['storage-quota'],
	},
	{
		id: 'secret-redaction',
		description: 'Every configured secret category is absent from all projections.',
		action: 'secret-redaction',
		expectedOwners: { 'request:secret': 'trace', 'ui:redacted-result': 'trace' },
	},
] as const satisfies readonly FixtureScenario[];

// Test-only values: never expose these through the fixture page or snapshots.
export const fixtureSecrets = [
	'Bearer fixture-token-7c27db4f',
	'fixture-api-key-4ebcc427',
	'fixture.user@example.test',
] as const;

export const fixtureScenarioById = new Map(fixtureScenarios.map((scenario) => [scenario.id, scenario]));
