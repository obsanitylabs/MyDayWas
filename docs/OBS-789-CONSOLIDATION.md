# OBS-789 — Netlify consolidation: one project for MyDayWas

Status: consolidation branch `obs-789-consolidate` (merge of `main` backend +
`obs-783-emitter-transport` app work). Target: single Netlify site `mydaywas.com`
(site id `c48b61ad-3016-4e9d-a550-899b1dd605f3`) serving:

- `/` — landing page (unchanged)
- `/app/` — encrypted diary app (built from `diary/`, Vite `base: /app/`)
- `/api/collect`, `/api/insights`, `/api/waitlist/*`, `/admin/`, `/insights/` —
  existing backend functions and static pages restored from `main`

## What happened to app.mydaywas.com (site `mydaywas-app`, e862bd6d)

> **Follow-up (2026-11-05, OBS-824):** with the site and DNS deleted, the
> `https://app.mydaywas.com` defaults in `relayer/fly.toml`,
> `relayer/.env.production.example`, and the relayer CORS tests were stale and
> now read **`https://mydaywas.com`** (the apex origin the diary app ships
> from). This section records the deletion as history.

The app site built from a separate repo (`hgit.services-prod.nsvcs.net/obsanitylabs/mydaywas-app.git`,
not the company GitHub). Salvage review of its latest deploy (6aebfa90d83abf629b566e92):

- Frontend: hash-routed landing/login/app shell with warm copy ("Come in. The light's on."),
  shelf section, housekeeping section. UI copy/theme concepts noted for the writing-space
  redesign; the single-file vanilla JS app itself is superseded by `diary/`.
- Backend: Netlify Identity (email/Google) + four stub functions (`auth-providers` returns a
  provider catalog; `oauth/start` returns 501 until client IDs are configured — i.e. never
  worked), `vault-key` (server-stored data-encryption key escrow per Identity user, backed by
  Netlify DB/Neon), `diary-sync` (ciphertext envelope store).
- **Merge verdict: not adopted.** The server-side key escrow is a security regression versus
  `diary/`'s client-held HKDF-derived, non-extractable AES-GCM keys (server never sees key
  material). The stub OAuth never functioned. Social login will be delivered via a proper
  OAuth + embedded-wallet provider (decision below) instead of Netlify Identity.

## Social login + wallet abstraction decision (CTO, OBS-789)

Requirement: many international OAuth providers (Google, X, LINE, Kakao, Baidu, VK, WeChat
where possible) + web3 wallet backend, abstracted until the user exports their own seed
phrase from settings.

- **Provider: Privy** (`@privy-io/react-auth`). Rationale: embedded wallets with
  user-exportable seed phrases, built-in social/email wallets, custom OAuth support for
  non-standard providers (Baidu, VK, LINE, Kakao) via configured OIDC, mature React SDK.
  Dynamic was the runner-up; revisit only if Privy integration fails a hard requirement.
- Integration is config-driven (`VITE_PRIVY_APP_ID`); app code must not hard-code keys.
- **Blocker:** a Privy account/app ID must be created by a human owner (business signup).
  Until then the diary keeps the existing injected-wallet auth.

## Retirement steps for the app site (after /app/ is verified on the apex)

1. Verify branch deploy `obs-789-consolidate` (landing + /app/ + functions all 200).
2. Merge `obs-789-consolidate` to `main` (production deploy of the unified site).
3. Set apex site env for the diary build if needed (`VITE_RELAYER_URL`, `VITE_COLLECT_URL`
   pointing at `https://mydaywas.com/api/collect`); add `https://mydaywas.com` to the
   relayer's `RELAYER_ALLOWED_ORIGINS` on Fly when the relayer is provisioned.
4. Delete Netlify site `mydaywas-app` (e862bd6d) and remove the `app` DNS record.
5. Remove `obs-789-consolidate` from `allowed_branches` on the apex site.
