import { useState } from "react";

/**
 * Embeds the VacationPort / NexCite Connect travel search widget via a
 * manually-controlled iframe pointed directly at the agency's SharedPage.
 *
 * Why a plain <iframe> instead of NexCite's own embed script
 * (<div class="nx-portable"> + their /Info/Portable script):
 * their script loads the same content, but going through a raw iframe let us
 * sidestep a Cross-Origin-Embedder-Policy conflict between this site and
 * their page that was blocking the widget from loading at all. This is a
 * deliberate divergence from their documented embed method, not a stylistic
 * choice — see the trade-offs below.
 *
 * Trade-offs versus their script-based embed:
 * - No auto-resizing: their script pairs with an iframe-resizer library that
 *   adjusts height to fit content. We don't have that here, so `minHeight`
 *   below is a fixed guess. If their result lists get taller (e.g. more
 *   filters, more results), content may get cut off — revisit this height
 *   periodically, or investigate re-adding their resizer script pointed at
 *   this manually-created iframe.
 * - `sandbox` restricts what the framed page can do. `allow-same-origin` is
 *   required for VacationPort's page to make its own same-origin API calls
 *   (their /JsonData/Search endpoint returned a CORS/404 failure without it).
 *   Do not remove `allow-same-origin` without re-testing search results.
 * - Bypasses whatever VacationPort's own script does under the hood (e.g.
 *   future updates on their end). If the widget breaks after a change on
 *   their side, check whether they've altered how DefaultSearch behaves.
 */
export default function VacationPortSearch({ page = "/SharedPage/DefaultSearch" }) {
  const [loadKey, setLoadKey] = useState(0);

  const frameSrc = `https://skyunlimitedtravel.vacationport.net${page}?noscroll=true&v=${loadKey}`;

  return (
    <div style={{ width: "100%", textAlign: "center" }}>
      <iframe
        key={loadKey}
        src={frameSrc}
        title="VacationPort Travel Search"
        style={{
          width: "100%",
          minHeight: "400px",
          border: "none",
          borderRadius: "8px",
        }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />

      {/* Manual reload, in case the iframe fails to load or gets stuck
          (e.g. a dropped network request) — bumps `loadKey`, which changes
          the `key` prop and forces React to remount a fresh iframe. */}
      <button
        onClick={() => setLoadKey((prev) => prev + 1)}
        style={{
          marginTop: "15px",
          padding: "6px 12px",
          fontSize: "12px",
          opacity: 0.6,
          cursor: "pointer",
          border: "1px solid #ccc",
          borderRadius: "4px",
          backgroundColor: "#f9f9f9",
        }}
      >
        Widget not loading? Reset Search Frame
      </button>
    </div>
  );
}