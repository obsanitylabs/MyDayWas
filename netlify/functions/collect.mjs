// OBS-125 — Netlify-native collector (same-origin, per-site). Replaces the VPS collector proxy.
// Enforces R1 (allowlist, query-strip, host-only referrer), R3 (IP truncation before
// persistence, log redaction), R6 (bot filter — counted, never stored).
// OBS-169: default-on aggregate collection — no consent gate (R2 consent check removed).
// Storage: Netlify Blobs (same provider as the site — Netlify, Inc. is the sole processor; see
// docs/COMPLIANCE-DELTA.md and public/analytics-notice.html).
// Deployed at POST /api/collect on each site's own domain.
'use strict';
import { getStore } from '@netlify/blobs';
import { validateBatch, truncateIp, redactLogs } from '../shared/enforce.mjs';
import { makeBotFilter } from '../shared/enforce.mjs';

const isBot = makeBotFilter(); // in-process sliding window (per warm instance; demo volume)
const JSON_HEADERS = { 'content-type': 'application/json' };
const NO_STORE = { 'cache-control': 'no-store' };
const MAX_BATCH_EVENTS = 50; // cheap-DoS cap: events past the cap are rejected+counted, never persisted

// OBS-783 — cross-origin transport for the mdw app emitter. The diary app runs
// on its own origin (app.mydaywas.com); the collector runs on the landing site
// (mydaywas.com), so the browser needs CORS. EXACT-origin match only: no `*`
// and no blind `Origin` reflection. The ACAO is present on the preflight, on
// the POST responses, AND on every error branch so the browser can read the
// error (the same defect class the relayer CORS gap had on 2026-11-01).
const ALLOWED_ORIGIN = (process.env.MDW_COLLECT_ORIGIN || 'https://app.mydaywas.com').trim();
function corsHeaders(origin) {
  const headers = { vary: 'Origin' };
  if (origin && origin === ALLOWED_ORIGIN) headers['access-control-allow-origin'] = ALLOWED_ORIGIN;
  return headers;
}

function dayKey(d = new Date()) { return `events/${d.toISOString().slice(0, 10)}`; }
function qualityKey(d = new Date()) { return `quality/${d.toISOString().slice(0, 10)}`; }

export default async (req) => {
  const cors = corsHeaders(req.headers.get('origin'));
  const json = (body, status, extra = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...NO_STORE, ...cors, ...extra } });

  // CORS preflight — 204, exact-origin ACAO only, POST + content-type only.
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
      },
    });
  }
  if (req.method !== 'POST') return json({ error: 'not-found' }, 404);

  let parsed;
  try { parsed = JSON.parse(await req.text()); } catch { return json({ error: 'bad-json' }, 400); }
  const events = parsed.events;

  // R3 — truncate at the earliest hop; never log or persist the full IP.
  const rawIp = req.headers.get('x-nf-client-connection-ip') || '';
  const ip = truncateIp(rawIp) || null;
  const ua = req.headers.get('user-agent') || '';
  const bot = isBot({ truncatedIp: ip, userAgent: ua }); // UA used transiently, never persisted
  const store = getStore('site-analytics');
  const today = new Date().toISOString().slice(0, 10);

  const bumpQuality = async (delta) => {
    const qk = `quality/${today}`;
    const cur = JSON.parse((await store.get(qk)) || '{}');
    for (const k of Object.keys(delta)) cur[k] = (cur[k] || 0) + delta[k];
    await store.setJSON(qk, cur);
  };

  if (bot.bot) { await bumpQuality({ botFiltered: 1 }); return json({ ok: true, filtered: true }, 200); }

  const overflow = Array.isArray(events) ? Math.max(0, events.length - MAX_BATCH_EVENTS) : 0;
  const { accepted, stats } = validateBatch(overflow ? events.slice(0, MAX_BATCH_EVENTS) : events);
  if (overflow) stats.rejected += overflow;
  await bumpQuality({ accepted: stats.accepted, rejected: stats.rejected, droppedAttributes: stats.droppedAttributes });
  if (accepted.length === 0) return json({ ok: true, accepted: 0 }, 200);

  // R1-clean events only are persisted — daily partition, append.
  const ek = `events/${today}`;
  const cur = JSON.parse((await store.get(ek)) || '[]');
  cur.push(...accepted);
  await store.setJSON(ek, cur);
  console.log(redactLogs(`collect: accepted=${stats.accepted} rejected=${stats.rejected} ip=${ip}`));
  return json({ ok: true, accepted: stats.accepted }, 200);
};

export const config = { path: '/api/collect' };