
// const script = document.createElement("script");
// script.src = chrome.runtime.getURL("page-scripts/fbBootstrapExtractor.page.js");
// script.onload = () => {
//   script.remove();
// };

// (document.head || document.documentElement).appendChild(script);

(function () {
  const inject = () => {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("page-scripts/fbBootstrapExtractor.page.js");
    s.setAttribute("data-cmn", "bootstrap");
    (document.head || document.documentElement).appendChild(s);
  };

  // Delay JUST enough to let hydration finish
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }
})();
