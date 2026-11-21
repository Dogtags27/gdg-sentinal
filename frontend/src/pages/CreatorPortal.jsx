import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Clock3, Copy, Inbox, Loader2, Send, ShieldCheck } from 'lucide-react';
import { api } from '../api/client.js';
import { describeError } from '../api/normalize.js';

// Ticket creator view: submit a problem and follow your own tickets. No triage internals are shown here.

const MINE = 'sd-my-tickets';
const MAX_BODY = 10_000;

// What a creator may know about a ticket's progress, in plain words.
const STATUS = {
  new: { label: 'Received', tone: 'bg-slate-100 text-slate-700', tip: 'We have your ticket and it is in the queue.' },
  review: { label: 'In progress', tone: 'bg-sky-50 text-sky-800', tip: 'A support specialist is looking into it.' },
  drafted: { label: 'Reply on its way', tone: 'bg-teal-50 text-teal-800', tip: 'An answer is being finalised for you.' },
  escalated: { label: 'Urgent: team engaged', tone: 'bg-rose-50 text-rose-800', tip: 'Flagged as urgent. Our on-call team is working on it now.' },
  resolved: { label: 'Resolved', tone: 'bg-emerald-50 text-emerald-800', tip: 'This ticket has been resolved.' },
  missing: {
    label: 'Not on record',
    tone: 'bg-slate-100 text-slate-500',
    tip: 'We no longer have this ticket: it expired after 7 days or was sent before tracking began. Please submit it again if you still need help.',
  },
};

const readMine = () => {
  try {
    return JSON.parse(localStorage.getItem(MINE) || '[]');
  } catch {
    return [];
  }
};
const writeMine = (items) => {
  try {
    localStorage.setItem(MINE, JSON.stringify(items.slice(0, 50)));
  } catch {
    /* private mode: history just won't persist */
  }
};

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

function StatusPill({ status }) {
  const s = STATUS[status] ?? STATUS.new;
  return (
    <span title={s.tip} className={`inline-flex shrink-0 cursor-help items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${s.tone}`}>
      {s.label}
    </span>
  );
}

export default function CreatorPortal() {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // the ticket just submitted
  const [mine, setMine] = useState(readMine);
  const [copied, setCopied] = useState(false);

  // Refresh the status of the creator's own tickets (and only those).
  const refresh = useCallback(async () => {
    const items = readMine();
    if (!items.length) return;
    const updated = await Promise.all(
      items.map(async (t) => {
        try {
          const s = await api.ticketStatus(t.ticket_id);
          return { ...t, status: s.status };
        } catch (err) {
          // 404: the store doesn't know this ticket, so don't keep showing a stale status. Other errors: keep the last one.
          return err?.status === 404 ? { ...t, status: 'missing' } : t;
        }
      }),
    );
    writeMine(updated);
    setMine(updated);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => !document.hidden && refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const t = await api.triage({ subject: subject.trim() || null, body: body.trim() });
      const entry = {
        ticket_id: t.ticket_id,
        subject: subject.trim() || body.trim().slice(0, 80),
        created_at: t.created_at,
        status: { ESCALATE_ONCALL: 'escalated', HUMAN_REVIEW: 'review', AUTO_DRAFT: 'drafted' }[t.gate.decision] ?? 'new',
      };
      const next = [entry, ...readMine().filter((x) => x.ticket_id !== entry.ticket_id)];
      writeMine(next);
      setMine(next);
      setDone(entry);
      setSubject('');
      setBody('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSending(false);
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(done.ticket_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the id is visible anyway */
    }
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-brand-50 via-page to-page">
      <header className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-teal-500 text-brand-950">
          <ShieldCheck size={20} strokeWidth={2.4} aria-hidden />
        </span>
        <span className="text-[17px] font-bold tracking-tight text-brand-950">SentinelDesk Support</span>
        <a
          href="#/"
          title="Switch role"
          className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-3 transition hover:bg-white hover:text-ink focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:outline-none"
        >
          <ArrowLeftRight size={14} aria-hidden /> Switch role
        </a>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-5 pb-16">
        <section className="rounded-2xl border border-line bg-white p-6 shadow-sentinel-md sm:p-8">
          {done ? (
            <div className="lab-in py-4 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={30} aria-hidden />
              </div>
              <h1 className="mt-4 text-[22px] font-semibold tracking-tight text-ink">Ticket submitted</h1>
              <p className="mx-auto mt-1.5 max-w-sm text-[14px] text-ink-2">Our support team is on it. You can follow its progress below.</p>
              <button
                onClick={copyId}
                title="Copy ticket ID"
                className="mx-auto mt-4 flex items-center gap-2 rounded-lg border border-line bg-page px-3 py-1.5 font-mono text-[13px] text-ink-2 transition hover:border-line-dark"
              >
                {done.ticket_id} <Copy size={13} aria-hidden /> <span className="sr-only">Copy</span>
                {copied && <span className="font-sans text-[12px] text-emerald-700">Copied</span>}
              </button>
              <button onClick={() => setDone(null)} className="mt-6 text-[13.5px] font-medium text-brand-600 hover:underline">
                Submit another ticket
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h1 className="text-[22px] font-semibold tracking-tight text-ink">How can we help?</h1>
                <p className="mt-1 text-[14px] text-ink-3">English or German. We reply in your language.</p>
              </div>
              <label className="block">
                <span className="text-[13px] font-medium text-ink-2">Subject <span className="font-normal text-ink-3">(optional)</span></span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. VPN not connecting"
                  className="mt-1.5 h-11 w-full rounded-lg border border-line-dark px-3.5 text-[14px] outline-none transition focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15"
                />
              </label>
              <label className="block">
                <span className="text-[13px] font-medium text-ink-2">Describe the problem</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  required
                  maxLength={MAX_BODY}
                  rows={6}
                  placeholder="What happened, and since when?"
                  className="mt-1.5 w-full resize-y rounded-lg border border-line-dark px-3.5 py-3 text-[14px] leading-relaxed outline-none transition focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15"
                />
              </label>
              {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</p>}
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-ink-3" title="Emails, phone numbers and account numbers are masked before any AI reads your ticket.">
                  Personal data is masked automatically.
                </span>
                <button
                  type="submit"
                  disabled={!body.trim() || sending}
                  className="ml-auto flex h-11 items-center gap-2 rounded-lg bg-brand-950 px-5 text-[14px] font-semibold text-white transition hover:bg-brand-800 focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:outline-none disabled:opacity-50"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}
                  {sending ? 'Sending' : 'Submit ticket'}
                </button>
              </div>
            </form>
          )}
        </section>

        <section aria-labelledby="mine-title">
          <h2 id="mine-title" className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Clock3 size={16} className="text-ink-3" aria-hidden /> Your tickets
          </h2>
          {mine.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-dark bg-white/60 px-5 py-6 text-[13.5px] text-ink-3">
              <Inbox size={18} aria-hidden /> Tickets you submit from this browser show up here.
            </div>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
              {mine.map((t) => (
                <li key={t.ticket_id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ink">{t.subject || 'Untitled'}</p>
                    <p className="mt-0.5 text-[12px] text-ink-3">
                      <span className="font-mono">{t.ticket_id}</span> · {when(t.created_at)}
                    </p>
                  </div>
                  <StatusPill status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
