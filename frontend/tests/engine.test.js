import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, detectLanguage, maskPII } from '../src/api/mockEngine.js';
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

test('PII masking', () => {
  const cases = [
    ['mail anna.keller@example.com now', 'mail [EMAIL] now', 'EMAIL'],
    ['IBAN DE89370400440532013000 bitte', 'IBAN [IBAN] bitte', 'IBAN'],
    ['IBAN DE89 3704 0044 0532 0130 00.', 'IBAN [IBAN].', 'IBAN'],
    ['card 4111 1111 1111 1111 expired', 'card [CARD] expired', 'CARD'],
    ['call +49 30 1234 5678 today', 'call [PHONE] today', 'PHONE'],
    ['call 030 1234567 today', 'call [PHONE] today', 'PHONE'],
  ];
  for (const [input, out, type] of cases) {
    const r = maskPII(input);
    assert.equal(r.text, out, input);
    assert.ok(r.entities.some((e) => e.type === type), input);
  }
  for (const keep of ['order 123456789 shipped', 'error 0x80070005 on update', 'ticket TKT-24017', 'version 2.14.3']) {
    assert.equal(maskPII(keep).text, keep, keep);
  }
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
