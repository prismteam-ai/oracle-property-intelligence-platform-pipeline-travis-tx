import path from 'node:path';
import { DEPLOY_ROOT } from '../src/env.js';
import { HashCache } from '../src/hash.js';
import { verifyInputs } from '../src/verify.js';

const t0 = Date.now();
const cache = new HashCache(path.join(DEPLOY_ROOT, '.hash-cache.json'));
const v = await verifyInputs(cache, (m) => console.log(m));
console.log(
  'ok',
  v.files.length,
  'inputs',
  v.parts.length,
  'parts',
  v.inputsSha256,
  `${Math.round((Date.now() - t0) / 1000)}s`,
);
