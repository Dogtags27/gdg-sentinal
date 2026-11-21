import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, Loader2, Send } from 'lucide-react';
import Modal from './Modal.jsx';
import { SAMPLES } from '../data/samples.js';
import { useTickets } from '../state/tickets.jsx';
import { go, ticketHref } from '../lib/useHashRoute.js';

const MAX_BODY = 8000;

// FS-05 — ticket input with a sample menu.
export default function NewTicketModal({ onClose }) {
  const { triage } = useTickets();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [menu, setMenu] = useState(false);

  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return;
    // Capture phase: the dialog stops mousedown propagation for its backdrop logic.
    const onDown = (e) => !menuRef.current?.contains(e.target) && setMenu(false);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setMenu(false);
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  const pick = (s) => {
    setSubject(s.subject);
    setBody(s.body);
    setMenu(false);
    setError(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!subject.trim() && !body.trim()) return setError('Add a subject or a body first.');
    setBusy(true);
    setError(null);
    try {
      const t = await triage({ subject: subject.trim(), body: body.trim() });
      onClose();
      go(ticketHref(t.ticket_id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Triage a new ticket" onClose={busy ? () => {} : onClose} width="max-w-2xl">
      <form onSubmit={submit} className="space-y-3">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
            className="flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-medium hover:bg-slate-50"
          >
            Load a sample <ChevronDown size={14} />
          </button>
          {menu && (
            <ul className="absolute z-10 mt-1 w-80 overflow-hidden rounded border border-line bg-white py-1 shadow-lg">
              {SAMPLES.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => pick(s)} className="block w-full px-3 py-1.5 text-left hover:bg-brand-50">
                    <div className="text-[12.5px] font-medium">{s.label}</div>
                    <div className="text-[11.5px] text-ink-3">{s.hint}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={300}
            className="w-full rounded border border-line px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            placeholder="e.g. VPN not reachable since this morning"
          />
        </label>
        <label className="block">
          <span className="mb-1 flex justify-between text-[12px] font-medium text-ink-2">
            Body <span className="tabular font-normal text-ink-3">{body.length}/{MAX_BODY}</span>
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
            rows={7}
            className="w-full resize-y rounded border border-line px-2.5 py-1.5 text-[13px] leading-relaxed outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            placeholder="Paste the customer's message (English or German)…"
          />
        </label>
        <p className="text-[11.5px] text-ink-3">Emails, phone numbers and IBANs are masked by the gateway before the engine sees them.</p>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
            <AlertCircle size={15} className="mt-px shrink-0" /> {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded border border-line px-3 py-1.5 text-[12.5px] hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="flex items-center gap-1.5 rounded bg-brand-700 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-brand-800 disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? 'Triaging…' : 'Run triage'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
