// =============================
//  CheckMyNews - MV3 Service Worker
//  CLEAN VERSION (NO dynamic import())
// =============================

// -------------------------------------
// 1. Static imports (Required in MV3)
// -------------------------------------
import * as ads from "./ads.js";
import * as explanations from "./explanations.js";
import * as preferences from "./preferences.js";
import * as news from "./news.js";
import * as consent from "./consent.js";
import * as user from "./userIdentification.js";
import * as iface from "./detectors.js";

import { lsGet, lsSet } from "./utils/storage.js";

// -------------------------------------
// 2. Global state
// -------------------------------------
const state = {
  CURRENT_USER_ID: null,
  LOGGED_IN: false,
  FACEBOOK_UI_VERSION: null,
  FACEBOOK_MOBILE: false,
  initialized: false,
};

// -------------------------------------
// 3. Backend URLs
// -------------------------------------
const HOST_SERVER = "https://adanalystplus.lix.polytechnique.fr/";

const URLS_SERVER = {
  registerAd: HOST_SERVER + "register_ad",
  registerClickedAd: HOST_SERVER + "register_clickedad",
  registerExplanation: HOST_SERVER + "register_explanation",
  registerInterests: HOST_SERVER + "register_interests",
  registerAdvertisers: HOST_SERVER + "register_advertisers",
  registerConsent: HOST_SERVER + "register_consent",
  getConsent: HOST_SERVER + "get_consent",
  registerEmail: HOST_SERVER + "register_email",
  registerLanguage: HOST_SERVER + "register_language",
  updateSurveysNumber: HOST_SERVER + "surveys_number",
  newInterfaceDetected: HOST_SERVER + "new_interface_detected",
};

// -------------------------------------
// 4. Offscreen document
// -------------------------------------
async function ensureOffscreen() {
  if (!chrome.offscreen) {
    console.warn("Offscreen API not supported.");
    return;
  }

  const exists = await chrome.offscreen.hasDocument();
  if (exists) return;

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Parse explanation HTML and images.",
  });

  console.log("[CMN] Offscreen created.");
}

// -------------------------------------
// 5. Alarms
// -------------------------------------
const HEARTBEAT = "cmn_heartbeat";
const EXPLAIN = "cmn_explanations";

function initAlarms() {
  chrome.alarms.create(HEARTBEAT, { periodInMinutes: 5 });
  chrome.alarms.create(EXPLAIN, { periodInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === HEARTBEAT) {
    await consent.refreshConsent(state, URLS_SERVER);
    await preferences.crawlPreferences(state, URLS_SERVER, { force: false });
    return;
  }

  if (alarm.name === EXPLAIN) {
    await explanations.processExplanationsQueue(state, URLS_SERVER);
    return;
  }
});

// -------------------------------------
// 6. Initialization
// -------------------------------------
async function init() {
  if (state.initialized) return;
  state.initialized = true;

  console.log("[CMN] Service worker initializing…");

  await ensureOffscreen();
  await user.initUserIdentification(state, URLS_SERVER);
  await consent.initConsentSystem(state, URLS_SERVER);
  await explanations.initExplanationsSystem(state, URLS_SERVER);
  await preferences.initPreferencesSystem(state, URLS_SERVER);
  await news.initNewsSystem(state, URLS_SERVER);
  await iface.initDetectors(state, URLS_SERVER);

  initAlarms();

  console.log("[CMN] Service worker fully initialized.");
}

init();
globalThis.__CMN_STATE__ = state;

// -------------------------------------
// 7. Message routing (NO dynamic imports)
// -------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[CMN][SW] Message received:", message, "from", sender?.tab?.url);

  (async () => {
    switch (message.type) {
      // ---------------------------
      // ADS
      // ---------------------------
      case "frontAd":
        await ads.handleFrontAd(state, URLS_SERVER, message, sendResponse);
        return;

      case "sideAd":
        await ads.handleSideAd(state, URLS_SERVER, message, sendResponse);
        return;

      case "clickedAds":
        await ads.handleClickedAds(state, URLS_SERVER, message, sendResponse);
        return;

      case "getAdsSummary":
        sendResponse(await ads.getAdsSummary());
        return;

      // ---------------------------
      // CONSENT
      // ---------------------------
      case "getConsentStatus":
        sendResponse(await consent.getConsentStatus(state, URLS_SERVER));
        return;

      case "registerConsent":
        sendResponse(
          await consent.registerConsent(state, URLS_SERVER, message.payload)
        );
        return;

      case "openConsentPage":
        consent.openConsentPage();
        sendResponse({ ok: true });
        return;

      // ---------------------------
      // USER
      // ---------------------------
      case "getCurrentUserId":
        sendResponse({ userId: state.CURRENT_USER_ID });
        return;

      // ---------------------------
      // NEWS
      // ---------------------------
      case "getNewsActivity":
        sendResponse(await news.getNewsActivity());
        return;

      case "getNewsVisits":
        sendResponse(await news.getNewsVisits());
        return;

      // ---------------------------
      // UI DETECTION
      // ---------------------------
      case "ui-detection":
        await iface.handleUiDetectionMessage(message, state, URLS_SERVER);
        sendResponse({ ok: true });
        return;
      case "userIdDetected":
        await user.updateDetectedUserId(state, message.userId);
        sendResponse({ ok: true });
        return;

      case "injectUserDetector": {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        if (!tab?.id) return;

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: () => {
            try {
              if (window.requireLazy) {
                window.requireLazy(["CurrentUserInitialData"], function (data) {
                  if (data?.USER_ID) {
                    window.postMessage(
                      {
                        source: "CMN",
                        type: "USER_ID",
                        userId: String(data.USER_ID),
                      },
                      "*"
                    );
                  }
                });
              }
            } catch (e) {}
          },
        });

        sendResponse({ ok: true });
        return;
      }
      // ---------------------------
      // USER ID DETECTED FROM CONTENT SCRIPT
      // ---------------------------
      case "userIdDetected": {
        const detectedId = message.userId;

        if (!detectedId) {
          sendResponse({ ok: false });
          return;
        }

        // Ignore if unchanged
        if (state.CURRENT_USER_ID === detectedId) {
          console.log("[CMN][USER] User ID unchanged:", detectedId);
          sendResponse({ ok: true, unchanged: true });
          return;
        }

        console.log("[CMN][USER] User ID detected from page:", detectedId);

        state.CURRENT_USER_ID = detectedId;

        // Persist it
        await chrome.storage.local.set({
          CURRENT_USER_ID: detectedId,
        });

        // Re-initialize dependent systems
        await consent.initConsentSystem(state, URLS_SERVER);
        await preferences.initPreferencesSystem(state, URLS_SERVER);
        await explanations.initExplanationsSystem(state, URLS_SERVER);
        await news.initNewsSystem(state, URLS_SERVER);

        sendResponse({ ok: true });
        return;
      }

      // ---------------------------
      // UNKNOWN MESSAGE
      // ---------------------------
      default:
        console.warn("[CMN] Unknown message:", message);
        sendResponse({ ok: false, error: "UNKNOWN_MESSAGE" });
        return;
    }
  })();

  return true;
});

// -------------------------------------
// 8. Installed event
// -------------------------------------
chrome.runtime.onInstalled.addListener((info) => {
  console.log("[CMN] Extension installed:", info.reason);
});
