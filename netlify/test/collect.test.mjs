// OBS-783 — collector CORS tests (exact-origin, preflight + error branches).
// Run: node --test netlify/test/collect.test.mjs
//
// Lives OUTSIDE netlify/functions/ on purpose: every file in the functions dir is
// auto-deployed as a Netlify Function, and a name containing a dot (`collect.test`)
// is rejected, which failed the site deploy. Mirrors the netlify/shared/*.test.mjs
// convention.
//
// The handler is exercised directly with a minimal Request-like object. Only
// the pre-flight and the pre-store error branches are driven here (the store
// branches need a Netlify Blobs context), which is exactly the transport
// surface this change adds.
import test from 'node:test';
import assert from 'node:assert/strict';
import collect from '../functions/collect.mjs';

const APP_ORIGIN = 'https://mydaywas.com';

function req({ method = 'POST', origin, body = '{}' } = {}) {
  const headers = new Map();
  if (origin !== undefined) headers.set('origin', origin);
  return {
    method,
    headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null },
    text: async () => body,
  };
}

test('OPTIONS preflight for the app origin is 204 with exact-origin ACAO', async () => {
  const res = await collect(req({ method: 'OPTIONS', origin: APP_ORIGIN }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), APP_ORIGIN);
  assert.equal(res.headers.get('access-control-allow-methods'), 'POST');
  assert.equal(res.headers.get('access-control-allow-headers'), 'content-type');
  assert.equal(res.headers.get('vary'), 'Origin');
  assert.ok(res.headers.get('access-control-max-age'));
});

test('OPTIONS preflight never wildcards or reflects a foreign origin', async () => {
  for (const origin of ['https://evil.example', undefined, 'https://app.mydaywas.com.evil.example']) {
    const res = await collect(req({ method: 'OPTIONS', origin }));
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(res.headers.get('vary'), 'Origin');
  }
});

test('a bad-json POST carries the ACAO on the error branch (browser can read it)', async () => {
  const res = await collect(req({ origin: APP_ORIGIN, body: 'not-json' }));
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('access-control-allow-origin'), APP_ORIGIN);
  assert.deepEqual(await res.json(), { error: 'bad-json' });
});

test('a non-POST request is 404 and still carries the ACAO for the app origin', async () => {
  const res = await collect(req({ method: 'GET', origin: APP_ORIGIN }));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('access-control-allow-origin'), APP_ORIGIN);
});

test('a non-POST request from a foreign origin gets NO ACAO', async () => {
  const res = await collect(req({ method: 'GET', origin: 'https://evil.example' }));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});
