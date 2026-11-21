import { Bot, ChevronRight } from 'lucide-react';
import { ticketHref } from '../lib/useHashRoute.js';

function rowStatus(t) {
  if (t.status === 'resolved' || t.review === 'accepted') {
    return { label: 'Resolved', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
  }
  if (t.gate.decision === 'ESCALATE_ONCALL') {
    return { label: 'Escalated', className: 'bg-red-50 text-red-800 border-red-200' };
  }
  if (t.gate.decision === 'AUTO_DRAFT' && t.review !== 'rejected') {
    return { label: 'Auto-handled', className: 'bg-brand-50 text-brand-800 border-brand-200' };
  }
  return { label: 'In progress', className: 'bg-amber-50 text-amber-900 border-amber-200' };
}

/**
 * "Live tickets · AI triaging" strip — parity with sentineldeskhq.com product preview.
 */
export default function LiveTicketFeed({ tickets, max = 5 }) {
  const live = [...tickets]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, max);

  return (
    <section className="sentinel-card overflow-hidden">
      <motionHeader />
      <ul className="divide-y divide-line">
        {live.length === 0 && <li className="px-4 py-8 text-center text-[12.5px] text-ink-3">Triaging starts when you submit a ticket.</li>}
        {live.map((t) => {
          const st = rowStatus(t);
          const category = t.classification?.type?.label ?? 'Ticket';
          const displayId = t.ticket_id.replace(/^TKT-/i, '#');
          return (
            <li key={t.ticket_id}>
              <a
                href={ticketHref(t.ticket_id)}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-brand-50/50"
              >
                <span className="tabular shrink-0 text-[12px] font-semibold text-ink-3">{displayId}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{t.subject || 'No subject'}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{category}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${st.className}`}>
                  {st.label}
                </span>
                <ChevronRight size={14} className="shrink-0 text-ink-3" aria-hidden />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function motionHeader() {
  return (
    <div className="flex items-center justify-between border-b border-line bg-gradient-to-r from-brand-50/80 to-white px-4 py-2.5">
      <div>
        <h2 className="text-[13.5px] font-semibold text-ink">Live tickets</h2>
        <p className="text-[11px] text-ink-3">Plain-language intake → classify → gate → draft</p>
      </div>
      <span className="flex items-center gap-1.5 rounded-full border border-brand-200 bg-white px-2.5 py-1 text-[10.5px] font-semibold text-brand-800">
        <Bot size={13} aria-hidden /> AI triaging
      </span>
    </div>
  );
}