export function laterWatermark(
  current: string | undefined,
  candidate: string | undefined,
): string | undefined {
  if (current === undefined) return candidate;
  if (candidate === undefined) return current;
  return candidate > current ? candidate : current;
}
