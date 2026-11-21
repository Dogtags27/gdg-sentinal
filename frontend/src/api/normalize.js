// Response handling with no Vite or browser dependencies, so it runs under `node --test`.
import { DECISIONS, REASONS } from '../lib/constants.js';

export class ApiError extends Error {
  constructor(message, { status = null, code = 'ERROR', cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

// Handles the gateway's {error:{message}} shape and FastAPI's {detail: string | [{msg}]}.
export function serverMessage(data) {
  const m = data?.error?.message || data?.message || data?.detail;
  if (Array.isArray(m)) return m.map((d) => d?.msg ?? String(d)).join('; ');
  return typeof m === 'string' ? m : null;
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const label = (v) =>
  typeof v === 'string' ? { label: v, confidence: 0 } : { ...obj(v), label: String(obj(v).label ?? 'unknown'), confidence: num(obj(v).confidence) };

// The contract is not frozen yet: require the few fields the UI cannot work without, default the rest,
// so a renamed field shows a readable error instead of crashing a view.
export function normalizeTriage(r, input = {}) {
  const missing = (what) => new ApiError(`The gateway response is missing ${what}.`, { code: 'BAD_RESPONSE' });
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw missing('a body');
  if (!['string', 'number'].includes(typeof r.ticket_id) || r.ticket_id === '') throw missing('ticket_id');
  const gate = obj(r.gate);
  if (!DECISIONS[gate.decision]) throw missing('a known gate.decision');
  const cls = obj(r.classification);
  if (!cls.type || !cls.queue || !cls.priority) throw missing('classification.type / queue / priority');

  const now = new Date().toISOString();
  const language = { code: String(obj(r.language).code ?? 'unknown'), confidence: num(obj(r.language).confidence) };
  const draft = obj(r.draft);
  const validation = obj(draft.validation);
  const priority = label(cls.priority);
  return {
    ...r,
    ticket_id: String(r.ticket_id),
    subject: String(r.subject ?? input.subject ?? ''),
    body: String(r.body ?? input.body ?? ''),
    created_at: r.created_at || now,
    processed_at: r.processed_at || now,
    language,
    classification: {
      type: label(cls.type),
      queue: { ...label(cls.queue), votes: num(obj(cls.queue).votes), k: num(obj(cls.queue).k) },
      priority: { ...priority, label: priority.label.toLowerCase(), p_high: num(obj(cls.priority).p_high) },
    },
    precedents: (Array.isArray(r.precedents) ? r.precedents : []).filter((p) => p && p.ticket_id),
    gate: {
      decision: gate.decision,
      reasons: (Array.isArray(gate.reasons) ? gate.reasons : [])
        .filter((x) => x && x.code)
        .map((x) => ({ ...x, severity: x.severity ?? REASONS[x.code]?.severity ?? 'P2', detail: String(x.detail ?? '') })),
    },
    draft: {
      language: draft.language ?? language.code,
      text: String(draft.text ?? ''),
      citations: Array.isArray(draft.citations) ? draft.citations : [],
      mode: draft.mode === 'extractive' ? 'extractive' : 'generated',
      validation: {
        passed: validation.passed === true && Boolean(draft.text),
        citations_ok: validation.citations_ok === true,
        numbers_ok: validation.numbers_ok === true,
        retries: num(validation.retries),
        issues: Array.isArray(validation.issues) ? validation.issues.map(String) : draft.text ? [] : ['No draft was returned.'],
      },
    },
    latency_ms: obj(r.latency_ms),
    pii: { masked: Array.isArray(obj(r.pii).masked) ? r.pii.masked : [] },
  };
}
