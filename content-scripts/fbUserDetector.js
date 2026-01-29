// content-scripts/fbUserDetector.js
console.log("[CMN] fbUserDetector content script loaded");

// Listen for messages from MAIN world
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== "CMN") return;

  if (event.data.type === "USER_ID") {
    chrome.runtime.sendMessage({
      type: "userIdDetected",
      userId: event.data.userId,
    });
  }
});

// Ask service worker to inject MAIN-world detector
chrome.runtime.sendMessage({ type: "injectUserDetector" });
window.addEventListener("CMN_UI_DETECTED", (e) => {
  const { version, mobile } = e.detail || {};
  if (!version) return;

  chrome.runtime.sendMessage({
    type: "ui-detection",
    version,
    mobile,
  });
});
