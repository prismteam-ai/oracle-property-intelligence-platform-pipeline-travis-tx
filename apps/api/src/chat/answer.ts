/**
 * "No HTML, no images, links only to the API, the explorer and the two gateways" (decisions.md section 20), enforced by
 * the server on the answer and the model's assumptions before they are checked and returned (review S2, 2026-10-20):
 * the CRM renders this text too, so the explorer's renderer cannot be the only guard. HTML tags, comments and autolinks
 * and Markdown images are removed; a link to anywhere else keeps its text and loses its target; a bare URL to anywhere
 * else is removed. The explorer is reached by its own `#/` routes.
 */
export const GATEWAY_HOSTS = ['ipfs.filebase.io', 'gateway.pinata.cloud'] as const;

export interface LinkPolicy {
  /** The API's host as the request reached it (`requestContext.domainName`). */
  apiHost?: string;
}

export function allowedLink(href: string, p: LinkPolicy): boolean {
  if (href.startsWith('#/')) return true;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return (
    (!!p.apiHost && u.host === p.apiHost) || (GATEWAY_HOSTS as readonly string[]).includes(u.host)
  );
}

const IMAGE = /!\[[^\]\n]*\](?:\([^)\n]*\)|\[[^\]\n]*\])/g;
const HTML = /<\/?[a-z!][^<>]*>/gi;
const LINK = /(?<!\[)\[([^\][\n]*)\]\(\s*([^)\s]*)[^)\n]*\)/g;
const REF_DEF = /^[ \t]*\[[^\]\n]+\]:[ \t]*\S+.*$/gm;
const BARE_URL = /\b(?:https?|ftp|data|javascript):[^\s)<>\]"']+/gi;

export function sanitizeAnswer(text: string, p: LinkPolicy): string {
  let s = text.replace(IMAGE, '').replace(HTML, '').replace(REF_DEF, '');
  const kept: string[] = [];
  s = s.replace(LINK, (whole, label: string, href: string) => {
    if (!allowedLink(href, p)) return label;
    kept.push(whole);
    return `@@kept-link-${kept.length - 1}@@`;
  });
  s = s.replace(BARE_URL, (u) => (allowedLink(u, p) ? u : ''));
  s = s.replace(/@@kept-link-(\d+)@@/g, (_m, i: string) => kept[Number(i)] ?? '');
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
