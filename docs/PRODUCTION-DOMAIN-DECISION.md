# Production domain decision — decision record (OBS-313 D7)

**Owner:** CTO. **Recorded:** 2026-10-31. **Status:** decided (DNS stand-up
pending — see Dependencies).

## Decision

**Option (a): stand up `app.mydaywas.com` as the production-beta app URL of
record.**

| Surface | URL | Hosting | Status |
| --- | --- | --- | --- |
| App (diary) | `https://app.mydaywas.com` | Netlify (already in production use, OBS-125/163) | **DNS record does not resolve yet** — stand-up is a dependency for stage 7 (OBS-264) |
| Relayer API | `https://relayer.mydaywas.com` | Behind the TLS LB of the container deployment (`deploy/README.md`) | DNS record to be created at provisioning |
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

Until the DNS record lands, `https://app.mydaywas.com` will not resolve. The
existing Netlify production deployment (OBS-125/163) remains the interim live
app URL; the landing config carries the **URL of record**, and the DNS
stand-up + Netlify custom-domain attach is tracked as stage-7 work (OBS-264).
Note: **Netlify control-plane access is not currently connected for this
company** — the custom-domain attach is an explicit stage-7 dependency, and
the relayer DNS record creation likewise happens at provisioning time by
whoever holds registrar access.