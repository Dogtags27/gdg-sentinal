import { lazy, Suspense, useState } from 'react';
import TopBar from './components/TopBar.jsx';
import SideRail from './components/SideRail.jsx';
import OutageBanner from './components/OutageBanner.jsx';
import NewTicketModal from './components/NewTicketModal.jsx';
import HistoryDrawer from './components/HistoryDrawer.jsx';
import Toasts from './components/Toasts.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import TriageDashboard from './pages/TriageDashboard.jsx';
import KanbanBoard from './pages/KanbanBoard.jsx';
import TicketDetail from './pages/TicketDetail.jsx';
import TriageLab from './pages/TriageLab.jsx';
import { useHashRoute } from './lib/useHashRoute.js';

// Recharts is heavy; load the Insights tab only when it is opened.
const InsightsPage = lazy(() => import('./pages/InsightsPage.jsx'));

export default function App() {
  const route = useHashRoute();
  const [query, setQuery] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const page = {
    dashboard: <TriageDashboard view={route.view} query={query} setQuery={setQuery} />,
    board: <KanbanBoard query={query} setQuery={setQuery} />,
    insights: (
      <Suspense fallback={<div className="p-8 text-[13px] text-ink-3">Loading insights…</div>}>
        <InsightsPage />
      </Suspense>
    ),
    lab: <TriageLab />,
    ticket: <TicketDetail id={route.id} />,
  }[route.page];

  return (
    <div className="flex h-full flex-col">
      <TopBar route={route} query={query} setQuery={setQuery} onNew={() => setShowNew(true)} />
      <OutageBanner />
      <div className="flex min-h-0 flex-1">
        <SideRail route={route} onHistory={() => setShowHistory(true)} />
        <main className="thin-scroll min-w-0 flex-1 overflow-y-auto">
          <ErrorBoundary resetKey={`${route.page}/${route.id ?? ''}`}>{page}</ErrorBoundary>
        </main>
      </div>
      {showNew && <NewTicketModal onClose={() => setShowNew(false)} />}
      {showHistory && <HistoryDrawer onClose={() => setShowHistory(false)} />}
      <Toasts />
    </div>
  );
}
