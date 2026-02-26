import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

// ── DONNÉES ────────────────────────────────────────────────────────────────────
// ⚠️ À mettre à jour chaque année — source : NOAA/UHSLC moyenne marégraphes mondiaux
const REF = { year: 2025, sl: 240 };
const CY = REF.year, SL_NOW = REF.sl;
const RATE_CY = 4.5; // mm/an mesuré à CY

const BY_MIN = 1900;
const BY_MAX = 2035; // borne max naissance (enfants/petits-enfants à venir)

const HIST: [number, number][] = [
  [1900, 0], [1910, 3], [1920, 19], [1930, 23], [1940, 37],
  [1950, 62], [1960, 85], [1970, 89], [1980, 113], [1990, 129],
  [1993, 131], [2000, 150], [2005, 162], [2010, 189], [2015, 205],
  [2020, 218], [2025, 240],
];

function hsl(yr: number): number {
  if (yr <= 1900) return 0;
  if (yr >= CY) return SL_NOW + (yr - CY) * RATE_CY;
  for (let i = 0; i < HIST.length - 1; i++) {
    const [y0, v0] = HIST[i], [y1, v1] = HIST[i + 1];
    if (yr >= y0 && yr <= y1) return v0 + (v1 - v0) * (yr - y0) / (y1 - y0);
  }
  return 240;
}

const SC: Record<string, { color: string; label: string; add: number }> = {
  "SSP1-2.6": { color: "#4ade80", label: "Optimiste (+1.5°C)", add: 350 },
  "SSP2-4.5": { color: "#fbbf24", label: "Intermédiaire (+2-3°C)", add: 470 },
  "SSP5-8.5": { color: "#f87171", label: "Pessimiste (+4-5°C)", add: 680 },
};
const SC_CI: Record<string, { low: number; high: number }> = {
  "SSP1-2.6": { low: 180, high: 490 },
  "SSP2-4.5": { low: 290, high: 650 },
  "SSP5-8.5": { low: 500, high: 930 },
};
const SC_KEYS = Object.keys(SC);
// Alias pour contourner les types stricts de recharts sur le prop label
const ReferenceLineAny = ReferenceLine as React.ComponentType<any>;

function _pslFormula(dt: number, total75: number): number {
  const accelCoef = Math.max(0, (total75 - RATE_CY * 75) / (75 * 75));
  return RATE_CY * dt + accelCoef * dt * dt;
}
function psl(yr: number, sc: string): number {
  if (yr <= CY) return hsl(yr);
  return SL_NOW + _pslFormula(yr - CY, SC[sc].add);
}
function pslCI(yr: number, sc: string, b: "low" | "high"): number {
  if (yr <= CY) return hsl(yr);
  return SL_NOW + _pslFormula(yr - CY, SC_CI[sc][b]);
}

function lifeExp(by: number): number {
  if (by < 1900) return 55; if (by < 1910) return 58; if (by < 1920) return 62;
  if (by < 1930) return 66; if (by < 1940) return 70; if (by < 1950) return 74;
  if (by < 1960) return 78; if (by < 1970) return 81; if (by < 1980) return 83;
  if (by < 1990) return 85; if (by < 2000) return 87; return 89;
}

function calcStats(by: number, endYr: number) {
  const slB = hsl(by), isDead = endYr < CY;
  const slAtNow = isDead ? hsl(endYr) : SL_NOW;
  const lived = Math.max(0, slAtNow - slB);
  const riseSinceDeath = isDead ? Math.max(0, SL_NOW - hsl(endYr)) : 0;
  const sc: Record<string, { toCome: number; total: number }> = {};
  for (const k of SC_KEYS) sc[k] = {
    toCome: isDead ? 0 : Math.max(0, psl(endYr, k) - SL_NOW),
    total: isDead ? lived : Math.max(0, psl(endYr, k) - slB),
  };
  return { lived, slB, slAtNow, isDead, riseSinceDeath, sc };
}

// ── GÉNÉRATIONS ────────────────────────────────────────────────────────────────
const GENS = [
  { id: "arriere", label: "Arrière-grands-parents",       color: "#a78bfa" },
  { id: "grands",  label: "Grands-parents",               color: "#60a5fa" },
  { id: "parents", label: "Parents / Oncles / Tantes",    color: "#34d399" },
  { id: "me",      label: "Moi",                          color: "#f1f5f9" },
  { id: "siblings",label: "Frères / Sœurs / Cousins",     color: "#fbbf24" },
  { id: "partner", label: "Conjoint·e / Ex",              color: "#fbbf24" },
  { id: "friends", label: "Amis / Connaissances",         color: "#fbbf24" },
  { id: "children",label: "Enfants / Neveux / Nièces",    color: "#fb923c" },
  { id: "grands2", label: "Petits-enfants / Filleuls",    color: "#f472b6" },
];
const genColor = (id: string) => GENS.find(g => g.id === id)?.color ?? "#e2e8f0";
const genLabel = (id: string) => GENS.find(g => g.id === id)?.label ?? "";

// ── TYPES ────────────────────────────────────────────────────────────────────
interface Person {
  id: number;
  name: string;
  birthYear: number;
  endYear: number;
  generation: string;
  deceased: boolean;
}

type PageId = "welcome" | "family" | "display" | "cta";

// ── PERSISTANCE ───────────────────────────────────────────────────────────────
const STORAGE_KEY = "sea-level-v3";
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveState(data: object) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

// ── STYLES PARTAGÉS ───────────────────────────────────────────────────────────
const S = {
  card: {
    background: "#1e293b", borderRadius: 12, padding: 16,
    border: "1px solid #334155",
  } as React.CSSProperties,
  inputBase: {
    width: "100%", background: "#0f172a", border: "1px solid #334155",
    borderRadius: 6, padding: "4px 7px", color: "#e2e8f0",
    fontSize: 12, boxSizing: "border-box" as const,
  } as React.CSSProperties,
  badge: (color: string) => ({
    fontSize: 10, color, background: color + "18",
    border: `1px solid ${color}44`, borderRadius: 5, padding: "2px 7px",
  } as React.CSSProperties),
  btnPrimary: {
    background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8,
    padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
  } as React.CSSProperties,
  btnGhost: {
    background: "none", border: "1px solid #334155", borderRadius: 6,
    color: "#94a3b8", fontSize: 12, padding: "6px 14px", cursor: "pointer",
  } as React.CSSProperties,
  label: { fontSize: 9, color: "#475569", marginBottom: 2 } as React.CSSProperties,
};

// ── SVG SILHOUETTE ────────────────────────────────────────────────────────────
const SVG_W = 120, SVG_H = 430, FIG_H = 280;
// 1 px SVG = 1700mm / FIG_H ≈ 6 mm de montée marine
const MM = FIG_H / 1700;
// Y_REF = ordonnée de la ligne "aujourd'hui" dans le viewBox
const Y_REF = 290;

function Silhouette({
  person, scenario, compareAll = false, svgWidth = 120,
}: {
  person: Person; scenario: string; compareAll?: boolean; svgWidth?: number;
}) {
  const { birthYear: rawBy, endYear, name, generation } = person;
  // Borne de sécurité : naissance entre BY_MIN et BY_MAX
  const by = Math.max(BY_MIN, Math.min(BY_MAX, rawBy));
  const s = calcStats(by, endYear);
  const cx = SVG_W / 2;
  const color = genColor(generation);
  const compact = svgWidth < 90;
  const svgH = Math.round(svgWidth * SVG_H / SVG_W);
  const clipId = `clip-${person.id}`;

  // Position verticale des pieds : décalage depuis Y_REF en fonction de la montée
  // depuis la naissance jusqu'à aujourd'hui. Clampé pour rester dans le viewBox.
  // Pour les naissances futures, s.slB > SL_NOW → riseBirth est négatif → feetY < Y_REF (pieds au-dessus).
  // Clamp bas = FIG_H (et non FIG_H+10=Y_REF) pour ne pas écraser les naissances futures sur la ligne bleue.
  const riseBirthToNow = SL_NOW - s.slB; // peut être négatif pour naissance future
  const feetY = Math.max(FIG_H, Math.min(SVG_H - 5, Y_REF + riseBirthToNow * MM));
  const headY = feetY - FIG_H;
  const hr = 18, hcy = headY + hr, shoulderY = hcy + hr + 5, waistY = shoulderY + 80;

  const fmtCm = (v: number) => `${(v / 10).toFixed(1)} cm`;
  const fmtSub = (v: number) => v >= 10 ? `${(v / 10).toFixed(1)} cm` : `${Math.round(v)} mm`;
  const toCome = s.sc[scenario]?.toCome ?? 0;

  // Lignes futures par scénario
  const futureLines = SC_KEYS.map(k => {
    const tc = s.isDead ? 0 : (s.sc[k]?.toCome ?? 0);
    const y = tc > 0 ? Math.max(5, Y_REF - tc * MM) : null;
    return { k, tc, y };
  });

  const yFuture = s.isDead ? null : (toCome > 0 ? Math.max(5, Y_REF - toCome * MM) : null);
  const yDeath = (s.isDead && s.riseSinceDeath > 2)
    ? Math.min(SVG_H - 5, Y_REF + s.riseSinceDeath * MM) : null;

  // Détection chevauchement labels en mode superposition
  const futureYsValid = futureLines.filter(f => f.y !== null).map(f => f.y as number).sort((a, b) => a - b);
  const labelsTooClose = futureYsValid.some((y, i) => i > 0 && futureYsValid[i - 1] - y < 10);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0, width: svgWidth }}>
      <div style={{ fontWeight: 700, color, fontSize: compact ? 10 : 12, width: "100%", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name || "—"}
      </div>
      <div style={{ color: "#64748b", fontSize: compact ? 9 : 10, textAlign: "center" }}>
        {by}{s.isDead ? `–${endYear} ✝` : `~${endYear}`}
      </div>

      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ width: svgWidth, height: svgH }}>
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={SVG_W} height={SVG_H} />
          </clipPath>
        </defs>
        <rect x="0" y="0" width={SVG_W} height={SVG_H} fill="#0f172a" />

        {/* Mode superposition : 3 lignes futures */}
        {compareAll && !s.isDead && futureLines.map(({ k, tc, y }) => y === null ? null : (
          <g key={k} clipPath={`url(#${clipId})`}>
            <rect x="0" y={y} width={SVG_W} height={Y_REF - y} fill={SC[k].color} opacity="0.07" />
            <line x1="0" y1={y} x2={SVG_W} y2={y} stroke={SC[k].color} strokeWidth="1.3" strokeDasharray="4,3" />
            {!compact && !labelsTooClose && (
              <text x={SVG_W - 2} y={Math.max(9, y - 2)} textAnchor="end" fontSize="6.5" fill={SC[k].color}>
                {k.replace("SSP", "")} +{fmtCm(tc)}
              </text>
            )}
          </g>
        ))}

        {/* Mode scénario unique */}
        {!compareAll && yFuture !== null && (
          <g clipPath={`url(#${clipId})`}>
            <rect x="0" y={yFuture} width={SVG_W} height={Y_REF - yFuture} fill={SC[scenario].color} opacity="0.1" />
            <line x1="0" y1={yFuture} x2={SVG_W} y2={yFuture} stroke={SC[scenario].color} strokeWidth="1.5" strokeDasharray="5,3" />
            {!compact && (
              <text x={SVG_W - 2} y={Math.max(9, yFuture - 2)} textAnchor="end" fontSize="7" fill={SC[scenario].color}>
                ~{endYear} +{fmtCm(toCome)}
              </text>
            )}
          </g>
        )}

        {/* Eau historique (naissance → aujourd'hui) */}
        <rect x="0" y={Y_REF} width={SVG_W} height={Math.max(0, feetY - Y_REF)} fill="#3b82f6" opacity="0.38" clipPath={`url(#${clipId})`} />
        <line x1="0" y1={Y_REF} x2={SVG_W} y2={Y_REF} stroke="#93c5fd" strokeWidth="1.8" />
        <text x="2" y={Y_REF - 3} fontSize="7" fill="#93c5fd">Auj.</text>

        {/* Ligne de décès */}
        {yDeath !== null && <>
          <line x1="0" y1={yDeath} x2={SVG_W} y2={yDeath} stroke="#f97316" strokeWidth="1" strokeDasharray="4,3" />
          {!compact && <text x={SVG_W - 2} y={yDeath - 2} textAnchor="end" fontSize="6.5" fill="#f97316">✝{endYear}: +{fmtCm(s.lived)}</text>}
        </>}

        {/* Ligne de naissance */}
        {!compact && feetY < SVG_H - 5 && <>
          <line x1="0" y1={feetY} x2={SVG_W} y2={feetY} stroke="#475569" strokeWidth="0.8" strokeDasharray="2,2" />
          <text x="2" y={Math.min(feetY - 2, SVG_H - 5)} fontSize="6.5" fill="#475569">{by}: 0</text>
        </>}

        {/* Corps humain — entièrement clippé dans le viewBox */}
        <g clipPath={`url(#${clipId})`}>
          <circle cx={cx} cy={hcy} r={hr} fill={color} />
          <rect x={cx - 5} y={hcy + hr} width="10" height="7" fill={color} />
          <path d={`M${cx - 22},${shoulderY} L${cx + 22},${shoulderY} L${cx + 18},${waistY} L${cx - 18},${waistY}Z`} fill={color} />
          <path d={`M${cx - 22},${shoulderY + 5} L${cx - 32},${shoulderY + 8} L${cx - 34},${waistY - 10} L${cx - 22},${waistY - 10}Z`} fill={color} />
          <path d={`M${cx + 22},${shoulderY + 5} L${cx + 32},${shoulderY + 8} L${cx + 34},${waistY - 10} L${cx + 22},${waistY - 10}Z`} fill={color} />
          <path d={`M${cx - 18},${waistY} L${cx - 3},${waistY} L${cx - 3},${feetY} L${cx - 18},${feetY}Z`} fill={color} />
          <path d={`M${cx + 3},${waistY} L${cx + 18},${waistY} L${cx + 18},${feetY} L${cx + 3},${feetY}Z`} fill={color} />
        </g>
      </svg>

      {/* Chiffres sous la silhouette */}
      <div style={{ fontSize: compact ? 9 : 10, color: "#94a3b8", textAlign: "center", lineHeight: 1.7 }}>
        {s.isDead ? (
          <span style={{ color: "#60a5fa", fontWeight: 700, fontSize: compact ? 10 : 12 }}>+{fmtSub(s.lived)}</span>
        ) : <>
          <div style={{ fontSize: compact ? 10 : 12, fontWeight: 800, color: "#e2e8f0", lineHeight: 1.2 }}>
            +{fmtSub(compareAll ? s.sc["SSP2-4.5"].total : s.sc[scenario].total)}
          </div>
          <div style={{ fontSize: 8, color: "#475569", marginBottom: 1 }}>
            sur la vie{compareAll ? " (réf. SSP2)" : ""}
          </div>
          {!compact && <div style={{ fontSize: 9 }}>
            <span style={{ color: "#60a5fa" }}>+{fmtSub(s.lived)}</span>
            <span style={{ color: "#475569" }}> vécu · </span>
            {toCome > 0 && <span style={{ color: SC[scenario].color }}>+{fmtSub(toCome)}</span>}
            {toCome > 0 && <span style={{ color: "#475569" }}> à venir</span>}
          </div>}
        </>}
        {s.isDead && s.riseSinceDeath > 0 && !compact && <>
          <br />
          <span style={{ color: "#f97316", fontSize: 9 }}>+{fmtSub(s.riseSinceDeath)}</span>
          <span style={{ color: "#475569", fontSize: 9 }}> depuis ✝</span>
        </>}
      </div>
    </div>
  );
}

// ── STAT CARD ─────────────────────────────────────────────────────────────────
function StatCard({ person }: { person: Person }) {
  const s = calcStats(person.birthYear, person.endYear);
  const color = genColor(person.generation);
  return (
    <div style={{ ...S.card, border: `1px solid ${color}44` }}>
      <div style={{ fontWeight: 700, fontSize: 15, color, marginBottom: 1 }}>{person.name || genLabel(person.generation)}</div>
      <div style={{ color: "#64748b", fontSize: 11, marginBottom: 2 }}>{genLabel(person.generation)}</div>
      <div style={{ color: "#64748b", fontSize: 11, marginBottom: 12 }}>
        {person.birthYear}–{person.endYear} · {person.endYear - person.birthYear} ans{s.isDead ? " (décédé·e)" : ""}
      </div>

      {s.isDead ? <>
        <div style={{ marginBottom: s.riseSinceDeath > 0 ? 8 : 12 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
            Hausse vécue ({person.birthYear}–{person.endYear})
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#60a5fa" }}>
            +{(s.lived / 10).toFixed(1)} cm
            <span style={{ fontSize: 11, fontWeight: 400, color: "#64748b", marginLeft: 6 }}>{Math.round(s.lived)} mm</span>
          </div>
        </div>
        {s.riseSinceDeath > 0 && (
          <div style={{ marginBottom: 12, padding: "7px 10px", background: "#0f172a", borderRadius: 8, border: "1px solid #f9741330", fontSize: 11 }}>
            <span style={{ color: "#f97316" }}>+{(s.riseSinceDeath / 10).toFixed(1)} cm</span>
            <span style={{ color: "#64748b" }}> ({Math.round(s.riseSinceDeath)} mm) supplémentaires depuis ✝{person.endYear}</span>
          </div>
        )}
      </> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Bloc "déjà vécu" — commun à tous les scénarios, mis en avant */}
          <div style={{ background: "#0f172a", borderRadius: 8, padding: "10px 12px", border: "1px solid #1e4080" }}>
            <div style={{ fontSize: 10, color: "#60a5fa", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
              Déjà vécu ({person.birthYear}→{CY})
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#60a5fa", lineHeight: 1.1 }}>
              +{(s.lived / 10).toFixed(1)} cm
              <span style={{ fontSize: 12, fontWeight: 400, color: "#475569", marginLeft: 8 }}>{Math.round(s.lived)} mm</span>
            </div>
            <div style={{ fontSize: 11, color: "#334155", marginTop: 2 }}>
              hausse mesurée depuis la naissance — identique quel que soit le scénario
            </div>
          </div>

          {/* Grille "à venir" par scénario */}
          <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: -4 }}>
            Encore à venir ({CY}→{person.endYear}) selon le scénario
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {SC_KEYS.map(k => (
              <div key={k} style={{ background: "#0f172a", borderRadius: 8, padding: "8px 6px", textAlign: "center", border: `2px solid ${SC[k].color}55` }}>
                {/* Scénario */}
                <div style={{ fontSize: 9, color: SC[k].color, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{k}</div>

                {/* Total vie — chiffre star */}
                <div style={{ fontSize: 9, color: "#64748b", marginBottom: 1 }}>total sur la vie</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#e2e8f0", lineHeight: 1.05 }}>
                  +{(s.sc[k].total / 10).toFixed(1)} cm
                </div>
                <div style={{ fontSize: 9, color: "#334155", marginBottom: 8 }}>{Math.round(s.sc[k].total)} mm</div>

                {/* À venir — second star, coloré */}
                <div style={{ borderTop: "1px solid #1e293b", paddingTop: 6 }}>
                  <div style={{ fontSize: 9, color: "#64748b", marginBottom: 1 }}>dont à venir</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: SC[k].color, lineHeight: 1.05 }}>
                    +{(s.sc[k].toCome / 10).toFixed(1)} cm
                  </div>
                  <div style={{ fontSize: 9, color: "#334155" }}>{Math.round(s.sc[k].toCome)} mm</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── FICHE SAISIE ──────────────────────────────────────────────────────────────
function PersonForm({
  p, onUpdate, onRemove, canRemove,
}: {
  p: Person; onUpdate: (f: string, v: unknown) => void; onRemove: () => void; canRemove: boolean;
}) {
  const color = genColor(p.generation);
  const isFuture = p.birthYear > CY;

  // État local pour la saisie de l'année de naissance :
  // on laisse l'utilisateur taper librement et on ne commite vers le parent
  // qu'au blur ou à la touche Entrée, après clamp et validation.
  const [byRaw, setByRaw] = useState(String(p.birthYear));

  // Synchronise l'affichage si le parent change la valeur (ex. reset)
  const prevById = useRef(p.id);
  if (prevById.current !== p.id) {
    prevById.current = p.id;
  }
  // Si la valeur externe change alors qu'on n'est pas en train de taper
  // (par ex. après un reset), on resynchronise l'affichage.
  const byRawAsNum = parseInt(byRaw);
  const externalChanged = !isNaN(byRawAsNum) && byRawAsNum !== p.birthYear && document.activeElement?.getAttribute("data-by-id") !== String(p.id);
  const displayBy = externalChanged ? String(p.birthYear) : byRaw;

  const commitBirthYear = (raw: string) => {
    const v = parseInt(raw);
    if (isNaN(v)) { setByRaw(String(p.birthYear)); return; }
    const clamped = Math.max(BY_MIN, Math.min(BY_MAX, v));
    setByRaw(String(clamped));
    onUpdate("birthYear", clamped);
  };

  // Validation croisée (basée sur la valeur committée, pas le raw)
  const byCommitted = parseInt(byRaw);
  const byError = (!isNaN(byCommitted) && (byCommitted < BY_MIN || byCommitted > BY_MAX))
    ? `Entre ${BY_MIN} et ${BY_MAX}` : null;
  const endError = !byError && p.endYear <= p.birthYear
    ? "Doit être > naissance" : null;

  return (
    <div style={{ ...S.card, border: `1px solid ${color}44`, position: "relative" }}>
      {canRemove && (
        <button onClick={onRemove} style={{
          position: "absolute", top: 6, right: 6,
          background: "rgba(15,23,42,0.7)", border: `1px solid ${color}55`,
          borderRadius: 4, color, opacity: 0.45, cursor: "pointer",
          fontSize: 12, lineHeight: 1, padding: "1px 5px", transition: "opacity .15s",
        }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = "1"}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = "0.45"}>✕</button>
      )}

      <input
        placeholder="Prénom / nom"
        value={p.name}
        onChange={e => onUpdate("name", e.target.value)}
        style={{ ...S.inputBase, marginBottom: 5, color, fontWeight: 600 }}
      />
      <select
        value={p.generation}
        onChange={e => onUpdate("generation", e.target.value)}
        style={{ ...S.inputBase, marginBottom: 5, background: "#0f172a" }}
      >
        {GENS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
      </select>

      {/* Toggle vivant/décédé */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <button
          onClick={() => !isFuture && onUpdate("deceased", !p.deceased)}
          style={{
            padding: "2px 9px", borderRadius: 5, fontSize: 10, fontWeight: 600,
            cursor: isFuture ? "not-allowed" : "pointer",
            border: `1px solid ${p.deceased ? "#f9741388" : isFuture ? "#1e293b" : "#334155"}`,
            background: p.deceased ? "#f9741318" : "#0f172a",
            color: p.deceased ? "#f97316" : isFuture ? "#1e293b44" : "#475569",
            transition: "all .15s", opacity: isFuture ? 0.3 : 1,
          }}>
          {p.deceased ? "✝ Décédé·e" : "Vivant·e"}
        </button>
        {isFuture
          ? <span style={{ fontSize: 9, color: "#334155" }}>— naissance future</span>
          : <span style={{ fontSize: 9, color: "#475569" }}>— cliquer pour changer</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
        <div>
          <div style={S.label}>Année de naissance ({BY_MIN}–{BY_MAX})</div>
          <input
            type="number" min={BY_MIN} max={BY_MAX}
            data-by-id={p.id}
            value={displayBy}
            onChange={e => setByRaw(e.target.value)}
            onBlur={e => commitBirthYear(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commitBirthYear((e.target as HTMLInputElement).value); }}
            style={{ ...S.inputBase, border: byError ? "1px solid #f87171" : "1px solid #334155" }}
          />
          {byError && <div style={{ fontSize: 9, color: "#f87171", marginTop: 2 }}>{byError}</div>}
        </div>
        <div>
          {p.deceased ? <>
            <div style={{ ...S.label, color: "#f97316" }}>Année de décès</div>
            <input
              type="number" min={p.birthYear + 1} max={CY - 1}
              defaultValue={p.endYear}
              key={`end-dead-${p.id}-${p.birthYear}`}
              onBlur={e => { const v = parseInt(e.target.value); if (!isNaN(v)) onUpdate("endYear", Math.max(p.birthYear + 1, Math.min(CY - 1, v))); }}
              onKeyDown={e => { if (e.key === "Enter") { const v = parseInt((e.target as HTMLInputElement).value); if (!isNaN(v)) onUpdate("endYear", Math.max(p.birthYear + 1, Math.min(CY - 1, v))); }}}
              style={{ ...S.inputBase, border: "1px solid #f9741366", color: "#f97316" }}
            />
          </> : <>
            <div style={S.label}>Horizon (projection)</div>
            <input
              type="number" min={Math.max(CY, p.birthYear + 1)} max={2125}
              defaultValue={p.endYear}
              key={`end-alive-${p.id}-${p.birthYear}`}
              onBlur={e => { const v = parseInt(e.target.value); if (!isNaN(v)) onUpdate("endYear", Math.max(p.birthYear + 1, Math.min(2125, v))); }}
              onKeyDown={e => { if (e.key === "Enter") { const v = parseInt((e.target as HTMLInputElement).value); if (!isNaN(v)) onUpdate("endYear", Math.max(p.birthYear + 1, Math.min(2125, v))); }}}
              style={{ ...S.inputBase, border: endError ? "1px solid #f87171" : "1px solid #334155", color: "#94a3b8" }}
            />
            {endError && <div style={{ fontSize: 9, color: "#f87171", marginTop: 2 }}>{endError}</div>}
          </>}
        </div>
      </div>
    </div>
  );
}

// ── BREADCRUMB ────────────────────────────────────────────────────────────────
const PAGES: { id: PageId; label: string }[] = [
  { id: "welcome", label: "Accueil" },
  { id: "family",  label: "Ma famille" },
  { id: "display", label: "Résultats" },
  { id: "cta",     label: "Agir" },
];

function Breadcrumb({ current, onNavigate }: { current: PageId; onNavigate: (p: PageId) => void }) {
  const currentIdx = PAGES.findIndex(p => p.id === current);
  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
      {PAGES.filter(p => p.id !== "welcome").map((p, i) => {
        const pIdx = PAGES.findIndex(pg => pg.id === p.id);
        const isPast = pIdx < currentIdx;
        const isCurrent = p.id === current;
        return (
          <span key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <span style={{ color: "#334155", fontSize: 12 }}>›</span>}
            <button
              onClick={() => (isPast || isCurrent) && onNavigate(p.id)}
              style={{
                background: isCurrent ? "#3b82f6" : "none",
                border: `1px solid ${isCurrent ? "#3b82f6" : isPast ? "#475569" : "#1e293b"}`,
                borderRadius: 6, padding: "3px 12px", fontSize: 12, fontWeight: isCurrent ? 700 : 400,
                color: isCurrent ? "#fff" : isPast ? "#94a3b8" : "#334155",
                cursor: (isPast || isCurrent) ? "pointer" : "default",
                transition: "all .15s",
              }}>
              {p.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

// ── CALL TO ACTION (composant) ────────────────────────────────────────────────
function CallToAction({ sorted }: { sorted: Person[] }) {
  const moi = sorted.find(p => p.generation === "me") ?? sorted[Math.floor(sorted.length / 2)];
  const youngest = sorted[sorted.length - 1];

  const diffPerson = (p: Person | undefined) => {
    if (!p) return null;
    const s = calcStats(p.birthYear, p.endYear);
    if (s.isDead) return null;
    const diffMm = s.sc["SSP5-8.5"].total - s.sc["SSP2-4.5"].total;
    return {
      name: p.name || genLabel(p.generation),
      color: genColor(p.generation),
      diffMm,
      total25: (s.sc["SSP2-4.5"].total / 10).toFixed(1),
      total85: (s.sc["SSP5-8.5"].total / 10).toFixed(1),
    };
  };
  const moiInfo = diffPerson(moi);
  const youngestInfo = youngest !== moi ? diffPerson(youngest) : null;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: "#4ade80", marginBottom: 10 }}>
        🌿 Ce que ces chiffres impliquent
      </div>
      {(moiInfo || youngestInfo) ? (
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 12, color: "#86efac", lineHeight: 1.8, margin: "0 0 10px 0" }}>
            Les choix collectifs d'émissions entre maintenant et 2040 détermineront sur quel scénario
            les générations représentées ici vivront. Voici ce que la différence entre{" "}
            <strong style={{ color: "#fbbf24" }}>SSP2-4.5</strong> et{" "}
            <strong style={{ color: "#f87171" }}>SSP5-8.5</strong> représente concrètement :
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {moiInfo && (
              <div style={{ background: "#0a1f0e", border: "1px solid #166534", borderRadius: 8, padding: "10px 14px", flex: "1 1 200px" }}>
                <div style={{ fontSize: 11, color: moiInfo.color, fontWeight: 700, marginBottom: 4 }}>{moiInfo.name}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>
                  Sur toute la vie : <span style={{ color: "#fbbf24" }}>{moiInfo.total25} cm</span> (SSP2)
                  {" vs "}<span style={{ color: "#f87171" }}>{moiInfo.total85} cm</span> (SSP5)
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>+{(moiInfo.diffMm / 10).toFixed(1)} cm</div>
                <div style={{ fontSize: 10, color: "#4ade80" }}>de différence sur la vie entière</div>
              </div>
            )}
            {youngestInfo && (
              <div style={{ background: "#0a1f0e", border: "1px solid #166534", borderRadius: 8, padding: "10px 14px", flex: "1 1 200px" }}>
                <div style={{ fontSize: 11, color: youngestInfo.color, fontWeight: 700, marginBottom: 4 }}>{youngestInfo.name}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>
                  Sur toute la vie : <span style={{ color: "#fbbf24" }}>{youngestInfo.total25} cm</span> (SSP2)
                  {" vs "}<span style={{ color: "#f87171" }}>{youngestInfo.total85} cm</span> (SSP5)
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>+{(youngestInfo.diffMm / 10).toFixed(1)} cm</div>
                <div style={{ fontSize: 10, color: "#f472b6" }}>de différence sur la vie entière</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "#86efac", lineHeight: 1.8, margin: "0 0 14px 0" }}>
          La différence entre SSP2-4.5 et SSP5-8.5 représente <strong style={{ color: "#fff" }}>20 à 30 cm</strong> de hausse
          supplémentaire d'ici 2100. Les décisions prises entre 2025 et 2040 détermineront
          sur quel scénario les générations représentées ici vivront.
        </p>
      )}
    </div>
  );
}

// ── PAGE 1 : BIENVENUE ────────────────────────────────────────────────────────
function PageWelcome({ onStart }: { onStart: () => void }) {
  return (
    <div style={{
      minHeight: "100vh", background: "#0f172a", color: "#e2e8f0",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: 660, width: "100%" }}>
        {/* En-tête */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: 56, marginBottom: 16, lineHeight: 1 }}>🌊</div>
          <h1 style={{ fontSize: 40, fontWeight: 900, margin: "0 0 16px", letterSpacing: "-1px", lineHeight: 1.05 }}>
            La mer monte
          </h1>
          <p style={{ fontSize: 17, color: "#94a3b8", lineHeight: 1.75, margin: "0 0 16px" }}>
            Depuis 1900, le niveau moyen des océans est monté de{" "}
            <span style={{ color: "#60a5fa", fontWeight: 700 }}>24 cm</span>.
            D'ici 2100, il devrait continuer de monter d'entre{" "}
            <span style={{ color: "#4ade80", fontWeight: 700 }}>35 cm</span> et{" "}
            <span style={{ color: "#f87171", fontWeight: 700 }}>68 cm</span> supplémentaires.
          </p>
          <p style={{ fontSize: 16, color: "#e2e8f0", lineHeight: 1.75, margin: "0 0 12px", fontWeight: 500 }}>
            Mais 2100, c'est loin, non ?
          </p>
          <p style={{ fontSize: 15, color: "#64748b", lineHeight: 1.75, margin: 0 }}>
            Ça dépend pour qui. Les enfants nés en ce moment vivront au-delà de cette date.
            Entrez les noms et dates de naissance des personnes qui comptent pour vous.
            Découvrez de combien de centimètres le niveau des océans aura monté au fil de leurs vies.
          </p>
        </div>

        {/* Aperçu des 3 scénarios */}
        <div style={{ display: "flex", gap: 10, marginBottom: 40, flexWrap: "wrap" }}>
          {SC_KEYS.map(k => (
            <div key={k} style={{
              flex: "1 1 160px",
              background: SC[k].color + "10",
              border: `1px solid ${SC[k].color}33`,
              borderRadius: 12, padding: "14px 16px",
            }}>
              <div style={{ fontSize: 10, color: SC[k].color, fontWeight: 700, marginBottom: 4, letterSpacing: 0.5 }}>{k}</div>
              <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 600, marginBottom: 4 }}>{SC[k].label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: SC[k].color, lineHeight: 1 }}>+{SC[k].add / 10} cm</div>
              <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>médiane GIEC AR6 d'ici 2100</div>
            </div>
          ))}
        </div>

        {/* Mode d'emploi rapide */}
        <div style={{ ...S.card, marginBottom: 32, fontSize: 13, color: "#94a3b8", lineHeight: 1.75 }}>
          <strong style={{ color: "#e2e8f0" }}>Comment ça marche —</strong>{" "}
          Renseignez les informations des personnes de votre entourage (prénom, année de naissance,
          lien avec vous). L'application indiquera la hausse du niveau marin qu'elles ont déjà vécue
          et calculera, le cas échéant, celle qu'elles vivront encore, selon trois scénarios
          climatiques du GIEC. Des silhouettes permettront de visualiser cette montée du niveau de
          la mer par rapport à la taille des personnes.
        </div>

        {/* CTA principal */}
        <div style={{ textAlign: "center" }}>
          <button
            onClick={onStart}
            style={{
              ...S.btnPrimary,
              fontSize: 16, padding: "13px 44px", borderRadius: 12,
              boxShadow: "0 4px 20px #3b82f640",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "#2563eb"}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "#3b82f6"}
          >
            Commencer →
          </button>
          <div style={{ marginTop: 16, fontSize: 11, color: "#334155" }}>
            Vos données restent sur votre appareil · Sauvegarde automatique
          </div>
        </div>

        {/* Sources */}
        <div style={{ marginTop: 40, textAlign: "center", fontSize: 11, color: "#1e293b" }}>
          Sources : Church & White (2011) · CSIRO · UHSLC/NOAA · GIEC AR6 (2021)
        </div>
      </div>
    </div>
  );
}

// ── PAGE 2 : MA FAMILLE ───────────────────────────────────────────────────────
function PageFamily({
  persons, onUpdate, onAdd, onRemove, onNavigate,
}: {
  persons: Person[];
  onUpdate: (id: number, f: string, v: unknown) => void;
  onAdd: () => void;
  onRemove: (id: number) => void;
  onNavigate: (p: PageId) => void;
}) {
  const [showLegend, setShowLegend] = useState(false);

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e2e8f0", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <Breadcrumb current="family" onNavigate={onNavigate} />

        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>👨‍👩‍👧‍👦 Ma famille & mes proches</h2>
        </div>

        <div style={{ ...S.card, marginBottom: 16, fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
          <strong style={{ color: "#e2e8f0" }}>💡 Comment renseigner —</strong>{" "}
          Entrez le prénom, l'année de naissance (entre {BY_MIN} et {BY_MAX}) et le lien avec vous
          pour chaque personne. Les naissances <strong style={{ color: "#e2e8f0" }}>futures</strong> sont
          acceptées (futurs enfants, petits-enfants à naître). Pour les personnes{" "}
          <strong style={{ color: "#f97316" }}>décédées</strong>, renseignez l'année de décès.
          Pour les vivants, l'<strong style={{ color: "#e2e8f0" }}>horizon de projection</strong> est
          modifiable librement (initialisé à l'espérance de vie estimée).
        </div>

        {/* Contrôles */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>
            {persons.length} personne{persons.length > 1 ? "s" : ""} ·
          </span>
          <button onClick={onAdd} style={{ ...S.btnPrimary, padding: "5px 14px", fontSize: 12 }}>
            + Ajouter une personne
          </button>
          <button onClick={() => setShowLegend(v => !v)} style={{ ...S.btnGhost, fontSize: 11, padding: "3px 10px" }}>
            {showLegend ? "▲ Légende" : "▼ Légende des liens"}
          </button>
        </div>

        {showLegend && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {GENS.map(g => (
              <span key={g.id} style={S.badge(g.color)}>{g.label}</span>
            ))}
          </div>
        )}

        {/* Formulaires */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))", gap: 8, marginBottom: 28 }}>
          {persons.map(p => (
            <PersonForm
              key={p.id} p={p}
              onUpdate={(f, v) => onUpdate(p.id, f, v)}
              onRemove={() => onRemove(p.id)}
              canRemove={persons.length > 1}
            />
          ))}
        </div>

        {/* Navigation vers résultats */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => onNavigate("display")}
            style={{ ...S.btnPrimary, fontSize: 14, padding: "10px 28px", borderRadius: 10 }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "#2563eb"}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "#3b82f6"}
          >
            Voir les résultats →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SOURCES (composant réutilisable, affiché en page 3) ──────────────────────
function SourcesBlock() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ color: "#475569", fontSize: 12, margin: "0 0 4px" }}>
        Sources des données
        <button onClick={() => setOpen(v => !v)} style={{ ...S.btnGhost, marginLeft: 10, fontSize: 11, padding: "2px 8px" }}>
          {open ? "▲ Réduire" : "▼ Détails"}
        </button>
      </p>
      {open && (
        <div style={{ ...S.card, fontSize: 12, color: "#94a3b8", lineHeight: 1.8 }}>
          <strong style={{ color: "#e2e8f0" }}>Données historiques (1880–2025)</strong><br />
          Church, J.A. & White, N.J. (2011). <em>Sea-Level Rise from the Late 19th to the Early 21st Century.</em>{" "}
          Surveys in Geophysics, 32(4–5), 585–602. Données CSIRO moyennées annuellement, base 1900 = 0 mm.<br />
          Satellite (1993–2025) : NOAA / University of Hawaii Sea Level Center (UHSLC),
          moyenne pondérée de 373 marégraphes mondiaux.<br /><br />
          <strong style={{ color: "#e2e8f0" }}>Projections futures (2025–2100)</strong><br />
          IPCC AR6 WGI (2021), Chapter 9. Médianes des scénarios SSP1-2.6, SSP2-4.5 et SSP5-8.5.
          Les intervalles de confiance représentent la fourchette « likely » (17e–83e percentile).<br /><br />
          <strong style={{ color: "#e2e8f0" }}>Espérance de vie</strong><br />
          Estimations basées sur les tables de mortalité historiques françaises et européennes (INSEE, Eurostat).
          L'horizon de projection est initialisé à l'espérance de vie estimée mais reste modifiable librement —
          il représente l'année jusqu'à laquelle on projette la hausse pour chaque personne.
        </div>
      )}
    </div>
  );
}

// ── PAGE 3 : RÉSULTATS ────────────────────────────────────────────────────────
function PageDisplay({
  persons, onNavigate,
}: {
  persons: Person[]; onNavigate: (p: PageId) => void;
}) {
  const [tab, setTab] = useState<"stats" | "silhouettes">("stats");
  const [scenario, setScenario] = useState("SSP2-4.5");
  const [compareAll, setCompareAll] = useState(false);
  const [containerWidth, setContainerWidth] = useState(700);
  const silContainerRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => [...persons].sort((a, b) => a.birthYear - b.birthYear), [persons]);

  const silCols = Math.min(6, Math.max(2, Math.floor((containerWidth + 12) / (75 + 12))));
  const silW = Math.min(120, Math.floor((containerWidth - (silCols - 1) * 12) / silCols));

  const silGroups = useMemo(() => {
    const groups: Person[][] = [];
    for (let i = 0; i < sorted.length; i += silCols) groups.push(sorted.slice(i, i + silCols));
    return groups;
  }, [sorted, silCols]);

  useEffect(() => {
    if (!silContainerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width;
      if (w) setContainerWidth(w);
    });
    ro.observe(silContainerRef.current);
    return () => ro.disconnect();
  }, []);

  // Avertissement lisibilité superposition :
  // Détecte si pour au moins une personne vivante, l'écart entre SSP1-2.6 et SSP5-8.5
  // représente moins de 20px (horizon proche de aujourd'hui = scénarios peu divergents)
  const compareWarning = useMemo(() => {
    if (!compareAll) return false;
    return sorted.some(p => {
      if (p.deceased || p.endYear <= CY) return false;
      const s = calcStats(p.birthYear, p.endYear);
      const tc1 = s.sc["SSP1-2.6"].toCome;
      const tc5 = s.sc["SSP5-8.5"].toCome;
      const gap = Math.abs(tc5 - tc1) * MM;
      return gap < 20; // px viewBox
    });
  }, [compareAll, sorted]);

  const chartData = useMemo(() => {
    const yrs = new Set<number>();
    for (let y = 1900; y <= 2100; y += 5) yrs.add(y);
    yrs.add(CY);
    persons.forEach(p => {
      const by = Math.max(BY_MIN, Math.min(BY_MAX, p.birthYear));
      if (by >= 1900 && by <= 2100) yrs.add(by);
    });
    return [...yrs].sort((a, b) => a - b).map(yr => {
      const pt: Record<string, number | null> = { yr };
      pt.hist = yr <= CY ? Math.round(hsl(yr)) : null;
      for (const sc of SC_KEYS) {
        pt[sc] = yr >= CY ? Math.round(psl(yr, sc)) : null;
        pt[sc + "_lo"] = yr >= CY ? Math.round(pslCI(yr, sc, "low")) : null;
        pt[sc + "_hi"] = yr >= CY ? Math.round(pslCI(yr, sc, "high")) : null;
      }
      return pt;
    });
  }, [persons]);

  const tabBtn = (t: typeof tab, label: string) => (
    <button onClick={() => setTab(t)} style={{
      padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer",
      fontWeight: 600, fontSize: 13,
      background: tab === t ? "#3b82f6" : "#1e293b",
      color: tab === t ? "#fff" : "#94a3b8", transition: "all .2s",
    }}>{label}</button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e2e8f0", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <Breadcrumb current="display" onNavigate={onNavigate} />

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>📊 Résultats</h2>
          <button onClick={() => onNavigate("family")} style={{ ...S.btnGhost, fontSize: 12 }}>
            ← Modifier les personnes
          </button>
        </div>

        {/* Onglets */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {tabBtn("stats", "📊 Chiffres clés")}
          {tabBtn("silhouettes", "🧍 Silhouettes")}
        </div>

        {/* ── STATS ── */}
        {tab === "stats" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginBottom: 24 }}>
              {sorted.map(p => <StatCard key={p.id} person={p} />)}
            </div>
            <div style={S.card}>
              <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>
                Évolution 1900–2100 (cm au-dessus du niveau de 1900)
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
                Church & White (2011) + UHSLC/NOAA · Projections GIEC AR6 médianes + intervalles de confiance (traits fins)
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  {/* X fixé sur 1900–2100, les années de naissance apparaissent via ReferenceLine
                      mais ne doivent pas étendre la plage visible */}
                  <XAxis
                    dataKey="yr"
                    type="number"
                    domain={[1900, 2100]}
                    stroke="#475569"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    ticks={[1900, 1920, 1940, 1960, 1980, 2000, 2020, 2040, 2060, 2080, 2100]}
                  />
                  {/* Y fixé : 0 à ~120 cm (1200 mm) pour ne pas s'aplatir avec de futurs nés */}
                  <YAxis
                    stroke="#475569"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    unit=" cm"
                    domain={[0, 1200]}
                    tickFormatter={v => (v / 10).toFixed(0)}
                    ticks={[0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]}
                  />
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                    labelFormatter={v => `Année ${v}`}
                    formatter={(v: number, n: string) => [`${(v / 10).toFixed(1)} cm`, n]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine x={CY} stroke="#475569" strokeDasharray="4,3"
                    label={{ value: "↑ Auj.", fill: "#64748b", fontSize: 9, position: "insideTopLeft" }} />
                  <Line dataKey="hist" name="Historique" stroke="#60a5fa" strokeWidth={2.5} dot={false} connectNulls={false} />
                  {SC_KEYS.map(k => [
                    <Line key={k} dataKey={k} name={`${k} · ${SC[k].label}`} stroke={SC[k].color}
                      strokeWidth={2} strokeDasharray="6,3" dot={false} connectNulls={false} />,
                    <Line key={k + "_lo"} dataKey={k + "_lo"} stroke={SC[k].color}
                      strokeWidth={0.8} strokeDasharray="3,4" dot={false} connectNulls={false}
                      strokeOpacity={0.4} legendType="none" name="" />,
                    <Line key={k + "_hi"} dataKey={k + "_hi"} stroke={SC[k].color}
                      strokeWidth={0.8} strokeDasharray="3,4" dot={false} connectNulls={false}
                      strokeOpacity={0.4} legendType="none" name="" />,
                  ])}
                  {sorted.map((p, i) => {
                    const by = Math.max(BY_MIN, Math.min(BY_MAX, p.birthYear));
                    if (by < 1900 || by > 2100) return null;
                    return (
                      <ReferenceLineAny key={p.id} x={by}
                        stroke={genColor(p.generation)} strokeWidth={1}
                        label={(props: any) => {
                          const vb = props?.viewBox;
                          if (!vb) return null;
                          const yOffset = 8 + (i % 6) * 11;
                          return (
                            <text x={vb.x + 3} y={vb.y + yOffset}
                              fontSize={8} fill={genColor(p.generation)}
                              textAnchor="start" style={{ pointerEvents: "none" }}>
                              {(p.name || "·")} ({p.birthYear})
                            </text>
                          );
                        }} />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Sources déplacées ici depuis page 2 */}
            <SourcesBlock />
          </div>
        )}

        {/* ── SILHOUETTES ── */}
        {tab === "silhouettes" && (
          <div>
            {/* Sélecteur de scénario (actif uniquement si pas compareAll) */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
              {!compareAll && SC_KEYS.map(k => (
                <button key={k} onClick={() => setScenario(k)} style={{
                  padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12,
                  border: `2px solid ${scenario === k ? SC[k].color : "#334155"}`,
                  background: scenario === k ? SC[k].color + "22" : "#1e293b",
                  color: scenario === k ? SC[k].color : "#94a3b8", transition: "all .2s",
                }}>{k} — {SC[k].label}</button>
              ))}

              {/* Toggle superposition */}
              <button
                onClick={() => setCompareAll(v => !v)}
                style={{
                  padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12,
                  border: `2px solid ${compareAll ? "#a78bfa" : "#334155"}`,
                  background: compareAll ? "#a78bfa22" : "#1e293b",
                  color: compareAll ? "#a78bfa" : "#94a3b8", transition: "all .2s",
                  marginLeft: compareAll ? 0 : 4,
                }}>
                {compareAll ? "✦ Superposition active" : "⊞ Superposer les 3 scénarios"}
              </button>
            </div>

            {/* Avertissement lisibilité */}
            {compareWarning && (
              <div style={{
                background: "#1c1207", border: "1px solid #92400e", borderRadius: 8,
                padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#fbbf24", lineHeight: 1.6,
              }}>
                ⚠️ <strong>Lisibilité réduite</strong> — Pour les personnes dont l'horizon de projection est proche
                de {CY}, les trois scénarios n'ont pas encore divergé significativement :
                les lignes futures apparaîtront groupées. Étendez l'horizon ou lisez les chiffres en mode "Chiffres clés".
              </div>
            )}

            <div style={{ ...S.card, marginBottom: 16, fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
              Toutes les silhouettes sont alignées sur la{" "}
              <span style={{ color: "#93c5fd" }}>ligne bleue (aujourd'hui)</span>.
              Les pieds sont au niveau de la mer à la naissance.
              Plus on est né tôt, plus les pieds plongent sous la ligne d'eau.
              {compareAll
                ? <> En mode superposition, les traits <span style={{ color: "#4ade80" }}>vert</span> / <span style={{ color: "#fbbf24" }}>jaune</span> / <span style={{ color: "#f87171" }}>rouge</span> indiquent les trois niveaux futurs.</>
                : <> La ligne colorée en pointillés indique le niveau projeté à l'horizon de chaque personne.</>}
            </div>

            <div ref={silContainerRef}>
              {silGroups.map((grp, gi) => (
                <div key={gi} style={{ marginBottom: gi < silGroups.length - 1 ? 32 : 0 }}>
                  {silGroups.length > 1 && (
                    <div style={{ fontSize: 11, color: "#475569", marginBottom: 8, textAlign: "center" }}>
                      — Groupe {gi + 1} / {silGroups.length} —
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "nowrap" }}>
                    {grp.map(p => (
                      <Silhouette key={p.id} person={p} scenario={scenario} compareAll={compareAll} svgWidth={silW} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ textAlign: "center", fontSize: 11, color: "#475569", marginTop: 16 }}>
              Échelle : silhouette = 170 cm · 1 px ≈ 6 mm de montée du niveau marin · Tri par année de naissance
            </div>
          </div>
        )}

        {/* Navigation bas de page — cohérente ← / → */}
        <div style={{ marginTop: 32, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <button onClick={() => onNavigate("family")} style={{ ...S.btnGhost }}>
            ← Modifier les personnes
          </button>
          <button onClick={() => onNavigate("cta")} style={{
            ...S.btnPrimary, background: "#14532d", border: "1px solid #166534",
            color: "#4ade80", fontSize: 13,
          }}>
            🌿 Comprendre et agir →
          </button>
        </div>

        <div style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 20 }}>
          Données : Church & White (2011) · CSIRO/UHSLC · NOAA (satellite 1993–2025) · GIEC AR6 WGI (2021)
        </div>
      </div>
    </div>
  );
}

// ── PAGE 4 : COMPRENDRE ET AGIR ──────────────────────────────────────────────
function PageCTA({ persons, onNavigate }: { persons: Person[]; onNavigate: (p: PageId) => void }) {
  const sorted = useMemo(() => [...persons].sort((a, b) => a.birthYear - b.birthYear), [persons]);

  // Lien générique réutilisable
  const LinkCard = ({ icon, label, desc, url, color, tag }: {
    icon: string; label: string; desc: string; url: string; color: string; tag?: string;
  }) => (
    <a href={url} target="_blank" rel="noopener noreferrer"
      style={{
        display: "flex", gap: 14, alignItems: "flex-start",
        background: "#1e293b", border: `1px solid ${color}22`,
        borderRadius: 10, padding: "12px 16px",
        textDecoration: "none", transition: "border-color .15s",
      }}
      onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.borderColor = color + "66"}
      onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.borderColor = color + "22"}>
      <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color }}>{label}</span>
          {tag && <span style={{ fontSize: 10, color: "#475569", border: "1px solid #334155", borderRadius: 4, padding: "1px 5px" }}>{tag}</span>}
        </div>
        <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{desc}</div>
      </div>
      <span style={{ marginLeft: "auto", fontSize: 16, color: "#334155", flexShrink: 0, paddingTop: 2 }}>↗</span>
    </a>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e2e8f0", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Breadcrumb current="cta" onNavigate={onNavigate} />

        {/* ── INTRO : situation actuelle ── */}
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 12px" }}>🌿 Comprendre et agir</h2>
          <div style={{ ...S.card, fontSize: 13, color: "#94a3b8", lineHeight: 1.8 }}>
            <strong style={{ color: "#e2e8f0" }}>Où en est-on aujourd'hui ?</strong>{" "}
            Avec les politiques climatiques actuelles, les trajectoires d'émissions mondiales se situent
            entre les scénarios{" "}
            <span style={{ color: SC["SSP2-4.5"].color, fontWeight: 600 }}>SSP2-4.5</span> et{" "}
            <span style={{ color: SC["SSP5-8.5"].color, fontWeight: 600 }}>SSP5-8.5</span>.
            Nous ne sommes pas sur le chemin du scénario optimiste, mais rien n'est figé :
            les décisions d'investissement et de politique énergétique prises{" "}
            <strong style={{ color: "#e2e8f0" }}>entre 2025 et 2040</strong> détermineront
            sur quelle trajectoire les générations présentées ici vivront.
          </div>
        </div>

        {/* ── CE QUE SIGNIFIE CONCRÈTEMENT LA MONTÉE DES EAUX ── */}
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 12px", color: "#e2e8f0" }}>
            🌊 Ce que signifie concrètement une montée de quelques dizaines de centimètres
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              {
                icon: "📏",
                title: "Des submersions plus fréquentes et plus étendues",
                body: "La montée du niveau moyen s'additionne aux marées et aux tempêtes. Un niveau de référence rehaussé de 30 cm transforme une submersion centennale en événement décennal : ce qui arrive une fois tous les cent ans peut arriver une fois tous les dix ans.",
              },
              {
                icon: "🏖️",
                title: "L'érosion côtière accélérée",
                body: "Une hausse de 10 cm du niveau moyen déplace la ligne de rivage de plusieurs mètres à plusieurs dizaines de mètres selon la pente des plages. Les côtes sableuses de l'Atlantique (Oléron, Vendée, Gironde) sont particulièrement concernées.",
              },
              {
                icon: "🧂",
                title: "L'intrusion saline dans les zones humides et les nappes",
                body: "Les marais côtiers, estuaires et zones humides voient leur salinité augmenter. Les nappes phréatiques littorales peuvent être contaminées. Les activités agricoles et la biodiversité de ces zones sont directement affectées.",
              },
              {
                icon: "🏘️",
                title: "Des infrastructures et des populations exposées",
                body: "En France, plusieurs centaines de milliers d'habitants vivent dans des zones côtières basses exposées à la submersion marine. Cela inclut des zones d'habitat, des routes, des zones industrielles et portuaires.",
              },
            ].map(({ icon, title, body }) => (
              <div key={title} style={{ ...S.card, display: "flex", gap: 12, padding: "12px 14px" }}>
                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── DIFFÉRENCE ENTRE SCÉNARIOS ── */}
        <div style={{ background: "#0f2a1a", border: "1px solid #166534", borderRadius: 12, padding: 20, marginBottom: 28 }}>
          <CallToAction sorted={sorted} />
        </div>

        {/* ── MITIGATION ET ADAPTATION ── */}
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 12px", color: "#e2e8f0" }}>
            🛠️ Deux leviers complémentaires : atténuation et adaptation
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ ...S.card, border: "1px solid #3b82f633" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa", marginBottom: 8 }}>
                Atténuation (mitigation)
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
                Réduire les émissions de gaz à effet de serre pour limiter l'ampleur du réchauffement et donc de la montée des eaux à long terme. Transition énergétique, efficacité, sobriété.
                <div style={{ marginTop: 8, padding: "6px 8px", background: "#0f172a", borderRadius: 6, fontSize: 11, color: "#475569" }}>
                  Agit sur le <strong style={{ color: "#60a5fa" }}>niveau futur</strong> — bénéfices sur plusieurs décennies.
                </div>
              </div>
            </div>
            <div style={{ ...S.card, border: "1px solid #f97316" + "33" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fb923c", marginBottom: 8 }}>
                Adaptation
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
                S'organiser pour vivre avec les niveaux déjà engagés : ouvrages de protection, recul stratégique du trait de côte, préservation des zones tampon naturelles (dunes, marais, mangroves).
                <div style={{ marginTop: 8, padding: "6px 8px", background: "#0f172a", borderRadius: 6, fontSize: 11, color: "#475569" }}>
                  Agit sur la <strong style={{ color: "#fb923c" }}>vulnérabilité présente</strong> — nécessaire quelle que soit la trajectoire d'émissions.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── RESSOURCES : VISUALISER LES IMPACTS ── */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#4ade80", marginBottom: 10 }}>
            🗺️ Visualiser les impacts sur les côtes françaises
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <LinkCard
              icon="🗺️"
              label="BRGM — Carte interactive de submersion (France)"
              desc="Saisissez un niveau de hausse (en mètres) et visualisez directement les zones côtières françaises potentiellement submergées. Outil grand public, immédiatement utilisable."
              url="https://sealevelrise.brgm.fr/slr/#lng=0.26000;lat=46.60430;zoom=6;level=1.0;layer=0"
              color="#4ade80"
              tag="Interactif · Grand public"
            />
            <LinkCard
              icon="📈"
              label="BRGM — Scénarios régionaux de hausse AR6 (France)"
              desc="Projections régionalisées du niveau de la mer selon les scénarios SSP du GIEC, par station marégraphique et par horizon temporel (2051, 2081, 2100)."
              url="https://sealevelrise.brgm.fr/sea-level-scenarios/map_beginner.html#map=0/2.714245517666123/0.000000/0.000000/SLR_AR6_ssp245_BRGM_scenario/2051/msl_m,msl_l,msl_h&tab=ar5"
              color="#4ade80"
              tag="Scénarios AR6"
            />
            <LinkCard
              icon="🌊"
              label="SONEL — Données marégraphiques françaises"
              desc="Observations continues du niveau de la mer aux marégraphes du littoral français. Données historiques et en temps quasi-réel."
              url="https://www.sonel.org/"
              color="#60a5fa"
              tag="Données observées"
            />

          </div>
        </div>

        {/* ── RESSOURCES : ALLER PLUS LOIN ── */}
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fbbf24", marginBottom: 10 }}>
            📚 Pour approfondir
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <LinkCard
              icon="📊"
              label="GIEC AR6 — Résumé pour décideurs"
              desc="Le rapport de synthèse de référence sur les changements climatiques, incluant les projections de montée des eaux par scénario et par région."
              url="https://www.ipcc.ch/report/ar6/wg1/chapter/summary-for-policymakers/"
              color="#fbbf24"
              tag="Rapport scientifique"
            />
            <LinkCard
              icon="🌦️"
              label="DRIAS — Projections climatiques régionalisées France"
              desc="Portail officiel Météo-France / BRGM / IPSL des projections climatiques régionalisées pour la France, tous paramètres (température, précipitations, niveaux marins)."
              url="https://www.drias-climat.fr/"
              color="#fbbf24"
              tag="Projections régionales"
            />
            <LinkCard
              icon="🌿"
              label="LIFE Adapto+ — S'adapter : gestion souple du trait de côte"
              desc="Projet du Conservatoire du littoral explorant des solutions d'adaptation fondées sur la nature : recul stratégique, renaturation, gestion souple de la bande côtière. 15 sites pilotes en France. Centre de ressources pédagogiques avec plus de 130 outils et retours d'expérience."
              url="https://www.lifeadapto.eu/"
              color="#34d399"
              tag="Adaptation · LIFE UE"
            />
          </div>
        </div>

        {/* Navigation cohérente bas de page */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <button onClick={() => onNavigate("display")} style={{ ...S.btnGhost }}>
            ← Retour aux résultats
          </button>
          <button onClick={() => onNavigate("family")} style={{ ...S.btnGhost }}>
            ✏️ Modifier les personnes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── APP ───────────────────────────────────────────────────────────────────────
const mkPerson = (id: number, name: string, by: number, gen: string, deceased = false): Person => ({
  id, name,
  birthYear: Math.max(BY_MIN, Math.min(BY_MAX, by)),
  endYear: deceased ? by + 70 : by + lifeExp(by),
  generation: gen,
  deceased,
});

const INIT_PERSONS: Person[] = [
  mkPerson(1, "Moi", 1985, "me"),
  mkPerson(2, "", 1955, "parents"),
  mkPerson(3, "", 2010, "children"),
  mkPerson(4, "", 2022, "grands2"),
];

export default function App() {
  const saved = loadState();

  const [page, setPage] = useState<PageId>(saved?.page === "display" ? "display" : "welcome");
  const [persons, setPersons] = useState<Person[]>(() =>
    saved?.persons?.length ? saved.persons : INIT_PERSONS
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const idRef = useRef(Math.max(...(saved?.persons?.map((p: Person) => p.id) ?? [4]), 4) + 1);

  // Sauvegarde
  useEffect(() => { saveState({ persons, page }); }, [persons, page]);
  useEffect(() => {
    setSavedFlash(true);
    const t = setTimeout(() => setSavedFlash(false), 1200);
    return () => clearTimeout(t);
  }, [persons]);

  const navigate = useCallback((p: PageId) => setPage(p), []);

  const addPerson = () => {
    setPersons(ps => [...ps, mkPerson(idRef.current++, "", 1980, "siblings")]);
  };
  const removePerson = (id: number) => setPersons(ps => ps.filter(p => p.id !== id));
  const updatePerson = (id: number, field: string, val: unknown) => setPersons(ps => ps.map(p => {
    if (p.id !== id) return p;
    const np: Person = { ...p, [field]: val };
    if (field === "birthYear") {
      const by = Math.max(BY_MIN, Math.min(BY_MAX, val as number));
      np.birthYear = by;
      np.endYear = np.deceased ? by + 70 : by + lifeExp(by);
    }
    if (field === "deceased") {
      if (val === true && np.endYear >= CY) np.endYear = Math.max(np.birthYear + 1, CY - 1);
      if (val === false && np.endYear < CY) np.endYear = np.birthYear + lifeExp(np.birthYear);
    }
    return np;
  }));

  const doReset = () => {
    const fresh = INIT_PERSONS.map((p, i) => ({ ...p, id: i + 1 }));
    idRef.current = 5;
    setPersons(fresh);
    setPage("family");
    saveState({ persons: fresh, page: "family" });
    setResetConfirm(false);
  };

  // Indicateur sauvegarde + reset (visible sur toutes les pages sauf welcome)
  const SaveBar = page !== "welcome" ? (
    <div style={{
      position: "fixed", top: 10, right: 16, display: "flex", gap: 8,
      alignItems: "center", zIndex: 100,
    }}>
      <span style={{ fontSize: 11, color: savedFlash ? "#4ade80" : "#334155", transition: "color .4s", fontWeight: savedFlash ? 600 : 400 }}>
        {savedFlash ? "✓ Sauvegardé" : "● Auto"}
      </span>
      {!resetConfirm ? (
        <button onClick={() => setResetConfirm(true)} style={{ ...S.btnGhost, fontSize: 10, padding: "1px 8px" }}>
          Réinitialiser
        </button>
      ) : (
        <span style={{ display: "flex", alignItems: "center", gap: 5, background: "#0f172a", padding: "3px 8px", borderRadius: 7, border: "1px solid #334155" }}>
          <span style={{ fontSize: 10, color: "#f87171" }}>Tout effacer ?</span>
          <button onClick={doReset} style={{ background: "#7f1d1d", border: "1px solid #f87171", borderRadius: 4, color: "#fca5a5", fontSize: 10, padding: "1px 6px", cursor: "pointer", fontWeight: 600 }}>Oui</button>
          <button onClick={() => setResetConfirm(false)} style={{ background: "none", border: "1px solid #334155", borderRadius: 4, color: "#475569", fontSize: 10, padding: "1px 6px", cursor: "pointer" }}>Non</button>
        </span>
      )}
    </div>
  ) : null;

  return (
    <>
      {SaveBar}
      {page === "welcome" && <PageWelcome onStart={() => navigate("family")} />}
      {page === "family" && (
        <PageFamily
          persons={persons}
          onUpdate={updatePerson}
          onAdd={addPerson}
          onRemove={removePerson}
          onNavigate={navigate}
        />
      )}
      {page === "display" && (
        <PageDisplay
          persons={persons}
          onNavigate={navigate}
        />
      )}
      {page === "cta" && (
        <PageCTA
          persons={persons}
          onNavigate={navigate}
        />
      )}
    </>
  );
}
