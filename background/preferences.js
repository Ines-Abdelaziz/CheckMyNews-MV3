// background/preferences.js
// MV3 clean preferences / advertisers crawler for CheckMyNews

import { offscreenRequest } from "./utils/domparser.js";
import { lsGet, lsSet } from "./utils/storage.js";

const PREF_LAST_CRAWL_KEY = "preferences_last_crawl";
const PREF_SNAPSHOT_KEY = "preferences_snapshot";

const DAY_MS = 24 * 60 * 60 * 1000;

// Facebook ad-preferences URLs (can be tuned if FB changes)
const FB_PREF_INTERESTS_URL =
  "https://www.facebook.com/adpreferences/ad_settings";
const FB_PREF_ADVERTISERS_URL =
  "https://www.facebook.com/adpreferences/advertisers";

// ------------------------------------------------------
// Initialize preferences system
// ------------------------------------------------------
export async function initPreferencesSystem(state, URLS_SERVER) {
  const last = await lsGet(PREF_LAST_CRAWL_KEY);
  const snap = await lsGet(PREF_SNAPSHOT_KEY);

  if (last === undefined) {
    await lsSet(PREF_LAST_CRAWL_KEY, 0);
  }
  if (!snap) {
    await lsSet(PREF_SNAPSHOT_KEY, {
      interests: [],
      advertisers_with_contact: [],
      advertisers_targeting_you: [],
      hidden_advertisers: [],
      lastUpdated: 0,
    });
  }

  console.log("[PREFERENCES] System initialized.");
}

// ------------------------------------------------------
// Main entry: crawlPreferences
// Called from heartbeat (and can be called on-demand)
// ------------------------------------------------------
export async function crawlPreferences(
  state,
  URLS_SERVER,
  { force = false } = {}
) {
  const userId = state.CURRENT_USER_ID;
  if (!userId) {
    console.log("[PREFERENCES] No CURRENT_USER_ID, skipping crawl.");
    return;
  }

  const now = Date.now();
  const lastCrawl = (await lsGet(PREF_LAST_CRAWL_KEY)) || 0;

  if (!force && now - lastCrawl < DAY_MS) {
    // Once per day is usually enough
    return;
  }

  console.log("[PREFERENCES] Crawling Facebook ad preferences…");

  try {
    // 1) Fetch HTML for interests and advertisers pages
    const [interestsHtml, advertisersHtml] = await Promise.all([
      fetchHtml(FB_PREF_INTERESTS_URL),
      fetchHtml(FB_PREF_ADVERTISERS_URL),
    ]);

    let interestsParsed = { interests: [] };
    let advertisersParsed = {
      advertisers_with_contact: [],
      advertisers_targeting_you: [],
      hidden_advertisers: [],
    };

    if (interestsHtml) {
      const res = await offscreenRequest("parsePreferencesHtml", {
        html: interestsHtml,
        section: "interests",
      });

      if (res && Array.isArray(res.interests)) {
        interestsParsed = res;
      } else {
        console.warn(
          "[PREFERENCES] Interests parsing unavailable (offscreen unsupported or FB change)"
        );
      }
    }

    if (advertisersHtml) {
      const res = await offscreenRequest("parsePreferencesHtml", {
        html: advertisersHtml,
        section: "advertisers",
      });

      if (res && typeof res === "object") {
        advertisersParsed = {
          advertisers_with_contact: res.advertisers_with_contact || [],
          advertisers_targeting_you: res.advertisers_targeting_you || [],
          hidden_advertisers: res.hidden_advertisers || [],
        };
      } else {
        console.warn(
          "[PREFERENCES] Advertisers parsing unavailable (offscreen unsupported or FB change)"
        );
      }
    }

    const snapshot = {
      interests: dedup(interestsParsed.interests || []),
      advertisers_with_contact: dedup(
        advertisersParsed.advertisers_with_contact || []
      ),
      advertisers_targeting_you: dedup(
        advertisersParsed.advertisers_targeting_you || []
      ),
      hidden_advertisers: dedup(advertisersParsed.hidden_advertisers || []),
      lastUpdated: now,
    };

    // 3) Store locally for popup / dashboard
    await lsSet(PREF_SNAPSHOT_KEY, snapshot);
    await lsSet(PREF_LAST_CRAWL_KEY, now);

    // 4) Send to backend
    await sendPreferencesToServer(userId, snapshot, URLS_SERVER);

    console.log("[PREFERENCES] Crawl completed.");
  } catch (e) {
    console.error("[PREFERENCES] crawlPreferences error:", e);
  }
}

// ------------------------------------------------------
// Expose snapshot to popup
// ------------------------------------------------------
export async function getPreferencesSnapshot() {
  const snap = (await lsGet(PREF_SNAPSHOT_KEY)) || {
    interests: [],
    advertisers_with_contact: [],
    advertisers_targeting_you: [],
    hidden_advertisers: [],
    lastUpdated: 0,
  };
  return snap;
}

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------

async function fetchHtml(url) {
  try {
    const resp = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
    });
    if (!resp.ok) {
      console.warn("[PREFERENCES] Fetch failed:", url, resp.status);
      return null;
    }
    return await resp.text();
  } catch (e) {
    console.warn("[PREFERENCES] fetchHtml error:", url, e);
    return null;
  }
}

async function sendPreferencesToServer(userId, snap, URLS_SERVER) {
  const basePayload = {
    user_id: userId,
    timestamp: Date.now(),
  };

  // Interests
  if (snap.interests.length > 0 && URLS_SERVER.registerInterests) {
    const payloadInterests = {
      ...basePayload,
      interests: snap.interests,
    };
    try {
      await postJSON(URLS_SERVER.registerInterests, payloadInterests);
    } catch (e) {
      console.warn("[PREFERENCES] registerInterests failed:", e);
    }
  }

  // Advertisers
  if (URLS_SERVER.registerAdvertisers) {
    const payloadAdv = {
      ...basePayload,
      advertisers_with_contact: snap.advertisers_with_contact,
      advertisers_targeting_you: snap.advertisers_targeting_you,
      hidden_advertisers: snap.hidden_advertisers,
    };
    try {
      await postJSON(URLS_SERVER.registerAdvertisers, payloadAdv);
    } catch (e) {
      console.warn("[PREFERENCES] registerAdvertisers failed:", e);
    }
  }
}

async function postJSON(url, bodyObj) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function dedup(arr) {
  return [...new Set(arr.filter(Boolean))];
}
