// Ticket-creator vocabulary: what a customer may know about a ticket's progress, in plain words.

export const MINE = 'sd-my-tickets';

export const STATUS = {
  new: {
    label: 'Received',
    tone: 'bg-slate-100 text-slate-700',
    tip: 'We have your ticket and it is in the queue.',
  },
  review: {
    label: 'In progress',
    tone: 'bg-sky-50 text-sky-800',
    tip: 'A support specialist is looking into it.',
  },
  drafted: {
    label: 'Reply on its way',
    tone: 'bg-teal-50 text-teal-800',
    tip: 'An answer is being finalised for you.',
  },
  escalated: {
    label: 'Urgent: team engaged',
    tone: 'bg-rose-50 text-rose-800',
    tip: 'Flagged as urgent. Our on-call team is working on it now.',
  },
  resolved: {
    label: 'Resolved',
    tone: 'bg-emerald-50 text-emerald-800',
    tip: 'This ticket has been resolved.',
  },
  missing: {
    label: 'Not on record',
    tone: 'bg-slate-100 text-slate-500',
    tip: 'We no longer have this ticket: it expired after 7 days or was sent before tracking began. Please submit it again if you still need help.',
  },
};

export function StatusPill({ status }) {
  const s = STATUS[status] ?? STATUS.new;
  return (
    <span
      title={s.tip}
      className={`inline-flex shrink-0 cursor-help items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${s.tone}`}
    >
      {s.label}
    </span>
  );
}

export const readMine = () => {
  try {
    return JSON.parse(localStorage.getItem(MINE) || '[]');
  } catch {
    return [];
  }
};

export const writeMine = (items) => {
  try {
    localStorage.setItem(MINE, JSON.stringify(items.slice(0, 50)));
  } catch {
    /* private mode: history just won't persist */
  }
};

/** Merge a fresh status into the creator's local history (keeps the list in step with the detail view). */
export const rememberStatus = (id, patch) => {
  const items = readMine();
  if (items.some((t) => t.ticket_id === id)) writeMine(items.map((t) => (t.ticket_id === id ? { ...t, ...patch } : t)));
};

export const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};
