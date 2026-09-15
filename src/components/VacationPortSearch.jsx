import { useEffect, useRef } from "react";

const SCRIPT_SRC = "https://skyunlimitedtravel.vacationport.net/Info/Portable";
const SCRIPT_ID = "nexcite-connect-portable-script";

/**
 * Embeds the VacationPort / NexCite Connect travel search widget.
 *
 * Usage:
 *   <VacationPortSearch />                              // default search page
 *   <VacationPortSearch page="/SharedPage/CruiseSearch" /> // a different NexCite page, if you have one
 *
 * How it works:
 * NexCite's script scans the page for `<div class="nx-portable" data-page="...">`
 * elements on load and injects the search widget into them. This component
 * renders that div and makes sure the vendor script is present on the page,
 * loading it only once even if the component is used in multiple places.
 *
 * Important caveat (client-side routing / SPAs):
 * The vendor script appears to be built for traditional multi-page sites — it
 * scans for `.nx-portable` divs when it loads. If your app uses client-side
 * routing (React Router, etc.) and the user navigates to a page containing
 * this component WITHOUT a full page reload, the script may already have run
 * its initial scan before this div existed, and the widget may not appear.
 * If you hit that, the fixes are either:
 *   1. Force a full page load for the route that hosts this component, or
 *   2. Ask VacationPort/NexCite support if they expose a manual re-init
 *      function (e.g. something like `window.NxPortable.init()`) you can
 *      call from this component's effect after the script loads — there's
 *      no public documentation of one, so this hasn't been assumed here.
 */
export default function VacationPortSearch({ page = "/SharedPage/DefaultSearch" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    // Don't inject the script twice if this component is rendered more than
    // once on the same page, or if it unmounts/remounts (e.g. React StrictMode).
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    document.body.appendChild(script);

    // Intentionally not removing the script on unmount: the widget is meant
    // to persist as part of the page it's embedded in, and re-adding it on
    // every mount/unmount cycle could cause the vendor script to double-scan
    // the DOM.
  }, []);

  // NexCite's script swaps this div's contents for an iframe, but it only
  // sets the iframe's width — height is set later, asynchronously, by a
  // separate iframe-resizer script it loads on its own. Until that finishes
  // (or if it's blocked by a CSP/ad-blocker), the iframe has no explicit
  // height and can appear blank/invisible. A minHeight here guarantees the
  // widget is visible immediately, and gets overridden once resizing kicks in.
  return (
    <div
      ref={containerRef}
      className="nx-portable"
      data-page={page}
      style={{ minHeight: 500, width: "100%" }}
    />
  );
}