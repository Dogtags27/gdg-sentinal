import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronLeft, ChevronRight, Loader2, Sparkles, X, Zap } from 'lucide-react';
import DetailsModal from '../components/DetailsModal.jsx';
import { ConfidenceBar, DecisionBadge, LangBadge, PriorityBadge, ReasonChip } from '../components/Badges.jsx';
import { useTickets } from '../state/tickets.jsx';
import { PRIORITIES } from '../lib/constants.js';
import { ms, overallConfidence, shortDate, ticketTitle } from '../lib/format.js';
import { ticketHref } from '../lib/useHashRoute.js';
import { VIEWS, VIEW_BY_ID, countView, viewHref } from '../lib/views.js';

const DECISION_RANK = { ESCALATE_ONCALL: 3, HUMAN_REVIEW: 2, AUTO_DRAFT: 1 };
const COLUMNS = [
  { key: 'id', label: 'Ticket', get: (t) => t.ticket_id },
  { key: 'subject', label: 'Subject', get: (t) => ticketTitle(t).toLowerCase() },
  { key: 'lang', label: 'Lang', get: (t) => t.language.code },
  { key: 'type', label: 'Type', get: (t) => t.classification.type.label },
  { key: 'priority', label: 'Priority', get: (t) => PRIORITIES[t.classification.priority.label]?.rank ?? 0 },
  { key: 'decision', label: 'Gate decision', get: (t) => DECISION_RANK[t.gate.decision] },
  { key: 'queue', label: 'Suggested queue', get: (t) => t.classification.queue.label },
  { key: 'conf', label: 'Confidence', get: (t) => overallConfidence(t) },
  { key: 'created', label: 'Created', get: (t) => t.created_at },
];

// The three gate outcomes, in the order a ticket is checked. Colors match the side-rail queue dots.
const OUTCOMES = [
  { id: 'escalated', bar: 'bg-red-600', text: 'text-red-700', what: 'On-call paged, draft held' },
  { id: 'review', bar: 'bg-amber-400', text: 'text-amber-700', what: 'A safety check fired' },
  { id: 'auto', bar: 'bg-teal-500', text: 'text-teal-700', what: 'Grounded draft ready to send' },
];

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export default function TriageDashboard({ view: viewId = 'needs', query, setQuery }) {
  const { tickets, review, toast, simulateOutage, busy } = useTickets();
  const view = VIEW_BY_ID[viewId] ?? VIEW_BY_ID.needs;
  const [sort, setSort] = useState({ key: 'created', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState(() => new Set());
  const [details, setDetails] = useState(null);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [view.id, query]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const col = COLUMNS.find((c) => c.key === sort.key);
    return tickets
      .filter(view.test)
      .filter((t) => !q || [t.ticket_id, t.subject, t.body, t.classification.queue.label, t.classification.type.label].some((f) => f?.toLowerCase().includes(q)))
      .sort((a, b) => {
        const x = col.get(a);
        const y = col.get(b);
        const cmp = x < y ? -1 : x > y ? 1 : 0;
        return sort.dir === 'asc' ? cmp : -cmp;
      });
  }, [tickets, view, query, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages);
  const visible = rows.slice((cur - 1) * pageSize, cur * pageSize);
  const allChecked = visible.length > 0 && visible.every((t) => selected.has(t.ticket_id));
  const picked = visible.filter((t) => selected.has(t.ticket_id));
  const needs = countView(tickets, 'needs');

  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    visible.forEach((t) => (allChecked ? n.delete(t.ticket_id) : n.add(t.ticket_id)));
    return n;
  });
  const bulk = (verdict) => {
    picked.forEach((t) => review(t.ticket_id, verdict, verdict === 'accepted' ? ['queue'] : undefined));
    toast(`${verdict === 'accepted' ? 'Accepted' : 'Rejected'} suggestions on ${picked.length} ticket${picked.length > 1 ? 's' : ''}`, verdict === 'accepted' ? 'good' : 'info');
    setSelected(new Set());
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Overview</h1>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {needs === 0
              ? 'Nothing is waiting for you. New tickets are triaged as they arrive.'
              : `${needs} ticket${needs > 1 ? 's' : ''} need${needs > 1 ? '' : 's'} a person. Everything else was triaged automatically.`}
          </p>
        </div>
        <button
          onClick={simulateOutage}
          disabled={busy.outage}
          title="Sends a burst of outage tickets through triage to show burst detection"
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-line-dark bg-white px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition hover:border-red-300 hover:text-red-700 disabled:opacity-60"
        >
          {busy.outage ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
          Simulate an outage
        </button>
      </header>

      <TriageSplit tickets={tickets} active={view.id} />

      <section className="rounded-xl border border-line bg-white">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2.5 sm:px-4">
          <nav className="flex flex-wrap gap-1" aria-label="Ticket views">
            {VIEWS.map((v) => {
              const on = v.id === view.id;
              return (
                <a
                  key={v.id}
                  href={viewHref(v.id)}
                  aria-current={on ? 'page' : undefined}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium transition ${
                    on ? 'bg-brand-800 text-white' : 'text-ink-2 hover:bg-slate-100'
                  }`}
                >
                  {v.label}
                  <span className={`tabular text-[11.5px] ${on ? 'text-white/75' : 'text-ink-3'}`}>{countView(tickets, v.id)}</span>
                </a>
              );
            })}
          </nav>
          {query && (
            <span className="ml-auto flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[12px] text-ink-2">
              Matching “{query}”
              <button onClick={() => setQuery('')} className="rounded text-ink-3 hover:text-ink" aria-label="Clear search"><X size={13} /></button>
            </span>
          )}
        </div>
        <p className="border-b border-line px-3 py-2 text-[12px] text-ink-3 sm:px-4">{view.blurb}</p>

        {picked.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-100 bg-brand-50 px-4 py-2 text-[12px]">
            <span className="font-medium text-brand-900">{picked.length} selected</span>
            <span className="flex items-center gap-2">
              <button onClick={() => bulk('accepted')} className="flex items-center gap-1 rounded border border-line-dark bg-white px-2.5 py-1 font-medium text-ink hover:border-teal-500 hover:text-teal-800">
                <Check size={13} /> Accept suggestions
              </button>
              <button onClick={() => bulk('rejected')} className="flex items-center gap-1 rounded border border-line-dark bg-white px-2.5 py-1 font-medium text-ink hover:border-red-400 hover:text-red-800">
                <X size={13} /> Reject
              </button>
            </span>
          </div>
        )}

        <div className="thin-scroll overflow-x-auto px-3 sm:px-4">
          <table className="w-full min-w-[1040px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="w-9 py-2.5 pl-1">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all on page" className="accent-brand-600" />
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="py-2.5 pr-3 font-semibold whitespace-nowrap text-ink-2">
                    <button onClick={() => toggleSort(c.key)} className="flex items-center gap-1 hover:text-ink">
                      {c.label}
                      {sort.key === c.key ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="text-slate-300" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="py-10 text-center text-ink-3">
                    {query ? `No ${view.label.toLowerCase()} tickets match “${query}”.` : `No ${view.label.toLowerCase()} tickets right now.`}
                  </td>
                </tr>
              )}
              {visible.map((t) => (
                <Row
                  key={t.ticket_id}
                  t={t}
                  checked={selected.has(t.ticket_id)}
                  onCheck={() => toggle(t.ticket_id)}
                  onDetails={() => setDetails(t)}
                  onReview={(v) => review(t.ticket_id, v, v === 'accepted' ? ['queue'] : undefined)}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-3 text-[12px] sm:px-4">
          <span className="text-ink-2">
            Showing <b className="tabular text-ink">{rows.length ? (cur - 1) * pageSize + 1 : 0}–{Math.min(cur * pageSize, rows.length)}</b> of <b className="tabular text-ink">{rows.length}</b>
          </span>
          <div className="flex items-center gap-1">
            <button disabled={cur === 1} onClick={() => setPage(cur - 1)} className="grid h-7 w-7 place-items-center rounded hover:bg-slate-100 disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={15} /></button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <button key={p} onClick={() => setPage(p)} aria-current={p === cur ? 'page' : undefined} className={`tabular h-7 min-w-7 rounded px-1.5 ${p === cur ? 'bg-brand-800 font-semibold text-white' : 'hover:bg-slate-100'}`}>{p}</button>
            ))}
            <button disabled={cur === pages} onClick={() => setPage(cur + 1)} className="grid h-7 w-7 place-items-center rounded hover:bg-slate-100 disabled:opacity-30" aria-label="Next page"><ChevronRight size={15} /></button>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} aria-label="Rows per page" className="ml-3 h-7 rounded border border-line bg-white px-1.5 text-ink">
              {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="ml-1 text-ink-3">per page</span>
          </div>
        </div>
      </section>

      {details && <DetailsModal ticket={details} onClose={() => setDetails(null)} />}
    </div>
  );
}

// One bar, three segments: how the escalation gate split every ticket in this session.
// Each segment and its legend link to the matching view.
function TriageSplit({ tickets, active }) {
  const n = tickets.length;
  const masked = tickets.filter((t) => t.pii?.masked?.length).length;
  const p50 = median(tickets.map((t) => t.latency_ms?.total).filter((x) => x != null));
  const parts = OUTCOMES.map((o) => {
    const v = VIEW_BY_ID[o.id];
    return { ...o, label: v.label, count: tickets.filter((t) => t.gate.decision === v.decision).length };
  });

  return (
    <section className="rounded-xl border border-line bg-white px-4 py-4 sm:px-5" aria-label="How the gate split this session's tickets">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-[14px] font-semibold text-ink">
          The gate sorted <span className="tabular">{n}</span> ticket{n === 1 ? '' : 's'}
        </h2>
        <p className="text-[12px] text-ink-3">
          PII masked in {masked} before the model saw them{p50 != null && <>. Median triage {ms(p50)}</>}.
        </p>
      </div>

      <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100">
        {n > 0 && parts.map((p) => p.count > 0 && (
          <a key={p.id} href={viewHref(p.id)} title={`${p.count} ${p.label.toLowerCase()}`} className={`${p.bar} transition-opacity hover:opacity-80`} style={{ width: `${(p.count / n) * 100}%` }} />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {parts.map((p) => {
          const on = active === p.id;
          return (
            <a
              key={p.id}
              href={viewHref(p.id)}
              aria-current={on ? 'page' : undefined}
              className={`group flex items-baseline gap-3 rounded-lg border px-3 py-2 transition ${on ? 'border-brand-600 bg-brand-50' : 'border-transparent hover:border-line hover:bg-slate-50'}`}
            >
              <span className={`tabular text-[26px] leading-none font-semibold ${p.text}`}>{p.count}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">{p.label}</span>
                <span className="block text-[12px] text-ink-3">{p.what}</span>
              </span>
              <span className="tabular ml-auto text-[12px] text-ink-3">{n ? Math.round((p.count / n) * 100) : 0}%</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function Row({ t, checked, onCheck, onDetails, onReview }) {
  const c = t.classification;
  const p1 = t.gate.reasons.filter((r) => r.severity === 'P1');
  const shown = (p1.length ? p1 : t.gate.reasons).slice(0, 2);
  return (
    <tr className={`border-b border-line/70 transition hover:bg-slate-50 ${checked ? 'bg-brand-50/70' : ''}`}>
      <td className="py-2.5 pl-1"><input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${t.ticket_id}`} className="accent-brand-600" /></td>
      <td className="py-2.5 pr-3 whitespace-nowrap"><a href={ticketHref(t.ticket_id)} className="font-mono text-[12px] font-medium text-brand-600 hover:underline">{t.ticket_id}</a></td>
      <td className="max-w-[300px] py-2.5 pr-3">
        <a href={ticketHref(t.ticket_id)} className="block truncate font-medium text-ink hover:text-brand-700" title={t.subject}>{ticketTitle(t)}</a>
        {t.gate.reasons.length > 0 && (
          <div className="mt-0.5 flex gap-1">
            {shown.map((r) => <ReasonChip key={r.code} code={r.code} />)}
            {t.gate.reasons.length > shown.length && <span className="text-[11px] text-ink-3">+{t.gate.reasons.length - shown.length}</span>}
          </div>
        )}
      </td>
      <td className="py-2.5 pr-3"><LangBadge code={t.language.code} /></td>
      <td className="py-2.5 pr-3 whitespace-nowrap text-ink-2">{c.type.label}</td>
      <td className="py-2.5 pr-3"><PriorityBadge priority={c.priority.label} /></td>
      <td className="py-2.5 pr-3 whitespace-nowrap">
        <span className="flex items-center gap-1">
          <DecisionBadge decision={t.gate.decision} short />
          <button onClick={onDetails} title="Why this decision?" aria-label={`Why ${t.ticket_id} got this decision`} className="rounded p-1 text-ink-3 hover:bg-slate-100 hover:text-brand-700"><Sparkles size={14} /></button>
        </span>
      </td>
      <td className="py-2.5 pr-3 whitespace-nowrap">
        <span className="flex items-center gap-2">
          <span className={t.review === 'rejected' ? 'text-ink-3 line-through' : 'text-ink-2'}>{c.queue.label}</span>
          {t.review === 'pending' && (
            <span className="ml-auto flex gap-1">
              <button onClick={() => onReview('accepted')} title="Accept suggestion" aria-label={`Accept suggestion for ${t.ticket_id}`} className="grid h-6 w-6 place-items-center rounded border border-line bg-white hover:border-teal-500 hover:text-teal-700"><Check size={13} /></button>
              <button onClick={() => onReview('rejected')} title="Reject suggestion" aria-label={`Reject suggestion for ${t.ticket_id}`} className="grid h-6 w-6 place-items-center rounded border border-line bg-white hover:border-red-400 hover:text-red-700"><X size={13} /></button>
            </span>
          )}
          {t.review === 'accepted' && <Check size={13} className="text-teal-600" aria-label="Accepted" />}
        </span>
      </td>
      <td className="py-2.5 pr-3"><ConfidenceBar value={overallConfidence(t)} /></td>
      <td className="tabular py-2.5 pr-1 whitespace-nowrap text-[12px] text-ink-3">{shortDate(t.created_at)}</td>
    </tr>
  );
}
