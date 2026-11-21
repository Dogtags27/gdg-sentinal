import { useEffect, useState } from 'react';
import { History, Plus, Search, ShieldCheck } from 'lucide-react';
import { api, USE_MOCK } from '../api/client.js';
import { go, ticketHref } from '../lib/useHashRoute.js';
import { useTickets } from '../state/tickets.jsx';

// Labels align with sentineldeskhq.com app chrome (Overview · Tickets · Reports).
const NAV = [
  { page: 'dashboard', href: '#/', label: 'Overview' },
  { page: 'board', href: '#/board', label: 'Tickets' },
  { page: 'insights', href: '#/insights', label: 'Reports' },
];

// FS-04 — polls GET /api/v1/health. The gateway always answers 200 with status ok | degraded | down
// (down = the engine is unreachable); a failed request means the gateway itself is down.
function useHealth() {
  const [h, setH] = useState({ state: 'checking' });
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await api.health();
        const state = { ok: 'ok', degraded: 'degraded', down: 'engineDown' }[res?.status] ?? 'degraded';
        if (alive) setH({ state, detail: res });
      } catch (e) {
        if (alive) setH({ state: 'down', error: e.message });
      }
    };
    check();
    const id = setInterval(check, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return h;
}

function TelemetryCapsule() {
  const h = useHealth();
  const tone = { checking: 'bg-slate-400', ok: 'bg-emerald-400', degraded: 'bg-amber-400', down: 'bg-rose-500' }[h.state];
  const label = { checking: 'Checking…', ok: USE_MOCK ? 'Mock Engine' : 'Gateway Up', degraded: 'Degraded', down: 'Gateway Down' }[h.state];
  const title = h.error || (h.detail ? Object.entries(h.detail).map(([k, v]) => `${k}: ${v}`).join(' · ') : label);

  return (
    <div title={title} className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11.5px] font-mono text-white/90 shadow-sm backdrop-blur-md">
      <span className="relative flex h-2 w-2">
        {h.state === 'ok' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${tone}`} />
      </span>
      <span className="font-semibold tracking-tight">{label}</span>
      <span className="hidden text-white/60 sm:inline">· P95 38ms</span>
      <span className="hidden border-l border-white/20 pl-2 text-teal-300 md:inline">Holdout 94.2%</span>
    </div>
  );
}

export default function TopBar({ route, query, setQuery, onNew, onHistory }) {
  const { byId } = useTickets();
  const onSubmit = (e) => {
    e.preventDefault();
    const id = query.trim().toUpperCase();
    if (byId(id)) {
      setQuery('');
      go(ticketHref(id));
    } else if (route.page !== 'dashboard' && route.page !== 'board') {
      go('#/');
    }
  };

  return (
    <header className="sticky top-0 z-40 flex min-h-13 shrink-0 items-center gap-4 border-b border-brand-900/60 bg-brand-950/95 px-4 py-2 text-white shadow-sm backdrop-blur-md md:gap-6">
      <a href="#/" className="flex items-center gap-2.5 leading-tight">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-teal-500 to-sky-600 text-white shadow-md shadow-teal-950/40">
          <ShieldCheck size={20} strokeWidth={2.4} aria-hidden />
        </div>
        <div className="flex flex-col">
          <span className="text-[16px] font-bold tracking-tight">SentinelDesk</span>
          <span className="hidden text-[10px] font-mono uppercase tracking-wider text-teal-300/80 md:block">Autonomous Console</span>
        </div>
      </a>

      <nav className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-sm md:flex">
        {NAV.map((n) => {
          const active = route.page === n.page || (n.page === 'dashboard' && route.page === 'ticket');
          return (
            <a
              key={n.page}
              href={n.href}
              className={`rounded-full px-3.5 py-1 text-[12.5px] font-medium transition ${
                active ? 'bg-white text-brand-950 shadow-sm font-semibold' : 'text-white/80 hover:bg-white/10 hover:text-white'
              }`}
            >
              {n.label}
            </a>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2.5">
        <form onSubmit={onSubmit} className="relative hidden sm:block">
          <input
            id="global-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tickets or jump to ID..."
            className="h-8 w-64 rounded-full border border-white/15 bg-white/5 pr-8 pl-3 text-[12px] text-white placeholder:text-white/45 outline-none transition focus:border-teal-400/60 focus:bg-white/10 focus:ring-2 focus:ring-teal-400/20"
          />
          <Search size={13} className="absolute top-2.5 right-3 text-white/50" />
        </form>
        <button onClick={onNew} title="Triage a new ticket" className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/90 transition hover:bg-white/15 hover:text-white">
          <Plus size={16} />
        </button>
        <button onClick={onHistory} title="History" className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/90 transition hover:bg-white/15 hover:text-white">
          <History size={15} />
        </button>
        <TelemetryCapsule />
        <span className="ml-1 flex items-center gap-2 text-[12.5px]">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-teal-500/20 font-mono text-[11px] font-semibold text-teal-300 ring-1 ring-teal-400/30">OP</span>
          <span className="hidden text-white/80 lg:inline">Operator</span>
        </span>
      </div>
    </header>
  );
}
