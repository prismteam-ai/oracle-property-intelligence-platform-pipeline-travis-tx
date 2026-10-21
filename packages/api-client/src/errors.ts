/** A non-2xx answer, a body that fails its Zod schema, or a transport failure. */
export class ApiError extends Error {
  readonly status: number;
  /** The API's `error` code, e.g. `stale_cursor`, `agent_unavailable`, `rate_limited`. */
  readonly code: string | null;
  readonly detail: string | null;
  readonly requestId: string | null;
  readonly body: unknown;
  constructor(init: {
    status: number;
    code?: string | null;
    detail?: string | null;
    requestId?: string | null;
    body?: unknown;
    message?: string;
  }) {
    super(
      init.message ??
        `${init.status} ${init.code ?? 'error'}${init.detail ? `: ${init.detail}` : ''}`,
    );
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code ?? null;
    this.detail = init.detail ?? null;
    this.requestId = init.requestId ?? null;
    this.body = init.body;
  }
  get isStaleCursor(): boolean {
    return this.status === 400 && this.code === 'stale_cursor';
  }
  get isRateLimited(): boolean {
    return this.status === 429;
  }
  /** `503 {error: "agent_unavailable"}` from the chat route. */
  get isAgentUnavailable(): boolean {
    return this.status === 503 && this.code === 'agent_unavailable';
  }
}

/** The body matched no Zod schema: a contract defect, reported with the issues. */
export class ContractViolation extends ApiError {
  readonly issues: unknown;
  constructor(operationId: string, issues: unknown, body: unknown) {
    super({
      status: 200,
      code: 'contract_violation',
      detail: `${operationId} response failed validation: ${JSON.stringify(Array.isArray(issues) ? issues.slice(0, 3) : issues)}`,
      body,
    });
    this.name = 'ContractViolation';
    this.issues = issues;
  }
}
