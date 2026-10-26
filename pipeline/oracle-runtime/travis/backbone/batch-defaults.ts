// Safe defaults for the full appraisal run on a 16 GiB laptop: small chunks, three in flight and a
// short pause between chunks keep the raw JSON held in memory at about 360 MB instead of 2.4 GB.
export const DEFAULT_CHUNK_SIZE = 2_000;
export const DEFAULT_WINDOW = 3;
export const DEFAULT_BATCH_PAUSE_MS = 1_000;

export const CHUNK_SIZE_RANGE = { min: 100, max: 20_000 } as const;
export const WINDOW_RANGE = { min: 1, max: 8 } as const;
export const BATCH_PAUSE_RANGE = { min: 0, max: 600_000 } as const;
