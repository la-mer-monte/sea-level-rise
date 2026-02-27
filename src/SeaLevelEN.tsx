import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

// ── DATA ──────────────────────────────────────────────────────────────────────
// ⚠️ Update annually — source: NOAA/UHSLC global tide gauge average
const REF = { year: 2025, sl: 240 };
const CY = REF.year, SL_NOW = REF.sl;
const RATE_CY = 4.5; // mm/yr measured at CY

const BY_MIN = 1900;
const BY_MAX = 2035; // max birth year (future children/grandchildren)

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
  "SSP1-2.6": { color: "#4ade80", label: "Optimistic (+1.5°C)", add: 350 },
  "SSP2-4.5": { color: "#fbbf24", label: "Intermediate (+2-3°C)", add: 470 },
  "SSP5-8.5": { color: "#f87171", label: "High-end (+4-5°C)", add: 680 },
};
const SC_CI: Record<string, { low: number; high: number }> = {
  "SSP1-2.6": { low: 180, high: 490 },
  "SSP2-4.5": { low: 290, high: 650 },
  "SSP5-8.5": { low: 500, high: 930 },
};
const SC_KEYS = Object.keys(SC);
// Alias to work around recharts strict TypeScript overloads on the label prop
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

// Life expectancy — linear interpolation between decennial anchors
const LIFE_ANCHORS: [number, number][] = [
  [1900, 55], [1910, 58], [1920, 62], [1930, 66], [1940, 70],
  [1950, 74], [1960, 78], [1970, 81], [1980, 83], [1990, 85],
  [2000, 87], [2010, 89],
];
function lifeExp(by: number): number {
  if (by <= LIFE_ANCHORS[0][0]) return LIFE_ANCHORS[0][1];
  const last = LIFE_ANCHORS[LIFE_ANCHORS.length - 1];
  if (by >= last[0]) return last[1];
  for (let i = 0; i < LIFE_ANCHORS.length - 1; i++) {
    const [y0, v0] = LIFE_ANCHORS[i], [y1, v1] = LIFE_ANCHORS[i + 1];
    if (by >= y0 && by < y1) return Math.round(v0 + (v1 - v0) * (by - y0) / (y1 - y0));
  }
  return last[1];
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

// ── RELATIONSHIPS ─────────────────────────────────────────────────────────────
const GENS = [
  { id: "arriere", label: "Great-grandparents",         color: "#a78bfa" },
  { id: "grands",  label: "Grandparents",               color: "#60a5fa" },
  { id: "parents", label: "Parents / Uncles / Aunts",   color: "#34d399" },
  { id: "me",      label: "Me",                         color: "#f1f5f9" },
  { id: "siblings",label: "Siblings / Cousins",          color: "#fbbf24" },
  { id: "partner", label: "Partner / Ex-partner",       color: "#fbbf24" },
  { id: "friends", label: "Friends / Acquaintances",    color: "#fbbf24" },
  { id: "children",label: "Children / Nephews / Nieces",color: "#fb923c" },
  { id: "grands2", label: "Grandchildren / Godchildren", color: "#f472b6" },
];
const genColor = (id: string) => GENS.find(g => g.id === id)?.color ?? "#e2e8f0";
const genLabel = (id: string) => GENS.find(g => g.id === id)?.label ?? "";

// ── TYPES ─────────────────────────────────────────────────────────────────────
interface Person {
  id: number;
  name: string;
  birthYear: number;
  endYear: number;
  generation: string;
  deceased: boolean;
}

type PageId = "welcome" | "family" | "display" | "cta";

// ── PERSISTENCE & SHARING ────────────────────────────────────────────────────
const STORAGE_KEY = "sea-level-en-v1";
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveState(data: object) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

function encodeShare(persons: Person[]): string {
  const data = persons.map(p => [p.name, p.birthYear, p.endYear, p.generation, p.deceased ? 1 : 0]);
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}
function decodeShare(hash: string): Person[] | null {
  try {
    const b64 = hash.replace(/^#?share=/, "");
    const data = JSON.parse(decodeURIComponent(escape(atob(b64))));
    if (!Array.isArray(data)) return null;
    return data.map((d: unknown[], i: number) => ({
      id: i + 1,
      name: String(d[0] ?? ""),
      birthYear: Number(d[1]),
      endYear: Number(d[2]),
      generation: String(d[3] ?? "me"),
      deceased: d[4] === 1,
    }));
  } catch { return null; }
}
function readHashShare(): Person[] | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash;
  if (!h.startsWith("#share=")) return null;
  return decodeShare(h);
}

// ── SHARED STYLES ─────────────────────────────────────────────────────────────
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
const MM = FIG_H / 1700;
const Y_REF = 290;

function Silhouette({
  person, scenario, compareAll = false, svgWidth = 120,
}: {
  person: Person; scenario: string; compareAll?: boolean; svgWidth?: number;
}) {
  const { birthYear: rawBy, endYear, name, generation } = person;
  const by = Math.max(BY_MIN, Math.min(BY_MAX, rawBy));
  const s = calcStats(by, endYear);
  const cx = SVG_W / 2;
  const color = genColor(generation);
  const compact = svgWidth < 90;
  const svgH = Math.round(svgWidth * SVG_H / SVG_W);
  const clipId = `clip-en-${person.id}`;

  const riseBirthToNow = SL_NOW - s.slB;
  const feetY = Math.max(FIG_H, Math.min(SVG_H - 5, Y_REF + riseBirthToNow * MM));
  const headY = feetY - FIG_H;
  const hr = 18, hcy = headY + hr, shoulderY = hcy + hr + 5, waistY = shoulderY + 80;

  const fmtCm = (v: number) => `${(v / 10).toFixed(1)} cm`;
  const fmtSub = (v: number) => v >= 10 ? `${(v / 10).toFixed(1)} cm` : `${Math.round(v)} mm`;
  const toCome = s.sc[scenario]?.toCome ?? 0;

  const futureLines = SC_KEYS.map(k => {
    const tc = s.isDead ? 0 : (s.sc[k]?.toCome ?? 0);
    const y = tc > 0 ? Math.max(5, Y_REF - tc * MM) : null;
    return { k, tc, y };
  });

  const yFuture = s.isDead ? null : (toCome > 0 ? Math.max(5, Y_REF - toCome * MM) : null);
  const yDeath = (s.isDead && s.riseSinceDeath > 2)
    ? Math.min(SVG_H - 5, Y_REF + s.riseSinceDeath * MM) : null;

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

        <rect x="0" y={Y_REF} width={SVG_W} height={Math.max(0, feetY - Y_REF)} fill="#3b82f6" opacity="0.38" clipPath={`url(#${clipId})`} />
        <line x1="0" y1={Y_REF} x2={SVG_W} y2={Y_REF} stroke="#93c5fd" strokeWidth="1.8" />
        <text x="2" y={Y_REF - 3} fontSize="7" fill="#93c5fd">Now</text>

        {yDeath !== null && <>
          <line x1="0" y1={yDeath} x2={SVG_W} y2={yDeath} stroke="#f97316" strokeWidth="1" strokeDasharray="4,3" />
          {!compact && <text x={SVG_W - 2} y={yDeath - 2} textAnchor="end" fontSize="6.5" fill="#f97316">✝{endYear}: +{fmtCm(s.lived)}</text>}
        </>}

        {!compact && feetY < SVG_H - 5 && <>
          <line x1="0" y1={feetY} x2={SVG_W} y2={feetY} stroke="#475569" strokeWidth="0.8" strokeDasharray="2,2" />
          <text x="2" y={Math.min(feetY - 2, SVG_H - 5)} fontSize="6.5" fill="#475569">{by}: 0</text>
        </>}

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

      <div style={{ fontSize: compact ? 9 : 10, color: "#94a3b8", textAlign: "center", lineHeight: 1.7 }}>
        {s.isDead ? (
          <span style={{ color: "#60a5fa", fontWeight: 700, fontSize: compact ? 10 : 12 }}>+{fmtSub(s.lived)}</span>
        ) : <>
          <div style={{ fontSize: compact ? 10 : 12, fontWeight: 800, color: "#e2e8f0", lineHeight: 1.2 }}>
            +{fmtSub(compareAll ? s.sc["SSP2-4.5"].total : s.sc[scenario].total)}
          </div>
          <div style={{ fontSize: 8, color: "#475569", marginBottom: 1 }}>
            over lifetime{compareAll ? " (ref. SSP2)" : ""}
          </div>
          {!compact && <div style={{ fontSize: 9 }}>
            <span style={{ color: "#60a5fa" }}>+{fmtSub(s.lived)}</span>
            <span style={{ color: "#475569" }}> lived · </span>
            {toCome > 0 && <span style={{ color: SC[scenario].color }}>+{fmtSub(toCome)}</span>}
            {toCome > 0 && <span style={{ color: "#475569" }}> ahead</span>}
          </div>}
        </>}
        {s.isDead && s.riseSinceDeath > 0 && !compact && <>
          <br />
          <span style={{ color: "#f97316", fontSize: 9 }}>+{fmtSub(s.riseSinceDeath)}</span>
          <span style={{ color: "#475569", fontSize: 9 }}> since ✝</span>
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
        {person.birthYear}–{person.endYear} · {person.endYear - person.birthYear} yrs{s.isDead ? " (deceased)" : ""}
      </div>

      {s.isDead ? <>
        <div style={{ marginBottom: s.riseSinceDeath > 0 ? 8 : 12 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
            Rise experienced ({person.birthYear}–{person.endYear})
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#60a5fa" }}>
            +{(s.lived / 10).toFixed(1)} cm
            <span style={{ fontSize: 11, fontWeight: 400, color: "#64748b", marginLeft: 6 }}>{Math.round(s.lived)} mm</span>
          </div>
        </div>
        {s.riseSinceDeath > 0 && (
          <div style={{ marginBottom: 12, padding: "7px 10px", background: "#0f172a", borderRadius: 8, border: "1px solid #f9741330", fontSize: 11 }}>
            <span style={{ color: "#f97316" }}>+{(s.riseSinceDeath / 10).toFixed(1)} cm</span>
            <span style={{ color: "#64748b" }}> ({Math.round(s.riseSinceDeath)} mm) additional rise since ✝{person.endYear}</span>
          </div>
        )}
      </> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: "#0f172a", borderRadius: 8, padding: "10px 12px", border: "1px solid #1e4080" }}>
            <div style={{ fontSize: 10, color: "#60a5fa", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
              Already experienced ({person.birthYear}→{CY})
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#60a5fa", lineHeight: 1.1 }}>
              +{(s.lived / 10).toFixed(1)} cm
              <span style={{ fontSize: 12, fontWeight: 400, color: "#475569", marginLeft: 8 }}>{Math.round(s.lived)} mm</span>
            </div>
            <div style={{ fontSize: 11, color: "#334155", marginTop: 2 }}>
              measured rise since birth — identical across all scenarios
            </div>
          </div>

          <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: -4 }}>
            Still ahead ({CY}→{person.endYear}) by scenario
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {SC_KEYS.map(k => (
              <div key={k} style={{ background: "#0f172a", borderRadius: 8, padding: "8px 6px", textAlign: "center", border: `2px solid ${SC[k].color}55` }}>
                <div style={{ fontSize: 9, color: SC[k].color, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{k}</div>
                <div style={{ fontSize: 9, color: "#64748b", marginBottom: 1 }}>over lifetime</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#e2e8f0", lineHeight: 1.05 }}>
                  +{(s.sc[k].total / 10).toFixed(1)} cm
                </div>
                <div style={{ fontSize: 9, color: "#334155", marginBottom: 8 }}>{Math.round(s.sc[k].total)} mm</div>
                <div style={{ borderTop: "1px solid #1e293b", paddingTop: 6 }}>
                  <div style={{ fontSize: 9, color: "#64748b", marginBottom: 1 }}>of which ahead</div>
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

// ── PERSON FORM ───────────────────────────────────────────────────────────────
function PersonForm({
  p, onUpdate, onRemove, canRemove,
}: {
  p: Person; onUpdate: (f: string, v: unknown) => void; onRemove: () => void; canRemove: boolean;
}) {
  const color = genColor(p.generation);
  const isFuture = p.birthYear > CY;

  const [byRaw, setByRaw] = useState(String(p.birthYear));
  const [endRaw, setEndRaw] = useState(String(p.endYear));

  // Sync endRaw when birthYear or deceased changes from parent
  useEffect(() => { setEndRaw(String(p.endYear)); }, [p.endYear, p.deceased]);
  const prevById = useRef(p.id);
  useEffect(() => {
    if (prevById.current !== p.id) {
      prevById.current = p.id;
      setByRaw(String(p.birthYear));
      setEndRaw(String(p.endYear));
    }
  });

  const byRawAsNum = parseInt(byRaw);
  const externalChanged = !isNaN(byRawAsNum) && byRawAsNum !== p.birthYear
    && document.activeElement?.getAttribute("data-by-id") !== String(p.id);
  const displayBy = externalChanged ? String(p.birthYear) : byRaw;

  const commitBirthYear = (raw: string) => {
    const v = parseInt(raw);
    if (isNaN(v)) { setByRaw(String(p.birthYear)); return; }
    const clamped = Math.max(BY_MIN, Math.min(BY_MAX, v));
    setByRaw(String(clamped));
    onUpdate("birthYear", clamped);
  };

  const commitEndYear = (raw: string) => {
    const v = parseInt(raw);
    if (isNaN(v)) { setEndRaw(String(p.endYear)); return; }
    const min = p.birthYear + 1;
    const max = p.deceased ? CY - 1 : 2125;
    const clamped = Math.max(min, Math.min(max, v));
    setEndRaw(String(clamped));
    onUpdate("endYear", clamped);
  };

  const byCommitted = parseInt(byRaw);
  const byError = (!isNaN(byCommitted) && (byCommitted < BY_MIN || byCommitted > BY_MAX))
    ? `Between ${BY_MIN} and ${BY_MAX}` : null;
  const endError = !byError && p.endYear <= p.birthYear ? "Must be after birth year" : null;

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
        placeholder="First name / name"
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
          {p.deceased ? "✝ Deceased" : "Living"}
        </button>
        {isFuture
          ? <span style={{ fontSize: 9, color: "#334155" }}>— future birth</span>
          : <span style={{ fontSize: 9, color: "#475569" }}>— click to change</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
        <div>
          <div style={S.label}>Birth year ({BY_MIN}–{BY_MAX})</div>
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
            <div style={{ ...S.label, color: "#f97316" }}>Year of death</div>
            <input
              type="number" min={p.birthYear + 1} max={CY - 1}
              value={endRaw}
              onChange={e => setEndRaw(e.target.value)}
              onBlur={e => commitEndYear(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commitEndYear((e.target as HTMLInputElement).value); }}
              style={{ ...S.inputBase, border: "1px solid #f9741366", color: "#f97316" }}
            />
          </> : <>
            <div style={S.label}>Projection horizon</div>
            <input
              type="number" min={Math.max(CY, p.birthYear + 1)} max={2125}
              value={endRaw}
              onChange={e => setEndRaw(e.target.value)}
              onBlur={e => commitEndYear(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commitEndYear((e.target as HTMLInputElement).value); }}
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
  { id: "welcome", label: "Home" },
  { id: "family",  label: "My people" },
  { id: "display", label: "Results" },
  { id: "cta",     label: "Understand & act" },
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

// ── CALL TO ACTION component ──────────────────────────────────────────────────
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
        🌿 What these numbers mean in practice
      </div>
      {(moiInfo || youngestInfo) ? (
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 12, color: "#86efac", lineHeight: 1.8, margin: "0 0 10px 0" }}>
            Collective emission choices made between now and 2040 will determine which
            scenario the generations shown here actually live through. Here is what the
            difference between{" "}
            <strong style={{ color: "#fbbf24" }}>SSP2-4.5</strong> and{" "}
            <strong style={{ color: "#f87171" }}>SSP5-8.5</strong> means concretely:
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {moiInfo && (
              <div style={{ background: "#0a1f0e", border: "1px solid #166534", borderRadius: 8, padding: "10px 14px", flex: "1 1 200px" }}>
                <div style={{ fontSize: 11, color: moiInfo.color, fontWeight: 700, marginBottom: 4 }}>{moiInfo.name}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>
                  Over a lifetime: <span style={{ color: "#fbbf24" }}>{moiInfo.total25} cm</span> (SSP2)
                  {" vs "}<span style={{ color: "#f87171" }}>{moiInfo.total85} cm</span> (SSP5)
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>+{(moiInfo.diffMm / 10).toFixed(1)} cm</div>
                <div style={{ fontSize: 10, color: "#4ade80" }}>difference over their entire life</div>
              </div>
            )}
            {youngestInfo && (
              <div style={{ background: "#0a1f0e", border: "1px solid #166534", borderRadius: 8, padding: "10px 14px", flex: "1 1 200px" }}>
                <div style={{ fontSize: 11, color: youngestInfo.color, fontWeight: 700, marginBottom: 4 }}>{youngestInfo.name}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>
                  Over a lifetime: <span style={{ color: "#fbbf24" }}>{youngestInfo.total25} cm</span> (SSP2)
                  {" vs "}<span style={{ color: "#f87171" }}>{youngestInfo.total85} cm</span> (SSP5)
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>+{(youngestInfo.diffMm / 10).toFixed(1)} cm</div>
                <div style={{ fontSize: 10, color: "#f472b6" }}>difference over their entire life</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "#86efac", lineHeight: 1.8, margin: "0 0 14px 0" }}>
          The difference between SSP2-4.5 and SSP5-8.5 represents <strong style={{ color: "#fff" }}>20 to 30 cm</strong> of
          additional rise by 2100. Decisions made between 2025 and 2040 will determine
          which scenario the generations shown here live through.
        </p>
      )}
    </div>
  );
}

// ── SOURCES BLOCK ─────────────────────────────────────────────────────────────
function SourcesBlock() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ color: "#475569", fontSize: 12, margin: "0 0 4px" }}>
        Data sources
        <button onClick={() => setOpen(v => !v)} style={{ ...S.btnGhost, marginLeft: 10, fontSize: 11, padding: "2px 8px" }}>
          {open ? "▲ Collapse" : "▼ Details"}
        </button>
      </p>
      {open && (
        <div style={{ ...S.card, fontSize: 12, color: "#94a3b8", lineHeight: 1.8 }}>
          <strong style={{ color: "#e2e8f0" }}>Historical data (1880–2025)</strong><br />
          Church, J.A. & White, N.J. (2011). <em>Sea-Level Rise from the Late 19th to the Early 21st Century.</em>{" "}
          Surveys in Geophysics, 32(4–5), 585–602. CSIRO data, annually averaged, baseline 1900 = 0 mm.<br />
          Satellite (1993–2025): NOAA / University of Hawaii Sea Level Center (UHSLC),
          weighted average of 373 global tide gauges.<br /><br />
          <strong style={{ color: "#e2e8f0" }}>Future projections (2025–2100)</strong><br />
          IPCC AR6 WGI (2021), Chapter 9. Medians of SSP1-2.6, SSP2-4.5 and SSP5-8.5 scenarios.
          Confidence intervals represent the "likely" range (17th–83rd percentile).<br /><br />
          <strong style={{ color: "#e2e8f0" }}>Life expectancy</strong><br />
          Estimates based on historical mortality tables for Western Europe (Eurostat, national statistical offices).
          The projection horizon is initialised to estimated life expectancy but can be adjusted freely —
          it represents the year up to which sea level rise is projected for each person.
        </div>
      )}
    </div>
  );
}

// ── PAGE 1 : WELCOME ──────────────────────────────────────────────────────────
function PageWelcome({ onStart }: { onStart: () => void }) {
  return (
    <div style={{
      minHeight: "100vh", background: "#0f172a", color: "#e2e8f0",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: 660, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: 56, marginBottom: 16, lineHeight: 1 }}>🌊</div>
          <h1 style={{ fontSize: 40, fontWeight: 900, margin: "0 0 16px", letterSpacing: "-1px", lineHeight: 1.05 }}>
            The sea is rising
          </h1>
          <p style={{ fontSize: 17, color: "#94a3b8", lineHeight: 1.75, margin: "0 0 16px" }}>
            Since 1900, average ocean levels have risen by{" "}
            <span style={{ color: "#60a5fa", fontWeight: 700 }}>24 cm</span>.
            By 2100, they are projected to rise a further{" "}
            <span style={{ color: "#4ade80", fontWeight: 700 }}>35 cm</span> to{" "}
            <span style={{ color: "#f87171", fontWeight: 700 }}>68 cm</span>{" "}
            on top of that.
          </p>
          <p style={{ fontSize: 16, color: "#e2e8f0", lineHeight: 1.75, margin: "0 0 12px", fontWeight: 500 }}>
            But 2100 feels far away, doesn't it?
          </p>
          <p style={{ fontSize: 15, color: "#64748b", lineHeight: 1.75, margin: 0 }}>
            That depends on who you are. Children born today will live past that date.
            Enter the names and birth years of the people who matter to you.
            Find out how many centimetres the ocean will have risen over the course of their lives.
          </p>
        </div>

        {/* Scenario preview */}
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
              <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>IPCC AR6 median by 2100</div>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div style={{ ...S.card, marginBottom: 32, fontSize: 13, color: "#94a3b8", lineHeight: 1.75 }}>
          <strong style={{ color: "#e2e8f0" }}>How it works —</strong>{" "}
          Enter information about the people close to you (first name, birth year, your relationship to them).
          The app will show the sea level rise they have already experienced and, where applicable,
          calculate what they will still live through — across three IPCC climate scenarios.
          Silhouettes allow you to visualise this rise relative to each person's height.
        </div>

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
            Get started →
          </button>
          <div style={{ marginTop: 16, fontSize: 11, color: "#334155" }}>
            Your data stays on your device · Auto-saved
          </div>
        </div>

        <div style={{ marginTop: 40, textAlign: "center", fontSize: 11, color: "#1e293b" }}>
          Sources: Church & White (2011) · CSIRO · UHSLC/NOAA · IPCC AR6 (2021)
        </div>
      </div>
    </div>
  );
}

// ── PAGE 2 : MY PEOPLE ────────────────────────────────────────────────────────
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
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>👨‍👩‍👧‍👦 My family & close ones</h2>
        </div>

        <div style={{ ...S.card, marginBottom: 16, fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
          <strong style={{ color: "#e2e8f0" }}>💡 How to fill in —</strong>{" "}
          Enter the first name, birth year (between {BY_MIN} and {BY_MAX}) and your relationship
          to each person. <strong style={{ color: "#e2e8f0" }}>Future births</strong> are accepted
          (children or grandchildren yet to be born). For <strong style={{ color: "#f97316" }}>deceased</strong> people,
          enter the year of death. For living people, the{" "}
          <strong style={{ color: "#e2e8f0" }}>projection horizon</strong> can be adjusted freely
          (initialised to estimated life expectancy).
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>
            {persons.length} person{persons.length > 1 ? "s" : ""} ·
          </span>
          <button onClick={onAdd} style={{ ...S.btnPrimary, padding: "5px 14px", fontSize: 12 }}>
            + Add a person
          </button>
          <button onClick={() => setShowLegend(v => !v)} style={{ ...S.btnGhost, fontSize: 11, padding: "3px 10px" }}>
            {showLegend ? "▲ Legend" : "▼ Relationship legend"}
          </button>
        </div>

        {showLegend && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {GENS.map(g => (
              <span key={g.id} style={S.badge(g.color)}>{g.label}</span>
            ))}
          </div>
        )}

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

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => onNavigate("display")}
            style={{ ...S.btnPrimary, fontSize: 14, padding: "10px 28px", borderRadius: 10 }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "#2563eb"}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "#3b82f6"}
          >
            See results →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SHARE BUTTON ──────────────────────────────────────────────────────────────
function ShareButton({ persons }: { persons: Person[] }) {
  const [copied, setCopied] = useState(false);
  const share = () => {
    const url = `${window.location.origin}${window.location.pathname}#share=${encodeShare(persons)}`;
    navigator.clipboard.writeText(url).then(() => {
      window.location.hash = `share=${encodeShare(persons)}`;
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {
      window.location.hash = `share=${encodeShare(persons)}`;
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };
  return (
    <button onClick={share} style={{
      background: copied ? "#14532d" : "#1e293b",
      border: `1px solid ${copied ? "#4ade80" : "#334155"}`,
      borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600,
      color: copied ? "#4ade80" : "#94a3b8", cursor: "pointer",
      transition: "all .2s", display: "flex", alignItems: "center", gap: 6,
    }}>
      {copied ? "✓ Link copied!" : "🔗 Share this family"}
    </button>
  );
}

// ── PAGE 3 : RESULTS ──────────────────────────────────────────────────────────
function PageDisplay({
  persons, onNavigate, isShared, onReset,
}: {
  persons: Person[]; onNavigate: (p: PageId) => void;
  isShared: boolean; onReset: () => void;
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

  const compareWarning = useMemo(() => {
    if (!compareAll) return false;
    return sorted.some(p => {
      if (p.deceased || p.endYear <= CY) return false;
      const s = calcStats(p.birthYear, p.endYear);
      const tc1 = s.sc["SSP1-2.6"].toCome;
      const tc5 = s.sc["SSP5-8.5"].toCome;
      return Math.abs(tc5 - tc1) * MM < 20;
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

        {isShared && (
          <div style={{
            background: "#0a2a0a", border: "1px solid #166534", borderRadius: 10,
            padding: "12px 16px", marginBottom: 16,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}>
            <span style={{ fontSize: 13, color: "#4ade80" }}>🔗 You are viewing a shared family.</span>
            <button onClick={() => onNavigate("family")} style={{ ...S.btnGhost, fontSize: 11, padding: "3px 10px", color: "#86efac", borderColor: "#166534" }}>
              ✏️ Edit
            </button>
            <button onClick={onReset} style={{ ...S.btnGhost, fontSize: 11, padding: "3px 10px", color: "#86efac", borderColor: "#166534" }}>
              🔄 Start my own
            </button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>📊 Results</h2>
          <button onClick={() => onNavigate("family")} style={{ ...S.btnGhost, fontSize: 12 }}>
            ← Edit people
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {tabBtn("stats", "📊 Key figures")}
          {tabBtn("silhouettes", "🧍 Silhouettes")}
        </div>

        {/* ── KEY FIGURES ── */}
        {tab === "stats" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginBottom: 24 }}>
              {sorted.map(p => <StatCard key={p.id} person={p} />)}
            </div>
            <div style={S.card}>
              <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>
                Sea level change 1900–2100 (cm above 1900 baseline)
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
                Church & White (2011) + UHSLC/NOAA · IPCC AR6 median projections + confidence intervals (thin lines)
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="yr"
                    type="number"
                    domain={[1900, 2100]}
                    stroke="#475569"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    ticks={[1900, 1920, 1940, 1960, 1980, 2000, 2020, 2040, 2060, 2080, 2100]}
                  />
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
                    labelFormatter={v => `Year ${v}`}
                    formatter={(v: number, n: string) => [`${(v / 10).toFixed(1)} cm`, n]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine x={CY} stroke="#475569" strokeDasharray="4,3"
                    label={{ value: "↑ Now", fill: "#64748b", fontSize: 9, position: "insideTopLeft" }} />
                  <Line dataKey="hist" name="Historical" stroke="#60a5fa" strokeWidth={2.5} dot={false} connectNulls={false} />
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

            <SourcesBlock />
          </div>
        )}

        {/* ── SILHOUETTES ── */}
        {tab === "silhouettes" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
              {!compareAll && SC_KEYS.map(k => (
                <button key={k} onClick={() => setScenario(k)} style={{
                  padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12,
                  border: `2px solid ${scenario === k ? SC[k].color : "#334155"}`,
                  background: scenario === k ? SC[k].color + "22" : "#1e293b",
                  color: scenario === k ? SC[k].color : "#94a3b8", transition: "all .2s",
                }}>{k} — {SC[k].label}</button>
              ))}
              <button
                onClick={() => setCompareAll(v => !v)}
                style={{
                  padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12,
                  border: `2px solid ${compareAll ? "#a78bfa" : "#334155"}`,
                  background: compareAll ? "#a78bfa22" : "#1e293b",
                  color: compareAll ? "#a78bfa" : "#94a3b8", transition: "all .2s",
                }}>
                {compareAll ? "✦ Overlay active" : "⊞ Overlay all 3 scenarios"}
              </button>
            </div>

            {compareWarning && (
              <div style={{
                background: "#1c1207", border: "1px solid #92400e", borderRadius: 8,
                padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#fbbf24", lineHeight: 1.6,
              }}>
                ⚠️ <strong>Reduced readability</strong> — For people whose projection horizon is close
                to {CY}, the three scenarios have not yet diverged significantly:
                future lines will appear grouped together. Extend the horizon or read figures in "Key figures" mode.
              </div>
            )}

            <div style={{ ...S.card, marginBottom: 16, fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
              All silhouettes are aligned on the{" "}
              <span style={{ color: "#93c5fd" }}>blue line (today's sea level)</span>.
              Feet are positioned at the sea level at birth.
              The further back someone was born, the deeper their feet sink below today's waterline.
              {compareAll
                ? <> In overlay mode, <span style={{ color: "#4ade80" }}>green</span> / <span style={{ color: "#fbbf24" }}>yellow</span> / <span style={{ color: "#f87171" }}>red</span> dashed lines show the three future levels.</>
                : <> The coloured dashed line shows the projected level at each person's horizon.</>}
            </div>

            <div ref={silContainerRef}>
              {silGroups.map((grp, gi) => (
                <div key={gi} style={{ marginBottom: gi < silGroups.length - 1 ? 32 : 0 }}>
                  {silGroups.length > 1 && (
                    <div style={{ fontSize: 11, color: "#475569", marginBottom: 8, textAlign: "center" }}>
                      — Group {gi + 1} / {silGroups.length} —
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
              Scale: silhouette = 170 cm · 1 px ≈ 6 mm of sea level rise · Sorted by birth year
            </div>
          </div>
        )}

        <div style={{ marginTop: 32, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <button onClick={() => onNavigate("family")} style={{ ...S.btnGhost }}>
            ← Edit people
          </button>
          <ShareButton persons={persons} />
          <button onClick={() => onNavigate("cta")} style={{
            ...S.btnPrimary, background: "#14532d", border: "1px solid #166534",
            color: "#4ade80", fontSize: 13,
          }}>
            🌿 Understand & act →
          </button>
        </div>

        <div style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 20 }}>
          Data: Church & White (2011) · CSIRO/UHSLC · NOAA (satellite 1993–2025) · IPCC AR6 WGI (2021)
        </div>
      </div>
    </div>
  );
}

// ── PAGE 4 : UNDERSTAND & ACT ─────────────────────────────────────────────────
function PageCTA({ persons, onNavigate }: { persons: Person[]; onNavigate: (p: PageId) => void }) {
  const sorted = useMemo(() => [...persons].sort((a, b) => a.birthYear - b.birthYear), [persons]);

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

        {/* ── INTRO: current trajectory ── */}
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 12px" }}>🌿 Understand & act</h2>
          <div style={{ ...S.card, fontSize: 13, color: "#94a3b8", lineHeight: 1.8 }}>
            <strong style={{ color: "#e2e8f0" }}>Where do we stand today?</strong>{" "}
            With current climate policies, global emission trajectories fall somewhere between the{" "}
            <span style={{ color: SC["SSP2-4.5"].color, fontWeight: 600 }}>SSP2-4.5</span> and{" "}
            <span style={{ color: SC["SSP5-8.5"].color, fontWeight: 600 }}>SSP5-8.5</span> scenarios.
            We are not on track for the optimistic pathway, but nothing is locked in:
            energy investment decisions and climate policies made{" "}
            <strong style={{ color: "#e2e8f0" }}>between 2025 and 2040</strong> will determine
            which trajectory the generations shown here actually live through.
          </div>
        </div>

        {/* ── WHAT DOES IT MEAN IN PRACTICE ── */}
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 12px", color: "#e2e8f0" }}>
            🌊 What does a rise of a few tens of centimetres actually mean?
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              {
                icon: "📏",
                title: "More frequent and more extensive flooding",
                body: "Mean sea level rise stacks on top of tides and storm surges. A baseline raised by 30 cm turns a once-in-a-century flood into a once-in-a-decade event. In the North Sea region, storm surges already affect millions of people; this baseline shift dramatically changes risk exposure for the Netherlands, Germany, Denmark and the UK.",
              },
              {
                icon: "🏖️",
                title: "Accelerated coastal erosion",
                body: "A 10 cm rise in mean sea level shifts the shoreline inland by several metres to several tens of metres depending on beach slope. Sandy Atlantic coasts (France, Portugal, Ireland, the Netherlands), exposed Baltic shores and low-lying Mediterranean deltas (Po, Ebro, Nile) face the fastest losses.",
              },
              {
                icon: "🧂",
                title: "Saltwater intrusion into wetlands and aquifers",
                body: "Coastal marshes, estuaries and wetlands see salinity increase. Freshwater coastal aquifers can become contaminated. Agricultural land, drinking water supply and biodiversity in these zones are directly affected — from the Camargue to the Wadden Sea.",
              },
              {
                icon: "🏘️",
                title: "Infrastructure and populations at risk",
                body: "Around 40 million Europeans live in coastal flood-risk zones. This includes residential areas, transport networks, ports, and industrial sites. Cities such as Venice, Rotterdam, Amsterdam, Hamburg, and dozens of smaller coastal towns face growing adaptation costs.",
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

        {/* ── SCENARIO DIFFERENCE ── */}
        <div style={{ background: "#0f2a1a", border: "1px solid #166534", borderRadius: 12, padding: 20, marginBottom: 28 }}>
          <CallToAction sorted={sorted} />
        </div>

        {/* ── MITIGATION & ADAPTATION ── */}
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 12px", color: "#e2e8f0" }}>
            🛠️ Two complementary levers: mitigation and adaptation
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ ...S.card, border: "1px solid #3b82f633" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa", marginBottom: 8 }}>
                Mitigation
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
                Reducing greenhouse gas emissions to limit the extent of warming and thus of long-term sea level rise. Energy transition, efficiency, behavioural change. The EU's Fit for 55 package and national climate plans aim here.
                <div style={{ marginTop: 8, padding: "6px 8px", background: "#0f172a", borderRadius: 6, fontSize: 11, color: "#475569" }}>
                  Acts on <strong style={{ color: "#60a5fa" }}>future levels</strong> — benefits materialise over decades.
                </div>
              </div>
            </div>
            <div style={{ ...S.card, border: "1px solid #f9741333" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fb923c", marginBottom: 8 }}>
                Adaptation
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
                Organising to live with levels already committed: coastal defences, managed retreat, preserving natural buffer zones (dunes, salt marshes, seagrass beds). A mandatory consideration regardless of emission trajectory.
                <div style={{ marginTop: 8, padding: "6px 8px", background: "#0f172a", borderRadius: 6, fontSize: 11, color: "#475569" }}>
                  Acts on <strong style={{ color: "#fb923c" }}>present vulnerability</strong> — necessary under all scenarios.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── RESOURCES: VISUALISE COASTAL IMPACTS ── */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#4ade80", marginBottom: 10 }}>
            🗺️ Visualise coastal impacts across Europe
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <LinkCard
              icon="🗺️"
              label="CoCliCo — European Coastal Flood Risk Viewer"
              desc="Copernicus-funded interactive viewer showing coastal flood exposure across Europe under different sea level rise scenarios. Country-by-country and local-scale data."
              url="https://coclicoservices.eu/"
              color="#4ade80"
              tag="Interactive · European"
            />
            <LinkCard
              icon="🌐"
              label="Climate Central — Coastal Risk Screening Tool"
              desc="Enter any coastal city or region worldwide and visualise areas exposed to sea level rise and storm surges. Includes European coastlines with detailed elevation data."
              url="https://coastal.climatecentral.org/"
              color="#4ade80"
              tag="Interactive · Global"
            />
            <LinkCard
              icon="🌊"
              label="PSMSL — Permanent Service for Mean Sea Level"
              desc="The global reference archive for tide gauge data, including all European stations. Access long-term sea level records for any coastal location."
              url="https://www.psmsl.org/"
              color="#60a5fa"
              tag="Tide gauge data · Global"
            />
          </div>
        </div>

        {/* ── RESOURCES: GO FURTHER ── */}
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fbbf24", marginBottom: 10 }}>
            📚 Go further
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <LinkCard
              icon="📊"
              label="IPCC AR6 — Summary for Policymakers"
              desc="The authoritative scientific reference on climate change, including sea level rise projections by scenario and region up to 2100 and beyond."
              url="https://www.ipcc.ch/report/ar6/wg1/chapter/summary-for-policymakers/"
              color="#fbbf24"
              tag="Scientific report"
            />
            <LinkCard
              icon="🌦️"
              label="Copernicus Climate Change Service (C3S)"
              desc="EU's official portal for regionalised climate projections across Europe. Includes sea level, temperature, precipitation and marine indicators across EURO-CORDEX scenarios."
              url="https://climate.copernicus.eu/"
              color="#fbbf24"
              tag="EU · Regional projections"
            />
            <LinkCard
              icon="🌿"
              label="MANABAS COAST — Nature-based coastal adaptation (North Sea)"
              desc="Interreg North Sea Programme project mainstreaming Nature-based Solutions for coastal flood and erosion risk management. Partners from Sweden, Denmark, Germany, Netherlands, Belgium and France. Runs 2022–2027."
              url="https://www.interregnorthsea.eu/manabas-coast"
              color="#34d399"
              tag="Adaptation · Interreg EU"
            />
            <LinkCard
              icon="🏛️"
              label="EEA Climate-ADAPT — European Adaptation Platform"
              desc="European Environment Agency's knowledge platform on climate change adaptation: country profiles, case studies, policy tools and adaptation strategies across all EU member states."
              url="https://climate-adapt.eea.europa.eu/"
              color="#34d399"
              tag="Adaptation · EU policy"
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <button onClick={() => onNavigate("display")} style={{ ...S.btnGhost }}>
            ← Back to results
          </button>
          <button onClick={() => onNavigate("family")} style={{ ...S.btnGhost }}>
            ✏️ Edit people
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
  mkPerson(1, "Me", 1985, "me"),
  mkPerson(2, "", 1955, "parents"),
  mkPerson(3, "", 2010, "children"),
  mkPerson(4, "", 2022, "grands2"),
];

export default function App() {
  const hashPersons = readHashShare();
  const saved = hashPersons ? null : loadState();

  const [isShared, setIsShared] = useState(!!hashPersons);
  const [page, setPage] = useState<PageId>(hashPersons ? "display" : (saved?.page === "display" ? "display" : "welcome"));
  const [persons, setPersons] = useState<Person[]>(() =>
    hashPersons ?? (saved?.persons?.length ? saved.persons : INIT_PERSONS)
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const idRef = useRef(Math.max(...((hashPersons ?? saved?.persons)?.map((p: Person) => p.id) ?? [4]), 4) + 1);

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
    setIsShared(false);
    window.location.hash = "";
    saveState({ persons: fresh, page: "family" });
    setResetConfirm(false);
  };

  const SaveBar = page !== "welcome" ? (
    <div style={{
      position: "fixed", top: 10, right: 16, display: "flex", gap: 8,
      alignItems: "center", zIndex: 100,
    }}>
      <span style={{ fontSize: 11, color: savedFlash ? "#4ade80" : "#334155", transition: "color .4s", fontWeight: savedFlash ? 600 : 400 }}>
        {savedFlash ? "✓ Saved" : "● Auto"}
      </span>
      {!resetConfirm ? (
        <button onClick={() => setResetConfirm(true)} style={{ ...S.btnGhost, fontSize: 10, padding: "1px 8px" }}>
          Reset
        </button>
      ) : (
        <span style={{ display: "flex", alignItems: "center", gap: 5, background: "#0f172a", padding: "3px 8px", borderRadius: 7, border: "1px solid #334155" }}>
          <span style={{ fontSize: 10, color: "#f87171" }}>Clear all?</span>
          <button onClick={doReset} style={{ background: "#7f1d1d", border: "1px solid #f87171", borderRadius: 4, color: "#fca5a5", fontSize: 10, padding: "1px 6px", cursor: "pointer", fontWeight: 600 }}>Yes</button>
          <button onClick={() => setResetConfirm(false)} style={{ background: "none", border: "1px solid #334155", borderRadius: 4, color: "#475569", fontSize: 10, padding: "1px 6px", cursor: "pointer" }}>No</button>
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
          isShared={isShared}
          onReset={doReset}
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
