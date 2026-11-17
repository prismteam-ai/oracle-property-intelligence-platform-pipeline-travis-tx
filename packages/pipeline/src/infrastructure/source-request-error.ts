export class SourceRequestError extends Error {
  constructor(
    readonly url: string,
    readonly httpStatus: number,
  ) {
    super(`Source request failed with HTTP ${httpStatus}: ${url}`);
    this.name = "SourceRequestError";
  }
}
