import { CITABLE, type EvidenceCollector, type EvidenceKind } from './evidence.js';

/**
 * The citation check (api-contract.md, `POST /v1/agent/chat`): every id the model writes must name a record a tool
 * returned in this turn, and every CID it writes must be one a tool returned. That covers the `[[kind:id]]` tokens and
 * ids written outside them (review S1, 2026-10-20): bare permit ids, 32-hex contractor keys and business or license
 * record ids, "property <id>" mentions and the ids in API paths of link targets. Anything else fails closed: the server
 * returns no model text and `outcome: "tool_error"`. Run over the answer and the model's assumption lines together.
 */
export interface CitationCheck {
  ok: boolean;
  cited: { kind: string; id: string }[];
  failures: { token: string; reason: string }[];
}

const TOKEN = /\[\[([^\]\n]*)\]\]/g;
/** CIDv1 in base32 (`bafy…`, `bagu…`) as the dataset writes them. */
const CID = /\bba[a-z2-7]{40,}\b/g;
/** An Austin permit number (`2026-102216 EP`), also written with a hyphen or no separator before the type. */
const BARE_PERMIT = /\b(\d{4}-\d{6})[ -]?([A-Z]{2})\b/g;
/** Exactly 32 hex characters: a contractor attribution key, or a business or license record id. */
const HEX32 = /\b[0-9a-f]{32}\b/g;
/** "property 103857", "property ID 103857", "property #103857"; not a year ("property 1967 roof"): no id is one. */
const PROPERTY_MENTION =
  /\bproperty(?:\s+id)?\s*(?:#|no\.|number)?\s*:?\s*(?!(?:1[89]|20)\d{2}\b)(\d{3,9})\b/gi;
/** An id in an API path, as in a link to `/v1/permits/2026-102216%20EP`. */
const API_PATH =
  /\/v1\/(properties|permits|contractors|businesses|licenses|runs)\/([^\s)"'\]>#?]+)/g;
const PATH_KIND: Record<string, EvidenceKind> = {
  properties: 'property',
  permits: 'permit',
  contractors: 'contractor',
  businesses: 'business',
  licenses: 'license',
  runs: 'run',
};

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function checkCitations(text: string, evidence: EvidenceCollector): CitationCheck {
  const cited: CitationCheck['cited'] = [];
  const failures: CitationCheck['failures'] = [];
  for (const m of text.matchAll(TOKEN)) {
    const token = m[0];
    const inner = m[1]!;
    const colon = inner.indexOf(':');
    if (colon <= 0) {
      failures.push({ token, reason: 'malformed citation token' });
      continue;
    }
    const kind = inner.slice(0, colon).trim();
    const id = inner.slice(colon + 1).trim();
    const evidenceKind = CITABLE[kind];
    if (!evidenceKind) {
      failures.push({ token, reason: `unknown citation kind ${kind}` });
      continue;
    }
    if (!id || !evidence.has(evidenceKind, id)) {
      failures.push({ token, reason: `no tool returned ${kind} ${id} in this turn` });
      continue;
    }
    cited.push({ kind, id });
  }
  // ids written outside the tokens
  const rest = text.replace(TOKEN, ' ');
  for (const m of rest.matchAll(BARE_PERMIT)) {
    const id = `${m[1]} ${m[2]}`;
    if (!evidence.has('permit', id))
      failures.push({ token: m[0], reason: `no tool returned permit ${id} in this turn` });
  }
  for (const m of rest.matchAll(HEX32)) {
    const id = m[0];
    if (
      !evidence.has('contractor', id) &&
      !evidence.has('business', id) &&
      !evidence.has('license', id)
    )
      failures.push({ token: id, reason: 'no tool returned this key or record id in this turn' });
  }
  for (const m of rest.matchAll(PROPERTY_MENTION)) {
    if (!evidence.has('property', m[1]!))
      failures.push({ token: m[0], reason: `no tool returned property ${m[1]} in this turn` });
  }
  for (const m of rest.matchAll(API_PATH)) {
    const kind = PATH_KIND[m[1]!]!;
    const id = decode(m[2]!);
    if (!evidence.has(kind, id))
      failures.push({ token: m[0], reason: `no tool returned ${kind} ${id} in this turn` });
  }
  for (const m of text.matchAll(CID)) {
    if (!evidence.cids.has(m[0]))
      failures.push({ token: m[0], reason: 'no tool returned this CID in this turn' });
  }
  return { ok: failures.length === 0, cited, failures };
}
