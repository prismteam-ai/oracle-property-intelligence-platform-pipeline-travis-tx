import "dotenv/config";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as restate from "@restatedev/restate-sdk";
import { createSourceClient, type SourceClient } from "../../oracle-runtime/travis/lib/source-client.js";
import {
  createJurisdictionProbes,
  createTravisDiscovery,
  createUs1Probes,
} from "../../oracle-runtime/travis/discovery/workflow.js";
import {
  readCatalogIfPresent,
  writeCatalog,
} from "../../oracle-runtime/travis/discovery/write-catalog.js";
import { priorExportFrom } from "../../oracle-runtime/travis/discovery/probes/tcad.js";
import {
  DEFAULT_REPO_ROOT,
  writeBlockedEvidence,
} from "../../oracle-runtime/travis/discovery/blocked-evidence.js";
import { proveDestination } from "../../oracle-runtime/travis/discovery/destination-proof.js";
import { configuredSystemIdentifier } from "./configured-db.js";
import { runValidator } from "../../oracle-runtime/travis/discovery/run-validator.js";
import { TRAVIS_JURISDICTION_PROFILE } from "../../oracle-runtime/travis/profiles/jurisdictions.js";
import { applyConcurrencyCap } from "../../oracle-runtime/travis/backbone/concurrency.js";
import { createLoader, lazyQueryDb, loadTracks, TRACKS_DIR } from "./loader.js";
import { createBackboneReport, loadSections, SECTIONS_DIR } from "./report.js";

// Local Oracle services endpoint. Services are bound here as they are authored
// (durable-workflow-builder).
//
// One Restate SDK instance: oracle-runtime imports the SDK type-only and receives this
// module's SDK here, so only pipeline/local-stack/node_modules/@restatedev/restate-sdk is
// loaded at runtime. A-04 workflow files (services/workflows/*.ts) export
// `createService(restate)` and receive this same instance.
//
// TravisDiscovery (A-01): the probes run only when a run is started (`discover`). Every
// request (US1 sources and US2 jurisdiction evidence) goes through one shared source client
// (2 per host, identified User-Agent, StopOnBlocked). The catalog is written to
// pipeline/docs/travis-sources.yaml with the destination proof (Docker side + SQL side,
// T044); each blocked source gets its evidence file under docs/evidence/blocked/ (T037);
// the vendored readiness validator runs on the first catalog and after each `captured`
// re-probe, saving docs/evidence/A-01-readiness.json (T045). A blocked source waits on a
// durable promise until `npm --prefix pipeline/oracle-runtime run resolve` (T036).
// The catalog write refuses to overwrite a catalog that offline commands amended (CR-3);
// a TCAD export already held with a matching receipt is reused with no request (OR-m8);
// the destination proof also reads system_identifier through DATABASE_URL (OR-m4).
//
// A-04 (T009): `Loader` (single Query DB writer, tracks from services/tracks/*.ts) and
// `BackboneReport` (read-only, sections from services/report-sections/*.ts) are bound beside
// every workflow file. The Query DB connection is opened lazily on first use and never logged.
// Worker counts from the env file are capped (transform 6, prepare 2) unless
// TCAD_UNSAFE_CONCURRENCY=1: the old values (16 / 8) exhausted memory on a 16 GiB machine.
applyConcurrencyCap();

let client: SourceClient | null = null;
const sharedClient = (): SourceClient => (client ??= createSourceClient());
const now = (): Date => new Date();

const queryDb = lazyQueryDb();

export const WORKFLOWS_DIR = fileURLToPath(new URL("./workflows/", import.meta.url));

const travisDiscovery = createTravisDiscovery(restate, {
  // CR2-5: the catalog read runs inside the workflow's journaled step (readPriorExport), so
  // a replay sees the same value and a bad catalog is a terminal error, not a retry loop.
  probes: ({ priorExport }) =>
    createUs1Probes({ client: sharedClient(), now, ...(priorExport ? { priorExport } : {}) }),
  readPriorExport: () => {
    const receipt = readCatalogIfPresent()?.parcel?.export_receipt;
    return receipt ? priorExportFrom(receipt, DEFAULT_REPO_ROOT) : null;
  },
  jurisdictions: () => createJurisdictionProbes({ client: sharedClient(), now }),
  profile: TRAVIS_JURISDICTION_PROFILE,
  writeCatalog: (catalog) => writeCatalog(catalog),
  readCatalog: () => readCatalogIfPresent(),
  writeEvidence: (relPath, content) => {
    writeBlockedEvidence(DEFAULT_REPO_ROOT, relPath, content);
  },
  secrets: () => [process.env.SOCRATA_APP_TOKEN ?? ""].filter((s) => s.length > 0),
  destinationProof: () => proveDestination({ configured: configuredSystemIdentifier }),
  runValidator: () => runValidator(),
});

type Definition = { name: string } & Parameters<typeof restate.serve>[0]["services"][number];

/** Every `<dir>/*.ts` exporting createService(restate), called with this module's SDK. */
async function loadWorkflows(dir: string): Promise<Definition[]> {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts")).sort();
  } catch {
    return [];
  }
  const out: Definition[] = [];
  for (const name of names) {
    const mod = (await import(pathToFileURL(join(dir, name)).href)) as {
      createService?: (sdk: typeof restate) => Definition;
    };
    if (typeof mod.createService === "function") out.push(mod.createService(restate));
  }
  return out;
}

export interface BuildOptions {
  workflowsDir?: string;
  tracksDir?: string;
  sectionsDir?: string;
}

export async function buildServices(options: BuildOptions = {}): Promise<Definition[]> {
  const workflows = await loadWorkflows(options.workflowsDir ?? WORKFLOWS_DIR);
  const loader = createLoader(restate, {
    tracks: await loadTracks(options.tracksDir ?? TRACKS_DIR),
    sql: queryDb,
  });
  const report = createBackboneReport(restate, {
    sections: await loadSections(options.sectionsDir ?? SECTIONS_DIR),
    sql: queryDb,
  });
  const all: Definition[] = [travisDiscovery, loader, report, ...workflows];
  const seen = new Set<string>();
  for (const def of all) {
    if (seen.has(def.name)) throw new Error(`app: two services named ${def.name}`);
    seen.add(def.name);
  }
  return all;
}

const isEntryPoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  restate.serve({ services: await buildServices(), port: 9080 });
}
