// content-scripts/injectGraphQLInterceptor.js
console.log("[CMN][Injector] Injecting GraphQL interceptor");

(function inject() {
  if (window.__CMN_GRAPHQL_INJECTED__) return;
  window.__CMN_GRAPHQL_INJECTED__ = true;

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL(
    "page-scripts/fbGraphQLInterceptor.page.js"
  );
  script.setAttribute("data-cmn", "graphql");
  (document.head || document.documentElement).appendChild(script);

  //   script.type = "text/javascript";

  //   script.onload = () => {
  //     console.log("[CMN][Injector] ✅ Injected");
  //     // script.remove();
  //   };

  //   document.documentElement.appendChild(script);
})();
