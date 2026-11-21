/**
 * DA-10: InsightsTab — dataset & holdout telemetry (operations + model sub-tabs).
 */

import { useState } from 'react';
import {
  BarChart3,
  Brain,
  Database,
  FileText,
  Languages,
  Shield,
  Siren,
} from 'lucide-react';
import ChartCard from '../../components/charts/ChartCard.jsx';
import HBarChart from '../../components/charts/HBarChart.jsx';
import KpiCard from '../../components/KpiCard.jsx';
import operationsData from './data/operations_insights.json';
import modelData from './data/model_insights.json';

// Two clearly different hues for the two languages (teal and navy), never two greens.
const LANG_COLORS = { en: 'bg-teal-600', de: 'bg-brand-700' };
const LANG_NAMES = { en: 'English', de: 'German' };
const PRIORITY_ORDER = ['high', 'medium', 'low'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const SUB_TABS = [
  { id: 'operations', label: 'Operational volumes', icon: Database },
  { id: 'model', label: 'Model & gate', icon: Brain },
];

function shortQueue(name) {
  return name.replace(' Support', '').replace(' and Maintenance', '').replace(' and Payments', '');
}

function formatExportDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function ProvenanceFooter() {
  return (
    <footer className="rounded border border-line bg-white px-4 py-3 text-[11.5px] text-ink-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          <span className="font-medium text-ink-2">Dataset:</span> {operationsData.dataset_name}
        </span>
        <span>
          <span className="font-medium text-ink-2">File:</span>{' '}
          <code className="text-ink">{operationsData.source_file ?? '—'}</code>
        </span>
        <span>
          <span className="font-medium text-ink-2">Exported (UTC):</span>{' '}
          {formatExportDate(operationsData.generated_at)}
        </span>
        <span className="text-ink-3">
          Verify: <code className="text-ink-2">{operationsData.verify_command ?? 'analytics/verify_operations_insights.py'}</code>
        </span>
      </div>
    </footer>
  );
}

function SubTabBar({ active, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Dataset insights">
      {SUB_TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px] font-medium ${
            active === id ? 'bg-brand-800 text-white' : 'bg-white text-ink-2 ring-1 ring-line hover:bg-slate-50'
          }`}
        >
          <Icon size={14} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

// One stacked bar instead of a pie: two parts compare more accurately by length than by angle.
function LanguageSplit({ rows }) {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  return (
    <div className="pt-1 pb-2">
      <div className="flex h-7 gap-0.5 overflow-hidden rounded-md" role="img" aria-label={rows.map((r) => `${r.label} ${r.pct}%`).join(', ')}>
        {rows.map((r) => (
          <div key={r.code} className={LANG_COLORS[r.code] ?? 'bg-slate-400'} style={{ width: `${(r.value / total) * 100}%` }} />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        {rows.map((r) => (
          <div key={r.code}>
            <dt className="flex items-center gap-1.5 text-[12px] text-ink-2">
              <span className={`h-2.5 w-2.5 rounded-sm ${LANG_COLORS[r.code] ?? 'bg-slate-400'}`} aria-hidden />
              {r.label}
            </dt>
            <dd className="mt-0.5 text-[20px] font-semibold text-ink">
              {r.pct}% <span className="text-[12px] font-normal text-ink-3">{r.value.toLocaleString()} tickets</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function InsightsTab() {
  const [activeSubTab, setActiveSubTab] = useState('operations');

  const queueTable = Object.entries(operationsData.queues)
    .map(([name, count]) => ({ label: shortQueue(name), value: count }))
    .sort((a, b) => b.value - a.value);

  const langTable = Object.entries(operationsData.languages.counts).map(([code, count]) => ({
    code,
    label: LANG_NAMES[code] ?? code,
    value: count,
    pct: operationsData.languages.percentages[code],
  }));

  // Fixed High → Medium → Low order: priority is ordinal, so it is not sorted by size.
  const priorityTable = PRIORITY_ORDER.filter((p) => p in operationsData.priorities).map((p) => ({
    label: cap(p),
    value: operationsData.priorities[p],
  }));

  const criticalByQueue = Object.entries(operationsData.critical_outages?.by_queue ?? {})
    .map(([label, value]) => ({ label: shortQueue(label), value }))
    .sort((a, b) => b.value - a.value);

  const modelFromHoldout = modelData.metrics_source === 'holdout_eval';

  return (
    <div className="space-y-4 pt-4">
      <SubTabBar active={activeSubTab} onChange={setActiveSubTab} />

      {activeSubTab === 'operations' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <KpiCard
              icon={Database}
              label="Total tickets analyzed"
              value={operationsData.total_volume.toLocaleString()}
              hint="Rows in the source CSV used for DA-02 export"
            />
            <KpiCard
              icon={Languages}
              label="German share"
              value={`${operationsData.languages.percentages.de}%`}
              unit={`(${operationsData.languages.counts.de.toLocaleString()} tickets)`}
            />
            <KpiCard
              icon={Siren}
              iconClass="text-red-700 bg-red-50"
              label="High-priority incidents"
              value={operationsData.critical_outages.total_count.toLocaleString()}
              unit={`(${operationsData.critical_outages.percentage}% of tickets)`}
            />
            <KpiCard
              icon={FileText}
              label="Avg message body"
              value={operationsData.text_telemetry.avg_body_chars}
              unit="chars"
              hint={`Null subjects: ${operationsData.text_telemetry.null_subject_pct}%`}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="Tickets by queue"
              subtitle="All queues in the training dataset"
              table={queueTable}
              format={(v) => v.toLocaleString()}
              className="lg:row-span-2"
            >
              <HBarChart data={queueTable} format={(v) => v.toLocaleString()} labelWidth={150} />
            </ChartCard>

            <ChartCard
              title="Languages"
              subtitle="Share of tickets in English and German"
              table={langTable}
              format={(v) => v.toLocaleString()}
            >
              <LanguageSplit rows={langTable} />
            </ChartCard>

            <ChartCard
              title="Priority"
              subtitle="Tickets per priority level"
              table={priorityTable}
              format={(v) => v.toLocaleString()}
            >
              <HBarChart data={priorityTable} format={(v) => v.toLocaleString()} labelWidth={72} />
            </ChartCard>

            <ChartCard
              title="High-priority incidents by queue"
              subtitle="Incidents with high priority"
              table={criticalByQueue}
              format={(v) => v.toLocaleString()}
            >
              <HBarChart data={criticalByQueue} format={(v) => v.toLocaleString()} labelWidth={120} />
            </ChartCard>
          </div>

          <ProvenanceFooter />
        </div>
      )}

      {activeSubTab === 'model' && (
        <div className="space-y-4">
          {!modelFromHoldout && (
            <div className="rounded border border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-900" role="status">
              Metrics are placeholders until holdout export:{' '}
              <code className="text-[11px]">python3 src/evaluate_holdout.py --export-insights</code> then{' '}
              <code className="text-[11px]">python3 analytics/export_model_insights.py</code>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <KpiCard
              icon={Brain}
              label="Type macro-F1"
              value={`${(modelData.holdout_benchmark.metrics.type_macro_f1 * 100).toFixed(1)}%`}
              unit={`weighted ${(modelData.holdout_benchmark.metrics.type_weighted_f1 * 100).toFixed(1)}%`}
            />
            <KpiCard
              icon={Siren}
              iconClass="text-emerald-700 bg-emerald-50"
              label="High-priority incident recall"
              value={`${(modelData.holdout_benchmark.metrics.high_priority_incident_recall * 100).toFixed(1)}%`}
              unit={`threshold ${(modelData.safety_gate_policy.high_priority_threshold * 100).toFixed(0)}%`}
            />
            <KpiCard
              icon={BarChart3}
              label="Triage inference"
              value={modelData.holdout_benchmark.latency.triage_inference_per_ticket_ms}
              unit="ms / ticket"
              hint={`n=${modelData.holdout_benchmark.eval_sample_size} holdout sample`}
            />
          </div>

          <ChartCard title="Escalation policy (DA-06)" subtitle="P1 → on-call · P2 → human review">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded border border-red-200 bg-red-50 p-3">
                <h4 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-red-900">
                  <Siren size={14} aria-hidden /> P1 → ESCALATE_ONCALL
                </h4>
                <ul className="mt-2 space-y-1 text-[11.5px] text-red-800">
                  <li>
                    <code>HIGH_PRIORITY_INCIDENT</code> — Incident &amp; P(high) ≥ threshold
                  </li>
                  <li>
                    <code>SECURITY_INCIDENT</code> — breach / ransomware terms
                  </li>
                  <li>
                    <code>ACTIVE_OUTAGE</code> — burst cluster
                  </li>
                </ul>
              </div>
              <div className="rounded border border-amber-200 bg-amber-50 p-3">
                <h4 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-900">
                  <Shield size={14} aria-hidden /> P2 → HUMAN_REVIEW
                </h4>
                <ul className="mt-2 space-y-1 text-[11.5px] text-amber-900">
                  <li>
                    <code>PROMPT_INJECTION</code>, <code>UNSUPPORTED_REQUEST</code>
                  </li>
                  <li>
                    <code>NO_PRECEDENT</code>, <code>LEGAL_OR_COMPLIANCE</code>
                  </li>
                </ul>
              </div>
            </div>
          </ChartCard>

          {modelData.generated_at && (
            <p className="text-[11.5px] text-ink-3">
              Model metrics exported: {formatExportDate(modelData.generated_at)}
              {modelFromHoldout ? ' (holdout eval)' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default InsightsTab;