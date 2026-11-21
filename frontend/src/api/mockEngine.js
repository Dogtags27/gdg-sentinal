// In-browser stand-in for gateway + engine so the console is never blocked (pairs with H-06).
// Deterministic: the same subject/body always produces the same result.
// Shapes here are the PROVISIONAL TriageResult — reconcile with contracts/ once H-02 lands.

import { GATE_THRESHOLDS, REASONS } from '../lib/constants.js';

const { precedentSimilarity: SIM_THRESHOLD, confidenceFloor: CONF_FLOOR, highPriority: P_HIGH_THRESHOLD } = GATE_THRESHOLDS;

// ---------- deterministic randomness ----------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, lo, hi) => lo + r() * (hi - lo);
const round2 = (x) => Math.round(x * 100) / 100;

// ---------- keyword lists (EN + DE) ----------
const KW = {
  security: ['breach', 'hacked', 'ransomware', 'compromised', 'phishing attack', 'phishing link', 'phished', 'malware', 'unauthorized access', 'gehackt', 'angriff', 'verschlüsselt', 'lösegeld', 'datenleck', 'schadsoftware', 'kompromittiert'],
  outage: ['outage', 'is down', 'are down', 'server down', 'vpn down', 'not reachable', 'unreachable', 'cannot connect', "can't connect", 'ausgefallen', 'ausfall', 'nicht erreichbar', 'störung', 'keine verbindung'],
  money: ['refund', 'compensation', 'chargeback', 'money back', 'discount', 'pricing', 'contract terms', 'erstattung', 'rückerstattung', 'entschädigung', 'gutschrift', 'rabatt'],
  legal: ['lawyer', 'lawsuit', 'legal action', 'gdpr', 'dsgvo', 'delete all my data', 'delete my data', 'attorney', 'anwalt', 'klage', 'rechtliche schritte', 'daten löschen'],
  injection: ['ignore previous', 'ignore all previous', 'ignore your instructions', 'system prompt', 'you are now', 'disregard all', 'ignoriere alle', 'ignoriere die vorherigen'],
  billing: ['invoice', 'billing', 'payment', 'charged', 'vat', 'rechnung', 'zahlung', 'abbuchung'],
  password: ['password', 'locked out', 'login attempts', 'log in', 'sign in', '2fa', 'passwort', 'zurücksetzen', 'gesperrt', 'anmelden'],
  feature: ['feature request', 'feature', 'enhancement', 'would be great', 'vorschlag'],
  product: ['app', 'crash', 'crashes', 'update', 'version', 'install', 'installation', 'sync', 'synchronisiert', 'synchronisierung', 'absturz', 'desktop'],
};
const CATEGORY_ORDER = ['security', 'outage', 'money', 'legal', 'billing', 'password', 'feature', 'product'];

const kwRegex = (kw) => new RegExp(`(^|[^\\p{L}])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'iu');
const COMPILED = Object.fromEntries(Object.entries(KW).map(([k, list]) => [k, list.map((w) => [w, kwRegex(w)])]));
function firstHit(group, text) {
  for (const [w, re] of COMPILED[group]) if (re.test(text)) return w;
  return null;
}

// ---------- language ----------
const LANG_WORDS = {
  en: ['the', 'and', 'is', 'not', 'we', 'our', 'please', 'with', 'can', 'my', 'have', 'for', 'you', 'since', 'all'],
  de: ['der', 'die', 'das', 'und', 'nicht', 'ich', 'ist', 'wir', 'bitte', 'unser', 'unsere', 'seit', 'mit', 'kann', 'keine', 'für', 'auf', 'eine', 'haben', 'sind', 'hallo'],
  fr: ['bonjour', 'merci', 'je', 'nous', 'avec', 'votre', 'mon', 'depuis', 'pas', 'de', 'le', 'la'],
  es: ['hola', 'gracias', 'problema', 'nuestro', 'por', 'favor', 'cuenta', 'mi', 'el', 'los'],
  it: ['ciao', 'buongiorno', 'grazie', 'il', 'non', 'della', 'sono', 'abbiamo', 'posso', 'accedere', 'che', 'mio'],
};
export function detectLanguage(text) {
  const words = text.toLowerCase().match(/\p{L}+/gu) || [];
  const scores = Object.fromEntries(Object.keys(LANG_WORDS).map((l) => [l, 0]));
  for (const w of words) for (const [l, list] of Object.entries(LANG_WORDS)) if (list.includes(w)) scores[l]++;
  if (/[äöüß]/i.test(text)) scores.de += 2;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [code, top] = ranked[0];
  if (top === 0) return { code: 'en', confidence: 0.55 };
  const margin = top - ranked[1][1];
  return { code, confidence: round2(Math.min(0.99, 0.72 + margin * 0.05)) };
}

// ---------- category profiles & precedent bank ----------
const PROFILE = {
  security: { type: 'Incident', queue: 'IT Support', priority: 'high', pHigh: 0.91, sim: 0.84, conf: 0.9 },
  outage: { type: 'Incident', queue: 'Service Outages and Maintenance', priority: 'high', pHigh: 0.88, sim: 0.88, conf: 0.89 },
  money: { type: 'Request', queue: 'Billing and Payments', priority: 'medium', pHigh: 0.27, sim: 0.79, conf: 0.8 },
  legal: { type: 'Request', queue: 'Customer Service', priority: 'medium', pHigh: 0.31, sim: 0.74, conf: 0.76 },
  billing: { type: 'Request', queue: 'Billing and Payments', priority: 'low', pHigh: 0.12, sim: 0.86, conf: 0.88 },
  password: { type: 'Request', queue: 'IT Support', priority: 'medium', pHigh: 0.21, sim: 0.91, conf: 0.92 },
  feature: { type: 'Change', queue: 'Product Support', priority: 'low', pHigh: 0.06, sim: 0.72, conf: 0.81 },
  product: { type: 'Problem', queue: 'Technical Support', priority: 'medium', pHigh: 0.3, sim: 0.8, conf: 0.84 },
  general: { type: 'Request', queue: 'General Inquiry', priority: 'low', pHigh: 0.1, sim: 0.24, conf: 0.38 },
};

const BANK = {
  security: [['TKT-00417', 'Ransomware note on file server', 'en'], ['TKT-02981', 'Account compromised after phishing email', 'en'], ['TKT-05520', 'Unbefugte Anmeldungen am Admin-Konto', 'de']],
  outage: [['TKT-02210', 'VPN gateway down for all remote staff', 'en'], ['TKT-04471', 'VPN-Verbindung bricht ständig ab', 'de'], ['TKT-06013', 'Klinik-Netzwerk nicht erreichbar', 'de']],
  money: [['TKT-01276', 'Requesting refund for annual plan', 'en'], ['TKT-05034', 'Compensation for downtime last week', 'en'], ['TKT-03890', 'Rückerstattung nach Kündigung', 'de']],
  legal: [['TKT-02647', 'GDPR data deletion request', 'en'], ['TKT-06120', 'Auskunftsersuchen nach DSGVO', 'de'], ['TKT-03455', 'Legal notice regarding contract', 'en']],
  billing: [['TKT-00933', 'Where can I download my invoice?', 'en'], ['TKT-04108', 'Doppelte Abbuchung auf Rechnung', 'de'], ['TKT-06655', 'Invoice shows wrong VAT', 'en']],
  password: [['TKT-01842', 'Password reset link not arriving', 'en'], ['TKT-03317', 'Locked out after too many attempts', 'en'], ['TKT-07702', 'Passwort zurücksetzen funktioniert nicht', 'de']],
  feature: [['TKT-01590', 'Feature request: dark mode', 'en'], ['TKT-04822', 'Vorschlag: Export als CSV', 'de'], ['TKT-07311', 'Enhancement: bulk edit', 'en']],
  product: [['TKT-00718', 'App crashes after update', 'en'], ['TKT-03602', 'Sync not working on desktop client', 'en'], ['TKT-05947', 'Installation schlägt unter Windows fehl', 'de']],
  general: [['TKT-02034', 'Question about support hours', 'en'], ['TKT-06408', 'Allgemeine Anfrage zum Produkt', 'de'], ['TKT-04563', 'Who is my account manager?', 'en']],
};

// ---------- draft templates ----------
const SIGN = { en: '\n\nBest regards,\nSupport Team', de: '\n\nMit freundlichen Grüßen\nIhr Support-Team' };
const HELLO = { en: 'Hello,\n\n', de: 'Guten Tag,\n\n' };
const BODY = {
  en: {
    security: 'Thank you for reporting this so quickly. We are treating it as a security incident and our on-call security team has been notified [c0]. As an immediate step, please disconnect affected devices from the network and do not pay any ransom or reply to the sender [c1]. A team member will contact you directly to coordinate next steps.',
    outage: 'Thank you for letting us know. We have escalated the outage to our on-call engineers [c0]. While we investigate, please restart the VPN client and tell us whether other users at your site are affected [c1]. We will update this ticket as soon as service is restored.',
    money: 'Thank you for contacting us, and we understand your frustration. Refund and compensation decisions are made by our billing team, so we have forwarded your request to them for review [c0]. We are not able to confirm a refund in this reply. You will hear back once the review is complete [c1].',
    legal: 'Thank you for your request. We have forwarded it to our data protection team, who handle requests of this kind [c0]. They will confirm the next steps with you directly [c1].',
    billing: 'Thank you for your message about your invoice. You can download all invoices under Account → Billing [c0]. If an amount or detail looks incorrect, reply with the invoice number and our billing team will review and reissue it [c1].',
    password: 'Thanks for reaching out. To reset your password, open the sign-in page and choose "Forgot password". A reset link will arrive by email and stays valid for 24 hours [c0]. If it does not arrive, check your spam folder or reply here and we will start a manual reset after verifying your account [c1].',
    feature: 'Thank you for the suggestion. We have logged it with our product team for review [c0]. We can\'t commit to a timeline, but we will update this ticket if it is planned [c1].',
    product: 'Thanks for the details. Please update to the latest version and restart the application, which resolved similar reports [c0]. If the problem continues, send us the app version and a screenshot of the error so we can investigate [c1].',
    general: 'Thank you for reaching out. We have received your request and a member of our team will look into it [c0]. If you can share more details, such as screenshots or the steps you took, that will help us respond faster [c1].',
  },
  de: {
    security: 'vielen Dank für Ihre schnelle Meldung. Wir behandeln den Vorfall als Sicherheitsvorfall und haben unser Bereitschaftsteam informiert [c0]. Bitte trennen Sie betroffene Geräte sofort vom Netzwerk und zahlen Sie kein Lösegeld [c1]. Ein Teammitglied meldet sich direkt bei Ihnen.',
    outage: 'vielen Dank für Ihre Meldung. Wir haben die Störung an unser Bereitschaftsteam eskaliert [c0]. Bitte starten Sie den VPN-Client neu und teilen Sie uns mit, ob weitere Nutzer an Ihrem Standort betroffen sind [c1]. Wir informieren Sie, sobald der Dienst wiederhergestellt ist.',
    money: 'vielen Dank für Ihre Nachricht. Über Erstattungen entscheidet unser Abrechnungsteam, an das wir Ihre Anfrage weitergeleitet haben [c0]. Eine Erstattung können wir in dieser Antwort nicht zusagen. Sie erhalten eine Rückmeldung, sobald die Prüfung abgeschlossen ist [c1].',
    legal: 'vielen Dank für Ihre Anfrage. Wir haben sie an unser Datenschutzteam weitergeleitet [c0]. Das Team stimmt die nächsten Schritte direkt mit Ihnen ab [c1].',
    billing: 'vielen Dank für Ihre Nachricht zu Ihrer Rechnung. Alle Rechnungen finden Sie im Kundenportal unter Konto → Abrechnung [c0]. Wenn ein Betrag nicht stimmt, senden Sie uns bitte die Rechnungsnummer, damit unser Abrechnungsteam ihn prüfen kann [c1].',
    password: 'vielen Dank für Ihre Anfrage. Um Ihr Passwort zurückzusetzen, öffnen Sie die Anmeldeseite und wählen Sie „Passwort vergessen“. Der Link kommt per E-Mail und ist 24 Stunden gültig [c0]. Falls keine E-Mail ankommt, prüfen Sie bitte Ihren Spam-Ordner oder antworten Sie hier [c1].',
    feature: 'vielen Dank für Ihren Vorschlag. Wir haben ihn an unser Produktteam weitergegeben [c0]. Einen Zeitplan können wir nicht zusagen, wir aktualisieren aber dieses Ticket, sobald es Neuigkeiten gibt [c1].',
    product: 'vielen Dank für die Details. Bitte aktualisieren Sie auf die neueste Version und starten Sie die Anwendung neu; das hat bei ähnlichen Meldungen geholfen [c0]. Falls das Problem weiterhin besteht, senden Sie uns bitte die Versionsnummer und einen Screenshot [c1].',
    general: 'vielen Dank für Ihre Nachricht. Wir haben Ihre Anfrage erhalten und ein Teammitglied kümmert sich darum [c0]. Weitere Details wie Screenshots helfen uns, schneller zu antworten [c1].',
  },
};
const FALLBACK = {
  en: 'Thank you for your message. Similar tickets were resolved as described in [c0] and [c1]. An agent will review and complete this reply.',
  de: 'vielen Dank für Ihre Nachricht. Ähnliche Tickets wurden wie in [c0] und [c1] beschrieben gelöst. Ein Mitarbeiter prüft und ergänzt diese Antwort.',
};

// ---------- gateway PII masking (mirrors backend/internal/pii; shared cases in its testdata/cases.json) ----------
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}
const PII_RULES = [
  { type: 'EMAIL', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  // Compact or 4-spaced, any final group length (DE IBANs end in a 2-char group).
  { type: 'IBAN', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g },
  // Grouped numbers are always masked; a bare digit run must pass Luhn so long order numbers stay readable.
  { type: 'CARD', re: /\b(?:\d[ -]?){12,18}\d\b/g, keep: (m) => !/[ -]/.test(m) && !luhn(m.replace(/\D/g, '')) },
  {
    type: 'ACCOUNT',
    // Masks only the number after the label; the value needs a digit so "customer number is missing" stays.
    re: /\b(account\s*(?:number|no\.?|nr\.?|#)|customer\s*(?:number|no\.?|id)|contract\s*(?:number|no\.?)|kontonummer|konto-?nr\.?|kundennummer|kunden-?nr\.?|vertragsnummer|vertrags-?nr\.?)(\s*(?:is\s+)?[:#]?\s*)([A-Z0-9][A-Z0-9-]{3,23})\b/gi,
    group: 3,
    keep: (m) => !/\d/.test(m),
  },
  { type: 'IP', re: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g },
  {
    type: 'PHONE',
    re: /(?<![\w-])(?:\+\d{1,3}[\s-]?)?\(?0?\d{2,4}\)?[\s\-/]?\d{3,4}[\s-]?\d{3,5}(?![\w])/g,
    // A bare digit run like an order number is not a phone: needs +, a leading 0, or separators.
    keep: (m) => !/^[+(0]/.test(m) && !/[\s\-/)]/.test(m),
  },
];

// One numbering per ticket ([EMAIL_1], [EMAIL_2], ...), shared by subject and body; a repeated value keeps
// its number. Same as pii.Masker in Go.
export function createMasker() {
  const numbers = {};
  const counts = {};
  const placeholder = (type, value) => {
    const byValue = (numbers[type] ??= new Map());
    if (!byValue.has(value)) byValue.set(value, byValue.size + 1);
    counts[type] = (counts[type] || 0) + 1;
    return `[${type}_${byValue.get(value)}]`;
  };
  return {
    mask(text) {
      let out = text;
      for (const { type, re, keep, group } of PII_RULES) {
        out = out.replace(re, (m, ...groups) => {
          if (!group) return keep?.(m) ? m : placeholder(type, m);
          const value = groups[group - 1];
          if (keep?.(value)) return m;
          return groups.slice(0, group - 1).join('') + placeholder(type, value);
        });
      }
      return out;
    },
    entities: () => PII_RULES.filter((r) => counts[r.type]).map((r) => ({ type: r.type, count: counts[r.type] })),
  };
}

export function maskPII(text) {
  const m = createMasker();
  return { text: m.mask(text), entities: m.entities() };
}

// ---------- the pipeline ----------
/**
 * @param {{ticket_id?: string, subject: string, body: string, created_at?: string}} input
 * @param {{burst?: boolean, overrides?: object}} ctx
 */
export function analyze(input, ctx = {}) {
  const o = ctx.overrides || {};
  const r = mulberry32(hash(`${input.subject}\n${input.body}`));
  const masker = createMasker();
  const subject = { text: masker.mask(input.subject) };
  const body = { text: masker.mask(input.body) };
  const text = `${subject.text}\n${body.text}`;

  // language
  const language = detectLanguage(text);
  const draftLang = language.code === 'de' ? 'de' : 'en';

  // category + flags
  const hits = Object.fromEntries(Object.keys(KW).map((g) => [g, firstHit(g, text)]));
  const category = o.category || CATEGORY_ORDER.find((c) => hits[c]) || 'general';
  const p = PROFILE[category];

  // classify (calibrated confidences, jittered deterministically)
  const confBase = o.confidence ?? p.conf;
  const pHigh = round2(Math.min(0.98, Math.max(0.02, p.pHigh + between(r, -0.04, 0.04))));
  const priorityLabel = o.priority || (pHigh >= P_HIGH_THRESHOLD ? 'high' : p.priority);
  const k = 5;
  const strong = confBase >= 0.75;
  const classification = {
    type: { label: o.type || p.type, confidence: round2(Math.min(0.99, confBase + between(r, 0, 0.06))) },
    queue: { label: o.queue || p.queue, confidence: round2(Math.min(0.99, confBase + between(r, -0.05, 0.02))), votes: strong ? 4 + Math.round(r()) : 2 + Math.round(r()), k },
    priority: { label: priorityLabel, confidence: round2(Math.min(0.99, confBase + between(r, -0.06, 0.03))), p_high: pHigh },
  };

  // retrieve
  const top = Math.min(0.97, (o.similarity ?? p.sim) + between(r, -0.03, 0.03));
  const precedents = BANK[category].map(([id, subj, lang], i) => ({
    ticket_id: id,
    subject: subj,
    language: lang,
    similarity: round2(top - i * between(r, 0.03, 0.07)),
    type: p.type,
    queue: p.queue,
    priority: p.priority,
  }));

  // gate
  const reasons = [];
  const add = (code, detail) => reasons.push({ code, severity: REASONS[code].severity, detail });
  if (classification.type.label === 'Incident' && pHigh >= P_HIGH_THRESHOLD) add('HIGH_PRIORITY_INCIDENT', `P(high) = ${pHigh.toFixed(2)} ≥ threshold ${P_HIGH_THRESHOLD}`);
  if (hits.security) add('SECURITY_INCIDENT', `Matched “${hits.security}”`);
  if (ctx.burst && category === 'outage') add('ACTIVE_OUTAGE', 'Joined burst cluster BURST-VPN-01');
  if (hits.legal) add('LEGAL_OR_COMPLIANCE', `Matched “${hits.legal}”`);
  if (hits.injection) add('PROMPT_INJECTION', `Matched “${hits.injection}”`);
  if (precedents[0].similarity < SIM_THRESHOLD) add('NO_PRECEDENT', `Top-1 similarity ${precedents[0].similarity.toFixed(2)} < ${SIM_THRESHOLD}`);
  const minConf = Math.min(classification.type.confidence, classification.queue.confidence, classification.priority.confidence);
  if (minConf < CONF_FLOOR) add('LOW_CONFIDENCE', `Calibrated confidence ${minConf.toFixed(2)} < floor ${CONF_FLOOR}`);
  if (hits.money) add('UNSUPPORTED_REQUEST', `Matched “${hits.money}” — no commitments in draft`);
  if (o.ungrounded) add('UNGROUNDED_DRAFT', 'Claim “within 2 business days” not found in cited precedents after retry');
  if (!['en', 'de'].includes(language.code)) add('UNSUPPORTED_LANGUAGE', `Detected ${language.code.toUpperCase()} (${Math.round(language.confidence * 100)}%)`);
  if (o.degraded) add('ENGINE_DEGRADED', 'Gemini timed out after 8 s — extractive fallback used');

  const decision = reasons.some((x) => x.severity === 'P1') ? 'ESCALATE_ONCALL' : reasons.length ? 'HUMAN_REVIEW' : 'AUTO_DRAFT';

  // draft + validate
  const c0 = precedents[0].ticket_id;
  const c1 = precedents[1].ticket_id;
  const core = (o.degraded ? FALLBACK : BODY)[draftLang];
  const coreText = typeof core === 'string' ? core : core[category];
  let draftText = HELLO[draftLang] + coreText.replace('[c0]', `[${c0}]`).replace('[c1]', `[${c1}]`) + SIGN[draftLang];
  if (o.ungrounded) draftText = draftText.replace(SIGN[draftLang], ` We will resolve this within 2 business days.${SIGN[draftLang]}`);
  const draft = {
    language: draftLang,
    text: draftText,
    citations: [c0, c1],
    mode: o.degraded ? 'extractive' : 'generated',
    validation: o.ungrounded
      ? { passed: false, citations_ok: true, numbers_ok: false, retries: 1, issues: ['“2 business days” is not supported by any cited precedent'] }
      : { passed: true, citations_ok: true, numbers_ok: true, retries: 0, issues: [] },
  };

  // latency (ms)
  const latency = {
    gateway: between(r, 3, 9),
    language: between(r, 2, 6),
    classify: between(r, 12, 28),
    retrieve: between(r, 38, 95),
    gate: between(r, 1, 3),
    draft: o.degraded ? 8000 + between(r, 20, 60) : between(r, 650, 1750),
    validate: between(r, 14, 42),
  };
  latency.total = Object.values(latency).reduce((a, b) => a + b, 0);

  return {
    ticket_id: input.ticket_id,
    subject: subject.text,
    body: body.text,
    created_at: input.created_at || new Date().toISOString(),
    processed_at: new Date().toISOString(),
    language,
    classification,
    precedents,
    gate: { decision, reasons },
    draft,
    latency_ms: latency,
    pii: { masked: masker.entities() },
    burst: ctx.burst && category === 'outage' ? { cluster_id: 'BURST-VPN-01' } : null,
  };
}

// ---------- fake transport ----------
let liveCounter = 1;
const sleep = (n) => new Promise((res) => setTimeout(res, n));

export const mockApi = {
  async health() {
    await sleep(120);
    return { status: 'ok', mode: 'mock', engine: 'mock', qdrant: 'mock' };
  },
  async triage(input, { burst = false } = {}) {
    if (!input.subject?.trim() && !input.body?.trim()) {
      const e = new Error('Subject or body is required.');
      e.code = 'VALIDATION';
      throw e;
    }
    await sleep(500 + Math.random() * 700);
    const id = input.ticket_id || `LIVE-${String(liveCounter++).padStart(4, '0')}`;
    return analyze({ ...input, ticket_id: id }, { burst });
  },
};
