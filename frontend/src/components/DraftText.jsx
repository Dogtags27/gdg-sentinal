// FS-10 — draft is rendered as plain text. Citations like [TKT-01234] become React span
// elements; nothing is ever injected as HTML.
const CITE = /\[(TKT-\d{5})\]/g;

export default function DraftText({ text, known = [] }) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const id = m[1];
    const ok = known.length === 0 || known.includes(id);
    parts.push(
      <span
        key={`${id}-${m.index}`}
        title={ok ? 'Cited precedent' : 'Citation not in retrieved precedents'}
        className={`mx-0.5 inline-flex items-center rounded px-1 align-baseline text-[11px] font-semibold ${
          ok ? 'bg-brand-100 text-brand-700' : 'bg-red-100 text-red-700 line-through'
        }`}
      >
        {id}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{parts}</div>;
}
