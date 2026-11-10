export class ServiceRequestError extends Error {
  constructor(
    readonly service: string,
    readonly url: string,
    readonly httpStatus: number,
    detail = "",
  ) {
    super(`${service} request failed with HTTP ${httpStatus}: ${url} ${detail}`.trim());
    this.name = "ServiceRequestError";
  }
}
