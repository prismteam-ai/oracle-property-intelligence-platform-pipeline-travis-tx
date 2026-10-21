import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The kit worktree's use-oracle runtime: read and imported from, never written (hard rule). */
export const KIT_ROOT =
  process.env.TRAVIS_KIT_ROOT ??
  '/Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime';
export const KIT_DATA = path.join(KIT_ROOT, 'data', 'travis');
export const KIT_TRAVIS_SRC = path.join(KIT_ROOT, 'src', 'counties', 'travis');

/**
 * The served run (decisions.md sections 29 and 33; docs/hosted-layer-interfaces.md): run 2, the next run of
 * 20261018T143520Z-t5-full. TRAVIS_RUN_ID serves another published run.
 */
export const RUN_ID = process.env.TRAVIS_RUN_ID ?? '20261020T200236Z-t5-full';
export const RUN_DIR = path.join(KIT_DATA, 'runs', RUN_ID);

const here = path.dirname(fileURLToPath(import.meta.url));
/** This checkout (a worktree during development). */
export const REPO_ROOT = path.resolve(here, '..', '..', '..');
/**
 * The MAIN checkout: data/ is gitignored and the image build reads data/deploy there, so deploy output goes to the
 * main checkout even when this code runs from a worktree under <main>/.claude/worktrees/<name>.
 */
export const MAIN_ROOT = REPO_ROOT.includes(`${path.sep}.claude${path.sep}worktrees${path.sep}`)
  ? (REPO_ROOT.split(`${path.sep}.claude${path.sep}worktrees${path.sep}`)[0] as string)
  : REPO_ROOT;
export const DEPLOY_ROOT = process.env.TRAVIS_DEPLOY_ROOT ?? path.join(MAIN_ROOT, 'data', 'deploy');

export const SCHEMA_DIR = path.join(REPO_ROOT, 'packages', 'query');
export const MANIFEST_PATH = path.join(REPO_ROOT, 'publish', RUN_ID, 'manifest.json');
export const RUN_RECORD_PATH = path.join(REPO_ROOT, 'runs', `${RUN_ID}.json`);
export const PUBLICATION_PATH = path.join(REPO_ROOT, 'runs', `${RUN_ID}.publication.json`);

/** The permit capture the served run ran on (its record's `inputs.capture.dir`, relative to the kit runtime). */
export function captureDir(): string {
  const run = JSON.parse(readFileSync(RUN_RECORD_PATH, 'utf8'));
  return path.join(KIT_ROOT, run.inputs.capture.dir);
}

/** The served run's permit link pass directory (its `global/link.done.json` names the attempt, e.g. `link-a2` in run 2). */
export function linkDir(): string {
  const marker = JSON.parse(readFileSync(path.join(RUN_DIR, 'global', 'link.done.json'), 'utf8'));
  return path.join(RUN_DIR, 'global', marker.output.dir);
}

export function requireKit(): void {
  if (!existsSync(KIT_ROOT))
    throw new Error(`kit runtime not found at ${KIT_ROOT} (set TRAVIS_KIT_ROOT)`);
}

export function shardIds(): string[] {
  return Array.from({ length: 89 }, (_, i) => `s${String(i + 1).padStart(4, '0')}`);
}
