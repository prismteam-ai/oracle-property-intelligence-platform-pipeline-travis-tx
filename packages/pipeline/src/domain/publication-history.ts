export interface Publication {
  buildId: string;
  publishedAt: string;
  manifestCid: string;
  rootCid: string;
  ipns: { name: string; resolvedCid: string };
}

export function latestPublication(history: readonly Publication[]): Publication | undefined {
  return byBuildId(history).at(-1);
}

export function publicationsBeyondRetention(
  history: readonly Publication[],
  keep: number,
): Publication[] {
  const ordered = byBuildId(history);
  return ordered.slice(0, Math.max(0, ordered.length - keep));
}

function byBuildId(history: readonly Publication[]): Publication[] {
  return [...history].sort((a, b) => a.buildId.localeCompare(b.buildId));
}
