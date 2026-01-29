// utils/fetch.js
// Simple retry wrapper used across detectors and consent

export async function fetchWithRetry(
  url,
  options = {},
  retries = 3,
  delay = 1000
) {
  try {
    const resp = await fetch(url, options);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json();
  } catch (err) {
    if (retries > 0) {
      console.warn("[fetchWithRetry] retrying:", url, "retries left:", retries);
      await new Promise((r) => setTimeout(r, delay));
      return fetchWithRetry(url, options, retries - 1, delay);
    }
    console.error("[fetchWithRetry] failed:", url, err);
    return null;
  }
}
