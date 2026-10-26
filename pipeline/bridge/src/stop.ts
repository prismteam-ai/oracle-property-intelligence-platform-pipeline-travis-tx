// The stop flag. A Stop command only sets it; the runner calls checkpoint() between atomic steps,
// never inside one (an upload, an add, a pin or the index write finishes before the run stops).
export class StoppedByAdmin extends Error {
  constructor(readonly beforeStep: string) {
    super(`stopped by admin before step ${beforeStep}`);
    this.name = "StoppedByAdmin";
  }
}

export class StopFlag {
  #requested = false;
  get requested(): boolean {
    return this.#requested;
  }
  request(): void {
    this.#requested = true;
  }
  clear(): void {
    this.#requested = false;
  }
  /** Call at a step boundary. Throws StoppedByAdmin when a stop was requested. */
  checkpoint(nextStep: string): void {
    if (this.#requested) throw new StoppedByAdmin(nextStep);
  }
}
