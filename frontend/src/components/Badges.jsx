import {
  AlertTriangle, ArrowDownCircle, CheckCircle2, Flame, MinusCircle, PenLine, Plus, Siren, ShieldAlert, Sparkles, UserCheck,
} from 'lucide-react';
import { DECISIONS, LANGUAGES, PRIORITIES, REASONS, WORKFLOW } from '../lib/constants.js';
import { pct } from '../lib/format.js';

export function Pill({ className = '', icon: Icon, children, title }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${className}`}>
      {Icon && <Icon size={12} strokeWidth={2.4} aria-hidden />}
      {children}
    </span>
  );
}

const DECISION_STYLE = {
  ESCALATE_ONCALL: ['bg-red-600 text-white', Siren],
  HUMAN_REVIEW: ['bg-amber-600 text-white', UserCheck],
  AUTO_DRAFT: ['bg-emerald-600 text-white', Sparkles],
};
export function DecisionBadge({ decision, short = false }) {
  const [cls, Icon] = DECISION_STYLE[decision] ?? ['bg-slate-400 text-white', null];
  const meta = DECISIONS[decision];
  return <Pill className={cls} icon={Icon}>{short ? meta?.short : meta?.label ?? decision}</Pill>;
}

const STATUS_STYLE = {
  new: ['bg-teal-400 text-white', Plus],
  escalated: ['bg-red-700 text-white', Siren],
  review: ['bg-violet-400 text-white', UserCheck],
  drafted: ['bg-brand-700 text-white', PenLine],
  resolved: ['bg-slate-500 text-white', CheckCircle2],
};
export function StatusBadge({ status }) {
  const [cls, Icon] = STATUS_STYLE[status] ?? STATUS_STYLE.new;
  return <Pill className={cls} icon={Icon}>{WORKFLOW.find((w) => w.id === status)?.label ?? status}</Pill>;
}

const PRIORITY_STYLE = {
  high: ['bg-red-600 text-white', Flame],
  medium: ['bg-emerald-600 text-white', MinusCircle],
  low: ['bg-sky-500 text-white', ArrowDownCircle],
};
export function PriorityBadge({ priority }) {
  const [cls, Icon] = PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.low;
  return <Pill className={cls} icon={Icon}>{PRIORITIES[priority]?.label ?? priority}</Pill>;
}

export function LangBadge({ code }) {
  const supported = code === 'en' || code === 'de';
  return (
    <span
      title={LANGUAGES[code] ?? code}
      className={`inline-flex h-5 min-w-7 items-center justify-center rounded border px-1 text-[10px] font-semibold uppercase tracking-wide ${
        supported ? 'border-slate-300 bg-white text-ink-2' : 'border-amber-400 bg-amber-50 text-amber-800'
      }`}
    >
      {code}
    </span>
  );
}

export function ReasonChip({ code, compact = false }) {
  const r = REASONS[code];
  const p1 = r?.severity === 'P1';
  return (
    <span
      title={r?.hint}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-[10.5px] font-medium ${
        p1 ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      {p1 ? <ShieldAlert size={11} aria-hidden /> : <AlertTriangle size={11} aria-hidden />}
      <span className="font-semibold">{r?.severity}</span>
      {!compact && <span>{r?.label ?? code}</span>}
    </span>
  );
}

export function ConfidenceBar({ value, width = 'w-16' }) {
  const tone = value >= 0.8 ? 'bg-emerald-500' : value >= 0.6 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 ${width} overflow-hidden rounded-full bg-slate-200`}>
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="tabular text-[11px] text-ink-2">{pct(value)}</span>
    </span>
  );
}
