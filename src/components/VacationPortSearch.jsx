import { useState } from "react";

export default function VacationPortSearch({ page = "/SharedPage/DefaultSearch" }) {
  const [loadKey, setLoadKey] = useState(0);

  // Safely construct the direct URL targeting the standalone VacationPort search frame
  const frameSrc = `https://vacationport.net${page}?noscroll=true&v=${loadKey}`;

  return (
    <div style={{ width: "100%", textAlign: "center" }}>
      <iframe
        key={loadKey}
        src={frameSrc}
        title="VacationPort Travel Search"
        style={{
          width: "100%",
          minHeight: "750px", // High baseline height ensures layout is visible immediately
          border: "none",
          borderRadius: "8px",
        }}
        // Standard sandbox rules allow forms and operations without cross-origin dependency leaks
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />

      {/* Manual recovery option remains in case network drops */}
      <button 
        onClick={() => setLoadKey(prev => prev + 1)}
        style={{ marginTop: "10px", padding: "5px 10px", fontSize: "12px", opacity: 0.6, cursor: "pointer" }}
      >
        Widget not loading? Reset Search Frame
      </button>
    </div>
  );
}
