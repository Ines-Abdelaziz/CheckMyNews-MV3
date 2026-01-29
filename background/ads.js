// background/ads.js
// Clean MV3 ads module — handles front ads, side ads, clicked ads
// Uses offscreen for image conversion and communicates with service worker

import { offscreenRequest } from "./utils/domparser.js";
import { lsGet, lsSet } from "./utils/storage.js";

// Placeholder: You can import real replaceUserIdEmail if you already migrated it
async function replaceUserIdEmail(obj) {
  return obj; // no-op for now
}

// Utility: safe JSON POST
async function postJSON(url, bodyObj) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// -----------------------------------------------------------
// IMAGE → BASE64 via OFFSCREEN
// -----------------------------------------------------------
async function convertImagesToBase64(urls) {
  if (!urls || urls.length === 0) return {};
  try {
    const { map } = await offscreenRequest("imagesToDataURLs", { urls });
    return map || {};
  } catch (e) {
    console.warn("[ads] convertImagesToBase64 failed:", e);
    return {};
  }
}

// -----------------------------------------------------------
// MAIN ENTRY: handleFrontAd()
// Called from service-worker on message.type === "frontAd"
// -----------------------------------------------------------
export async function handleFrontAd(state, URLS_SERVER, message, sendResponse) {
  try {
    const CURRENT_USER_ID = state.CURRENT_USER_ID;
    const images = message.fullImageURLs || message.imageURLs || [];

    // 1) Convert images using offscreen
    const mediaContent = await convertImagesToBase64(images);

    // 2) Build final payload for backend
    const payload = {
      user_id: CURRENT_USER_ID,
      fb_id: message.fb_id,
      pageName: message.pageName || "",
      text: message.text || "",
      links: message.links || [],
      clientToken: message.clientToken || null,
      graphQLAsyncParams: message.graphQLAsyncParams || null,
      newInterface: message.newInterface === true,
      adType: message.adType || "feed",
      objId: message.objId || null,
      serialized_frtp_identifiers: message.serialized_frtp_identifiers || null,
      story_debug_info: message.story_debug_info || null,
      MEDIA_CONTENT: mediaContent, // base64 images
      timestamp: Date.now(),
    };

    const requestForServer = await replaceUserIdEmail(payload);

    // 3) Send to server
    const resp = await postJSON(URLS_SERVER.registerAd, requestForServer);

    // 4) Reply to content script
    sendResponse?.({
      saved: resp.status !== "FAILURE",
      dbId: resp.ad_id || null,
    });
  } catch (e) {
    console.error("[ads] handleFrontAd error:", e);
    sendResponse?.({ saved: false, error: e.toString() });
  }
}

// -----------------------------------------------------------
// handleSideAd (rarely used now, but keeping logic identical)
// -----------------------------------------------------------
export async function handleSideAd(state, URLS_SERVER, message, sendResponse) {
  try {
    const CURRENT_USER_ID = state.CURRENT_USER_ID;
    const images = message.fullImageURLs || message.imageURLs || [];

    const mediaContent = await convertImagesToBase64(images);

    const payload = {
      user_id: CURRENT_USER_ID,
      fb_id: message.fb_id,
      pageName: message.pageName || "",
      text: message.text || "",
      links: message.links || [],
      MEDIA_CONTENT: mediaContent,
      timestamp: Date.now(),
      adType: "sidebar",
    };

    const requestForServer = await replaceUserIdEmail(payload);
    const resp = await postJSON(URLS_SERVER.registerAd, requestForServer);

    sendResponse?.({
      saved: resp.status !== "FAILURE",
      dbId: resp.ad_id || null,
    });
  } catch (e) {
    console.error("[ads] handleSideAd error:", e);
    sendResponse?.({ saved: false, error: e.toString() });
  }
}

// -----------------------------------------------------------
// handleClickedAds()
// When content script sends a batch of clicked ad events
// -----------------------------------------------------------
export async function handleClickedAds(
  state,
  URLS_SERVER,
  message,
  sendResponse
) {
  try {
    const CURRENT_USER_ID = state.CURRENT_USER_ID;
    const clickedData = message.adClickedData || {};

    const keys = Object.keys(clickedData);
    if (keys.length === 0) {
      sendResponse?.({ ok: true, count: 0 });
      return;
    }

    for (const k of keys) {
      const req = clickedData[k];

      // Collect all relevant image URLs
      const imgList = [
        ...(req.contents?.fullImageURLs || []),
        ...(req.contents?.imageURLs || []),
      ];

      if (req.contents?.facebookPageProfilePicURL) {
        imgList.push(req.contents.facebookPageProfilePicURL);
      }

      // Convert via offscreen
      const mediaContent = await convertImagesToBase64(imgList);

      const payload = {
        ...req,
        MEDIA_CONTENT: mediaContent,
        user_id: CURRENT_USER_ID,
        timestamp: Date.now(),
      };

      const requestForServer = await replaceUserIdEmail(payload);

      try {
        await postJSON(URLS_SERVER.registerClickedAd, requestForServer);
      } catch (e) {
        console.warn("[ads] Failed to send clicked ad:", e);
      }
    }

    sendResponse?.({ ok: true, count: keys.length });
  } catch (e) {
    console.error("[ads] handleClickedAds error:", e);
    sendResponse?.({ ok: false, error: e.toString() });
  }
}
// Key where ads are stored
const ADS_STORAGE_KEY = "ads_list";

/**
 * Get summary of collected ads for popup UI.
 * Returns:
 * {
 *   count: number,
 *   lastAds: [ ... up to last 5 ads ... ]
 * }
 */
export async function getAdsSummary() {
  let ads = await lsGet(ADS_STORAGE_KEY);
  if (!ads) ads = [];

  // Sort newest → oldest
  ads = ads.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // Take last 5 ads for preview
  const lastAds = ads.slice(0, 5).map((ad) => ({
    fb_id: ad.fb_id,
    adId: ad.adId || ad.dbId || null,
    type: ad.type,
    timestamp: ad.timestamp,
  }));

  return {
    count: ads.length,
    lastAds,
  };
}

async function storeAdLocally(adObj) {
  let ads = await lsGet(ADS_STORAGE_KEY);
  if (!ads) ads = [];

  // Add timestamp if not present
  if (!adObj.timestamp) {
    adObj.timestamp = Date.now();
  }

  ads.unshift(adObj); // newest first

  // Optional: limit local storage to last 500 ads
  if (ads.length > 500) ads = ads.slice(0, 500);

  await lsSet(ADS_STORAGE_KEY, ads);
}
