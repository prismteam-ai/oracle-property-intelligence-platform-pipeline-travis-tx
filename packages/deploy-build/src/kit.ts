import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, KIT_TRAVIS_SRC, requireKit } from './env.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Kit {
  profile: any; // permit-profile.mjs: summarizePermitRow, describePermitRow, classifyStatusGroup, ...
  roofAge: any; // t5-roof-age.mjs: estimateParcelRoofAge
  matcher: any; // name-matcher.mjs: normalizeName, MATCHER_VERSION
  recordIds: any; // record-ids.mjs
  sources: any; // t3-sources.mjs: T3_SOURCES, businessDetailUrl, PRIVACY_VERSION
  shards: any; // t5-shards.mjs: streamCsvRecords
  permitVerify: any; // t4-permit-verify.mjs
}

let cached: Kit | null = null;

/**
 * Imports the kit's Travis modules (permit profile, the `elephant.roof-age-estimate.v1` estimator through t5-roof-age,
 * the name matcher, record ids, sources, CSV record streaming). The deploy build imports them; it never copies logic.
 * Needs Node >= 22.18 (the kit's own floor: its estimator is TypeScript loaded by type stripping).
 */
export async function loadKit(): Promise<Kit> {
  if (cached) return cached;
  requireKit();
  const imp = (f: string) => import(pathToFileURL(path.join(KIT_TRAVIS_SRC, f)).href);
  cached = {
    profile: await imp('permit-profile.mjs'),
    roofAge: await imp('t5-roof-age.mjs'),
    matcher: await imp('name-matcher.mjs'),
    recordIds: await imp('record-ids.mjs'),
    sources: await imp('t3-sources.mjs'),
    shards: await imp('t5-shards.mjs'),
    permitVerify: await imp('t4-permit-verify.mjs'),
  };
  return cached;
}

export const kitRoot = KIT_ROOT;
