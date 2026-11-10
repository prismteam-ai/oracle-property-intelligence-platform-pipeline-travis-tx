const CLIENT_IP_HEADER = "cf-connecting-ip";
const UNKNOWN_CLIENT = "unknown";
const TOO_MANY_REQUESTS = 429;

export async function tooManyRequests(
  limiter: Pick<RateLimit, "limit">,
  request: Request,
  message: string,
): Promise<Response | undefined> {
  const key = request.headers.get(CLIENT_IP_HEADER) ?? UNKNOWN_CLIENT;
  const { success } = await limiter.limit({ key });
  return success ? undefined : Response.json({ error: message }, { status: TOO_MANY_REQUESTS });
}
