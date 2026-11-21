import { useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronLeft, ChevronRight, Gauge, Loader2, Plus, Siren, Sparkles, Timer, X, Zap,
} from 'lucide-react';
import KpiCard from '../components/KpiCard.jsx';
import DetailsModal from '../components/DetailsModal.jsx';
import { ConfidenceBar, DecisionBadge, LangBadge, PriorityBadge, ReasonChip } from '../components/Badges.jsx';
import { useTickets } from '../state/tickets.jsx';
import { USE_MOCK } from '../api/client.js';
import { PRIORITIES } from '../lib/constants.js';
import { ms, overallConfidence, shortDate, ticketTitle } from '../lib/format.js';
import { ticketHref } from '../lib/useHashRoute.js';

const TABS = [
  { id: 'needs', label: 'Needs action', test: (t) => t.review === 'pending' && t.status !== 'resolved', count: true },
  { id: 'escalated', label: 'Escalated', test: (t) => t.gate.decision === 'ESCALATE_ONCALL' },
  { id: 'auto', label: 'Auto-drafted', test: (t) => t.gate.decision === 'AUTO_DRAFT' },
  { id: 'accepted', label: 'Accepted', test: (t) => t.review === 'accepted' },
  { id: 'rejected', label: 'Rejected', test: (t) => t.review === 'rejected' },
  { id: 'failed', label: 'Degraded', test: (t) => t.gate.reasons.some((r) => r.code === 'ENGINE_DEGRADED' || r.code === 'UNGROUNDED_DRAFT') },
];

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

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export default function TriageDashboard({ query, setQuery, onNew }) {
  const { tickets, review, toast, simulateOutage, busy } = useTickets();
  const [tab, setTab] = useState('needs');
  const [showResolved, setShowResolved] = useState(false);
  const [sort, setSort] = useState({ key: 'created', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState(() => new Set());
  const [details, setDetails] = useState(null);

  const kpis = useMemo(() => {
    const n = tickets.length;
    const auto = tickets.filter((t) => t.gate.decision === 'AUTO_DRAFT').length;
    const esc = tickets.filter((t) => t.gate.decision === 'ESCALATE_ONCALL').length;
    return { n, auto, autoPct: n ? Math.round((auto / n) * 100) : 0, esc, p50: median(tickets.map((t) => t.latency_ms?.total ?? 0)) };
  }, [tickets]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tabDef = TABS.find((x) => x.id === tab);
    const col = COLUMNS.find((c) => c.key === sort.key);
    return tickets
      .filter((t) => showResolved || t.status !== 'resolved')
      .filter(tabDef.test)
      .filter((t) => !q || [t.ticket_id, t.subject, t.body, t.classification.queue.label, t.classification.type.label].some((f) => f.toLowerCase().includes(q)))
      .sort((a, b) => {
        const x = col.get(a);
        const y = col.get(b);
        const cmp = x < y ? -1 : x > y ? 1 : 0;
        return sort.dir === 'asc' ? cmp : -cmp;
      });
  }, [tickets, tab, showResolved, query, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages);
  const visible = rows.slice((cur - 1) * pageSize, cur * pageSize);
  const allChecked = visible.length > 0 && visible.every((t) => selected.has(t.ticket_id));
  // Bulk actions only touch what the operator can see; selections hidden by a filter or another page are ignored.
  const picked = visible.filter((t) => selected.has(t.ticket_id));

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
    <div className="px-5 py-3">
      <div className="text-[12.5px] text-ink-2">Incident Triage <span className="mx-1 text-ink-3">/</span> Triage Dashboard</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-[22px] font-semibold">Triage Dashboard</h1>
        {USE_MOCK && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Mock data</span>}
        <div className="ml-auto flex gap-2">
          <button
            onClick={simulateOutage}
            disabled={busy.outage}
            className="flex items-center gap-1.5 rounded border border-red-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {busy.outage ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Simulate outage
          </button>
          <button onClick={onNew} className="flex items-center gap-1.5 rounded bg-brand-700 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-brand-800">
            <Plus size={14} /> New ticket
          </button>
        </div>
      </div>
      <p className="mt-1 text-[13px] text-ink-2">
        Classify, route and draft grounded replies for English and German tickets. Anything risky is held for a person or escalated to on-call.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <KpiCard icon={Sparkles} label="AI triaged" value={kpis.n} unit="tickets" hint="Tickets processed by the pipeline in this session" />
        <KpiCard icon={Gauge} iconClass="text-emerald-700 bg-emerald-100" label="Auto-drafted" value={`${kpis.autoPct}%`} unit={`${kpis.auto} tickets`} hint="No gate reasons fired; grounded draft ready" />
        <KpiCard icon={Siren} iconClass="text-red-700 bg-red-100" label="Escalated to on-call" value={kpis.esc} unit="tickets" hint="At least one P1 reason fired" />
        <KpiCard icon={Timer} iconClass="text-violet-700 bg-violet-100" label="Median latency" value={ms(kpis.p50)} hint="End-to-end, gateway to validated draft" />
      </div>

      <section className="mt-4 rounded border border-line bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Filter or search keywords…"
            className="h-8 min-w-[240px] flex-1 rounded border border-line px-2.5 text-[12.5px] outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
          />
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium">
            <button
              role="switch"
              aria-checked={showResolved}
              onClick={() => setShowResolved((v) => !v)}
              className={`relative h-5 w-9 rounded-full transition ${showResolved ? 'bg-brand-600' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${showResolved ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            Show resolved
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
          {TABS.map((x) => {
            const n = tickets.filter((t) => (showResolved || t.status !== 'resolved') && x.test(t)).length;
            return (
              <button
                key={x.id}
                onClick={() => { setTab(x.id); setPage(1); setSelected(new Set()); }}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px] font-medium ${
                  tab === x.id ? 'bg-brand-100 text-brand-800 ring-1 ring-brand-600/30' : 'bg-slate-100 text-ink hover:bg-slate-200'
                }`}
              >
                {x.label}
                {(x.count || tab === x.id) && <span className="tabular text-[11px] text-ink-2">{n}</span>}
              </button>
            );
          })}
          {picked.length > 0 && (
            <span className="ml-auto flex items-center gap-2 text-[12px]">
              <span className="text-ink-2">{picked.length} selected</span>
              <button onClick={() => bulk('accepted')} className="flex items-center gap-1 rounded border border-line px-2 py-1 hover:bg-emerald-50"><Check size={13} /> Accept</button>
              <button onClick={() => bulk('rejected')} className="flex items-center gap-1 rounded border border-line px-2 py-1 hover:bg-red-50"><X size={13} /> Reject</button>
            </span>
          )}
        </div>

        <div className="thin-scroll mt-2 overflow-x-auto px-4">
          <table className="w-full min-w-[1080px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="w-9 py-2.5 pl-1">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all on page" className="accent-brand-600" />
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="py-2.5 pr-3 font-semibold whitespace-nowrap">
                    <button onClick={() => toggleSort(c.key)} className="flex items-center gap-1 hover:text-brand-700">
                      {c.label}
                      {sort.key === c.key ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="text-ink-3" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={COLUMNS.length + 1} className="py-10 text-center text-ink-3">No tickets match this view.</td></tr>
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

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12.5px]">
          <span className="text-ink-2">
            Showing <b className="text-ink">{rows.length ? (cur - 1) * pageSize + 1 : 0}–{Math.min(cur * pageSize, rows.length)}</b> of <b className="text-ink">{rows.length}</b> items
          </span>
          <div className="flex items-center gap-1">
            <button disabled={cur === 1} onClick={() => setPage(cur - 1)} className="grid h-7 w-7 place-items-center rounded hover:bg-slate-100 disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={15} /></button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <button key={p} onClick={() => setPage(p)} className={`h-7 min-w-7 rounded px-1.5 ${p === cur ? 'bg-brand-100 font-semibold text-brand-700' : 'hover:bg-slate-100'}`}>{p}</button>
            ))}
            <button disabled={cur === pages} onClick={() => setPage(cur + 1)} className="grid h-7 w-7 place-items-center rounded hover:bg-slate-100 disabled:opacity-30" aria-label="Next page"><ChevronRight size={15} /></button>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="ml-3 h-7 rounded border border-line bg-white px-1.5">
              {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="ml-1 text-ink-2">items per page</span>
          </div>
        </div>
      </section>

      {details && <DetailsModal ticket={details} onClose={() => setDetails(null)} />}
    </div>
  );
}

function Row({ t, checked, onCheck, onDetails, onReview }) {
  const c = t.classification;
  const p1 = t.gate.reasons.filter((r) => r.severity === 'P1');
  const shown = (p1.length ? p1 : t.gate.reasons).slice(0, 2);
  return (
    <tr className={`border-b border-line/70 hover:bg-brand-50/60 ${checked ? 'bg-brand-50' : ''}`}>
      <td className="py-2 pl-1"><input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${t.ticket_id}`} className="accent-brand-600" /></td>
      <td className="py-2 pr-3 whitespace-nowrap"><a href={ticketHref(t.ticket_id)} className="text-brand-600 hover:underline">{t.ticket_id}</a></td>
      <td className="max-w-[300px] py-2 pr-3">
        <div className={`truncate ${t.subject?.trim() ? '' : 'italic text-ink-2'}`} title={ticketTitle(t)}>{ticketTitle(t)}</div>
        {t.gate.reasons.length > 0 && (
          <div className="mt-0.5 flex gap-1">
            {shown.map((r) => <ReasonChip key={r.code} code={r.code} />)}
            {t.gate.reasons.length > shown.length && <span className="text-[11px] text-ink-3">+{t.gate.reasons.length - shown.length}</span>}
          </div>
        )}
      </td>
      <td className="py-2 pr-3"><LangBadge code={t.language.code} /></td>
      <td className="py-2 pr-3 whitespace-nowrap">{c.type.label}</td>
      <td className="py-2 pr-3"><PriorityBadge priority={c.priority.label} /></td>
      <td className="py-2 pr-3 whitespace-nowrap">
        <span className="flex items-center gap-1.5">
          <DecisionBadge decision={t.gate.decision} short />
          <button onClick={onDetails} title="Why this decision?" className="rounded p-1 text-brand-600 hover:bg-brand-100"><Sparkles size={14} /></button>
        </span>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">
        <span className="flex items-center gap-2">
          <span className={t.review === 'pending' ? 'font-medium text-amber-700' : t.review === 'rejected' ? 'text-ink-3 line-through' : ''}>
            {t.review === 'pending' && <Zap size={12} className="mr-1 inline" />}
            {c.queue.label}
          </span>
          {t.review === 'pending' && (
            <span className="ml-auto flex gap-1">
              <button onClick={() => onReview('accepted')} title="Accept suggestion" className="grid h-6 w-6 place-items-center rounded border border-line bg-white hover:border-emerald-500 hover:text-emerald-700"><Check size={13} /></button>
              <button onClick={() => onReview('rejected')} title="Reject suggestion" className="grid h-6 w-6 place-items-center rounded border border-line bg-white hover:border-red-500 hover:text-red-700"><X size={13} /></button>
            </span>
          )}
          {t.review === 'accepted' && <Check size={13} className="text-emerald-600" aria-label="Accepted" />}
        </span>
      </td>
      <td className="py-2 pr-3"><ConfidenceBar value={overallConfidence(t)} /></td>
      <td className="tabular py-2 pr-1 whitespace-nowrap text-ink-2">{shortDate(t.created_at)}</td>
    </tr>
  );
}
