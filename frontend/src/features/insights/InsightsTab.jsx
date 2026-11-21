/**
 * DA-10: InsightsTab.jsx
 * Operational Analytics & Model Triage Insights Component
 * For SentinelDesk React Frontend (Tailwind CSS + Recharts).
 */

import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';

import operationsData from './data/operations_insights.json';
import modelData from './data/model_insights.json';

const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export const InsightsTab = () => {
  const [activeSubTab, setActiveSubTab] = useState('operations');

  // Format Queue Distribution Data for Recharts
  const queueChartData = Object.entries(operationsData.queues).map(([name, count]) => ({
    name: name.replace(' Support', '').replace(' and Maintenance', ''),
    tickets: count,
  }));

  // Format Language Data
  const langChartData = Object.entries(operationsData.languages.counts).map(([lang, count]) => ({
    name: lang === 'en' ? 'English (en)' : 'German (de)',
    value: count,
  }));

  // Format Priority Data
  const priorityChartData = Object.entries(operationsData.priorities).map(([prio, count]) => ({
    name: prio.toUpperCase(),
    value: count,
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      
      {/* Header & Sub-Tab Switcher */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            📊 SentinelDesk Insights & Telemetry
          </h1>
          <p className="text-sm text-slate-500">
            Real-time operational distribution and holdout benchmark telemetry.
          </p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
          <button
            onClick={() => setActiveSubTab('operations')}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${
              activeSubTab === 'operations' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🏢 Operational Volumes
          </button>
          <button
            onClick={() => setActiveSubTab('model')}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${
              activeSubTab === 'model' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🧠 Model & Gate Performance
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: OPERATIONAL VOLUMES */}
      {activeSubTab === 'operations' && (
        <div className="space-y-6">
          
          {/* Top KPI Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="text-xs font-bold text-slate-500 uppercase">Total Tickets Analyzed</div>
              <div className="text-2xl font-black text-slate-900 mt-1">{operationsData.total_volume.toLocaleString()}</div>
              <div className="text-xs text-emerald-600 font-medium mt-1">100% Ingested & Verified</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="text-xs font-bold text-slate-500 uppercase">German (DE) Ratio</div>
              <div className="text-2xl font-black text-slate-900 mt-1">{operationsData.languages.percentages.de}%</div>
              <div className="text-xs text-slate-500 font-medium mt-1">{operationsData.languages.counts.de.toLocaleString()} tickets</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-red-500">
              <div className="text-xs font-bold text-slate-500 uppercase">Critical P1 Outages</div>
              <div className="text-2xl font-black text-red-600 mt-1">{operationsData.critical_outages.total_count.toLocaleString()}</div>
              <div className="text-xs text-red-500 font-medium mt-1">{operationsData.critical_outages.percentage}% of total stream</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="text-xs font-bold text-slate-500 uppercase">Avg Message Body</div>
              <div className="text-2xl font-black text-slate-900 mt-1">{operationsData.text_telemetry.avg_body_chars} chars</div>
              <div className="text-xs text-slate-500 font-medium mt-1">Null subjects: {operationsData.text_telemetry.null_subject_pct}%</div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Queue Distribution Bar Chart */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-slate-900 mb-4 flex items-center justify-between">
                <span>📁 Volume by Department Queue</span>
                <span className="text-xs font-normal text-slate-500">Top 10 Queues</span>
              </h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={queueChartData} margin={{ top: 10, right: 10, left: -20, bottom: 40 }}>
                    <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="tickets" fill="#2563EB" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Language & Priority Split */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-slate-900 mb-4">🌐 Multilingual Distribution (EN / DE)</h3>
              <div className="h-72 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={langChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      {langChartData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* SUB-TAB 2: MODEL & GATE PERFORMANCE */}
      {activeSubTab === 'model' && (
        <div className="space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="text-xs font-bold text-slate-500 uppercase">Type Macro-F1 (4 Classes)</div>
              <div className="text-3xl font-black text-blue-600 mt-2">
                {(modelData.holdout_benchmark.metrics.type_macro_f1 * 100).toFixed(1)}%
              </div>
              <p className="text-xs text-slate-500 mt-2">Weighted: {(modelData.holdout_benchmark.metrics.type_weighted_f1 * 100).toFixed(1)}%</p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-emerald-500">
              <div className="text-xs font-bold text-slate-500 uppercase">P1 Outage Incident Recall</div>
              <div className="text-3xl font-black text-emerald-600 mt-2">
                {(modelData.holdout_benchmark.metrics.high_priority_incident_recall * 100).toFixed(1)}%
              </div>
              <p className="text-xs text-slate-500 mt-2">Tuned threshold: {modelData.safety_gate_policy.high_priority_threshold * 100}%</p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="text-xs font-bold text-slate-500 uppercase">Inference Latency</div>
              <div className="text-3xl font-black text-slate-900 mt-2">
                {modelData.holdout_benchmark.latency.triage_inference_per_ticket_ms} ms
              </div>
              <p className="text-xs text-slate-500 mt-2">Sub-second end-to-end</p>
            </div>
          </div>

          {/* Safety Policy Rules Matrix */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="text-base font-bold text-slate-900 mb-2">🛡️ Escalation Policy Codes (DA-06 Specification)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                <h4 className="font-bold text-red-800 text-sm mb-2">🚨 P1 Severity → ESCALATE_ONCALL</h4>
                <ul className="text-xs text-red-700 space-y-1">
                  <li>• <code>HIGH_PRIORITY_INCIDENT</code>: Type=Incident & P(High) ≥ 38%</li>
                  <li>• <code>SECURITY_INCIDENT</code>: Ransomware, breach, or hacked terms</li>
                  <li>• <code>ACTIVE_OUTAGE</code>: Ticket joins an active burst cluster</li>
                </ul>
              </div>

              <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
                <h4 className="font-bold text-amber-800 text-sm mb-2">⚠️ P2 Severity → HUMAN_REVIEW</h4>
                <ul className="text-xs text-amber-700 space-y-1">
                  <li>• <code>PROMPT_INJECTION</code>: Jailbreak or override patterns</li>
                  <li>• <code>UNSUPPORTED_REQUEST</code>: 100% refund, Bitcoin, or SLA compensation</li>
                  <li>• <code>NO_PRECEDENT</code>: Top-1 similarity &lt; 28%</li>
                  <li>• <code>LEGAL_OR_COMPLIANCE</code>: Lawsuit, GDPR/DSGVO, or attorney demands</li>
                </ul>
              </div>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};

export default InsightsTab;