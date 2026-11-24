// Both the resolver's ducking calculation and the native audio mix treat this gain as silent.
const mutedGainDb = -60;

export function validateVolumePercent(percent: number) {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError("Volume must be between 0 and 100 percent.");
  }
}

export function getVolumeGainDb(volumePercent = 100, baseGainDb = 0): number {
  validateVolumePercent(volumePercent);
  if (volumePercent === 100) return baseGainDb;
  if (volumePercent === 0) return mutedGainDb;
  return Math.max(mutedGainDb, baseGainDb + 20 * Math.log10(volumePercent / 100));
}
