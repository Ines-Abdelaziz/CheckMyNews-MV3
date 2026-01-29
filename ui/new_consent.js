// new_consent.js — MV3 version

const HOST_SERVER = "https://adanalystplus.lix.polytechnique.fr/";

// -----------------------------------------------------
// 1. Send consent to background service worker
// -----------------------------------------------------
function sendConsent() {
  console.log("[CONSENT] Sending consent…");

  chrome.runtime.sendMessage(
    { type: "registerConsent", payload: { consent: true } },
    (response) => {
      console.log("[CONSENT] Response:", response);

      // Background failed or unreachable
      if (!response || response.ok === false) {
        showError();
        return;
      }

      // ✅ Consent registered → close page
      window.close();
    }
  );
}

// -----------------------------------------------------
// 2. Poll consent status (optional safety net)
// -----------------------------------------------------
function pollConsentStatus() {
  chrome.runtime.sendMessage({ type: "getConsentStatus" }, (response) => {
    if (!response || !response.ok) {
      setTimeout(pollConsentStatus, 5000);
      return;
    }

    if (response.consent === true) {
      window.close();
      return;
    }

    setTimeout(pollConsentStatus, 5000);
  });
}

// -----------------------------------------------------
// 3. Error handling UI
// -----------------------------------------------------
function showError() {
  $("#consentInfo").append(`
    <div class="alert alert-danger alert-dismissable">
      <strong>Error:</strong> Something went wrong. Please try again.
    </div>
  `);
}

// -----------------------------------------------------
// 4. Bind UI
// -----------------------------------------------------
$(document).ready(function () {
  $("#consentButton").click(sendConsent);

  $("#noConsentButton").click(() => {
    chrome.tabs.create({ url: "chrome://extensions/" });
    window.close();
  });

  pollConsentStatus();
});
