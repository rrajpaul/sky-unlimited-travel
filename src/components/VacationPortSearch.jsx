import { useEffect, useState } from "react";

const SCRIPT_SRC = "https://skyunlimitedtravel.vacationport.net/Info/Portable";
const SCRIPT_ID = "nexcite-connect-portable-script";

export default function VacationPortSearch({ page = "/SharedPage/DefaultSearch" }) {
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    // 1. Remove any old, stalled instance of the script first
    const existingScript = document.getElementById(SCRIPT_ID);
    if (existingScript) {
      existingScript.remove();
    }

    // 2. Also remove any stale iframes left behind by broken previous page transitions
    const oldIframe = document.querySelector('iframe[id^="iFrameResizer"]');
    if (oldIframe) {
      oldIframe.remove();
    }

    // 3. Dynamically build and append a fresh copy of the script
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `${SCRIPT_SRC}?v=${Date.now()}`; // Query string defeats aggressive browser caching
    script.async = true;
    
    document.body.appendChild(script);

    // 4. Cleanup function: Clean the script out of the DOM if the user navigates away
    return () => {
      const scriptToClean = document.getElementById(SCRIPT_ID);
      if (scriptToClean) scriptToClean.remove();
    };
  }, [page, loadKey]);

  return (
    <div style={{ width: "100%", textAlign: "center" }}>
      <div
        className="nx-portable"
        data-page={page}
        style={{ minHeight: "600px", width: "100%" }}
      />
      {/* If a timeout happens, this button provides an instant manual restart fallback */}
      <button 
        onClick={() => setLoadKey(prev => prev + 1)}
        style={{ marginTop: "10px", padding: "5px 10px", fontSize: "12px", opacity: 0.6 }}
      >
        Widget not loading? Reload Search Portal
      </button>
    </div>
  );
}
