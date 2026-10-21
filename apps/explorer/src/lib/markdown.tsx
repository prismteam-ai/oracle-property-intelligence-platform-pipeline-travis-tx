import { Fragment, type ReactNode } from 'react';

/**
 * The agent's answer as sanitized Markdown (decisions.md section 20, "Prompt-injection boundary"): React elements built
 * from a small subset (paragraphs, lists, bold, italics, inline code), never HTML (text is escaped by React, no
 * dangerouslySetInnerHTML), never images, and links only to the API, the explorer and the two public gateways. Citation
 * tokens (`[[kind:id]]`, api-contract.md) become chips: records link to their API endpoint, a run to the explorer's run
 * history, a CID to the explorer's Verify view.
 */
export interface MarkdownContext {
  /** The API base (VITE_API_URL), or '' for same-origin. */
  apiBase: string;
  /** The explorer's origin (location.origin). */
  explorerOrigin: string;
}

export const GATEWAYS = ['ipfs.filebase.io', 'gateway.pinata.cloud'] as const;

/** Whether a link target is one the answer may link to. */
export function allowedHref(href: string, ctx: MarkdownContext): boolean {
  if (href.startsWith('#/')) return true;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const origins = [ctx.apiBase, ctx.explorerOrigin].filter(Boolean).map((o) => {
    try {
      return new URL(o).origin;
    } catch {
      return '';
    }
  });
  if (origins.includes(u.origin)) return true;
  return u.protocol === 'https:' && (GATEWAYS as readonly string[]).includes(u.hostname);
}

const KINDS: Record<string, { label: string; path?: (id: string) => string }> = {
  property: { label: 'property', path: (id) => `/v1/properties/${encodeURIComponent(id)}` },
  permit: { label: 'permit', path: (id) => `/v1/permits/${encodeURIComponent(id)}` },
  contractor: { label: 'contractor', path: (id) => `/v1/contractors/${encodeURIComponent(id)}` },
  business: { label: 'business record', path: (id) => `/v1/businesses/${encodeURIComponent(id)}` },
  license: { label: 'license record', path: (id) => `/v1/licenses/${encodeURIComponent(id)}` },
  run: { label: 'run' },
};

const short = (id: string) => (/^[0-9a-f]{24,}$/.test(id) ? `${id.slice(0, 8)}…` : id);

/** One citation chip: a readable label and a link into the API record (or the explorer for a run). */
export function CitationChip({
  kind,
  id,
  ctx,
}: {
  kind: string;
  id: string;
  ctx: MarkdownContext;
}) {
  const k = KINDS[kind];
  if (!k) return <code>{`[[${kind}:${id}]]`}</code>;
  const href = k.path ? `${ctx.apiBase}${k.path(id)}` : '#/runs';
  return (
    <a
      className="chip"
      href={href}
      title={`${k.label} ${id}`}
      {...(k.path ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      data-testid="citation"
    >
      {k.label} {short(id)}
    </a>
  );
}

// citation | image | link | code | bold | italic | CID
const INLINE =
  /(\[\[([a-z_]+):([^\]\n]+)\]\])|(!\[[^\]]*\]\([^)]*\))|(\[([^\]\n]+)\]\(([^)\s]+)\))|(`([^`\n]+)`)|(\*\*([^*\n]+)\*\*)|(\*([^*\s][^*\n]*)\*|_([^_\n]+)_)|(\bba[a-z2-7]{40,}\b)/g;

export function renderInline(text: string, ctx: MarkdownContext, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyBase}-${n++}`;
    if (m[1]) out.push(<CitationChip key={key} kind={m[2]!} id={m[3]!.trim()} ctx={ctx} />);
    else if (m[4])
      out.push(null); // images are never shown
    else if (m[5]) {
      const href = m[7]!;
      out.push(
        allowedHref(href, ctx) ? (
          <a
            key={key}
            href={href}
            rel="noreferrer noopener"
            target={href.startsWith('#/') ? undefined : '_blank'}
          >
            {renderInline(m[6]!, ctx, key)}
          </a>
        ) : (
          <Fragment key={key}>{renderInline(m[6]!, ctx, key)}</Fragment>
        ),
      );
    } else if (m[8]) out.push(<code key={key}>{m[9]}</code>);
    else if (m[10]) out.push(<strong key={key}>{renderInline(m[11]!, ctx, key)}</strong>);
    else if (m[12]) out.push(<em key={key}>{renderInline(m[13] ?? m[14]!, ctx, key)}</em>);
    else if (m[15])
      out.push(
        <a key={key} href={`#/verify?cid=${m[15]}`} title="Verify this CID">
          <code className="cid">{m[15]}</code>
        </a>,
      );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/** Block structure: paragraphs, bullet and numbered lists, headings shown as bold lines, rules dropped. */
export function Markdown({ text, ctx }: { text: string; ctx: MarkdownContext }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(<p key={k}>{renderInline(para.join(' '), ctx, k)}</p>);
    }
    para = [];
  };
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`;
      const items = list.items.map((it, i) => (
        <li key={i}>{renderInline(it, ctx, `${k}-${i}`)}</li>
      ));
      blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
    }
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '' || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      flushList();
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flushPara();
      const ordered = /^\s*\d/.test(line);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item[1]!);
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const k = `h${blocks.length}`;
      blocks.push(
        <p key={k}>
          <strong>{renderInline(heading[1]!, ctx, k)}</strong>
        </p>,
      );
      continue;
    }
    if (list) flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return <div className="answer">{blocks}</div>;
}
