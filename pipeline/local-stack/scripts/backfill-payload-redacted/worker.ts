// A-11 fix 1c: worker thread of the payload_redacted backfill. Receives contiguous record
// chunks, runs transformChunk (the loader's processRecord) and replies with the rows. One key
// inventory per worker. An error (e.g. UnknownKeyError) is replied by name and message only.
import { parentPort, workerData } from "node:worker_threads";
import { createKeyInventory } from "../../../oracle-runtime/travis/tcad/key-inventory.js";
import { transformChunk, type ChunkIn, type WorkerInit, type WorkerReply } from "./transform.js";

const port = parentPort;
if (port === null) throw new Error("backfill worker: must run as a worker thread");
const init = workerData as WorkerInit;
const pids = init.pids === null ? null : new Set(init.pids);
const inventory = createKeyInventory();

port.on("message", (chunk: ChunkIn) => {
  let reply: WorkerReply;
  try {
    reply = { ok: true, out: transformChunk(chunk, init.ctx, inventory, pids) };
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    reply = { ok: false, seq: chunk.seq, error: { name: e.name, message: e.message } };
  }
  port.postMessage(reply);
});
