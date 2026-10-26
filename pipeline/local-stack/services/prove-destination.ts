import "dotenv/config";
import { proveDestination } from "../../oracle-runtime/travis/discovery/destination-proof.js";
import {
  amendCatalog,
  readCatalog,
} from "../../oracle-runtime/travis/discovery/write-catalog.js";
import { redact } from "../../oracle-runtime/travis/lib/log.js";
import { configuredSystemIdentifier } from "./configured-db.js";

// Operator command `npm --prefix pipeline/local-stack run prove-destination` (OR-m4; local
// only: Docker, the local Postgres container and the configured loader connection; no source
// request). Proves the internal destination with three identities (Docker side, SQL side
// inside the container, and the configured DATABASE_URL connection, which must report the
// same system identifier) and records it in the catalog's `destination` block as an
// amendment. A-04 runs the same proof, refreshing destination.captured_at, before its first
// write. Nothing is written when the destination is not proven. The URL is never printed.
const say = (line: string): void => {
  process.stdout.write(`${redact(line)}\n`);
};

const destination = await proveDestination({
  configured: configuredSystemIdentifier,
});
if (!destination.proven) {
  say(
    `prove-destination: not proven: ${destination.missing_reason ?? "no reason"}; nothing written`,
  );
  process.exitCode = 2;
} else {
  for (const id of destination.independent_identity_sources ?? [])
    say(`prove-destination: ${id}`);
  amendCatalog(
    { ...readCatalog(), destination },
    {
      command: "prove-destination",
      venue: "operator",
      fields: ["destination"],
      ref: "local stack: compose service postgres, SQL inside its container, and the configured loader connection",
      note: "three identities; the configured connection reports the same system identifier",
    },
  );
  say(
    `prove-destination: destination proven at ${destination.captured_at ?? "?"}; catalog amended`,
  );
}
