// OBS-303 — pff campaign funnel C1–C3 (metric dictionary v2 events only; OBS-123/v2 definitions
// of record, pre-registered on the OBS-297 measurement-plan document).
//   C1 first box configured  : funnel_step  { funnel_name: 'pff_purchase', step_name: 'box_configured' } — first occurrence per anonymous_id
//   C2 first box opened       : activation_complete (dictionary activation event, §4.1/§4.3) — first occurrence per anonymous_id
//   C3 repeat open            : anonymous_id with >= 2 core_action { action_type: 'box_opened' }
// C0 (waitlist_verified) is NOT computed here — it is served by GET /api/waitlist/stats (OBS-203)
// and joined in the dashboard; no side tallies, everything counts distinct anonymous_id.
// Pure module: no store, no network, no clock. Exported for node --test coverage.
"use strict";

export function campaignFunnel(events) {
  const c1 = new Set();
  const c2 = new Set();
  const openCounts = new Map();

  for (const ev of events || []) {
    if (!ev || ev.product !== "pff") continue;
    const u = ev.anonymous_id;
    if (!u) continue;
    const name = ev.event_name;

    if (
      name === "funnel_step" &&
      ev.funnel_name === "pff_purchase" &&
      ev.step_name === "box_configured"
    ) {
      c1.add(u);
    } else if (name === "activation_complete") {
      c2.add(u);
    }

    if (name === "core_action" && ev.action_type === "box_opened") {
      openCounts.set(u, (openCounts.get(u) || 0) + 1);
    }
  }

  let openers = 0;
  let repeat = 0;
  for (const n of openCounts.values()) {
    openers += 1;
    if (n >= 2) repeat += 1;
  }

  const rate = (num, den) => (den ? +(num / den).toFixed(3) : 0);
  return {
    // distinct anonymous_id counts per step
    c_configured: c1.size,
    c_firstOpen: c2.size,
    c_repeatOpen: repeat,
    openers,
    // pre-registered rates (OBS-297 §2): box-open = C2/C1, repeat-open = repeat/openers
    boxOpenRate: rate(c2.size, c1.size),
    boxOpenRateNote:
      "activation_complete and funnel_step box_configured are independent events; the raw ratio is not capped at 1.0 and may exceed 100% if the app does not emit activation_complete exactly at first box open",
    repeatOpenRate: rate(repeat, openers),
    stepNames: {
      c_configured: "box_configured",
      c_firstOpen: "activation_complete",
      c_repeatOpen: "core_action box_opened (>=2)",
    },
  };
}
