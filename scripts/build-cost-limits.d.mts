// Types of scripts/build-cost-limits.mjs for the unit test (apps/web/test/cost-limits.test.ts).
export const REPO_ROOT: string;
export const COST_DOC: string;
export const LIMITS_DOC: string;
export const OUTPUT_FILE: string;
export function clean(cell: string): string;
export function tables(md: string): { header: string[]; rows: string[][] }[];
export function parseCost(md: string): unknown;
export function parseLimits(md: string): unknown;
export function buildCostLimits(costMd: string, limitsMd: string): unknown;
