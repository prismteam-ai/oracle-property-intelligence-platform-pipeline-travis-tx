import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';
import { TravisApi } from '../lib/api-stack.js';
import { loadConfig } from '../lib/config.js';
import { TravisWeb } from '../lib/web-stack.js';

const cdkDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(cdkDir, '..');
const config = loadConfig(resolve(process.env.CDK_CONFIG ?? join(cdkDir, 'config.json')));

const dbPath = join(apiDir, 'build', 'db', 'serving.duckdb');
if (!existsSync(dbPath)) {
  console.warn(
    `[travis-cdk] ${dbPath} is missing. Synth works, but the image build and \`just deploy-api\` will fail.\n` +
      `            Stage it first: \`just stage-db\` (the serving file) or \`just stage-db fixture\` (CI).`,
  );
}

const explorerDist = join(apiDir, '..', 'explorer', 'dist');
let explorerDistDirectory = explorerDist;
if (!existsSync(join(explorerDist, 'index.html'))) {
  console.warn(
    `[travis-cdk] ${explorerDist} is not built; TravisWeb synthesizes with a placeholder page.`,
  );
  explorerDistDirectory = join(cdkDir, 'placeholder-explorer');
}

const app = new App();
const env = { account: config.account, region: config.region };
new TravisApi(app, 'TravisApi', { env, config, imageDirectory: apiDir });
new TravisWeb(app, 'TravisWeb', { env, config, explorerDistDirectory });
