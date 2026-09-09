import { fixtureSecrets } from './ground-truth.js';

export function createSafeFixtureSnapshot(value: string): string {
	return fixtureSecrets.reduce((snapshot, secret) => snapshot.replaceAll(secret, '[REDACTED]'), value);
}
