export const LOUDNESS_TARGET = {
  minimum: -24,
  defaultIntegrated: -16,
  maximum: -14,
  range: 7,
  truePeak: -1.5,
} as const;

export function isValidLoudnessTarget(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= LOUDNESS_TARGET.minimum &&
    value <= LOUDNESS_TARGET.maximum
  );
}

export function previewPlaybackGain(targetLufs: number): number {
  if (!isValidLoudnessTarget(targetLufs)) return 1;
  return Math.min(1, 10 ** ((targetLufs - LOUDNESS_TARGET.maximum) / 20));
}
