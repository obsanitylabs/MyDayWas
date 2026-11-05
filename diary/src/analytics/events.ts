/**
 * First-party mdw analytics emitter (metric dictionary v3, OBS-350 + OBS-783).
 *
 * Emits ONLY the metric-dictionary §2.1 common attribute set plus the closed
 * mdw event list. Five of the events (signals_optin/optout, followup_*) carry
 * NO per-event attributes. The F2 activation pair (`entry_started` →
 * `entry_saved` / `activation_complete`) carries ONLY the three attributes the
 * collector's `MDW_EVENTS` table already allows on `activation_complete`
 * (`first_session`, `time_to_activation_s`, `activation_path`). The payload
 * NEVER contains PII, wallet addresses, account ids, referral-code values,
 * entry ids, prompt ids, or user-generated content (§2.2 allowlist).
 *
 * Dormancy (D7/D13, binding): these are mdw product events and must not be
 * instrumented on staging or pre-launch. The emitter is therefore a NO-OP
 * unless a collector endpoint is explicitly configured at build time
 * (`VITE_COLLECT_URL`); nothing fires until the M6 production build wires it.
 * Consent, privacy, and the privacy allowlist are unchanged by this module.
 *
 * Transport: same-origin/cross-origin `POST {endpoint}` with
 * `{ events: [event] }`, matching the OBS-125 collector
 * (`netlify/functions/collect.mjs`). Failures are swallowed — analytics must
 * never break the diary.
 */

const ANON_KEY = "mydaywas.analytics.anonymous_id.v1";
const SESSION_KEY = "mydaywas.analytics.session_id.v1";
const SESSION_ACTIVITY_KEY = "mydaywas.analytics.session_last_activity.v1";
const SESSION_START_KEY = "mydaywas.analytics.session_started_at.v1";
const SESSION_COUNT_KEY = "mydaywas.analytics.session_count.v1";
const UTM_KEY = "mydaywas.analytics.utm.v1";
const ACTIVATED_KEY = "mydaywas.analytics.activated.v1";

/** session_id is regenerated after 30 minutes of inactivity (§2.1). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

/**
 * `activation_path` is a closed list — the collector only accepts the
 * `action_type_mdw` enum values (`netlify/shared/enforce.mjs`). MDW activation
 * is by definition a saved entry, so the emitted path is always `entry_saved`.
 */
export type ActivationPath = "entry_saved" | "entry_edited" | "past_entry_viewed" | "unclassified";

export type MdwEventName =
  | "signals_optin"
  | "signals_optout"
  | "followup_prompted"
  | "followup_answered"
  | "followup_skipped"
  | "entry_started"
  | "entry_saved"
  | "activation_complete";

/** The three `activation_complete` attributes the collector allows (OBS-783). */
export interface ActivationAttrs {
  first_session: boolean;
  time_to_activation_s: number;
  activation_path: ActivationPath;
}

export interface MdwEvent {
  product: "mdw";
  event_name: MdwEventName;
  anonymous_id: string;
  session_id: string;
  wallet_connected: false;
  build_version: string;
  timestamp: string;
  utm_source: string;
  referrer?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  utm_id?: string;
}

export interface AnalyticsDeps {
  storage: Storage;
  /** Collector endpoint. Falsy => dormant no-op (staging/pre-launch). */
  endpoint?: string;
  now?: () => number;
  uuid?: () => string;
  search?: string;
  referrer?: string;
  buildVersion?: string;
  /** Injectable sender; defaults to `navigator.sendBeacon`/`fetch` keepalive. */
  send?: (endpoint: string, body: string) => void;
}

function defaultUuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // RFC-4122 v4 fallback (never derived from any user/diary data).
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}

/**
 * Lowercase, ≤60 chars, no PII (OBS-132 §8.3). `utm_medium` values are a closed
 * enum that includes underscores (`organic_social`), so allow them for medium
 * only; everything else is `a-z0-9-`. Invalid values are dropped.
 */
function sanitizeUtm(v: string | null, allowUnderscore = false): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  const re = allowUnderscore ? /^[a-z0-9_-]{1,60}$/ : /^[a-z0-9-]{1,60}$/;
  return re.test(s) ? s : undefined;
}

function hostOnly(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u).host.slice(0, 255) || undefined;
  } catch {
    return undefined;
  }
}

/** First-party device id; persisted client-side; never a wallet/account id. */
export function getAnonymousId(storage: Storage, uuid: () => string = defaultUuid): string {
  const existing = storage.getItem(ANON_KEY);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const next = uuid();
  storage.setItem(ANON_KEY, next);
  return next;
}

/** New session id, regenerated after {@link SESSION_IDLE_MS} of inactivity. */
export function getSessionId(storage: Storage, nowMs: number, uuid: () => string = defaultUuid): string {
  const id = storage.getItem(SESSION_KEY);
  const last = Number(storage.getItem(SESSION_ACTIVITY_KEY) ?? "0");
  const fresh = !id || !/^[0-9a-f-]{36}$/i.test(id) || !Number.isFinite(last) || nowMs - last > SESSION_IDLE_MS;
  const next = fresh ? uuid() : id;
  storage.setItem(SESSION_KEY, next);
  storage.setItem(SESSION_ACTIVITY_KEY, String(nowMs));
  if (fresh) {
    // OBS-783: session bookkeeping for the activation attributes. The start
    // timestamp anchors `time_to_activation_s`; the monotonic count tells
    // `first_session` apart (count <= 1 => this is the user's first session).
    storage.setItem(SESSION_START_KEY, String(nowMs));
    const seen = Number(storage.getItem(SESSION_COUNT_KEY) ?? "0");
    storage.setItem(SESSION_COUNT_KEY, String((Number.isFinite(seen) ? seen : 0) + 1));
  }
  return next;
}

/** True once the (at-most-once) activation event has been emitted on this device. */
export function isActivated(storage: Storage): boolean {
  return storage.getItem(ACTIVATED_KEY) === "1";
}

interface FirstTouch {
  utm_source: string;
  referrer?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  utm_id?: string;
}

/** D4 first-landing capture: persisted on first visit and preserved thereafter. */
export function captureFirstTouch(storage: Storage, search: string, referrer: string | undefined): FirstTouch {
  const cached = storage.getItem(UTM_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as FirstTouch;
    } catch {
      /* fall through and re-capture */
    }
  }
  const p = new URLSearchParams(search.startsWith("?") || search === "" ? search : `?${search}`);
  const ft: FirstTouch = {
    utm_source: sanitizeUtm(p.get("utm_source")) ?? "direct",
    referrer: hostOnly(referrer),
    utm_medium: sanitizeUtm(p.get("utm_medium"), true),
    utm_campaign: sanitizeUtm(p.get("utm_campaign")),
    utm_content: sanitizeUtm(p.get("utm_content")),
    utm_term: sanitizeUtm(p.get("utm_term")),
    utm_id: sanitizeUtm(p.get("utm_id")),
  };
  storage.setItem(UTM_KEY, JSON.stringify(ft));
  return ft;
}

/** Build the §2.1-conformant event for one of the five closed-list names. */
export function buildMdwEvent(name: MdwEventName, deps: AnalyticsDeps): MdwEvent {
  const now = deps.now ?? (() => Date.now());
  const uuid = deps.uuid ?? defaultUuid;
  const nowMs = now();
  const ft = captureFirstTouch(deps.storage, deps.search ?? "", deps.referrer);
  const ev: MdwEvent = {
    product: "mdw",
    event_name: name,
    anonymous_id: getAnonymousId(deps.storage, uuid),
    session_id: getSessionId(deps.storage, nowMs, uuid),
    wallet_connected: false,
    build_version: deps.buildVersion ?? (import.meta.env.VITE_BUILD_VERSION as string | undefined) ?? "mdw-dev",
    timestamp: new Date(nowMs).toISOString(),
    utm_source: ft.utm_source,
  };
  if (ft.referrer) ev.referrer = ft.referrer;
  if (ft.utm_medium) ev.utm_medium = ft.utm_medium;
  if (ft.utm_campaign) ev.utm_campaign = ft.utm_campaign;
  if (ft.utm_content) ev.utm_content = ft.utm_content;
  if (ft.utm_term) ev.utm_term = ft.utm_term;
  if (ft.utm_id) ev.utm_id = ft.utm_id;
  return ev;
}

function defaultSend(endpoint: string, body: string): void {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav && typeof nav.sendBeacon === "function") {
    nav.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
    return;
  }
  if (typeof fetch === "function") {
    void fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  }
}

/**
 * Fire one mdw event. NO-OP when no endpoint is configured (dormant). Never
 * throws — a failed analytics send must not affect the diary.
 */
export function emitMdw(name: MdwEventName, deps: AnalyticsDeps): void {
  if (!deps.endpoint) return;
  try {
    const event = buildMdwEvent(name, deps);
    (deps.send ?? defaultSend)(deps.endpoint, JSON.stringify({ events: [event] }));
  } catch {
    /* analytics is best-effort only */
  }
}

/** The build-time collector endpoint. Undefined on staging/pre-launch (dormant). */
export function collectEndpoint(): string | undefined {
  const v = import.meta.env.VITE_COLLECT_URL as string | undefined;
  return v && v.length ? v : undefined;
}

/**
 * OBS-783 F2 — `entry_started`. Fired when the user begins composing a new
 * entry (first non-empty keystroke). Once per compose cycle; the UI resets it
 * on save. No per-event attributes (§2.2).
 */
export function emitEntryStarted(deps: AnalyticsDeps): void {
  emitMdw("entry_started", deps);
}

/**
 * OBS-783 F2 — `entry_saved`, and the activation endpoint. Fired on every
 * successful save of a composed entry; the FIRST such save on the device also
 * emits `activation_complete` (the F3 denominator). `emitActivationIfFirst`
 * enforces at-most-once.
 */
export function emitEntrySaved(deps: AnalyticsDeps): void {
  emitMdw("entry_saved", deps);
  emitActivationIfFirst(deps);
}

/**
 * Build the `activation_complete` event. It carries ONLY the three attributes
 * the collector's `MDW_EVENTS` table allows (`first_session`,
 * `time_to_activation_s`, `activation_path`) — no entry id, no text, no PII.
 */
export function buildActivationEvent(
  deps: AnalyticsDeps,
  path: ActivationPath = "entry_saved",
): MdwEvent & ActivationAttrs {
  const now = deps.now ?? (() => Date.now());
  const uuid = deps.uuid ?? defaultUuid;
  const nowMs = now();
  const storage = deps.storage;
  // Ensure the current session is materialized so SESSION_START_KEY is set.
  getSessionId(storage, nowMs, uuid);
  const start = Number(storage.getItem(SESSION_START_KEY) ?? "0");
  const startMs = Number.isFinite(start) && start > 0 ? start : nowMs;
  const seen = Number(storage.getItem(SESSION_COUNT_KEY) ?? "1");
  const attrs: ActivationAttrs = {
    first_session: (Number.isFinite(seen) ? seen : 1) <= 1,
    time_to_activation_s: Math.max(0, Math.round((nowMs - startMs) / 1000)),
    activation_path: path,
  };
  return { ...buildMdwEvent("activation_complete", deps), ...attrs };
}

/**
 * Emit `activation_complete` on the first successful `entry_saved`, at most
 * once per device. NO-OP when dormant (no endpoint). Returns whether it fired.
 */
export function emitActivationIfFirst(deps: AnalyticsDeps): boolean {
  if (!deps.endpoint) return false;
  try {
    if (isActivated(deps.storage)) return false;
    const event = buildActivationEvent(deps, "entry_saved");
    deps.storage.setItem(ACTIVATED_KEY, "1");
    (deps.send ?? defaultSend)(deps.endpoint, JSON.stringify({ events: [event] }));
    return true;
  } catch {
    return false;
  }
}
