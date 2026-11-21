import { useEffect, useState } from 'react';
import { History, Plus, Search, ShieldCheck } from 'lucide-react';
import { api, USE_MOCK } from '../api/client.js';
import { go, ticketHref } from '../lib/useHashRoute.js';
import { useTickets } from '../state/tickets.jsx';

const NAV = [
  { page: 'dashboard', href: '#/', label: 'Triage' },
  { page: 'board', href: '#/board', label: 'Board' },
  { page: 'insights', href: '#/insights', label: 'Insights' },
];

// FS-04 — polls the gateway health endpoint.
function useHealth() {
  const [h, setH] = useState({ state: 'checking' });
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await api.health();
        if (alive) setH({ state: res?.status === 'ok' ? 'ok' : 'degraded', detail: res });
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

function HealthDot() {
  const h = useHealth();
  const tone = { checking: 'bg-slate-300', ok: 'bg-emerald-400', degraded: 'bg-amber-400', down: 'bg-red-500' }[h.state];
  const gatewayMock = h.detail?.mode === 'mock';
  const label = {
    checking: 'Checking…',
    ok: USE_MOCK ? 'Mock engine' : gatewayMock ? 'Gateway · mock engine' : 'Gateway up',
    degraded: 'Engine down',
    down: 'Gateway down',
  }[h.state];
  const title = h.error || (h.detail ? Object.entries(h.detail).map(([k, v]) => `${k}: ${v}`).join(' · ') : label);
  return (
    <span title={title} className="flex items-center gap-1.5 rounded bg-white/10 px-2 py-1 text-[11.5px] text-white/90">
      <span className={`h-2 w-2 rounded-full ${tone}`} />
      {label}
    </span>
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
    <header className="flex h-12 shrink-0 items-center gap-6 bg-brand-800 px-4 text-white">
      <a href="#/" className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
        <ShieldCheck size={20} strokeWidth={2.4} /> SentinelDesk
      </a>
      <nav className="hidden items-center gap-1 md:flex">
        {NAV.map((n) => {
          const active = route.page === n.page || (n.page === 'dashboard' && route.page === 'ticket');
          return (
            <a
              key={n.page}
              href={n.href}
              className={`rounded px-3 py-1.5 text-[13px] ${active ? 'bg-white/15 font-semibold' : 'text-white/85 hover:bg-white/10'}`}
            >
              {n.label}
            </a>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <form onSubmit={onSubmit} className="relative hidden sm:block">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tickets or jump to ID"
            className="h-8 w-64 rounded border border-white/10 bg-brand-900/70 pr-8 pl-2.5 text-[12.5px] text-white placeholder:text-white/50 outline-none focus:border-white/40"
          />
          <Search size={14} className="absolute top-2 right-2.5 text-white/60" />
        </form>
        <button onClick={onNew} title="Triage a new ticket" className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><Plus size={18} /></button>
        <button onClick={onHistory} title="History" className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><History size={17} /></button>
        <HealthDot />
        <span className="ml-1 flex items-center gap-2 text-[12.5px]">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-[11px] font-semibold">OP</span>
          <span className="hidden lg:inline">Operator</span>
        </span>
      </div>
    </header>
  );
}
