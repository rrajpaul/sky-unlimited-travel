import { useState } from "react";

export default function VacationPortSearch({ page = "/SharedPage/DefaultSearch" }) {
  const [loadKey, setLoadKey] = useState(0);

  // FIX 1: Re-instated your unique portal subdomain. 
  // VacationPort maps agency configurations to subdomains. Without it, the widget crashes 
  // because it tries to look up matching styles/branding for "vacationport.net" and fails.
  const frameSrc = `https://skyunlimitedtravel.vacationport.net${page}?noscroll=true&v=${loadKey}`;

  return (
    <div style={{ width: "100%", textAlign: "center" }}>
      <iframe
        key={loadKey}
        src={frameSrc}
        title="VacationPort Travel Search"
        style={{
          width: "100%",
          minHeight: "750px", // High baseline height ensures visibility immediately
          border: "none",
          borderRadius: "8px",
        }}
        // FIX 2: Removed "allow-same-origin". 
        // This isolates the third-party iframe into its own safe sandbox. 
        // This stops the widget's internal jQuery scripts from attempting to read/bleed 
        // into your custom React/Vite parent window contexts, stopping the TypeError crash.
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      />

      {/* Manual recovery option remains in case network drops */}
      <button 
        onClick={() => setLoadKey(prev => prev + 1)}
        style={{ 
          marginTop: "10px", 
          padding: "5px 10px", 
          fontSize: "12px", 
          opacity: 0.6, 
          cursor: "pointer" 
        }}
      >
        Widget not loading? Reset Search Frame
      </button>
    </div>
  );
}
