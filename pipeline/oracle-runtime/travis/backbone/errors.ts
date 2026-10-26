// A-04 F1 (CR-3): a deterministic problem with the run's data or inputs. Restate retries every
// plain Error forever, so the Restate bindings turn this class (and the other deterministic
// errors, see local-stack/services/loader.ts deterministicFailure) into a TerminalError: the run
// fails cleanly and its backbone_runs row is closed. The message must carry no record content.
export class RunDataError extends Error {
  override name = "RunDataError";
}
