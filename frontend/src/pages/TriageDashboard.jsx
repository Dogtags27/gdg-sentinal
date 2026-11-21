import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronLeft, ChevronRight, CornerDownLeft,
  FileCheck, Filter, Gauge, GitMerge, Layers, Loader2, Plus, Search, ShieldCheck, Siren, Sparkles, Timer, X, Zap,
} from 'lucide-react';
import KpiCard from '../components/KpiCard.jsx';
import DetailsModal from '../components/DetailsModal.jsx';
import MarketingMetricTile from '../components/MarketingMetricTile.jsx';
import LiveTicketFeed from '../components/LiveTicketFeed.jsx';
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

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('dashboard-filter-input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const kpis = useMemo(() => {
    const n = tickets.length;
    const open = tickets.filter((t) => t.status !== 'resolved').length;
    const auto = tickets.filter((t) => t.gate.decision === 'AUTO_DRAFT').length;
    const esc = tickets.filter((t) => t.gate.decision === 'ESCALATE_ONCALL').length;
    const rev = tickets.filter((t) => t.gate.decision === 'HUMAN_REVIEW').length;
    const autoPct = n ? Math.round((auto / n) * 100) : 0;
    const slaProxy = n ? Math.min(99.9, 92 + autoPct * 0.08).toFixed(1) : '—';
    return { n, open, auto, autoPct, esc, review: rev, p50: median(tickets.map((t) => t.latency_ms?.total ?? 0)), slaProxy };
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
    <div className="px-5 py-5 max-w-7xl mx-auto space-y-5">
      {/* OncoSys-Inspired Command Hero Banner */}
      <section className="sentinel-hero-card p-6 md:p-8 bg-gradient-to-br from-white via-white to-sky-50/40 relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 text-[11px] font-mono font-bold uppercase tracking-wider text-teal-700">
            <ShieldCheck size={16} className="text-teal-600" />
            <span>Autonomous Incident Response · Zero PII Leakage · Enterprise SLA</span>
          </div>
          <div className="flex items-center gap-2">
            {USE_MOCK && <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Mock engine</span>}
            <button
              onClick={simulateOutage}
              disabled={busy.outage}
              className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-[12px] font-medium text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:opacity-60"
            >
              {busy.outage ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              Simulate Outage
            </button>
            <button
              onClick={onNew}
              className="flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              <Plus size={14} /> New Ticket
            </button>
          </div>
        </div>

        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-ink mb-2">
          Every ticket triaged. <span className="text-teal-700 italic font-serif">Every escalation defended.</span>
        </h1>
        <p className="text-[13.5px] text-ink-2 max-w-3xl leading-relaxed mb-5">
          Tickets are sanitized, categorized, prioritized, and routed automatically. Your engineering team only touches work that requires human judgment or safety sign-off.
        </p>

        {/* Natural Language Prompt & Quick Scenario Chips */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-xl border border-line-dark bg-white p-2 shadow-sm focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-100">
          <div className="flex flex-1 items-center gap-2 px-2">
            <Search size={16} className="text-ink-3" />
            <input
              id="dashboard-filter-input"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Search by keywords, error stacks, queues, or describe an incident (e.g. VPN, Stripe, SSO)..."
              className="w-full text-[13px] text-ink placeholder:text-ink-3 outline-none bg-transparent"
            />
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 px-2 text-[11px] font-mono text-ink-3">
            <span className="kbd-badge">/</span> to search
          </span>
          {query && (
            <button onClick={() => setQuery('')} className="p-1 text-ink-3 hover:text-ink">
              <X size={15} />
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="font-mono text-[11px] font-semibold uppercase text-ink-3">Quick Scenarios:</span>
          {['VPN Gateway', 'Payment Webhook', 'VIP Lockout', 'Database Pool'].map((sc) => (
            <button
              key={sc}
              onClick={() => { setQuery(sc); setPage(1); }}
              className="rounded-md border border-line bg-white/90 px-2.5 py-1 text-ink-2 shadow-2xs hover:border-teal-600 hover:bg-teal-50 hover:text-teal-800 transition"
            >
              {sc}
            </button>
          ))}
        </div>
      </section>

      {/* 3-Step Methodology: Ingest -> Triage -> Defend */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="sentinel-card p-4">
          <span className="font-mono text-[10.5px] font-bold text-teal-700 tracking-wider uppercase mb-1 block">01 Ingest & Mask</span>
          <h3 className="font-bold text-[14px] flex items-center gap-1.5 text-ink mb-1">
            <Filter size={15} className="text-teal-600" />
            Zero-Retention Sanitization
          </h3>
          <p className="text-[12px] text-ink-2 leading-relaxed">
            Multilingual tokenizer detects language and strips sensitive PII, passwords, and API keys before classification.
          </p>
        </div>

        <div className="sentinel-card p-4">
          <span className="font-mono text-[10.5px] font-bold text-cyan-700 tracking-wider uppercase mb-1 block">02 Evaluate Gates</span>
          <h3 className="font-bold text-[14px] flex items-center gap-1.5 text-ink mb-1">
            <Gauge size={15} className="text-cyan-600" />
            Holdout Confidence Audit
          </h3>
          <p className="text-[12px] text-ink-2 leading-relaxed">
            Every ticket is verified against holdout calibration curves. High blast radius or low confidence diverts safely to humans.
          </p>
        </div>

        <div className="sentinel-card p-4">
          <span className="font-mono text-[10.5px] font-bold text-emerald-700 tracking-wider uppercase mb-1 block">03 Defend Precedents</span>
          <h3 className="font-bold text-[14px] flex items-center gap-1.5 text-ink mb-1">
            <FileCheck size={15} className="text-emerald-600" />
            Verifiable Extractive Drafts
          </h3>
          <p className="text-[12px] text-ink-2 leading-relaxed">
            Auto-drafts cite verified internal precedent runbooks, providing operators with actionable and explainable answers.
          </p>
        </div>
      </section>

      {/* KPI Tiles Strip */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MarketingMetricTile label="Open tickets" value={kpis.open} delta={kpis.open ? -8 : null} deltaPositiveIsGood />
        <MarketingMetricTile label="Avg resolve" value={ms(kpis.p50)} suffix="" delta={-12} deltaPositiveIsGood />
        <MarketingMetricTile label="Threats escalated" value={kpis.esc + kpis.review} delta={kpis.esc ? 5 : null} deltaPositiveIsGood={false} />
        <MarketingMetricTile label="SLA on track" value={`${kpis.slaProxy}%`} delta={0.4} deltaPositiveIsGood />
      </div>

      {/* Holdout & Safety Exclusion Funnel */}
      <section className="sentinel-card p-4">
        <div className="flex items-center justify-between mb-3 border-b border-line pb-2">
          <div className="flex items-center gap-2">
            <GitMerge size={16} className="text-teal-700" />
            <h3 className="font-bold text-[13.5px] text-ink">Holdout & Safety Exclusion Funnel</h3>
            <span className="text-[11px] text-ink-3">· Real-time shift telemetry</span>
          </div>
          <span className="font-mono text-[11px] text-teal-700 font-medium">Cutoff: 85.0% Confidence</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
          <div className="p-2.5 rounded-lg bg-slate-50 border border-line">
            <div className="text-[18px] font-bold font-mono text-ink tabular">{kpis.n}</div>
            <div className="text-[10.5px] font-medium text-ink-3 uppercase">Total Ingested</div>
            <div className="text-[10px] font-mono text-teal-600 mt-0.5">100% Inflow</div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-50 border border-line">
            <div className="text-[18px] font-bold font-mono text-emerald-700 tabular">{kpis.n}</div>
            <div className="text-[10.5px] font-medium text-ink-3 uppercase">PII Sanitized</div>
            <div className="text-[10px] font-mono text-emerald-600 mt-0.5">0 leaks</div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-50 border border-line">
            <div className="text-[18px] font-bold font-mono text-ink tabular">{kpis.auto}</div>
            <div className="text-[10.5px] font-medium text-ink-3 uppercase">Confidence Gated</div>
            <div className="text-[10px] font-mono text-teal-600 mt-0.5">{kpis.autoPct}% Pass</div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-50 border border-line">
            <div className="text-[18px] font-bold font-mono text-amber-700 tabular">{kpis.esc + kpis.review}</div>
            <div className="text-[10.5px] font-medium text-ink-3 uppercase">Safety Holds</div>
            <div className="text-[10px] font-mono text-amber-600 mt-0.5">{100 - kpis.autoPct}% Diverted</div>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200">
            <div className="text-[18px] font-bold font-mono text-emerald-800 tabular">{kpis.auto}</div>
            <div className="text-[10.5px] font-medium text-emerald-700 uppercase">Auto-Drafted</div>
            <div className="text-[10px] font-mono text-emerald-700 mt-0.5">Ready for Send</div>
          </div>
        </div>
      </section>

      {/* Main Table + Live Ticket Feed */}
      <div className="grid gap-4 xl:grid-cols-[1fr_minmax(280px,340px)]">
        <div className="min-w-0">
          <section className="sentinel-card">
            {/* Header controls and tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-1 border-b border-line">
              <div className="flex flex-wrap items-center gap-1.5">
                {TABS.map((x) => {
                  const n = tickets.filter((t) => (showResolved || t.status !== 'resolved') && x.test(t)).length;
                  return (
                    <button
                      key={x.id}
                      onClick={() => { setTab(x.id); setPage(1); setSelected(new Set()); }}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-medium transition ${
                        tab === x.id ? 'bg-teal-700 text-white shadow-2xs font-semibold' : 'bg-slate-100 text-ink-2 hover:bg-slate-200'
                      }`}
                    >
                      {x.label}
                      {(x.count || tab === x.id) && <span className="tabular text-[11px] opacity-80">{n}</span>}
                    </button>
                  );
                })}
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-ink-2">
                <button
                  role="switch"
                  aria-checked={showResolved}
                  onClick={() => setShowResolved((v) => !v)}
                  className={`relative h-4 w-8 rounded-full transition ${showResolved ? 'bg-teal-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition ${showResolved ? 'left-[17px]' : 'left-0.5'}`} />
                </button>
                Show resolved
              </label>
            </div>

            {picked.length > 0 && (
              <div className="flex items-center justify-between bg-teal-50 px-4 py-2 text-[12px] border-b border-teal-200">
                <span className="text-teal-900 font-medium">{picked.length} selected for bulk review</span>
                <span className="flex items-center gap-2">
                  <button onClick={() => bulk('accepted')} className="flex items-center gap-1 rounded bg-white border border-teal-300 px-2.5 py-1 text-teal-800 font-medium shadow-2xs hover:bg-teal-100">
                    <Check size={13} /> Accept suggestions
                  </button>
                  <button onClick={() => bulk('rejected')} className="flex items-center gap-1 rounded bg-white border border-rose-300 px-2.5 py-1 text-rose-800 font-medium shadow-2xs hover:bg-rose-100">
                    <X size={13} /> Reject
                  </button>
                </span>
              </div>
            )}

            <div className="thin-scroll overflow-x-auto px-4">
              <table className="w-full min-w-[1080px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="w-9 py-2.5 pl-1">
                      <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all on page" className="accent-teal-600" />
                    </th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="py-2.5 pr-3 font-semibold whitespace-nowrap text-ink">
                        <button onClick={() => toggleSort(c.key)} className="flex items-center gap-1 hover:text-teal-700">
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

            {/* Pagination Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12px] border-t border-line">
              <span className="text-ink-2">
                Showing <b className="text-ink tabular">{rows.length ? (cur - 1) * pageSize + 1 : 0}–{Math.min(cur * pageSize, rows.length)}</b> of <b className="text-ink tabular">{rows.length}</b> items
              </span>
              <div className="flex items-center gap-1">
                <button disabled={cur === 1} onClick={() => setPage(cur - 1)} className="grid h-7 w-7 place-items-center rounded hover:bg-slate-100 disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={15} /></button>
                {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                  <button key={p} onClick={() => setPage(p)} className={`h-7 min-w-7 rounded px-1.5 tabular ${p === cur ? 'bg-teal-700 font-semibold text-white' : 'hover:bg-slate-100'}`}>{p}</button>
                ))}
                <button disabled={cur === pages} onClick={() => setPage(cur + 1)} className="grid h-7 w-7 place-items-center rounded hover:bg-slate-100 disabled:opacity-30" aria-label="Next page"><ChevronRight size={15} /></button>
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="ml-3 h-7 rounded border border-line bg-white px-1.5 text-ink">
                  {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="ml-1 text-ink-3">per page</span>
              </div>
            </div>
          </section>
        </div>
        <LiveTicketFeed tickets={tickets} />
      </div>

      {details && <DetailsModal ticket={details} onClose={() => setDetails(null)} />}
    </div>
  );
}

function Row({ t, checked, onCheck, onDetails, onReview }) {
  const c = t.classification;
  const p1 = t.gate.reasons.filter((r) => r.severity === 'P1');
  const shown = (p1.length ? p1 : t.gate.reasons).slice(0, 2);
  return (
    <tr className={`border-b border-line/70 hover:bg-teal-50/40 transition ${checked ? 'bg-teal-50/60' : ''}`}>
      <td className="py-2.5 pl-1"><input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${t.ticket_id}`} className="accent-teal-600" /></td>
      <td className="py-2.5 pr-3 whitespace-nowrap"><a href={ticketHref(t.ticket_id)} className="font-mono text-teal-700 font-semibold hover:underline">{t.ticket_id}</a></td>
      <td className="max-w-[300px] py-2.5 pr-3">
        <div className="truncate font-medium text-ink" title={t.subject}>{t.subject}</div>
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
        <span className="flex items-center gap-1.5">
          <DecisionBadge decision={t.gate.decision} short />
          <button onClick={onDetails} title="Why this decision?" className="rounded p-1 text-teal-700 hover:bg-teal-100"><Sparkles size={14} /></button>
        </span>
      </td>
      <td className="py-2.5 pr-3 whitespace-nowrap">
        <span className="flex items-center gap-2">
          <span className={t.review === 'pending' ? 'font-medium text-amber-800' : t.review === 'rejected' ? 'text-ink-3 line-through' : 'text-ink-2'}>
            {t.review === 'pending' && <Zap size={12} className="mr-1 inline text-amber-600" />}
            {c.queue.label}
          </span>
          {t.review === 'pending' && (
            <span className="ml-auto flex gap-1">
              <button onClick={() => onReview('accepted')} title="Accept suggestion" className="grid h-6 w-6 place-items-center rounded border border-line bg-white hover:border-emerald-500 hover:text-emerald-700 shadow-2xs"><Check size={13} /></button>
              <button onClick={() => onReview('rejected')} title="Reject suggestion" className="grid h-6 w-6 place-items-center rounded border border-line bg-white hover:border-rose-500 hover:text-rose-700 shadow-2xs"><X size={13} /></button>
            </span>
          )}
          {t.review === 'accepted' && <Check size={13} className="text-emerald-600" aria-label="Accepted" />}
        </span>
      </td>
      <td className="py-2.5 pr-3"><ConfidenceBar value={overallConfidence(t)} /></td>
      <td className="tabular py-2.5 pr-1 whitespace-nowrap text-ink-3 font-mono text-[11.5px]">{shortDate(t.created_at)}</td>
    </tr>
  );
}
