// OBS-350 — mdw signals opt-in + follow-up usage funnel (metric dictionary v3 §3/§4,
// OBS-266 F3/F4). OBS-820 — adds the F2 activation rate (metric dictionary v2 §5.1).
// Pure module: no store, no network, no clock; exported for node --test.
//
//   F2 activation rate = distinct anonymous_id with activation_complete ÷ distinct new
//      anonymous_id in the cohort window. The numerator is the same `activated` set F3
//      uses as its denominator (reuse, never recompute). The denominator is the API's
//      New-users figure for the same window (`GET /api/insights` → `newUsers`), passed
//      in by the caller — the module cannot recompute "new" (it never sees prior history).
//   F3 anonymous-signals opt-in rate = distinct anonymous_id with a first-ever
//      signals_optin ÷ distinct anonymous_id with activation_complete (cohort window).
//      Revocations are reported separately (signals_optout count / opted-in base) and
//      are NOT subtracted from F3 (F3 measures ever-opted-in).
//   F4 follow-up usage = followup_answered ÷ followup_prompted, with the skip rate
//      alongside; per-user variant uses distinct anonymous_id with >=1 answered ÷ >=1 prompted.
//
// Dormancy (v3 D13): these are mdw product events; pre-launch there are no mdw events and
// every rate is null (the dashboard renders n/a until the M6 production build is live).
// A dormant funnel must never read as a 0% activation rate — null, not 0.
//
// Window caveat: `first-ever`/`new` is computed within the loaded event window (GET /api/insights
// caps at 90 days); the dashboard reports it as "in window", matching the New-users pattern.
"use strict";

export function mdwFunnel(events, options = {}) {
  const requestedNewUsers = Number(options.newUsers);
  const newUsers = Number.isFinite(requestedNewUsers) ? requestedNewUsers : 0;
  const optedIn = new Set();
  const activated = new Set();
  let revocations = 0;
  let prompted = 0;
  let answered = 0;
  let skipped = 0;
  let mdwEvents = 0;
  const promptedUsers = new Set();
  const answeredUsers = new Set();

  for (const ev of events || []) {
    if (!ev || (ev.product !== "mdw" && ev.product !== "mydaywas")) continue;
    mdwEvents += 1;
    const u = ev.anonymous_id;
    switch (ev.event_name) {
      case "signals_optin":
        if (u) optedIn.add(u);
        break;
      case "signals_optout":
        revocations += 1;
        break;
      case "activation_complete":
        if (u) activated.add(u);
        break;
      case "followup_prompted":
        prompted += 1;
        if (u) promptedUsers.add(u);
        break;
      case "followup_answered":
        answered += 1;
        if (u) answeredUsers.add(u);
        break;
      case "followup_skipped":
        skipped += 1;
        break;
      default:
        break;
    }
  }

  const rate = (num, den) => (den ? +(num / den).toFixed(3) : null);
  // dormant = no mdw activity at all (v3 D13); a dormant funnel's rates are null, never 0.
  const dormant = mdwEvents === 0;
  return {
    window: "in-window (<=90d)",
    f2: {
      activatedUsers: activated.size,
      newUsers,
      // F2 = distinct activation_complete ÷ distinct new anonymous_id; null pre-launch / no denominator.
      activationRate: dormant ? null : rate(activated.size, newUsers),
    },
    f3: {
      optedInUsers: optedIn.size,
      activatedUsers: activated.size,
      // F3 = distinct opt-in ÷ distinct activation_complete; null until activation exists.
      optInRate: rate(optedIn.size, activated.size),
      revocations,
      // revocation monitoring only — not a funnel step, not subtracted from F3.
      revocationRateOfOptedIn: rate(revocations, optedIn.size),
    },
    f4: {
      prompted,
      answered,
      skipped,
      answeredRate: rate(answered, prompted),
      skipRate: rate(skipped, prompted),
      perUserAnsweredOverPrompted: rate(answeredUsers.size, promptedUsers.size),
    },
    // true until the production app is live and any mdw event exists (v3 D13).
    dormant,
    definitions: {
      f2: "distinct anonymous_id with activation_complete / distinct new anonymous_id in the cohort window (API New-users figure)",
      f3: "distinct anonymous_id with first-ever signals_optin / distinct anonymous_id with activation_complete",
      f4: "followup_answered / followup_prompted (skip rate reported alongside)",
    },
  };
}
