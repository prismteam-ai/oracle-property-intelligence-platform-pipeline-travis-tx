/**
 * `POST /v1/agent/chat` request validation (api-contract.md): at most 20 messages, 4,000 characters each and 16,000 in
 * total (otherwise 413), roles `user` and `assistant` only, the last message `user`, and an optional `session_id` of at
 * most 64 characters from [A-Za-z0-9_-] (otherwise 400).
 */
export const CHAT_LIMITS = {
  messages: 20,
  messageChars: 4000,
  totalChars: 16_000,
  sessionIdChars: 64,
  /** Raw body bytes read at all; anything larger is 413 before parsing. */
  bodyBytes: 64 * 1024,
} as const;

export interface ChatMessageIn {
  role: 'user' | 'assistant';
  content: string;
}
export type ParsedChat =
  | { ok: true; messages: ChatMessageIn[]; sessionId: string | undefined }
  | { ok: false; status: 400 | 413; error: 'invalid_params' | 'request_too_large'; detail: string };

const bad = (detail: string): ParsedChat => ({
  ok: false,
  status: 400,
  error: 'invalid_params',
  detail,
});
const big = (detail: string): ParsedChat => ({
  ok: false,
  status: 413,
  error: 'request_too_large',
  detail,
});

export function parseChatRequest(body: string | null): ParsedChat {
  if (body === null || body.trim() === '') return bad('the request body must be a JSON object');
  if (Buffer.byteLength(body, 'utf8') > CHAT_LIMITS.bodyBytes)
    return big(`the request body is larger than ${CHAT_LIMITS.bodyBytes} bytes`);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return bad('the request body is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return bad('the request body must be a JSON object');
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.messages)) return bad('messages: an array of {role, content} is required');
  if (o.messages.length === 0) return bad('messages: at least one message is required');
  if (o.messages.length > CHAT_LIMITS.messages)
    return big(`messages: at most ${CHAT_LIMITS.messages} messages`);
  const messages: ChatMessageIn[] = [];
  let total = 0;
  for (const [i, m] of o.messages.entries()) {
    if (!m || typeof m !== 'object' || Array.isArray(m))
      return bad(`messages.${i}: must be an object {role, content}`);
    const { role, content } = m as Record<string, unknown>;
    if (role !== 'user' && role !== 'assistant')
      return bad(`messages.${i}.role: must be "user" or "assistant"`);
    if (typeof content !== 'string') return bad(`messages.${i}.content: must be a string`);
    if (content.length > CHAT_LIMITS.messageChars)
      return big(`messages.${i}.content: at most ${CHAT_LIMITS.messageChars} characters`);
    total += content.length;
    messages.push({ role, content });
  }
  if (total > CHAT_LIMITS.totalChars)
    return big(`messages: at most ${CHAT_LIMITS.totalChars} characters in total`);
  if (messages[messages.length - 1]!.role !== 'user')
    return bad('messages: the last message must have role "user"');
  if (messages[messages.length - 1]!.content.trim() === '')
    return bad('messages: the last message must not be empty');
  let sessionId: string | undefined;
  if (o.session_id !== undefined) {
    if (
      typeof o.session_id !== 'string' ||
      o.session_id.length === 0 ||
      o.session_id.length > CHAT_LIMITS.sessionIdChars ||
      !/^[A-Za-z0-9_-]+$/.test(o.session_id)
    )
      return bad('session_id: at most 64 characters from [A-Za-z0-9_-]');
    sessionId = o.session_id;
  }
  return { ok: true, messages, sessionId };
}
