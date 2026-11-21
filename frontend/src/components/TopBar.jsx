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

function HealthDot() {
  const h = useHealth();
  // Mock mode reports degraded (its components are stubs) but works, so it gets its own label and colour.
  const gatewayMock = h.detail?.mode === 'mock' && h.state !== 'down';
  const tone = gatewayMock ? 'bg-emerald-400' : { checking: 'bg-slate-300', ok: 'bg-emerald-400', degraded: 'bg-amber-400', engineDown: 'bg-red-500', down: 'bg-red-500' }[h.state];
  const label = {
    checking: 'Checking…',
    ok: 'Live',
    degraded: 'Degraded',
    engineDown: 'Engine down',
    down: 'Gateway down',
  }[h.state];
  const shown = gatewayMock ? (USE_MOCK ? 'Mock engine' : 'Gateway · mock engine') : label;
  const components = h.detail?.components ?? {};
  const title =
    h.error ||
    [`mode: ${h.detail?.mode ?? '?'}`, ...Object.entries(components).map(([k, v]) => `${k.replace('_', ' ')}: ${v}`)].join(' · ');
  return (
    <span title={title} className="flex items-center gap-1.5 rounded bg-white/10 px-2 py-1 text-[11.5px] text-white/90">
      <span className={`h-2 w-2 rounded-full ${tone}`} />
      {shown}
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
