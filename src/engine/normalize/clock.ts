import type { ClockCalibration, ClockCalibrationQuality } from '../../model/evidence.js';

export type ClockHandshake = {
	readonly sessionStartedCdpSeconds: number;
	readonly cdpHandshakeSeconds: number;
	readonly probeEpochMilliseconds: number;
	readonly roundTripMilliseconds: number;
};

const maximumRoundTripByQualityUs: Record<ClockCalibrationQuality, number> = {
	high: 5_000,
	medium: 25_000,
	low: Number.POSITIVE_INFINITY,
};

export function calibrateClocks(handshake: ClockHandshake): ClockCalibration {
	for (const value of Object.values(handshake)) {
		if (!Number.isFinite(value) || value < 0) throw new Error('Clock handshake values must be finite non-negative numbers.');
	}

	const roundTripUs = Math.round(handshake.roundTripMilliseconds * 1_000);
	const quality = (Object.keys(maximumRoundTripByQualityUs) as ClockCalibrationQuality[]).find(
		(candidate) => roundTripUs <= maximumRoundTripByQualityUs[candidate],
	) ?? 'low';
	const cdpHandshakeUs = Math.round(handshake.cdpHandshakeSeconds * 1_000_000);
	const probeEpochUs = Math.round(handshake.probeEpochMilliseconds * 1_000);

	return {
		cdpEpochOffsetUs: -Math.round(handshake.sessionStartedCdpSeconds * 1_000_000),
		probeEpochOffsetUs: cdpHandshakeUs - probeEpochUs - Math.round(handshake.sessionStartedCdpSeconds * 1_000_000),
		quality,
		roundTripUs,
	};
}

export function cdpTimestampToSessionUs(timestampSeconds: number, calibration: ClockCalibration): number {
	return Math.round(timestampSeconds * 1_000_000) + calibration.cdpEpochOffsetUs;
}

export function probeTimestampToSessionUs(timestampEpochMilliseconds: number, calibration: ClockCalibration): number {
	return Math.round(timestampEpochMilliseconds * 1_000) + calibration.probeEpochOffsetUs;
}
