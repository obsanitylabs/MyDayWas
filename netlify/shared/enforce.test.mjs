// OBS-350 — collector allowlist tests for the five metric-dictionary v3 `mdw`
// consent/follow-up events (product code `mdw`; v2 §5.2 + v3 §3).
// Run: node --test netlify/shared/enforce.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, validateBatch, ENUMS_OUT } from './enforce.mjs';

const U = '0f8b0d3a-2c1e-4b7a-9d6f-1a2b3c4d5e6f';
const S = '11112222-3333-4444-5555-666677778888';

function base(name, product = 'mdw', extra = {}) {
  return {
    product,
    event_name: name,
    anonymous_id: U,
    session_id: S,
    utm_source: 'direct',
    wallet_connected: false,
    build_version: 'mdw-1.0.0',
    timestamp: '2026-11-02T12:00:00Z',
    ...extra,
  };
}

const V3 = ['signals_optin', 'signals_optout', 'followup_prompted', 'followup_answered', 'followup_skipped'];

test('mdw is in the closed product enum', () => {
  assert.ok(ENUMS_OUT.product.includes('mdw'));
  assert.ok(ENUMS_OUT.product.includes('mydaywas'));
});

test('all five v3 mdw events are accepted with only §2.1 common attributes', () => {
  for (const name of V3) {
    const r = validateEvent(base(name));
    assert.equal(r.ok, true, `${name} should be accepted`);
    assert.equal(r.event.event_name, name);
    assert.equal(r.event.product, 'mdw');
  }
});

test('v3 events survive the batch path and are counted accepted', () => {
  const { accepted, stats } = validateBatch(V3.map((n) => base(n)));
  assert.equal(accepted.length, 5);
  assert.equal(stats.accepted, 5);
  assert.equal(stats.rejected, 0);
});

test('v3 events carry no per-event attributes: an extra attribute is dropped, never persisted', () => {
  const r = validateEvent(base('signals_optin', 'mdw', { answer_text: 'my private day' }));
  assert.equal(r.ok, true);
  assert.equal(r.event.answer_text, undefined);
  assert.ok(r.dropped.includes('extra:answer_text'));
});

test('mydaywas alias routes to the mdw table (live OBS-721 data keeps validating)', () => {
  const r = validateEvent(base('page_view', 'mydaywas', { page_path: '/app?q=1' }));
  assert.equal(r.ok, true);
  assert.equal(r.event.page_path, '/app');
});

test('mdw page_view/entry_saved accepted; unknown mdw event rejected', () => {
  assert.equal(validateEvent(base('page_view', 'mdw', { page_path: '/app' })).ok, true);
  assert.equal(validateEvent(base('entry_saved')).ok, true);
  const bad = validateEvent(base('signals_optin_typo'));
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'unknown-event-name');
});

test('v3.mdw events are not valid on other products (closed per-product lists)', () => {
  for (const p of ['ubs', 'pff']) {
    const r = validateEvent(base('signals_optin', p));
    assert.equal(r.ok, false, `${p} must reject signals_optin`);
    assert.equal(r.reason, 'unknown-event-name');
  }
});

test('a name with an extra attribute that is a required attribute of another event is still just dropped', () => {
  const r = validateEvent(base('followup_answered', 'mdw', { action_type: 'entry_saved' }));
  assert.equal(r.ok, true);
  assert.equal(r.event.action_type, undefined);
  assert.ok(r.dropped.includes('extra:action_type'));
});

test('funnel_step requires its declared attributes (missing funnel_name rejected)', () => {
  const missing = validateEvent(base('funnel_step', 'mdw', { step_index: 1 }));
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /missing-required:funnel_name/);
  const ok = validateEvent(base('funnel_step', 'mdw', { funnel_name: 'mdw_onboarding', step_index: 1, step_name: 'write' }));
  assert.equal(ok.ok, true);
});

test('mdw core_action enum accepts mdw values and rejects cross-product values', () => {
  assert.equal(validateEvent(base('core_action', 'mdw', { action_type: 'entry_edited' })).ok, true);
  const cross = validateEvent(base('core_action', 'mdw', { action_type: 'box_opened' }));
  assert.equal(cross.ok, false);
  assert.match(cross.reason, /missing-required:action_type/);
});

test('missing anonymous_id/session_id rejects any mdw event', () => {
  const e = base('signals_optout');
  delete e.session_id;
  const r = validateEvent(e);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-anonymous_id-or-session_id');
});
