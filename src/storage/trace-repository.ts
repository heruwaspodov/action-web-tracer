import { canonicalEvidenceBrand, type EvidenceEnvelope } from '../model/evidence.js';

/** Persistence boundary: adapters must normalize events before they can be retained. */
export class TraceRepository {
	readonly #events: EvidenceEnvelope[] = [];

	append(event: EvidenceEnvelope): void {
		if ((event as Record<PropertyKey, unknown>)[canonicalEvidenceBrand] !== true) {
			throw new Error('TraceRepository accepts only normalized canonical evidence.');
		}
		this.#events.push(event);
	}

	list(): readonly EvidenceEnvelope[] {
		return [...this.#events];
	}
}
