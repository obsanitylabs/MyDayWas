// OBS-350 — mdw F3/F4 funnel tests (metric dictionary v3 §4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mdwFunnel } from './mdwFunnel.mjs';

const e = (event_name, anonymous_id, product = 'mdw') => ({ product, event_name, anonymous_id });

test('empty / dormant event set yields null rates and dormant=true', () => {
  const r = mdwFunnel([]);
  assert.equal(r.dormant, true);
  assert.equal(r.f3.optInRate, null);
  assert.equal(r.f4.answeredRate, null);
  assert.equal(r.f4.skipRate, null);
});

test('F3 = distinct opt-in users / distinct activated users; revocations separate', () => {
  const r = mdwFunnel([
    e('activation_complete', 'a'), e('activation_complete', 'b'), e('activation_complete', 'c'),
    e('signals_optin', 'a'), e('signals_optin', 'a'), e('signals_optin', 'b'),
    e('signals_optout', 'b'),
  ]);
  assert.equal(r.f3.optedInUsers, 2);
  assert.equal(r.f3.activatedUsers, 3);
  assert.equal(r.f3.optInRate, 0.667);
  assert.equal(r.f3.revocations, 1);
  assert.equal(r.f3.revocationRateOfOptedIn, 0.5);
});

test('F4 counts prompted/answered/skipped and per-user rate', () => {
  const r = mdwFunnel([
    e('followup_prompted', 'a'), e('followup_prompted', 'b'), e('followup_prompted', 'a'),
    e('followup_answered', 'a'), e('followup_skipped', 'b'),
  ]);
  assert.equal(r.f4.prompted, 3);
  assert.equal(r.f4.answered, 1);
  assert.equal(r.f4.skipped, 1);
  assert.equal(r.f4.answeredRate, 0.333);
  assert.equal(r.f4.skipRate, 0.333);
  assert.equal(r.f4.perUserAnsweredOverPrompted, 0.5);
});

test('mydaywas alias product is included (live OBS-721 data)', () => {
  const r = mdwFunnel([e('signals_optin', 'a', 'mydaywas'), e('activation_complete', 'a', 'mydaywas')]);
  assert.equal(r.f3.optedInUsers, 1);
  assert.equal(r.f3.optInRate, 1);
});

test('other products never enter the mdw funnel', () => {
  const r = mdwFunnel([e('activation_complete', 'a', 'ubs'), e('signals_optin', 'a', 'pff')]);
  assert.equal(r.f3.activatedUsers, 0);
  assert.equal(r.f3.optedInUsers, 0);
});
