// background/explanations.js
// MV3 clean explanation crawling pipeline for CheckMyNews

import { offscreenRequest } from "./utils/domparser.js";
import { lsGet, lsSet } from "./utils/storage.js";

// Keys for storage
const QUEUE_KEY = "explanations_queue";
const CRAWLED_KEY = "explanations_crawled";

// Limit how many explanations we process per heartbeat cycle
const BATCH_SIZE = 3;

// ------------------------------------------------------
// Initialize explanations system
// ------------------------------------------------------
export async function initExplanationsSystem(state, URLS_SERVER) {
  const q = await lsGet(QUEUE_KEY);
  const c = await lsGet(CRAWLED_KEY);

  if (!q) await lsSet(QUEUE_KEY, []);
  if (!c) await lsSet(CRAWLED_KEY, []);

  console.log("[EXPLANATIONS] System initialized.");
}

// ------------------------------------------------------
// Queue a new explanation
// Called from ads.js when registerAd succeeds
// ------------------------------------------------------
export async function queueExplanation(explanationUrl, adId, meta = {}) {
  if (!explanationUrl || !adId) return;

  const queue = (await lsGet(QUEUE_KEY)) || [];

  // Prevent duplicates
  const exists = queue.some(
    (item) => item.adId === adId || item.url === explanationUrl
  );
  if (exists) return;

  queue.push({
    url: explanationUrl,
    adId,
    meta,
    timestamp: Date.now(),
  });

  await lsSet(QUEUE_KEY, queue);
  console.log("[EXPLANATIONS] Queued:", explanationUrl);
}

// ------------------------------------------------------
// Process a single explanation
// Fetch → Offscreen parse → Register with server
// ------------------------------------------------------
async function processOneExplanation(state, URLS_SERVER, item) {
  const { url, adId, meta } = item;

  try {
    // 1) Fetch HTML
    const resp = await fetch(url, {
      method: "GET",
      credentials: "include",
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const html = await resp.text();

    // 2) Parse HTML using offscreen
    const parsed = await offscreenRequest("parseExplanationHtml", { html });

    // Offscreen returns:
    // - parsed.text
    // - parsed.reasons
    // - parsed.advertisers
    // - parsed.links
    // (depending on how we’ll implement parseExplanationHtml in offscreen.js)

    const payload = {
      user_id: state.CURRENT_USER_ID,
      ad_id: adId,
      explanation_url: url,
      explanation_text: parsed?.text || "",
      explanation_reasons: parsed?.reasons || [],
      advertisers: parsed?.advertisers || [],
      links: parsed?.links || [],
      meta,
      timestamp: Date.now(),
    };

    // 3) Send to backend
    const res = await fetch(URLS_SERVER.registerExplanation, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    return true;
  } catch (e) {
    console.error("[EXPLANATIONS] Error processing explanation:", url, e);
    return false;
  }
}

// ------------------------------------------------------
// Main pipeline: process explanation queue
// Triggered from service-worker heartbeat every 5 minutes
// ------------------------------------------------------
export async function processExplanationsQueue(state, URLS_SERVER) {
  let queue = (await lsGet(QUEUE_KEY)) || [];
  let crawled = (await lsGet(CRAWLED_KEY)) || [];

  if (queue.length === 0) {
    // nothing to do
    return;
  }

  console.log(
    `[EXPLANATIONS] Processing ${Math.min(BATCH_SIZE, queue.length)}/${
      queue.length
    } items…`
  );

  const batch = queue.slice(0, BATCH_SIZE);
  const successes = [];

  for (const item of batch) {
    const ok = await processOneExplanation(state, URLS_SERVER, item);
    if (ok) successes.push(item);
  }

  // Remove processed ones from queue
  const remaining = queue.filter((item) => !successes.includes(item));
  await lsSet(QUEUE_KEY, remaining);

  // Add to crawled list
  const newCrawled = [
    ...crawled,
    ...successes.map((x) => ({
      adId: x.adId,
      url: x.url,
      time: Date.now(),
    })),
  ];
  await lsSet(CRAWLED_KEY, newCrawled);

  console.log(
    `[EXPLANATIONS] Done. Success=${successes.length}, Remaining=${remaining.length}`
  );
}
