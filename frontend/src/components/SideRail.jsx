import { BarChart3, KanbanSquare, ListChecks } from 'lucide-react';

const ITEMS = [
  { page: 'dashboard', href: '#/', icon: ListChecks, label: 'Triage dashboard' },
  { page: 'board', href: '#/board', icon: KanbanSquare, label: 'Kanban board' },
  { page: 'insights', href: '#/insights', icon: BarChart3, label: 'Insights' },
];

export default function SideRail({ route }) {
  return (
    <nav className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-white py-3 sm:flex" aria-label="Sections">
      {ITEMS.map(({ page, href, icon: Icon, label }) => {
        const active = route.page === page || (page === 'dashboard' && route.page === 'ticket');
        return (
          <a
            key={page}
            href={href}
            title={label}
            aria-label={label}
            className={`relative grid h-9 w-9 place-items-center rounded ${active ? 'bg-brand-100 text-brand-700' : 'text-ink-3 hover:bg-slate-100 hover:text-ink'}`}
          >
            {active && <span className="absolute top-1.5 bottom-1.5 -left-1.5 w-[3px] rounded-r bg-brand-600" />}
            <Icon size={18} />
          </a>
        );
      })}
    </nav>
  );
}
