import { describe, expect, it, beforeEach } from "vitest";
import {
  SESSION_IDLE_MS,
  buildMdwEvent,
  captureFirstTouch,
  collectEndpoint,
  emitActivationIfFirst,
  emitEntrySaved,
  emitEntryStarted,
  emitMdw,
  getAnonymousId,
  getSessionId,
  isActivated,
  type MdwEventName,
} from "../src/analytics/events";

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}

const V3: MdwEventName[] = [
  "signals_optin",
  "signals_optout",
  "followup_prompted",
  "followup_answered",
  "followup_skipped",
];

const ALLOWED_KEYS = new Set([
  "product", "event_name", "anonymous_id", "session_id", "wallet_connected",
  "build_version", "timestamp", "utm_source", "referrer", "utm_medium",
  "utm_campaign", "utm_content", "utm_term", "utm_id",
]);

describe("mdw analytics emitter (OBS-350, metric dictionary v3)", () => {
  let s: Storage;
  let uuidN: number;
  const uuid = () => {
    uuidN += 1;
    const n = uuidN.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${n}`;
  };
  beforeEach(() => { s = new MemStorage(); uuidN = 0; });

  it("is DORMANT (no send) when no collector endpoint is configured", () => {
    let called = 0;
    emitMdw("signals_optin", { storage: s, send: () => { called++; } });
    expect(called).toBe(0);
  });

  it("sends a same-origin batch { events: [event] } for each of the five names", () => {
    for (const name of V3) {
      let body = "";
      let endpoint = "";
      emitMdw(name, {
        storage: s, endpoint: "/api/collect", uuid, buildVersion: "mdw-1.0.0",
        send: (e, b) => { endpoint = e; body = b; },
      });
      expect(endpoint).toBe("/api/collect");
      const parsed = JSON.parse(body) as { events: Record<string, unknown>[] };
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0].event_name).toBe(name);
      expect(parsed.events[0].product).toBe("mdw");
    }
  });

  it("carries only the §2.1 common attributes — no per-event attributes", () => {
    for (const name of V3) {
      const ev = buildMdwEvent(name, { storage: s, uuid, buildVersion: "mdw-1.0.0" });
      for (const k of Object.keys(ev)) expect(ALLOWED_KEYS.has(k)).toBe(true);
      expect(ev.wallet_connected).toBe(false);
    }
  });

  it("never emits PII, entry ids, prompt ids, or user-generated content", () => {
    let body = "";
    emitMdw("followup_answered", {
      storage: s, endpoint: "/api/collect", uuid,
      send: (_e, b) => { body = b; },
    });
    const ev = (JSON.parse(body) as { events: Record<string, unknown>[] }).events[0];
    const forbidden = ["answer", "answer_text", "text", "entry_id", "prompt_id", "email", "wallet_address", "ip"];
    for (const k of Object.keys(ev)) expect(forbidden.includes(k)).toBe(false);
    expect(JSON.stringify(ev)).not.toMatch(/0x[0-9a-f]{40}/i);
  });

  it("anonymous_id is device-persisted and stable across calls", () => {
    const a = getAnonymousId(s, uuid);
    const b = getAnonymousId(s, uuid);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("session_id rotates only after 30 minutes of inactivity", () => {
    const t0 = 1_000_000_000_000;
    const first = getSessionId(s, t0, uuid);
    const same = getSessionId(s, t0 + SESSION_IDLE_MS - 1, uuid);
    expect(same).toBe(first);
    // The previous call refreshed activity, so idle is measured from t0+idle-1.
    const rotated = getSessionId(s, t0 + SESSION_IDLE_MS - 1 + SESSION_IDLE_MS + 1, uuid);
    expect(rotated).not.toBe(first);
  });

  it("captures UTM at first landing and preserves it thereafter (D4)", () => {
    const ft = captureFirstTouch(s, "?utm_source=x&utm_medium=organic_social", "https://example.com/a?b=1");
    expect(ft.utm_source).toBe("x");
    expect(ft.utm_medium).toBe("organic_social");
    expect(ft.referrer).toBe("example.com");
    // A later visit with different params must NOT overwrite first touch.
    const again = captureFirstTouch(s, "?utm_source=telegram", undefined);
    expect(again.utm_source).toBe("x");
  });

  it("drops malformed UTM values and defaults to direct", () => {
    const ft = captureFirstTouch(s, "?utm_source=Bad Value!!&utm_campaign=ok-1", undefined);
    expect(ft.utm_source).toBe("direct");
    expect(ft.utm_campaign).toBe("ok-1");
  });

  it("collectEndpoint() is undefined without build config (pre-launch dormancy)", () => {
    // VITE_COLLECT_URL is unset in the test build.
    expect(collectEndpoint()).toBeUndefined();
  });
});

describe("mdw activation emitter (OBS-783, F2/F3)", () => {
  let s: Storage;
  let uuidN: number;
  const uuid = () => {
    uuidN += 1;
    const n = uuidN.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${n}`;
  };
  beforeEach(() => { s = new MemStorage(); uuidN = 0; });

  type Batch = { events: Record<string, unknown>[] };
  function capture() {
    const sent: { endpoint: string; batch: Batch }[] = [];
    const send = (endpoint: string, body: string) => sent.push({ endpoint, batch: JSON.parse(body) as Batch });
    return { sent, send };
  }

  it("entry_started is DORMANT without an endpoint (no send, no state change)", () => {
    let called = 0;
    emitEntryStarted({ storage: s, send: () => { called++; } });
    expect(called).toBe(0);
  });

  it("entry_started emits a no-attribute event (only §2.1 common attrs)", () => {
    const { sent, send } = capture();
    emitEntryStarted({ storage: s, endpoint: "/api/collect", uuid, buildVersion: "mdw-1.0.0", send });
    expect(sent).toHaveLength(1);
    const ev = sent[0].batch.events[0];
    expect(ev.event_name).toBe("entry_started");
    expect(ev.product).toBe("mdw");
    for (const k of Object.keys(ev)) expect(ALLOWED_KEYS.has(k)).toBe(true);
  });

  it("entry_saved emits entry_saved, and the first save also emits activation_complete", () => {
    const { sent, send } = capture();
    const deps = { storage: s, endpoint: "/api/collect", uuid, buildVersion: "mdw-1.0.0", send };
    emitEntrySaved(deps);
    expect(sent).toHaveLength(2);
    expect(sent[0].batch.events[0].event_name).toBe("entry_saved");
    const act = sent[1].batch.events[0];
    expect(act.event_name).toBe("activation_complete");
    expect(act.product).toBe("mdw");
    // Exactly the three collector-allowed attributes, with the right types.
    expect(typeof act.first_session).toBe("boolean");
    expect(typeof act.time_to_activation_s).toBe("number");
    expect(act.activation_path).toBe("entry_saved");
    // The three attrs are the ONLY non-common keys.
    const attrKeys = Object.keys(act).filter((k) => !ALLOWED_KEYS.has(k)).sort();
    expect(attrKeys).toEqual(["activation_path", "first_session", "time_to_activation_s"]);
  });

  it("activation_complete fires AT MOST ONCE (second save emits entry_saved only)", () => {
    const { sent, send } = capture();
    const deps = { storage: s, endpoint: "/api/collect", uuid, buildVersion: "mdw-1.0.0", send };
    emitEntrySaved(deps);
    emitEntrySaved(deps);
    const names = sent.map((x) => x.batch.events[0].event_name);
    expect(names).toEqual(["entry_saved", "activation_complete", "entry_saved"]);
    expect(isActivated(s)).toBe(true);
  });

  it("dormant save neither sends nor marks activation (still fires once wired)", () => {
    emitEntrySaved({ storage: s, send: () => { throw new Error("must not send"); } });
    expect(isActivated(s)).toBe(false);
    const { sent, send } = capture();
    expect(emitActivationIfFirst({ storage: s, endpoint: "/api/collect", uuid, send })).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("carries no PII/entry-id/prompt-id/answer-text in the activation attrs", () => {
    const { sent, send } = capture();
    emitEntrySaved({ storage: s, endpoint: "/api/collect", uuid, send });
    const act = sent[1].batch.events[0];
    const forbidden = ["entry_id", "prompt_id", "answer", "answer_text", "text", "email", "wallet_address", "ip"];
    for (const k of Object.keys(act)) expect(forbidden.includes(k)).toBe(false);
    expect(JSON.stringify(act)).not.toMatch(/0x[0-9a-f]{40}/i);
  });

  it("time_to_activation_s is a non-negative finite number anchored at session start", () => {
    const t0 = 5_000_000_000_000;
    const { sent, send } = capture();
    // First event opens the session at t0; activation 42s later.
    getSessionId(s, t0, uuid);
    emitEntrySaved({ storage: s, endpoint: "/api/collect", uuid, now: () => t0 + 42_000, send });
    const act = sent[1].batch.events[0];
    expect(act.time_to_activation_s).toBe(42);
    expect(act.first_session).toBe(true);
  });
});
