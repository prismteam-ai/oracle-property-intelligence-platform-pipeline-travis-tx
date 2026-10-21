/** A client-visible failure with the contract's HTTP status and error code. */
export class QueryError extends Error {
  constructor(
    readonly status: 400 | 404,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export const badRequest = (code: string, detail?: string) => new QueryError(400, code, detail);
export const notFound = (what: string) => new QueryError(404, 'not_found', what);
