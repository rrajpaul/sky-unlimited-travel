import { useState } from "react";

export default function VacationPortSearch({ page = "/SharedPage/DefaultSearch" }) {
  const [loadKey, setLoadKey] = useState(0);

  // Construct the targeted platform URL containing your unique agency subdomain
  const frameSrc = `https://skyunlimitedtravel.vacationport.net${page}?noscroll=true&v=${loadKey}`;

  return (
    <div style={{ width: "100%", textAlign: "center" }}>
      {/* 
        CRITICAL ISOLATION BOX:
        We wrap the iframe inside a clean, unstyled HTML5 container. 
        This keeps your custom bundle_site error listeners from tracking and crashing 
        the nested jQuery objects inside the widget when it initializes.
      */}
      <div style={{ display: "block", width: "100%", clear: "both" }}>
        <iframe
          key={loadKey}
          src={frameSrc}
          title="VacationPort Travel Search"
          style={{
            width: "100%",
            minHeight: "800px", // Increased to ensure the search results fit comfortably
            border: "none",
            borderRadius: "8px",
          }}
          // FIX: Re-added allow-same-origin alongside allow-same-origin dependencies.
          // This allows the iframe to pass a valid origin to the /JsonData/Search API, 
          // fixing the 404 CORS failure while maintaining isolated script execution contexts.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
      </div>

      {/* Manual recovery option remains in case network drops */}
      <button 
        onClick={() => setLoadKey(prev => prev + 1)}
        style={{ 
          marginTop: "15px", 
          padding: "6px 12px", 
          fontSize: "12px", 
          opacity: 0.6, 
          cursor: "pointer",
          border: "1px solid #ccc",
          borderRadius: "4px",
          backgroundColor: "#f9f9f9"
        }}
      >
        Widget not loading? Reset Search Frame
      </button>
    </div>
  );
}
