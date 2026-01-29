// background/consent.js
// Modern MV3 consent management for CheckMyNews

import { lsGet, lsSet } from "./utils/storage.js";

/**
 * Storage keys
 */
const CONSENTS_KEY = (uid) => `${uid}_consents`;
const CONSENT_LAST_CHECK_KEY = (uid) => `${uid}_consent_last_check`;
const CONSENT_PAGE_OPENED_KEY = "consent_page_opened";

const CONSENT_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Initialize consent state (called once)
 */
export async function initConsentSystem(state, URLS_SERVER) {
  const uid = state.CURRENT_USER_ID;
  if (!uid) return;

  const consents = await lsGet(CONSENTS_KEY(uid));
  if (!consents) await lsSet(CONSENTS_KEY(uid), "{}");

  const lastCheck = await lsGet(CONSENT_LAST_CHECK_KEY(uid));
  if (!lastCheck) await lsSet(CONSENT_LAST_CHECK_KEY(uid), 0);

  console.log("[CONSENT] Initialized.");
}

/**
 * Check if user has consent
 */
export async function hasConsent(userId, mode = 0) {
  if (!userId) return false;

  const stored = await lsGet(CONSENTS_KEY(userId));
  if (!stored) return false;

  try {
    const obj = JSON.parse(stored);
    if (mode === 0) return Object.values(obj).some((x) => x === true);
    return obj[mode] === true;
  } catch (e) {
    console.warn("[CONSENT] Could not parse stored consents", e);
    return false;
  }
}

/**
 * Server → Extension: refresh consent status
 */
export async function refreshConsentFromServer(
  state,
  URLS_SERVER,
  force = false
) {
  const uid = state.CURRENT_USER_ID;
  if (!uid) return false;

  const now = Date.now();
  const lastCheck = (await lsGet(CONSENT_LAST_CHECK_KEY(uid))) || 0;

  if (!force && now - lastCheck < CONSENT_CHECK_INTERVAL) return;

  console.log("[CONSENT] Refreshing consent from server…");

  try {
    const resp = await fetch(URLS_SERVER.getConsent, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: uid }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();

    await lsSet(CONSENTS_KEY(uid), JSON.stringify(data.consents || {}));
    await lsSet(CONSENT_LAST_CHECK_KEY(uid), now);

    notifyConsentChange(data.consents || {});
    console.log("[CONSENT] Updated:", data.consents);
    return true;
  } catch (e) {
    console.error("[CONSENT] refreshConsentFromServer failed:", e);
    return false;
  }
}

/**
 * MV3 WRAPPER REQUIRED BY SERVICE WORKER
 * service-worker.js calls this every heartbeat
 */
export async function refreshConsent(state, URLS_SERVER) {
  return await refreshConsentFromServer(state, URLS_SERVER, false);
}

/**
 * MV3 REQUIRED FUNCTION — Popup asks “Do I have consent?”
 */

export async function getConsentStatus(state) {
  const uid = state.CURRENT_USER_ID;

  // NOT logged in
  if (!uid || uid === "0" || uid === 0 || typeof uid !== "string") {
    return {
      ok: true,
      consent: false,
      currentUser: null,
    };
  }

  // Logged in → check consent
  const stored = await lsGet(`${uid}_consents`);
  let parsed = {};

  try {
    parsed = stored ? JSON.parse(stored) : {};
  } catch {
    parsed = {};
  }

  const hasConsent = Object.values(parsed).some((v) => v === true);

  return {
    ok: true,
    consent: hasConsent,
    currentUser: uid,
  };
}

/**
 * Register a new consent event
 */
export async function registerConsent(state, URLS_SERVER, consentPayload) {
  const uid = state.CURRENT_USER_ID;
  if (!uid) return false;

  try {
    const payload = {
      user_id: Number(uid),
      ...consentPayload,
      timestamp: Date.now(),
    };

    const res = await fetch(URLS_SERVER.registerConsent, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const out = await res.json();

    if (out.consents) {
      await lsSet(CONSENTS_KEY(uid), JSON.stringify(out.consents));
      notifyConsentChange(out.consents);
    }

    console.log("[CONSENT] Consent registered:", out);
    return { ok: true, consents: out.consents, currentUser: uid };
  } catch (e) {
    console.error("[CONSENT] registerConsent error:", e);
    return { ok: false };
  }
}

/**
 * Open consent page
 */
export async function openConsentPage() {
  await chrome.storage.local.set({ [CONSENT_PAGE_OPENED_KEY]: true });
  chrome.tabs.create({ url: chrome.runtime.getURL("ui/new_consent.html") });
}

/**
 * Notify UI
 */
async function notifyConsentChange(consents) {
  chrome.runtime.sendMessage({
    type: "consentUpdated",
    consents,
  });
}

/**
 * Heartbeat periodic check
 */
export async function periodicConsentCheck(state, URLS_SERVER) {
  await refreshConsentFromServer(state, URLS_SERVER, false);
}
