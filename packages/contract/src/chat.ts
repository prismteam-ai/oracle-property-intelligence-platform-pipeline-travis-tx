import { z } from 'zod';
import { Limitation, UnpublishedSource, def, int, nstr, obj } from './shared.js';
import { Source } from './shared.js';

export const ChatMessage = def(
  'ChatMessage',
  obj({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }),
);

/** At most 20 messages, 4,000 chars each, 16,000 total; last must be `user` (cross-field limits enforced by the handler: 400 or 413). */
export const ChatRequest = def(
  'ChatRequest',
  obj({
    messages: z.array(ChatMessage).min(1).max(20),
    session_id: z
      .string()
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  }),
);

export const ChatOutcome = z.enum([
  'answered',
  'no_matches',
  'needs_clarification',
  'out_of_scope',
  'out_of_county',
  'limit_reached',
  'tool_error',
]);

export const ChatToolCall = def(
  'ChatToolCall',
  obj({
    id: z.string(),
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
    status: z.enum(['ok', 'error', 'rate_limited', 'timeout']),
    total: int.nullable(),
    returned: int.nullable(),
    result_summary: z.string(),
  }),
);

export const ChatEvidence = def(
  'ChatEvidence',
  obj({
    kind: z.enum([
      'property',
      'permit',
      'contractor',
      'business',
      'license',
      'search_center',
      'run',
    ]),
    tool_call_id: z.string(),
    property_id: nstr,
    permit_id: nstr,
    contractor_attribution_key: nstr,
    business_record_id: nstr,
    license_record_id: nstr,
    record_cid: nstr,
    source: Source.or(obj({})).describe(
      "The record's `source`, or {} for evidence without one (search centers, runs).",
    ),
    unpublished_source: UnpublishedSource.nullable(),
  }),
);

export const ChatResponse = def(
  'ChatResponse',
  obj({
    outcome: ChatOutcome,
    answer: z
      .string()
      .describe(
        'Markdown subset, no HTML or images. Ids cited as [[property:<id>]], [[permit:<id>]], [[contractor:<key>]], [[business:<id>]], [[license:<id>]], [[run:<run_id>]].',
      ),
    assumptions: z.array(z.string()),
    tool_calls: z.array(ChatToolCall),
    evidence: z.array(ChatEvidence),
    limitations: z.array(Limitation),
    run_id: z.string(),
    manifest_cid: z.string(),
    model_id: z.string(),
    prompt_version: z.string(),
    request_id: z.string(),
  }),
);
