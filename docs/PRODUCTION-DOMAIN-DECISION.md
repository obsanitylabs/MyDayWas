# Production domain decision — decision record (OBS-313 D7)

**Owner:** CTO. **Recorded:** 2026-10-31. **Status:** decided + **stood up
2026-10-31 (OBS-442)** — `app.mydaywas.com` is live over TLS; `relayer`
record deferred to TLS-edge provisioning (see Known limitation).

## Decision

**Option (a): stand up `app.mydaywas.com` as the production-beta app URL of
record.**

| Surface | URL | Hosting | Status |
| --- | --- | --- | --- |
| App (diary) | `https://app.mydaywas.com` | Netlify site `mydaywas-app` (e862bd6d) | **Live 2026-10-31 (OBS-442): HTTP 200 over TLS** (Let's Encrypt, apex-SAN cert) |
| Relayer API | `https://relayer.mydaywas.com` | Behind the on-host Caddy TLS edge of the Vultr container deployment (`deploy/README.md`, OBS-794) | **Record at TLS-edge provisioning** (stage 7) — the Vultr instance/edge does not exist yet; no record created |
| Landing | the landing page CTA (`src/config.js` `APP_URL`) | GitHub Pages → points at the app URL of record | **Updated in this change** |

`mydaywas.com` apex already resolves to Netlify (HTTP 200, verified
2026-10-31). `app.mydaywas.com` had **no DNS record** at decision time — the
stand-up (Netlify custom domain + DNS `CNAME`/`ALIAS` from the registrar) is
recorded as a **dependency for stage 7 / OBS-264**, not something this repo
can land from here.

## Why (a) over (b)

A first-party hostname on the already-in-use Netlify production tenancy is
the lower-risk beta URL of record vs. retaining a `netlify.app` subdomain:
it keeps the product URL stable through later infrastructure changes and
matches the recorded OBS-77 carry-over decision.

## Wiring that lands with this document

- **Landing CTA** (`src/config.js`): `APP_URL = 'https://app.mydaywas.com/'` —
  every navbar/footer/hero CTA now points at the single app URL of record.
  The old GitHub Pages staging URL is removed from the UI config.
- **App → relayer**: the diary reads `VITE_RELAYER_URL`
  (`diary/src/ui/App.tsx`) at **build time**; the production build sets
  `VITE_RELAYER_URL=https://relayer.mydaywas.com` in the Netlify build env
  (documented in `relayer/.env.production.example` and `deploy/README.md`).
  Unset = the app honestly reports "no relayer URL configured" (no fake sends).
- **Docs**: every production reference points at
  `https://app.mydaywas.com` / `https://relayer.mydaywas.com`
  (`docs/PRODUCTION-DEPLOYMENT.md`, `docs/PRODUCTION-DEPLOY-MODEL.md`,
  `docs/PRODUCTION-IAM.md`).

## Known limitation (recorded, not hidden)

Until the TLS edge is provisioned, `https://relayer.mydaywas.com` does not resolve.
The **app** record is no longer a limitation: **stood up 2026-10-31 (OBS-442)**
via the Netlify API with the managed `netlify-obsanity-token` secret:

- Netlify site `mydaywas-app` (id `e862bd6d-e683-41f0-a54c-8f1edd9cfc7a`)
  created from the `m4/signals-v1` diary build (`vite build --base=/`,
  `VITE_RELAYER_URL=https://relayer.mydaywas.com`, diary tests 57/57) and
  deployed via the digest method (deploy `6ae61d33…`).
- Custom domain `app.mydaywas.com` attached; zone `mydaywas.com`
  (Netlify DNS, id `6ad5a320…`) gained a `NETLIFY` record
  `app.mydaywas.com -> mydaywas-app.netlify.app` (record id `6ae61d7e…`).
- Verified: `dig app.mydaywas.com` -> Netlify IPs; `https://app.mydaywas.com/`
  **200** + `assets/index-D50vqUCW.js` + CSS **200** over TLS (Let's Encrypt).
- Landing bundle on `m4/signals-v1` (`dist/assets/index-BrIRi0th.js`) points
  its CTA at `https://app.mydaywas.com/` — **target verified 200**, so the
  merge/deploy of that branch no longer ships a dead CTA.

**`relayer.mydaywas.com` stands up at TLS-edge provisioning (stage 7,
OBS-264):** the record cannot point at a Vultr instance that does not exist,
and the production deploy itself remains gated behind OBS-237 written
sign-off and the stage-6 CISO control sign-off. The landing CTA does not
point at the relayer host, so this deferral carries no funnel hazard.
Creation of the record (A/ALIAS to the instance IP, answering the Caddy edge
— OBS-794; no Vultr Load Balancer) is an explicit step of the OBS-264 runbook
(steps 2–3 + step 6 wiring).