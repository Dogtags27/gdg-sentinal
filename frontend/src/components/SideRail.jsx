import { BarChart3, KanbanSquare, ListChecks } from 'lucide-react';

const ITEMS = [
  { page: 'dashboard', href: '#/', icon: ListChecks, label: 'Overview', short: 'Overview' },
  { page: 'board', href: '#/board', icon: KanbanSquare, label: 'Tickets', short: 'Tickets' },
  { page: 'insights', href: '#/insights', icon: BarChart3, label: 'Reports', short: 'Reports' },
];

export default function SideRail({ route }) {
  return (
    <nav
      className="hidden w-12 shrink-0 flex-col gap-0.5 border-r border-line bg-white py-3 sm:flex lg:w-[148px] lg:items-stretch lg:px-2"
      aria-label="Main"
    >
      {ITEMS.map(({ page, href, icon: Icon, label, short }) => {
        const active = route.page === page || (page === 'dashboard' && route.page === 'ticket');
        return (
          <a
            key={page}
            href={href}
            title={label}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={`relative flex items-center gap-2 rounded-md px-2 py-2 text-[12.5px] font-medium transition ${
              active ? 'bg-brand-100 text-brand-800' : 'text-ink-2 hover:bg-slate-100 hover:text-ink'
            } lg:justify-start`}
          >
            {active && <span className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-r bg-brand-600 lg:-left-2" />}
            <Icon size={18} className="shrink-0" aria-hidden />
            <span className="hidden lg:inline">{short}</span>
          </a>
        );
      })}
      <a
        href="https://www.sentineldeskhq.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto hidden rounded-md px-2 py-2 text-[11px] text-ink-3 hover:text-brand-700 lg:block"
      >
        sentineldeskhq.com ↗
      </a>
    </nav>
  );
}
