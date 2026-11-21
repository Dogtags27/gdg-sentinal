import { useMemo, useState } from 'react';
import { CheckCircle2, Siren, UserCheck } from 'lucide-react';
import ChartCard from '../components/charts/ChartCard.jsx';
import HBarChart from '../components/charts/HBarChart.jsx';
import { useTickets } from '../state/tickets.jsx';
import { LANGUAGES, PIPELINE_STAGES, REASONS } from '../lib/constants.js';
import { ms } from '../lib/format.js';
import InsightsTab from '../features/insights/InsightsTab.jsx';
import PageHeader from '../components/PageHeader.jsx';

// FS-13 — parity with sentineldeskhq.com "Reports" + live ops telemetry.
const VIEWS = [
  { id: 'dataset', label: 'Dataset & benchmarks' },
  { id: 'session', label: 'This session' },
];

const countBy = (xs, key) => {
  const m = new Map();
  xs.forEach((x) => {
    const k = key(x);
    (Array.isArray(k) ? k : [k]).forEach((kk) => m.set(kk, (m.get(kk) || 0) + 1));
  });
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
};

function StatusTile({ icon: Icon, tone, label, value, total }) {
  return (
    <div className="flex flex-1 items-center gap-3 rounded border border-line bg-white px-4 py-3">
      <Icon size={20} className={tone} aria-hidden />
      <div>
        <div className="text-[12px] text-ink-2">{label}</div>
        <div className="text-[20px] font-semibold">
          {value} <span className="text-[12px] font-normal text-ink-3">{total ? Math.round((value / total) * 100) : 0}%</span>
        </div>
      </div>
    </div>
  );
}

export default function InsightsPage() {
  const [view, setView] = useState('dataset');
  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
      <PageHeader
        title="Reports"
        description="What the training dataset looks like and how well the model and gate perform on held-out tickets, plus what happened in this session."
      />
      <div className="mt-4 flex flex-wrap items-center gap-1 border-b border-line" role="tablist" aria-label="Reports view">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition ${view === v.id ? 'border-brand-700 text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === 'session' ? <SessionInsights /> : <InsightsTab />}
    </div>
  );
}

function SessionInsights() {
  const { tickets } = useTickets();

  const d = useMemo(() => {
    const n = tickets.length;
    const by = (dec) => tickets.filter((t) => t.gate.decision === dec).length;
    const stageAvg = PIPELINE_STAGES.map((s) => ({
      label: s.label,
      value: n ? tickets.reduce((a, t) => a + (t.latency_ms?.[s.id] ?? 0), 0) / n : 0,
    }));
    return {
      n,
      esc: by('ESCALATE_ONCALL'),
      rev: by('HUMAN_REVIEW'),
      auto: by('AUTO_DRAFT'),
      queues: countBy(tickets, (t) => t.classification.queue.label),
      reasons: countBy(tickets, (t) => t.gate.reasons.map((r) => REASONS[r.code]?.label ?? r.code)),
      langs: countBy(tickets, (t) => LANGUAGES[t.language.code] ?? t.language.code),
      stageAvg,
    };
  }, [tickets]);

  return (
    <div className="pt-4">
      <p className="text-[13px] text-ink-2">The {d.n} tickets triaged in this browser session. Dataset volumes and model quality are under Dataset &amp; benchmarks.</p>

      <div className="mt-4 flex flex-wrap gap-3">
        <StatusTile icon={Siren} tone="text-red-600" label="Escalated to on-call" value={d.esc} total={d.n} />
        <StatusTile icon={UserCheck} tone="text-amber-600" label="Held for human review" value={d.rev} total={d.n} />
        <StatusTile icon={CheckCircle2} tone="text-emerald-600" label="Auto-drafted" value={d.auto} total={d.n} />
      </div>

      <div className="mt-3 grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
        <ChartCard title="Tickets by suggested queue" subtitle="Count of tickets" table={d.queues}>
          <HBarChart data={d.queues} labelWidth={190} />
        </ChartCard>
        <ChartCard title="Gate reasons fired" subtitle="Tickets can fire more than one reason" table={d.reasons}>
          <HBarChart data={d.reasons} labelWidth={160} />
        </ChartCard>
        <ChartCard title="Average latency by pipeline stage" subtitle="Milliseconds per ticket" table={d.stageAvg} format={ms}>
          <HBarChart data={d.stageAvg} format={ms} labelWidth={90} />
        </ChartCard>
        <ChartCard title="Tickets by language" subtitle="Only English and German are supported" table={d.langs}>
          <HBarChart data={d.langs} labelWidth={90} />
        </ChartCard>
      </div>
    </div>
  );
}
