// OBS-350 — mdw signals opt-in + follow-up usage funnel (metric dictionary v3 §3/§4,
// OBS-266 F3/F4). Pure module: no store, no network, no clock; exported for node --test.
//
//   F3 anonymous-signals opt-in rate = distinct anonymous_id with a first-ever
//      signals_optin ÷ distinct anonymous_id with activation_complete (cohort window).
//      Revocations are reported separately (signals_optout count / opted-in base) and
//      are NOT subtracted from F3 (F3 measures ever-opted-in).
//   F4 follow-up usage = followup_answered ÷ followup_prompted, with the skip rate
//      alongside; per-user variant uses distinct anonymous_id with >=1 answered ÷ >=1 prompted.
//
// Dormancy (v3 D13): these are mdw product events; pre-launch there are no events and
// every rate is null (the dashboard renders 0 / n-a until the M6 production build is live).
//
// Window caveat: `first-ever` is computed within the loaded event window (GET /api/insights
// caps at 90 days); the dashboard reports it as "in window", matching the New-users pattern.
"use strict";

export function mdwFunnel(events) {
  const optedIn = new Set();
  const activated = new Set();
  let revocations = 0;
  let prompted = 0;
  let answered = 0;
  let skipped = 0;
  const promptedUsers = new Set();
  const answeredUsers = new Set();

  for (const ev of events || []) {
    if (!ev || (ev.product !== "mdw" && ev.product !== "mydaywas")) continue;
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
  return {
    window: "in-window (<=90d)",
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
    // true until the production app is live and events exist (v3 D13).
    dormant: prompted === 0 && optedIn.size === 0,
    definitions: {
      f3: "distinct anonymous_id with first-ever signals_optin / distinct anonymous_id with activation_complete",
      f4: "followup_answered / followup_prompted (skip rate reported alongside)",
    },
  };
}
