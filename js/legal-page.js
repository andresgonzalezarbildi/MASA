(() => {
  "use strict";

  const isLegalPath = value => /\/(?:privacy|terms)\.html(?:$|[?#])/i.test(String(value || ""));

  document.addEventListener("click", event => {
    const link = event.target.closest("a[href]");
    if (!link || !isLegalPath(link.getAttribute("href"))) return;
    event.preventDefault();
    window.location.replace(link.href);
  });

  window.MASAHandleAndroidBack = () => {
    window.location.replace(new URL("./index.html", document.baseURI).href);
    return true;
  };
})();
