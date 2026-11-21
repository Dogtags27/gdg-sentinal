import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, createMasker, detectLanguage, maskPII } from '../src/api/mockEngine.js';
import { ApiError, normalizeTriage, serverMessage } from '../src/api/normalize.js';
import { SAMPLES, OUTAGE_BURST } from '../src/data/samples.js';
import { buildSeedTickets } from '../src/data/mockTickets.js';

const codes = (r) => r.gate.reasons.map((x) => x.code);

test('demo samples land on their scripted gate decision', () => {
  const want = {
    'de-vpn': ['ESCALATE_ONCALL', 'HIGH_PRIORITY_INCIDENT'],
    'en-password': ['AUTO_DRAFT'],
    'en-refund-injection': ['HUMAN_REVIEW', 'PROMPT_INJECTION', 'UNSUPPORTED_REQUEST'],
    'de-ransomware': ['ESCALATE_ONCALL', 'SECURITY_INCIDENT'],
    'en-gdpr': ['HUMAN_REVIEW', 'LEGAL_OR_COMPLIANCE'],
    'fr-login': ['HUMAN_REVIEW', 'UNSUPPORTED_LANGUAGE'],
  };
  for (const s of SAMPLES) {
    const [decision, ...reasons] = want[s.id];
    const r = analyze({ ticket_id: 'T', subject: s.subject, body: s.body });
    assert.equal(r.gate.decision, decision, s.id);
    for (const c of reasons) assert.ok(codes(r).includes(c), `${s.id} should fire ${c}, got ${codes(r)}`);
  }
});

test('gate rule: any P1 escalates, else any reason holds, else auto-draft', () => {
  for (const t of buildSeedTickets()) {
    const sev = t.gate.reasons.map((x) => x.severity);
    const expected = sev.includes('P1') ? 'ESCALATE_ONCALL' : sev.length ? 'HUMAN_REVIEW' : 'AUTO_DRAFT';
    assert.equal(t.gate.decision, expected, t.ticket_id);
  }
});

test('outage burst tickets join the cluster and escalate', () => {
  for (const s of OUTAGE_BURST) {
    const r = analyze({ ticket_id: 'T', ...s }, { burst: true });
    assert.equal(r.gate.decision, 'ESCALATE_ONCALL', s.subject);
    assert.ok(codes(r).includes('ACTIVE_OUTAGE'), s.subject);
    assert.equal(r.burst?.cluster_id, 'BURST-VPN-01');
  }
});

test('keywords do not over-fire on harmless mentions', () => {
  assert.equal(analyze({ subject: 'Thanks', body: 'the vpn works great now' }).gate.decision !== 'ESCALATE_ONCALL', true);
  assert.ok(!codes(analyze({ subject: 'Training', body: 'We would like phishing awareness training for staff.' })).includes('SECURITY_INCIDENT'));
});

// Same table as the Go gateway's tests, so the mock and backend/internal/pii agree. It lives in backend/
// because the Go package owns the rules; this test needs the whole repo checked out.
const PII_CASES = JSON.parse(readFileSync(new URL('../../backend/internal/pii/testdata/cases.json', import.meta.url), 'utf8'));

test('PII masking matches the gateway cases', () => {
  for (const c of PII_CASES) {
    const r = maskPII(c.in);
    assert.equal(r.text, c.out, c.name);
    assert.deepEqual(r.entities, c.masked, c.name);
  }
});

test('PII numbering is shared by subject and body', () => {
  const r = analyze({ subject: 'Mail a@b.de', body: 'or c@d.de or a@b.de, call 030 1234567' });
  assert.equal(r.subject, 'Mail [EMAIL_1]');
  assert.equal(r.body, 'or [EMAIL_2] or [EMAIL_1], call [PHONE_1]');
  assert.deepEqual(r.pii.masked, [{ type: 'EMAIL', count: 3 }, { type: 'PHONE', count: 1 }]);
  assert.deepEqual(createMasker().entities(), []);
});

test('language detection', () => {
  assert.equal(detectLanguage('Hello, my password reset email never arrives. Can you help?').code, 'en');
  assert.equal(detectLanguage('Hallo, ich kann mich nicht anmelden. Bitte um Hilfe.').code, 'de');
  assert.equal(detectLanguage('Bonjour, je ne peux pas me connecter depuis hier.').code, 'fr');
  assert.equal(detectLanguage('Ciao, non posso accedere al mio account. Grazie.').code, 'it');
});

test('normalizeTriage accepts the mock shape unchanged in substance', () => {
  const r = analyze({ ticket_id: 'T1', subject: 'Password reset', body: 'I forgot my password' });
  const n = normalizeTriage(r);
  assert.equal(n.ticket_id, 'T1');
  assert.equal(n.gate.decision, r.gate.decision);
  assert.deepEqual(n.draft.validation, r.draft.validation);
});

test('normalizeTriage rejects responses the UI cannot use, with readable errors', () => {
  const ok = analyze({ ticket_id: 'T1', subject: 'x', body: 'y' });
  const bad = [null, [], {}, { ...ok, ticket_id: undefined }, { ...ok, gate: { decision: 'MAYBE' } }, { ...ok, classification: {} }];
  for (const b of bad) {
    assert.throws(() => normalizeTriage(b), (e) => e instanceof ApiError && e.code === 'BAD_RESPONSE' && /missing/.test(e.message));
  }
});

test('normalizeTriage fills optional fields so views never crash', () => {
  const n = normalizeTriage(
    { ticket_id: 7, gate: { decision: 'HUMAN_REVIEW', reasons: [{ code: 'NO_PRECEDENT' }] }, classification: { type: 'Incident', queue: 'IT Support', priority: 'High' }, draft: null },
    { subject: 'S', body: 'B' },
  );
  assert.equal(n.ticket_id, '7');
  assert.equal(n.subject, 'S');
  assert.equal(n.classification.priority.label, 'high');
  assert.equal(n.gate.reasons[0].severity, 'P2');
  assert.deepEqual(n.precedents, []);
  assert.equal(n.draft.validation.passed, false);
  assert.ok(n.created_at && n.language.code);
});

test('serverMessage reads gateway and FastAPI error shapes', () => {
  assert.equal(serverMessage({ error: { message: 'bad' } }), 'bad');
  assert.equal(serverMessage({ detail: 'nope' }), 'nope');
  assert.equal(serverMessage({ detail: [{ msg: 'field required' }, { msg: 'too long' }] }), 'field required; too long');
  assert.equal(serverMessage(null), null);
});
