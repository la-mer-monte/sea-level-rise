import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import AppFR from "./SeaLevelFR";
import AppEN from "./SeaLevelEN";

// Détecte la langue du navigateur pour choisir la version par défaut
function detectLang(): "fr" | "en" {
  const saved = localStorage.getItem("sea-level-lang");
  if (saved === "fr" || saved === "en") return saved;
  const nav = navigator.language?.toLowerCase() ?? "";
  return nav.startsWith("fr") ? "fr" : "en";
}

function Root() {
  const [lang, setLang] = useState<"fr" | "en">(detectLang);

  const switchLang = (l: "fr" | "en") => {
    localStorage.setItem("sea-level-lang", l);
    setLang(l);
  };

  return (
    <>
      {/* Sélecteur de langue — fixe en haut à gauche */}
      <div style={{
        position: "fixed", top: 10, left: 16, zIndex: 200,
        display: "flex", gap: 4,
      }}>
        {(["fr", "en"] as const).map(l => (
          <button
            key={l}
            onClick={() => switchLang(l)}
            style={{
              fontSize: 11, padding: "2px 9px", borderRadius: 5, cursor: "pointer",
              border: `1px solid ${lang === l ? "#3b82f6" : "#334155"}`,
              background: lang === l ? "#3b82f618" : "none",
              color: lang === l ? "#60a5fa" : "#475569",
              fontWeight: lang === l ? 700 : 400,
              transition: "all .15s",
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {lang === "fr" ? <AppFR /> : <AppEN />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
