import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Cell, ReferenceLine,
  LineChart, Line, Legend, AreaChart, Area,
} from "recharts";

/* ------------------------------------------------------------------
   Perzistence: ve standalone webu nahrazuje artefaktové window.storage
   jednoduchým úložištěm nad localStorage (per prohlížeč/uživatel).
------------------------------------------------------------------ */
if (typeof window !== "undefined" && !window.storage) {
  const KP = "movit::";
  window.storage = {
    async get(key) { const v = localStorage.getItem(KP + key); return v === null ? null : { key, value: v }; },
    async set(key, value) { localStorage.setItem(KP + key, value); return { key, value }; },
    async delete(key) { localStorage.removeItem(KP + key); return { key, deleted: true }; },
    async list(prefix = "") {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(KP + prefix)) keys.push(k.slice(KP.length));
      }
      return { keys, prefix };
    },
  };
}

/* ============================================================
   MOVit Energy — Portfolio Console
   Řízení vývoje produktového portfolia
   ============================================================ */

const VAT = 1.12; // 12% DPH (doplňky stravy)
const PHASES = ["Nápad", "Rešerše", "Kalkulace", "Rozhodnutí", "Výroba", "On market"];
const VERDICTS = ["", "Go", "Hold", "No-go"];
const SERIES = [
  "Prémiové produkty", "Vitamíny & minerály", "Rostlinné extrakty", "Probiotika",
  "Longevity", "Beauty", "Houby", "PET", "CBD", "Spánek", "—",
];
const SCORE_DEFS = [
  { k: "s1", label: "Marže", w: 2.5, hint: "Ziskovost produktu" },
  { k: "s2", label: "Náročnost", w: 1.5, hint: "Snadnost výroby / vývoje" },
  { k: "s3", label: "Rychlost", w: 1.5, hint: "Rychlost uvedení na trh" },
  { k: "s4", label: "Velikost trhu", w: 2.5, hint: "Potenciál poptávky" },
  { k: "s5", label: "MOVit Fit", w: 2, hint: "Soulad se značkou" },
];
const RISK_DEFS = [
  { k: "r1", label: "Regulace", w: 2 },
  { k: "r2", label: "Dostupnost", w: 3 },
  { k: "r3", label: "Trendy", w: 1 },
  { k: "r4", label: "Kanibalizace", w: 1 },
  { k: "r5", label: "Konkurence", w: 3 },
];
const STOP_DEFS = [
  { k: "M", label: "Marže", hint: "Nedostatečná marže / ekonomicky nevýhodné" },
  { k: "K", label: "Kanibalizace", hint: "Konkuruje vlastnímu portfoliu" },
  { k: "D", label: "Dostupnost", hint: "Surovina nebo výrobce nedostupný" },
  { k: "R", label: "Regulace", hint: "Regulační či legislativní překážka" },
  { k: "C", label: "Konkurence", hint: "Silná tržní konkurence" },
];

/* ---------- konfigurace scoringu (dle zdrojových dat, editovatelné) ---------- */
const DEFAULT_SCORING = {
  scoreW: { s1: 2.5, s2: 1.5, s3: 1.5, s4: 2.5, s5: 2 },
  riskW: { r1: 2, r2: 3, r3: 1, r4: 1, r5: 3 },
  goMin: 70, holdMin: 55,
};
let SCORING = JSON.parse(JSON.stringify(DEFAULT_SCORING));
const setScoringConfig = (cfg) => { SCORING = cfg; };

/* ---------- účty & role ---------- */
const ROLES = {
  admin: { label: "Administrátor", desc: "Plný přístup – editace, mazání i obnova dat" },
  readonly: { label: "Pouze náhled", desc: "Bez editace; smí pouze přidat nový produkt" },
};
const DEFAULT_ACCOUNTS = [
  { username: "admin", password: "admin", role: "admin", name: "Administrátor" },
  { username: "nahled", password: "nahled", role: "readonly", name: "Náhledový uživatel" },
];
const initials = (name) => (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/* ---------- compute helpers ---------- */
const n = (v) => (v === null || v === undefined || v === "" || isNaN(v) ? null : Number(v));
function derive(p) {
  const vyr = n(p.vyrobniCena), moq = n(p.moq), dmoc = n(p.dmoc), voc = n(p.voc);
  const vstupniNaklad = vyr != null && moq != null ? Math.round(vyr * moq) : null;
  let marzeEshop = null;
  if (vyr != null && dmoc != null && dmoc > 0) {
    const bez = dmoc / VAT;
    marzeEshop = (bez - vyr) / bez;
  }
  let marzeB2B = null;
  if (!p.b2cOnly && vyr != null && voc != null && voc > 0) marzeB2B = (voc - vyr) / voc;
  const sVals = SCORE_DEFS.map((d) => n(p[d.k]));
  const hasScore = sVals.some((v) => v != null);
  const skore = hasScore ? SCORE_DEFS.reduce((a, d, i) => a + (SCORING.scoreW[d.k] ?? d.w) * (sVals[i] || 0), 0) : null;
  const rVals = RISK_DEFS.map((d) => n(p[d.k]));
  const hasRisk = rVals.every((v) => v != null);
  const riskSkore = hasRisk ? RISK_DEFS.reduce((a, d, i) => a + (SCORING.riskW[d.k] ?? d.w) * rVals[i], 0) : null;
  const f = n(p.forecastKsRok), b2bR = n(p.pomerB2B);
  let predpokladanyObrat = null;
  if (f != null && b2bR != null && voc != null && dmoc != null)
    predpokladanyObrat = Math.round(f * (b2bR * voc + (1 - b2bR) * (dmoc / VAT)));
  const stop = p.stop || {};
  const stopActive = STOP_DEFS.filter((s) => stop[s.k]).map((s) => s.k);
  const cenaKonk = n(p.cenaKonkurence);
  const cenovyRozdil = cenaKonk != null && dmoc != null ? dmoc - cenaKonk : null;
  return { vstupniNaklad, marzeEshop, marzeB2B, skore, riskSkore, predpokladanyObrat, stopActive, cenovyRozdil };
}

/* ---------- formatters ---------- */
const fmtKc = (v) => (v == null ? "—" : Math.round(v).toLocaleString("cs-CZ") + " Kč");
const fmtPct = (v) => (v == null ? "—" : (v * 100).toFixed(1).replace(".", ",") + " %");
const fmtNum = (v) => (v == null ? "—" : Number(v).toLocaleString("cs-CZ"));

const verdictColor = (v) =>
  v === "Go" ? "var(--go)" : v === "Hold" ? "var(--hold)" : v === "No-go" ? "var(--nogo)" : "var(--pending)";
const verdictLabel = (v) => (v ? v : "Nevyhodnoceno");
const scoreColor = (s) =>
  s == null ? "var(--ink-3)" : s >= SCORING.goMin ? "var(--go)" : s >= SCORING.holdMin ? "var(--hold)" : "var(--nogo)";

/* ---------- barvy řad & fází (tabulka) ---------- */
const SERIES_COLOR = {
  "Prémiové produkty": "#2563EB",
  "Vitamíny & minerály": "#B23A52",
  "Rostlinné extrakty": "#2F8F5B",
  "Probiotika": "#0E8A86",
  "Longevity": "#DD6B20",
  "Beauty": "#B83280",
  "Houby": "#7C3AED",
  "PET": "#9C4221",
  "CBD": "#155E52",
  "Spánek": "#5B4BB0",
  "—": "#64748B",
};
const seriesColor = (s) => SERIES_COLOR[s] || "#64748B";
const PHASE_META = {
  "Nápad": { color: "#64748B", icon: "💡" },
  "Rešerše": { color: "#DD6B20", icon: "🔍" },
  "Kalkulace": { color: "#2563EB", icon: "🧮" },
  "Rozhodnutí": { color: "#E8580C", icon: "⚡" },
  "Výroba": { color: "#2C9A7F", icon: "🏭" },
  "On market": { color: "#0E8A86", icon: "🟢" },
};
const phaseMeta = (f) => PHASE_META[f] || { color: "#64748B", icon: "•" };

/* ---------- export ---------- */
const EXPORT_COLS = [
  ["Produkt", "produkt"],
  ["Řada", "rada"],
  ["Fáze", "faze"],
  ["Verdikt", (p) => verdictLabel(p.verdict)],
  ["Pouze B2C", (p) => (p.b2cOnly ? "Ano" : "Ne")],
  ["Výrobní cena", "vyrobniCena"],
  ["MOQ", "moq"],
  ["Vstupní náklad", (p, d) => d.vstupniNaklad],
  ["DMOC (s DPH)", "dmoc"],
  ["VOC", "voc"],
  ["Marže e-shop %", (p, d) => (d.marzeEshop == null ? null : +(d.marzeEshop * 100).toFixed(1))],
  ["Marže B2B %", (p, d) => (d.marzeB2B == null ? null : +(d.marzeB2B * 100).toFixed(1))],
  ["S1 Marže", "s1"], ["S2 Náročnost", "s2"], ["S3 Rychlost", "s3"], ["S4 Velikost trhu", "s4"], ["S5 MOVit Fit", "s5"],
  ["Skóre", (p, d) => (d.skore == null ? null : Math.round(d.skore))],
  ["R1 Regulace", "r1"], ["R2 Dostupnost", "r2"], ["R3 Trendy", "r3"], ["R4 Kanibalizace", "r4"], ["R5 Konkurence", "r5"],
  ["Risk skóre", (p, d) => d.riskSkore],
  ["Forecast ks/rok", "forecastKsRok"],
  ["Poměr B2B", "pomerB2B"],
  ["Předpokládaný obrat", (p, d) => d.predpokladanyObrat],
  ["Skutečný obrat", "skutecnyObrat"],
  ["Cena konkurence", "cenaKonkurence"],
  ["Velikost trhu", "velikostTrhu"],
  ["Cílový podíl trhu %", "marketShareTarget"],
  ["Růst trhu %", "rustTrhu"],
  ["Stop-flagy", (p, d) => d.stopActive.join("/")],
  ["Účinky", (p) => (p.ucinky || []).join(", ")],
  ["Poznámka", "poznamka"],
];
function buildExportMatrix(products) {
  const header = EXPORT_COLS.map((c) => c[0]);
  const rows = products.map((p) => {
    const d = derive(p);
    return EXPORT_COLS.map((c) => {
      const k = c[1];
      const v = typeof k === "function" ? k(p, d) : p[k];
      return v == null ? "" : v;
    });
  });
  return [header, ...rows];
}
function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.setAttribute("data-src", src);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("script load failed"));
    document.head.appendChild(s);
  });
}
async function exportElementToPDF(el, filename) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js");
  if (!window.html2pdf) throw new Error("html2pdf unavailable");
  const opt = {
    margin: [10, 10, 12, 10],
    filename,
    image: { type: "jpeg", quality: 0.96 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false, windowWidth: el.scrollWidth },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["css", "legacy"], avoid: [".swot-q", ".reco-col", ".reco-verdict", ".sl", ".dp-info", ".analysis-table tr", ".dp-score-grid section"] },
  };
  await window.html2pdf().set(opt).from(el).save();
}
function exportCSV(products) {
  const m = buildExportMatrix(products);
  const csv = m.map((row) => row.map((cell) => {
    let s = typeof cell === "number" ? String(cell).replace(".", ",") : String(cell);
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }).join(";")).join("\r\n");
  downloadBlob("\uFEFF" + csv, "movit-portfolio.csv", "text/csv;charset=utf-8;");
}
async function exportXLSX(products) {
  try {
    const XLSX = await import("xlsx");
    const m = buildExportMatrix(products);
    const ws = XLSX.utils.aoa_to_sheet(m);
    ws["!cols"] = m[0].map((_, i) => ({ wch: i === 0 ? 32 : i >= m[0].length - 2 ? 28 : 13 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Portfolio");
    XLSX.writeFile(wb, "movit-portfolio.xlsx");
    return true;
  } catch (e) {
    exportCSV(products);
    return false;
  }
}

/* ---------- AI analýzy (web search přes Anthropic API) ---------- */
async function callClaudeJSON(prompt, { search = false, maxTokens = 4096 } = {}) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, search, maxTokens }),
  });
  if (!res.ok) throw new Error("API " + res.status);
  const data = await res.json();
  const text = data.text || "";
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const a = cleaned.indexOf("{"), b = cleaned.lastIndexOf("}");
  return JSON.parse(a >= 0 && b > a ? cleaned.slice(a, b + 1) : cleaned);
}
function analyzeCompetition(p) {
  const prompt = `Jsi tržní analytik pro český e-commerce trh s doplňky stravy. Pomocí webového vyhledávání najdi na ČESKÉM trhu 10 nejprodávanějších / nejlépe hodnocených konkurenčních produktů k produktu "${p.produkt}"${p.rada && p.rada !== "—" ? ` (kategorie: ${p.rada})` : ""}. Hledej na Heureka.cz, Zbozi.cz, Mall.cz, e-shopech lékáren a specializovaných obchodech.

Vrať POUZE validní JSON (žádný text okolo, žádné markdown bloky):
{"shrnuti":"2-3 věty o konkurenčním prostředí a cenovém rozpětí","produkty":[{"nazev":"...","vyrobce":"...","odkaz":"https://...","cena":"299 Kč","baleni":"60 kapslí","cenaZaKus":"4,98 Kč/ks","hodnoceni":"4.7/5 (320)","poznamka":"krátká poznámka"}]}
Uveď přesně 10 produktů seřazených od nejprodávanějšího. Cenu za kus přepočti na 1 tabletu/kapsli/dávku. Když údaj nezjistíš, dej "".`;
  return callClaudeJSON(prompt, { search: true, maxTokens: 4096 });
}
function analyzeTrends(p) {
  const prompt = `Jsi SEO a PPC analytik pro český trh. Z názvu produktu "${p.produkt}" vyber hlavní česká klíčová slova a jejich synonyma, která lidé reálně hledají. Pomocí webového vyhledávání odhadni vyhledávanost na Google CZ a cenu za proklik (CPC) v Google Ads.

Vrať POUZE validní JSON (žádný text okolo, žádné markdown):
{"shrnuti":"2-3 věty o trendu a sezónnosti","klicovaSlova":[{"slovo":"hořčík","objem6":12000,"objem12":11000,"objem24":9500,"objem36":8000,"cpc":"6,40 Kč","trend":"rostoucí","obtiznost":"střední"}],"casovaRada":[{"obdobi":"Q3/23","index":62}]}
Pravidla: objem6/12/24/36 = odhadovaný PRŮMĚRNÝ měsíční počet hledání za posledních 6/12/24/36 měsíců. "casovaRada" = 12 čtvrtletních bodů od nejstaršího po nejnovější, "index" 0-100 vůči maximu. Uveď 4-6 klíčových slov. trend = "rostoucí"/"stabilní"/"klesající". Čísla jsou kvalifikované odhady.`;
  return callClaudeJSON(prompt, { search: true, maxTokens: 3500 });
}
function analyzeRecommendation(p) {
  const prompt = `Jsi zkušený produktový a tržní stratég značky doplňků stravy MOVit (český trh). Na základě webového vyhledávání posuď atraktivitu uvedení produktu "${p.produkt}"${p.rada && p.rada !== "—" ? ` (kategorie: ${p.rada})` : ""} na český trh z pohledu poptávky, konkurence, marží, regulace (doplňky stravy) a souladu se značkou.

Vrať POUZE validní JSON (žádný text okolo, žádné markdown):
{"doporuceni":"ANO","skore":72,"shrnuti":"1-2 věty verdikt","plus":["..."],"minus":["..."],"swot":{"silne":["..."],"slabe":["..."],"prilezitosti":["..."],"hrozby":["..."]},"komentar":"3-5 vět: zda produkt uvést na trh, proč, na co si dát pozor a hlavní rizika"}
Pravidla: "doporuceni" je jedno z: "ANO","SPÍŠE ANO","ZVÁŽIT","SPÍŠE NE","NE". "skore" = celková atraktivita 0-100. V plus/minus a SWOT uveď 3-5 konkrétních bodů opřených o český trh.`;
  return callClaudeJSON(prompt, { search: true, maxTokens: 3000 });
}
function analyzeReferences(p) {
  const prompt = `Jsi rešeršní analytik pro značku doplňků stravy (český trh). K produktu / účinné látce "${p.produkt}"${p.rada && p.rada !== "—" ? ` (kategorie: ${p.rada})` : ""} pomocí webového vyhledávání najdi dvě skupiny zdrojů:
1) VĚDECKÉ STUDIE z celého světa k účinnosti a bezpečnosti (PubMed, klinické studie, metaanalýzy, recenzované články).
2) STRÁNKY ÚŘADŮ v ČR a EU s informacemi o regulaci, restrikcích, povolených zdravotních tvrzeních či maximálních dávkách – např. EFSA, Evropská komise (registr health claims), SÚKL, SZPI, Ministerstvo zdravotnictví ČR.

Vrať POUZE validní JSON (žádný text okolo, žádné markdown):
{"shrnuti":"2-3 věty o stavu poznání a regulace","studie":[{"nazev":"...","popis":"krátké zjištění / o čem studie je","odkaz":"https://..."}],"regulace":[{"nazev":"...","urad":"EFSA","popis":"čeho se týká (restrikce, dávky, health claim)","odkaz":"https://..."}]}
Uveď 4-6 studií a 3-6 regulačních zdrojů. Odkazy musí být reálné. Co nezjistíš, nech jako "".`;
  return callClaudeJSON(prompt, { search: true, maxTokens: 4096 });
}
async function loadAnalysis(key) {
  try { const r = await window.storage.get(key); if (r && r.value) return JSON.parse(r.value); } catch (e) {}
  return null;
}
async function saveAnalysis(key, payload) {
  try { await window.storage.set(key, JSON.stringify(payload)); } catch (e) {}
}
async function recordAnalysisHistory(product, type, ts) {
  if (!product || !product.id) return;
  try {
    let list = [];
    const r = await window.storage.get("movit:anahistory");
    if (r && r.value) list = JSON.parse(r.value);
    let e = list.find((x) => x.id === product.id);
    if (!e) { e = { id: product.id, produkt: product.produkt, rada: product.rada, comp: null, trend: null, reco: null, refs: null, updated: 0 }; list.unshift(e); }
    e.produkt = product.produkt; e.rada = product.rada;
    e[type] = ts; e.updated = ts;
    await window.storage.set("movit:anahistory", JSON.stringify(list));
  } catch (e) {}
}
function metaFromId(id, products) {
  if (String(id).startsWith("ana:")) {
    const rest = id.slice(4);
    const sep = rest.lastIndexOf("|");
    const slug = sep >= 0 ? rest.slice(0, sep) : rest;
    const cat = sep >= 0 ? rest.slice(sep + 1) : "—";
    const name = slug.replace(/-/g, " ").trim();
    return { produkt: name ? name.charAt(0).toUpperCase() + name.slice(1) : "Analýza", rada: cat || "—" };
  }
  const p = (products || []).find((x) => x.id === id);
  return { produkt: p ? p.produkt : "Smazaný produkt", rada: p ? p.rada : "—" };
}
async function loadHistory(products) {
  let list = [];
  try { const r = await window.storage.get("movit:anahistory"); if (r && r.value) list = JSON.parse(r.value); } catch (e) {}
  const byId = {};
  list.forEach((e) => { byId[e.id] = e; });
  for (const [prefix, type] of [["movit:comp:", "comp"], ["movit:trend:", "trend"], ["movit:reco:", "reco"], ["movit:refs:", "refs"]]) {
    let keys = [];
    try { const res = await window.storage.list(prefix); keys = (res && res.keys) || []; } catch (e) {}
    for (const key of keys) {
      const id = key.slice(prefix.length);
      let e = byId[id];
      if (!e) { const meta = metaFromId(id, products); e = { id, produkt: meta.produkt, rada: meta.rada, comp: null, trend: null, reco: null, refs: null, updated: 0 }; byId[id] = e; list.unshift(e); }
      if (e[type] == null) {
        let ts = null;
        try { const v = await window.storage.get(key); if (v && v.value) ts = JSON.parse(v.value).ts || null; } catch (er) {}
        if (ts) { e[type] = ts; e.updated = Math.max(e.updated || 0, ts); }
      }
    }
  }
  list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return list;
}

/* ============================================================
   SEED DATA — z tabulky MOVit
   ============================================================ */
const RAW = [
  ["Dětský sirup s betaglukany","Prémiové produkty","Nápad","",140,,,,false,"","Imunita, Děti"],
  ["Brusinky","Rostlinné extrakty","Nápad","",,,,,false,"","Močové cesty"],
  ["Yuzu","—","Rešerše","No-go",137,,,,false,"",""],
  ["Multivitamin Femina","Vitamíny & minerály","Nápad","",109,,,,false,"","Antioxidanty"],
  ["PEA","Longevity","Rešerše","No-go",,,,,false,"","Dlouhověkost"],
  ["Elektrolyty","Vitamíny & minerály","Nápad","",345,,1079,699,false,{s2:3},"Energie, Antioxidanty"],
  ["Pancreobalance – podpora slinivky","Prémiové produkty","Nápad","",130,,429,279,false,{s1:7},""],
  ["ApetiMax","Prémiové produkty","Rešerše","No-go",,,,,false,"",""],
  ["Multivitamíny pro specifické cílovky","Vitamíny & minerály","Nápad","",,,,,false,"",""],
  ["Trávicí enzymy","Prémiové produkty","Rešerše","No-go",,,,,false,"",""],
  ["Magtein – patentovaný magnesium L-threonát","Vitamíny & minerály","Nápad","",435,1110,999,,true,{s1:3},"Energie, Nervy, Spánek, Mozek"],
  ["Vápník pro děti","Vitamíny & minerály","Nápad","",,,,,false,"","Kosti"],
  ["B12 – pro děti?","Vitamíny & minerály","Nápad","",100,2000,299,199,false,"","Děti"],
  ["B12","Vitamíny & minerály","Nápad","",,,,,false,"",""],
  ["Cykloastragenol","Longevity","Nápad","No-go",,,,,false,"","Dlouhověkost"],
  ["Gummies","—","Rešerše","Hold",,,,,false,"",""],
  ["Astina SuperVit","Vitamíny & minerály","Nápad","",47,,,,false,"","Antioxidanty, Pokožka, Imunita"],
  ["Probiotika mimina","Probiotika","Nápad","",,,,,false,"","Děti, Trávení"],
  ["Antistress kids","Prémiové produkty","Nápad","",,,,,false,"","Děti, Nervy, Spánek"],
  ["KeragenIV","Beauty","Rešerše","No-go",,,,,false,"","Vlasy, Pokožka"],
  ["Ředění krve","—","Nápad","",,,,,false,"",""],
  ["Megadetox – lipozomální ostropestřec","Rostlinné extrakty","Rešerše","No-go",150,,529,345,false,{s2:5},"Játra, Detoxikace"],
  ["Kolagen drink","Beauty","Nápad","No-go",125,,,,false,"","Pokožka, Vlasy, Nehty"],
  ["ALA","Longevity","Nápad","No-go",,,,,false,"","Dlouhověkost"],
  ["CBD pro zvířata","PET","Nápad","",,,,,false,"","Stres, Nervy, Spánek"],
  ["Longevity komplex","Longevity","Nápad","",,,,,false,"","Dlouhověkost"],
  ["Sleep CBD","CBD","Nápad","No-go",,,,,false,"","Stres, Spánek, Nervy"],
  ["Magnesium taurát","Vitamíny & minerály","Nápad","",,,,,false,"","Nervy, Energie, Regenerace"],
  ["Berberin + gurmar","Prémiové produkty","Nápad","",180,,599,389,false,{s2:4},"Trávení, Cévy"],
  ["Greens complex","Rostlinné extrakty","Rešerše","No-go",,,,,false,"","Trávení, Odvodnění, Zažívání"],
  ["Probiotika pro děti extra strong","Probiotika","Nápad","",,,,,false,"","Děti, Trávení, Mikrobiom"],
  ["Alergohelp – podpora proti příznakům alergie","Prémiové produkty","On market","Go",79,3333,399,254,false,{s1:8,s2:4,s3:4,s4:6,s5:6,forecastKsRok:800,pomerB2B:0.8,r1:4,r2:6,r3:8,r4:10,r5:9},"Trávení, Zažívání, Imunita, Antioxidanty, Mikrobiom"],
  ["Ashwagandha TOP – KSM66 extrakt","Longevity","Nápad","",140,,,,false,"","Nervy, Stres, Spánek"],
  ["PMS balance – zmírnění PMS","Prémiové produkty","Rozhodnutí","No-go",84,,,,false,"","Energie, Spánek, Únava"],
  ["Probiotika pro psy","PET","On market","Go",99,500,399,259,false,{s1:6,s2:8,s3:7,s4:7,s5:5,forecastKsRok:1400,pomerB2B:0.92,r1:8,r2:7,r3:8,r4:9,r5:8},"Trávení, Mikrobiom"],
  ["Pupalka extra strong","Rostlinné extrakty","Výroba","Go",104,500,369,236,false,{s1:5,s2:9,s3:9,s4:7,s5:7},"Antioxidanty, Imunita, Nehty, Oči, Pokožka"],
  ["Další rozšíření longevity řady","Longevity","Nápad","",,,,,false,"","Dlouhověkost"],
  ["Probiotika skin help","Probiotika","Nápad","Hold",137,3333,599,389,false,{s1:7,s2:5,s3:5,s4:4,s5:7},"Trávení, Mikrobiom, Pokožka"],
  ["Probiotika teeth","Probiotika","Nápad","Hold",67,3333,299,195,false,{s1:7},"Trávení"],
  ["Krill oil","Prémiové produkty","Rozhodnutí","",143,500,699,444,false,{s1:8,s2:6,s3:6,s4:5,s5:6},"Antioxidanty, Srdce, Mozek, Pokožka, Oči"],
  ["Guarana + ženšen","Rostlinné extrakty","Nápad","Hold",102,3333,349,225,false,{s1:4},"Kognice, Paměť, Energie"],
  ["Reishi + chaga","Houby","Nápad","Hold",108,3333,499,325,false,{s1:7},"Imunita, Regenerace"],
  ["Ashwagandha (komoditní, 90 kapslí)","Rostlinné extrakty","On market","Go",94,1600,369,235,false,{s1:6,s2:9,s3:9,s4:8,s5:8,forecastKsRok:1400,pomerB2B:0.85,r1:8,r2:9,r3:10,r4:6,r5:6},"Stres, Spánek, Paměť"],
  ["Kategorie děti","—","Nápad","",,,,,false,"","Děti"],
  ["Vitamin A 6000 IU","Vitamíny & minerály","Nápad","No-go",46,500,169,110,false,{s1:5},"Antioxidanty, Zrak, Imunita, Oči"],
  ["Vitamin D3 4000 IU","Vitamíny & minerály","Nápad","Hold",43,500,179,116,false,{s1:6},"Imunita"],
  ["Probiotika URO women","Probiotika","Nápad","Hold",,,,,false,"","Močové cesty, Mikrobiom, Trávení"],
  ["NAD+","Longevity","Nápad","No-go",,,,,false,"","Dlouhověkost, Energie"],
  ["Diosmin + Hesperidin","Prémiové produkty","Kalkulace","",135,,479,312,false,{s1:5},"Cévy, Antioxidanty"],
  ["Omega 3 + kapsaicin","Prémiové produkty","Nápad","Hold",,,,,false,"","Srdce, Mozek"],
  ["Probiotika akutní průjem","Probiotika","Nápad","Hold",,,,,false,"","Trávení, Zažívání, Mikrobiom"],
  ["Prostata+","Prémiové produkty","Výroba","Go",105,1500,399,259,false,{s1:6,s2:9,s3:9,s4:6,s5:6},"Prostata, Močové cesty, Mikrobiom, Antioxidanty, Libido"],
  ["Vitamin E 200 IU","Vitamíny & minerály","Nápad","Hold",40,,199,129,false,{s1:8},"Antioxidanty"],
  ["Wurmex","Prémiové produkty","Nápad","Hold",,,,,false,"",""],
  ["Rutin + vitamin C","Vitamíny & minerály","Nápad","",41.5,,169,110,false,{s1:6},"Antioxidanty, Imunita, Cévy"],
  ["Psyllium","Rostlinné extrakty","Nápad","No-go",,,,,false,"","Trávení, Zažívání"],
  ["Lecithin 1200/1325 mg","Prémiové produkty","Nápad","",,,,,false,"",""],
  ["Maitake","Houby","Nápad","",,,,,false,"","Imunita"],
  ["Eye complex","Prémiové produkty","Rozhodnutí","Hold",,,,,false,"","Oči, Zrak, Antioxidanty"],
  ["Shilajit – mumio","Prémiové produkty","Nápad","",,,,,false,"","Antioxidanty"],
  ["Saw palmetto","Rostlinné extrakty","Nápad","No-go",,,,,false,"","Prostata"],
  ["C 500/1000","Vitamíny & minerály","Nápad","",,,,,false,"","Antioxidanty, Imunita, Pokožka"],
  ["Upgrade methionin","Beauty","Nápad","",,,,,false,"","Vlasy, Nehty"],
  ["Butyrát sodný","Probiotika","Kalkulace","",59,,,,false,"","Trávení, Mikrobiom"],
  ["Kozí kolostrum","Prémiové produkty","Kalkulace","No-go",,,,,false,"","Imunita, Děti"],
  ["Omega3 UltraPure","Prémiové produkty","Výroba","Go",85,500,399,259,false,{s1:8,s2:9,s3:9,s4:8,s5:7,forecastKsRok:4000,pomerB2B:0.87,r1:9,r2:7,r3:7,r4:5,r5:6},"Srdce, Nervy, Imunita"],
  ["Lolly imunity kids – 1 ks","—","Rozhodnutí","",5.9,20000,19,,true,{s1:7,s2:8,s3:7,s4:4,s5:6},"Děti, Imunita, Antioxidanty, Energie"],
  ["Lolly imunity kids – balení","—","Rozhodnutí","",59,2000,179,,true,{s1:7,s2:8,s3:7,s4:4,s5:6},"Děti, Imunita, Antioxidanty, Energie"],
  ["Vitamin K2","Vitamíny & minerály","Výroba","Go",92,500,349,222,false,{s1:5,s2:9,s3:9,s4:5,s5:7},"Kosti, Cévy"],
  ["Melatonin","Spánek","On market","Go",47,1500,169,108,false,{s1:5,s2:9,s3:9,s4:5,s5:6,forecastKsRok:600,pomerB2B:0.9,r1:5,r2:8,r3:6,r4:5,r5:5},"Spánek, Regenerace"],
  ["Kolagen + hořčík + Ca + K2 + D3","Vitamíny & minerály","Nápad","Hold",116.5,,399,259,false,{s1:5},"Antioxidanty, Pokožka, Mozek, Kosti, Klouby, Nervy, Spánek"],
  ["Ostropestřec s fosfolipidy","Rostlinné extrakty","Rešerše","",,,,,false,"","Játra, Detoxikace"],
];
function buildSeed() {
  return RAW.map((r, i) => {
    const [produkt, rada, faze, verdict, vyrobniCena, moq, dmoc, voc, b2cOnly, extra, ucinky] = r;
    const base = {
      id: "p" + (i + 1), produkt, rada, faze, verdict,
      vyrobniCena: vyrobniCena ?? null, moq: moq ?? null, dmoc: dmoc ?? null, voc: voc ?? null,
      b2cOnly: !!b2cOnly,
      cenaKonkurence: null, velikostTrhu: null, marketShareTarget: null, rustTrhu: null,
      stop: {},
      s1: null, s2: null, s3: null, s4: null, s5: null,
      r1: null, r2: null, r3: null, r4: null, r5: null,
      forecastKsRok: null, pomerB2B: null, skutecnyObrat: null,
      poznamka: "", ucinky: ucinky ? ucinky.split(",").map((s) => s.trim()).filter(Boolean) : [],
    };
    if (extra && typeof extra === "object") Object.assign(base, extra);
    return base;
  });
}

/* ============================================================
   ICONS (inline SVG)
   ============================================================ */
const Ic = {
  dash: <path d="M3 3h7v7H3zM14 3h7v5h-7zM14 11h7v10h-7zM3 14h7v7H3z" />,
  pipe: <path d="M3 5h18M6 12h12M9 19h6" />,
  table: <path d="M3 4h18v16H3zM3 9h18M3 14h18M9 4v16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  trash: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />,
  reset: <path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.5M3 3v4h4" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  logout: <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0112 0v1" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
  edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />,
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  chart: <path d="M3 3v18h18M7 14l4-4 3 3 5-6" />,
  store: <path d="M4 7l1-3h14l1 3M4 7h16v3a2 2 0 01-4 0 2 2 0 01-4 0 2 2 0 01-4 0 2 2 0 01-4 0zM5 11v9h14v-9" />,
  refresh: <path d="M3 12a9 9 0 019-9 9 9 0 017 3.3M21 12a9 9 0 01-9 9 9 9 0 01-7-3.3M21 3v4h-4M3 21v-4h4" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />,
  beaker: <path d="M9 3h6M10 3v6L5 19a1 1 0 001 1h12a1 1 0 001-1l-5-10V3M7 14h10" />,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /></>,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  pdf: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /></>,
};
const Icon = ({ d, size = 18, sw = 1.7, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>{d}</svg>
);

/* ============================================================
   SMALL UI PARTS
   ============================================================ */
const Badge = ({ color, children, solid }) => (
  <span className="badge" style={solid
    ? { background: color, color: "#fff", borderColor: color }
    : { color, borderColor: color, background: "transparent" }}>{children}</span>
);

function ScoreRing({ value, size = 46 }) {
  const r = (size - 7) / 2, c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const col = scoreColor(value);
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="4"
          strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dasharray .5s" }} />
      </svg>
      <span style={{
        position: "absolute", inset: 0, display: "grid", placeItems: "center",
        fontFamily: "var(--mono)", fontWeight: 600, fontSize: size > 40 ? 13 : 11, color: col,
      }}>{value == null ? "–" : Math.round(value)}</span>
    </div>
  );
}

/* ============================================================
   APP
   ============================================================ */
function newProductObject(data = {}) {
  return {
    id: "p" + Date.now() + Math.floor(Math.random() * 1000),
    produkt: (data.produkt || "Nový produkt").trim(), rada: data.rada || "—",
    faze: data.faze || "Nápad", verdict: data.verdict || "",
    vyrobniCena: null, moq: null, dmoc: null, voc: null, b2cOnly: !!data.b2cOnly,
    cenaKonkurence: null, velikostTrhu: null, marketShareTarget: null, rustTrhu: null,
    stop: {},
    s1: null, s2: null, s3: null, s4: null, s5: null, r1: null, r2: null, r3: null, r4: null, r5: null,
    forecastKsRok: null, pomerB2B: null, skutecnyObrat: null, poznamka: data.poznamka || "", ucinky: data.ucinky || [],
  };
}
export default function App() {
  const [products, setProducts] = useState(null);
  const [view, setView] = useState("dash");
  const [q, setQ] = useState("");
  const [fSeries, setFSeries] = useState("");
  const [fPhase, setFPhase] = useState("");
  const [fVerdict, setFVerdict] = useState("");
  const [fStop, setFStop] = useState(false);
  const [selId, setSelId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [anaDetail, setAnaDetail] = useState(null);
  const [toast, setToast] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [scoring, setScoring] = useState(SCORING);
  const loaded = useRef(false);

  /* ---- účty & session ---- */
  useEffect(() => {
    (async () => {
      let accs = DEFAULT_ACCOUNTS;
      try {
        const r = await window.storage.get("movit:accounts");
        if (r && r.value) accs = JSON.parse(r.value);
        else await window.storage.set("movit:accounts", JSON.stringify(accs));
      } catch (e) {}
      setAccounts(accs);
      try {
        const s = await window.storage.get("movit:session");
        if (s && s.value) { const u = JSON.parse(s.value); if (u) setSession(u); }
      } catch (e) {}
      try {
        const sc = await window.storage.get("movit:scoring");
        if (sc && sc.value) { const cfg = JSON.parse(sc.value); setScoringConfig(cfg); setScoring(cfg); }
      } catch (e) {}
      setAuthReady(true);
    })();
  }, []);

  const updateScoring = (next) => {
    setScoringConfig(next); setScoring(next);
    try { window.storage.set("movit:scoring", JSON.stringify(next)); } catch (e) {}
  };
  const resetScoring = () => {
    const def = JSON.parse(JSON.stringify(DEFAULT_SCORING));
    updateScoring(def);
  };

  /* ---- persistence ---- */
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("movit:products");
        if (res && res.value) { setProducts(JSON.parse(res.value)); loaded.current = true; return; }
      } catch (e) {}
      const seed = buildSeed();
      setProducts(seed); loaded.current = true;
      try { await window.storage.set("movit:products", JSON.stringify(seed)); } catch (e) {}
    })();
  }, []);
  useEffect(() => {
    if (!loaded.current || products == null) return;
    (async () => { try { await window.storage.set("movit:products", JSON.stringify(products)); } catch (e) {} })();
  }, [products]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  const currentUser = accounts && session ? accounts.find((a) => a.username === session) || null : null;
  const canEdit = currentUser?.role === "admin";

  const login = async (username, password) => {
    if (!accounts) return false;
    const u = accounts.find((a) => a.username === String(username).trim().toLowerCase() && a.password === password);
    if (!u) return false;
    setSession(u.username);
    try { await window.storage.set("movit:session", JSON.stringify(u.username)); } catch (e) {}
    return true;
  };
  const logout = async () => {
    setSession(null); setSelId(null); setView("dash");
    try { await window.storage.delete("movit:session"); } catch (e) {}
  };

  const updateProduct = (id, patch) => {
    if (!canEdit) return;
    setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  const addProduct = (data = {}) => {
    const np = newProductObject(data);
    setProducts((ps) => [np, ...ps]); setShowAdd(false); setSelId(np.id); setView("table"); flash("Produkt přidán");
  };
  const addFromAnalysis = async (ana) => {
    const np = newProductObject({ produkt: ana.produkt, rada: ana.rada });
    setProducts((ps) => [np, ...ps]);
    try {
      for (const t of ["comp", "trend", "reco", "refs"]) {
        const r = await window.storage.get("movit:" + t + ":" + ana.id);
        if (r && r.value) await window.storage.set("movit:" + t + ":" + np.id, r.value);
      }
    } catch (e) {}
    flash("Produkt přidán do seznamu");
    setSelId(np.id); setView("table");
  };
  const removeProduct = (id) => { if (!canEdit) return; setProducts((ps) => ps.filter((p) => p.id !== id)); setSelId(null); flash("Produkt smazán"); };
  const removeProductConfirm = (id, after) => {
    if (!canEdit) return;
    const p = products?.find((x) => x.id === id);
    if (!confirm(`Opravdu smazat produkt „${p?.produkt || ""}"? Tuto akci nelze vrátit.`)) return;
    setProducts((ps) => ps.filter((x) => x.id !== id));
    setSelId(null);
    flash("Produkt smazán");
    if (after) after();
  };
  const openDetail = (id) => { setDetailId(id); setView("detail"); };
  const openAnalysis = (entry) => { setAnaDetail(entry); setView("analyza"); };
  const resetAll = () => {
    if (!canEdit) return;
    if (!confirm("Obnovit data podle původní tabulky? Vaše úpravy budou ztraceny.")) return;
    const seed = buildSeed(); setProducts(seed); setSelId(null); flash("Data obnovena");
  };

  const filtered = useMemo(() => {
    if (!products) return [];
    const ql = q.trim().toLowerCase();
    return products.filter((p) => {
      if (fSeries && p.rada !== fSeries) return false;
      if (fPhase && p.faze !== fPhase) return false;
      if (fVerdict && (p.verdict || "—") !== fVerdict) return false;
      if (fStop && derive(p).stopActive.length === 0) return false;
      if (ql) {
        const hay = (p.produkt + " " + p.rada + " " + (p.ucinky || []).join(" ")).toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [products, q, fSeries, fPhase, fVerdict, fStop]);

  const clearFilters = () => { setFSeries(""); setFPhase(""); setFVerdict(""); setFStop(false); setQ(""); };
  const goToTable = (filter = {}) => {
    setFSeries(filter.series || "");
    setFPhase(filter.phase || "");
    setFVerdict(filter.verdict || "");
    setFStop(!!filter.stop);
    setQ("");
    setView("table");
  };

  const selected = products?.find((p) => p.id === selId) || null;
  const detailProduct = products?.find((p) => p.id === detailId) || null;

  const activeKpi =
    fStop ? "stop"
    : fPhase === "On market" && !fSeries && !fVerdict && !q ? "market"
    : fVerdict === "Go" && !fSeries && !fPhase && !q ? "go"
    : fVerdict === "Hold" && !fSeries && !fPhase && !q ? "hold"
    : fVerdict === "No-go" && !fSeries && !fPhase && !q ? "nogo"
    : (!fSeries && !fPhase && !fVerdict && !q) ? "all"
    : null;

  if (!authReady || !products) return <div style={{ padding: 40, fontFamily: "var(--body)" }}>Načítám portfolio…</div>;
  if (!currentUser) return <Login onLogin={login} />;

  return (
    <div className="app">
      <style>{CSS}</style>

      {/* SIDEBAR */}
      <aside className="rail">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div className="brand-tx">
            <div className="brand-name">MOVit</div>
            <div className="brand-sub">Portfolio Console</div>
          </div>
        </div>
        <nav className="nav">
          {[
            ["dash", "Dashboard", Ic.dash],
            ["table", "Produkty", Ic.table],
            ["analyza", "Analýza", Ic.beaker],
            ["pipe", "Pipeline", Ic.pipe],
            ["scoring", "Scoring", Ic.chart],
          ].map(([k, label, ic]) => (
            <button key={k} className={"nav-btn" + (view === k || (k === "table" && view === "detail") ? " on" : "")} onClick={() => { setView(k); if (k === "analyza") setAnaDetail(null); }}>
              <Icon d={ic} size={18} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <div className="export-row">
            <button className="ghost-btn" onClick={() => exportXLSX(products)} title="Stáhnout jako Excel (.xlsx)">
              <Icon d={Ic.download} size={15} /><span>Excel</span>
            </button>
            <button className="ghost-btn" onClick={() => exportCSV(products)} title="Stáhnout jako CSV">
              <Icon d={Ic.download} size={15} /><span>CSV</span>
            </button>
          </div>
          {canEdit && (
            <button className="ghost-btn" onClick={resetAll}>
              <Icon d={Ic.reset} size={15} /><span>Obnovit zdroj</span>
            </button>
          )}
          <div className="user-chip">
            <div className="user-av">{initials(currentUser.name)}</div>
            <div className="user-tx">
              <div className="user-name">{currentUser.name}</div>
              <div className={"user-role" + (canEdit ? " admin" : "")}>{ROLES[currentUser.role].label}</div>
            </div>
            <button className="user-logout" onClick={logout} title="Odhlásit se"><Icon d={Ic.logout} size={16} /></button>
          </div>
          <a className="rail-link" href="https://www.movitenergy.cz" target="_blank" rel="noreferrer">movitenergy.cz</a>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        <header className="topbar">
          <div className="searchbox">
            <Icon d={Ic.search} size={16} style={{ color: "var(--ink-3)" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledat produkt, řadu, účinek…" />
          </div>
          <div className="filters">
            <Select value={fSeries} onChange={setFSeries} placeholder="Řada"
              options={[...new Set(products.map((p) => p.rada))].sort()} />
            <Select value={fPhase} onChange={setFPhase} placeholder="Fáze" options={PHASES} />
            <Select value={fVerdict} onChange={setFVerdict} placeholder="Verdikt" options={["Go", "Hold", "No-go", "—"]} />
            {fStop && (
              <button className="filter-chip" onClick={() => setFStop(false)} title="Zrušit filtr stop-flagů">
                <Icon d={Ic.lock} size={13} /><span>Se stop-flagem</span><span className="filter-chip-x">×</span>
              </button>
            )}
            {(fSeries || fPhase || fVerdict || fStop || q) && (
              <button className="clear-f" onClick={clearFilters}>Zrušit filtry</button>
            )}
          </div>
          <button className="add-btn" onClick={() => setShowAdd(true)}><Icon d={Ic.plus} size={16} /><span>Nový produkt</span></button>
        </header>

        <div className="content">
          {view === "dash" && <Dashboard products={products} onOpen={openDetail} onFilter={goToTable} onEdit={(id) => setSelId(id)} onDelete={(id) => removeProductConfirm(id)} canEdit={canEdit} onOpenAnalysis={openAnalysis} />}
          {view === "pipe" && <Pipeline products={filtered} canEdit={canEdit} onMove={(id, faze) => updateProduct(id, { faze })} onOpen={openDetail} />}
          {view === "table" && <Tabulka products={filtered} onOpen={openDetail} onEdit={(id) => setSelId(id)} onDelete={(id) => removeProductConfirm(id)} canEdit={canEdit} allProducts={products} onFilter={goToTable} active={activeKpi} />}
          {view === "detail" && (detailProduct
            ? <DetailPage product={detailProduct} canEdit={canEdit} onBack={() => setView("table")} onEdit={() => setSelId(detailProduct.id)} onDelete={() => removeProductConfirm(detailProduct.id, () => setView("table"))} />
            : <div className="page"><button className="back-btn" onClick={() => setView("table")}><Icon d={Ic.back} size={16} /><span>Zpět na produkty</span></button><p style={{ marginTop: 20, color: "var(--ink-3)" }}>Produkt nebyl nalezen.</p></div>)}
          {view === "scoring" && <ScoringSettings scoring={scoring} canEdit={canEdit} products={products} onChange={updateScoring} onReset={resetScoring} />}
          {view === "analyza" && <AnalyzaSection canEdit={canEdit} onAddProduct={addFromAnalysis} products={products} detail={anaDetail} setDetail={setAnaDetail} />}
        </div>
      </main>

      {/* DETAIL DRAWER */}
      {selected && (
        <Drawer product={selected} canEdit={canEdit} onClose={() => setSelId(null)}
          onChange={(patch) => updateProduct(selected.id, patch)} onDelete={() => removeProduct(selected.id)} />
      )}
      {showAdd && <AddProductModal readOnly={!canEdit} onClose={() => setShowAdd(false)} onAdd={addProduct} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ---------- Login ---------- */
function Login({ onLogin }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState(false);
  const submit = async () => { const ok = await onLogin(u, p); if (!ok) setErr(true); };
  const onKey = (e) => { if (e.key === "Enter") submit(); };
  return (
    <div className="login-wrap">
      <style>{CSS}</style>
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="login-name">MOVit</div>
            <div className="login-sub">Portfolio Console</div>
          </div>
        </div>
        <h2 className="login-title">Přihlášení</h2>
        <label className="field"><span>Uživatelské jméno</span>
          <input autoFocus value={u} onChange={(e) => { setU(e.target.value); setErr(false); }} onKeyDown={onKey} placeholder="jméno" /></label>
        <label className="field"><span>Heslo</span>
          <input type="password" value={p} onChange={(e) => { setP(e.target.value); setErr(false); }} onKeyDown={onKey} placeholder="heslo" /></label>
        {err && <div className="login-err">Neplatné jméno nebo heslo.</div>}
        <button className="login-btn" onClick={submit}><Icon d={Ic.lock} size={16} /><span>Přihlásit se</span></button>
        <div className="login-demo">
          <div className="login-demo-title">Demo účty</div>
          <div><b>admin</b> / admin — Administrátor (plný přístup)</div>
          <div><b>nahled</b> / nahled — Pouze náhled (smí přidat produkt)</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Add product modal ---------- */
function AddProductModal({ onClose, onAdd, readOnly }) {
  const [f, setF] = useState({ produkt: "", rada: "—", faze: "Nápad", verdict: "", b2cOnly: false, ucinky: "", poznamka: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const ok = f.produkt.trim().length > 0;
  const submit = () => {
    if (!ok) return;
    onAdd({ ...f, ucinky: f.ucinky.split(",").map((s) => s.trim()).filter(Boolean) });
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-head">
          <h3>Nový produkt</h3>
          <button className="icon-btn" onClick={onClose}><Icon d={Ic.close} size={18} /></button>
        </div>
        <div className="modal-body">
          <label className="field"><span>Název produktu *</span>
            <input autoFocus value={f.produkt} onChange={(e) => set("produkt", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="např. Hořčík bisglycinát" /></label>
          <div className="grid2">
            <Field label="Řada"><select value={f.rada} onChange={(e) => set("rada", e.target.value)}>{SERIES.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Fáze"><select value={f.faze} onChange={(e) => set("faze", e.target.value)}>{PHASES.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Verdikt"><select value={f.verdict} onChange={(e) => set("verdict", e.target.value)}>{VERDICTS.map((v) => <option key={v} value={v}>{verdictLabel(v)}</option>)}</select></Field>
            <Field label="Pouze B2C">
              <button className={"toggle" + (f.b2cOnly ? " on" : "")} onClick={() => set("b2cOnly", !f.b2cOnly)}>
                <span className="toggle-dot" />{f.b2cOnly ? "Ano" : "Ne"}
              </button>
            </Field>
          </div>
          <label className="field"><span>Účinky (oddělené čárkou)</span>
            <input value={f.ucinky} onChange={(e) => set("ucinky", e.target.value)} placeholder="Imunita, Trávení, Energie" /></label>
          <label className="field"><span>Poznámka</span>
            <textarea className="d-note" rows={2} value={f.poznamka} onChange={(e) => set("poznamka", e.target.value)} placeholder="Volitelná poznámka…" /></label>
          {readOnly && (
            <div className="modal-note">Jako uživatel s právem náhledu můžete přidat nový produkt do pipeline. Detailní hodnocení (ekonomika, skóre, rizika) doplní administrátor.</div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost2" onClick={onClose}>Zrušit</button>
          <button className="login-btn compact" onClick={submit} disabled={!ok}><Icon d={Ic.plus} size={15} /><span>Přidat produkt</span></button>
        </div>
      </div>
    </>
  );
}

/* ---------- Select ---------- */
function Select({ value, onChange, options, placeholder }) {
  return (
    <div className="select">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}: vše</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <Icon d={Ic.chevron} size={14} style={{ transform: "rotate(90deg)" }} />
    </div>
  );
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function KpiRow({ products, onFilter, active }) {
  const der = products.map((p) => ({ p, d: derive(p) }));
  const cnt = (f) => products.filter((p) => p.verdict === f).length;
  const onMarket = products.filter((p) => p.faze === "On market").length;
  const scored = der.filter((x) => x.d.skore != null);
  const avgScore = scored.length ? scored.reduce((a, x) => a + x.d.skore, 0) / scored.length : null;
  const stopCount = der.filter((x) => x.d.stopActive.length > 0).length;
  const is = (k) => active === k;
  return (
    <div className="kpis">
      <Kpi label="Produktů celkem" value={fmtNum(products.length)} onClick={() => onFilter({})} on={is("all")} />
      <Kpi label="Na trhu" value={fmtNum(onMarket)} accent="var(--pine)" onClick={() => onFilter({ phase: "On market" })} on={is("market")} />
      <Kpi label="Schváleno (Go)" value={fmtNum(cnt("Go"))} accent="var(--go)" onClick={() => onFilter({ verdict: "Go" })} on={is("go")} />
      <Kpi label="Hold" value={fmtNum(cnt("Hold"))} accent="var(--hold)" onClick={() => onFilter({ verdict: "Hold" })} on={is("hold")} />
      <Kpi label="Zamítnuto" value={fmtNum(cnt("No-go"))} accent="var(--nogo)" onClick={() => onFilter({ verdict: "No-go" })} on={is("nogo")} />
      <Kpi label="Se stop-flagem" value={fmtNum(stopCount)} accent="var(--nogo)" onClick={() => onFilter({ stop: true })} on={is("stop")} />
      <Kpi label="Prům. skóre" value={avgScore == null ? "—" : Math.round(avgScore)} accent={scoreColor(avgScore)} />
    </div>
  );
}

function RecentAnalyses({ products, onOpen, limit = 6 }) {
  const [list, setList] = useState(null);
  useEffect(() => { let live = true; (async () => { const l = await loadHistory(products); if (live) setList(l); })(); return () => { live = false; }; }, []);
  return (
    <section className="card">
      <div className="card-head"><h3>Historie analýz</h3><span className="card-sub">poslední provedené analýzy produktů</span></div>
      {list == null ? (
        <div className="analysis-loading"><span className="spinner" /> Načítám…</div>
      ) : !list.length ? (
        <div className="analysis-empty">Zatím žádné analýzy. Spusťte je v sekci Analýza nebo na detailu produktu.</div>
      ) : (
        <div className="recent-ana">
          {list.slice(0, limit).map((e) => (
            <button className="recent-row" key={e.id} onClick={() => onOpen && onOpen(e)}>
              <div className="recent-ic"><Icon d={Ic.beaker} size={15} /></div>
              <div className="recent-tx">
                <div className="recent-name">{e.produkt}</div>
                <div className="recent-meta">{e.rada}{e.updated ? " · " + new Date(e.updated).toLocaleDateString("cs-CZ") : ""}</div>
              </div>
              <div className="recent-dots">
                <span className={"hist-dot" + (e.comp ? " on" : "")} title="Konkurence" />
                <span className={"hist-dot" + (e.trend ? " on" : "")} title="Trendy" />
                <span className={"hist-dot" + (e.reco ? " on" : "")} title="Doporučení" />
                <span className={"hist-dot" + (e.refs ? " on" : "")} title="Studie & regulace" />
              </div>
              <Icon d={Ic.chevron} size={15} style={{ color: "var(--ink-3)", flex: "none" }} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Dashboard({ products, onOpen, onFilter, onEdit, onDelete, canEdit, onOpenAnalysis }) {
  const der = products.map((p) => ({ p, d: derive(p) }));
  const scored = der.filter((x) => x.d.skore != null);

  const phaseData = PHASES.map((ph) => ({
    name: ph, count: products.filter((p) => p.faze === ph).length,
    obrat: der.filter((x) => x.p.faze === ph).reduce((a, x) => a + (x.d.predpokladanyObrat || 0), 0),
  }));
  const maxPhase = Math.max(...phaseData.map((d) => d.count), 1);

  const seriesData = [...new Set(products.map((p) => p.rada))]
    .map((s) => ({ name: s, count: products.filter((p) => p.rada === s).length }))
    .sort((a, b) => b.count - a.count);

  const topScore = [...scored].sort((a, b) => b.d.skore - a.d.skore).slice(0, 15);

  return (
    <div className="dash">
      <div className="page-head">
        <div>
          <div className="eyebrow">Stav portfolia</div>
          <h1>Přehled vývoje produktů</h1>
        </div>
        <div className="head-meta">{products.length} produktů ve sledování</div>
      </div>

      {/* KPI */}
      <KpiRow products={products} onFilter={onFilter} />

      {/* TOP 15 — nejvýše hodnocené */}
      <section className="card">
        <div className="card-head"><h3>Nejvýše hodnocené produkty</h3><span className="card-sub">TOP 15 podle skóre (0–100)</span></div>
        <div className="topscore-scroll">
          <ProductTable rows={topScore} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} canEdit={canEdit} sortable={false} />
        </div>
      </section>

      {/* FUNNEL — signature */}
      <section className="card funnel-card">
        <div className="card-head"><h3>Vývojový trychtýř</h3><span className="card-sub">počet produktů a předpokládaný obrat dle fáze</span></div>
        <div className="funnel">
          {phaseData.map((d, i) => (
            <div className="funnel-row" key={d.name}>
              <div className="funnel-label"><span className="funnel-idx">{String(i + 1).padStart(2, "0")}</span>{d.name}</div>
              <div className="funnel-track">
                <div className="funnel-bar" style={{ width: `${(d.count / maxPhase) * 100}%`,
                  background: `linear-gradient(90deg, var(--pine), ${i >= 4 ? "var(--go)" : "var(--pine-light)"})` }}>
                  <span className="funnel-count">{d.count}</span>
                </div>
              </div>
              <div className="funnel-obrat">{d.obrat ? fmtKc(d.obrat) : ""}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="dash-grid">
        {/* historie analýz */}
        <RecentAnalyses products={products} onOpen={onOpenAnalysis} />

        {/* series bar */}
        <section className="card">
          <div className="card-head"><h3>Produkty dle řady</h3></div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={seriesData} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 8 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "var(--ink-2)" }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: "var(--ink-2)" }} />
                <Tooltip cursor={{ fill: "rgba(14,59,58,.05)" }} contentStyle={tipStyle} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="var(--pine)" barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

const tipStyle = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12, fontFamily: "var(--body)" };
function ScatterTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ ...tipStyle, padding: "8px 10px" }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
      <div>Skóre {d.skore} · Riziko {d.risk}</div>
      {d.obrat ? <div>{fmtKc(d.obrat)}</div> : null}
    </div>
  );
}
function Kpi({ label, value, accent, wide, onClick, on }) {
  const clickable = typeof onClick === "function";
  return (
    <div className={"kpi" + (wide ? " kpi-wide" : "") + (clickable ? " kpi-click" : "") + (on ? " kpi-on" : "")}
      onClick={onClick}
      role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}>
      <div className="kpi-label">{label}{clickable && <span className="kpi-arrow">→</span>}</div>
      <div className="kpi-value" style={accent ? { color: accent } : null}>{value}</div>
    </div>
  );
}

/* ============================================================
   PIPELINE (kanban)
   ============================================================ */
function Pipeline({ products, onMove, onOpen, canEdit }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Tok vývoje</div><h1>Pipeline</h1></div>
        <div className="head-meta">{canEdit ? "Přetáhněte kartu mezi fázemi" : "Režim pouze pro čtení"}</div>
      </div>
      <div className="kanban">
        {PHASES.map((ph) => {
          const items = products.filter((p) => p.faze === ph);
          const obrat = items.reduce((a, p) => a + (derive(p).predpokladanyObrat || 0), 0);
          return (
            <div key={ph} className={"kcol" + (over === ph ? " over" : "")}
              onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(ph); } }}
              onDragLeave={() => setOver((o) => (o === ph ? null : o))}
              onDrop={() => { if (canEdit && drag) onMove(drag, ph); setDrag(null); setOver(null); }}>
              <div className="kcol-head">
                <span className="kcol-title">{ph}</span>
                <span className="kcol-count">{items.length}</span>
              </div>
              {obrat > 0 && <div className="kcol-obrat">{fmtKc(obrat)}</div>}
              <div className="kcol-body">
                {items.map((p) => {
                  const d = derive(p);
                  return (
                    <div key={p.id} className="kcard" draggable={canEdit}
                      onDragStart={() => canEdit && setDrag(p.id)} onDragEnd={() => { setDrag(null); setOver(null); }}
                      onClick={() => onOpen(p.id)}
                      style={{ borderLeftColor: verdictColor(p.verdict) }}>
                      <div className="kcard-top">
                        <span className="kcard-name">{p.produkt}</span>
                        <ScoreRing value={d.skore} size={38} />
                      </div>
                      <div className="kcard-foot">
                        <span className="kcard-rada">{p.rada}</span>
                        <Badge color={verdictColor(p.verdict)}>{verdictLabel(p.verdict)}</Badge>
                      </div>
                      {d.stopActive.length ? (
                        <div className="kcard-stops">
                          <span className="kcard-stop-lbl">STOP</span>
                          {d.stopActive.map((c) => <span key={c} className="stop-mini" title={"Stop " + c}>{c}</span>)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {items.length === 0 && <div className="kempty">Žádné produkty</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   TABLE
   ============================================================ */
function SeriesPill({ value }) {
  return <span className="series-pill" style={{ background: seriesColor(value) }} title={value}>{value}</span>;
}
function PhasePill({ value }) {
  const m = phaseMeta(value);
  return <span className="phase-pill2" style={{ background: m.color }}><span className="phase-ic">{m.icon}</span>{value}</span>;
}
function ScoreBar({ value }) {
  const col = scoreColor(value);
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="scorebar">
      <div className="scorebar-track"><div className="scorebar-fill" style={{ width: pct + "%", background: col }} /></div>
      <span className="scorebar-num" style={{ color: col }}>{value == null ? "—" : Math.round(value)}</span>
    </div>
  );
}
function StopChip({ code }) {
  return <span className="stop-chip-tbl" title={"Stop " + code}>⚠ Stop {code}</span>;
}

/* ============================================================
   SCORING SETTINGS
   ============================================================ */
function ScoringSettings({ scoring, canEdit, products, onChange, onReset }) {
  const [draft, setDraft] = useState(scoring);
  useEffect(() => { setDraft(scoring); }, [scoring]);

  const setScoreW = (k, v) => setDraft((d) => ({ ...d, scoreW: { ...d.scoreW, [k]: v } }));
  const setRiskW = (k, v) => setDraft((d) => ({ ...d, riskW: { ...d.riskW, [k]: v } }));
  const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const scoreSum = SCORE_DEFS.reduce((a, def) => a + (Number(draft.scoreW[def.k]) || 0), 0);
  const riskSum = RISK_DEFS.reduce((a, def) => a + (Number(draft.riskW[def.k]) || 0), 0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(scoring);
  const formula = (defs, w) => defs.map((def) => `${(Number(w[def.k]) || 0)}·${def.k.toUpperCase()}`).join(" + ");

  const bands = useMemo(() => {
    let go = 0, hold = 0, no = 0, none = 0;
    (products || []).forEach((p) => {
      const vals = SCORE_DEFS.map((def) => { const v = p[def.k]; return v == null || v === "" || isNaN(v) ? null : Number(v); });
      if (!vals.some((v) => v != null)) { none++; return; }
      const s = SCORE_DEFS.reduce((a, def, i) => a + (Number(draft.scoreW[def.k]) || 0) * (vals[i] || 0), 0);
      if (s >= draft.goMin) go++; else if (s >= draft.holdMin) hold++; else no++;
    });
    return { go, hold, no, none };
  }, [products, draft]);

  const WeightRow = ({ def, value, onW }) => (
    <div className="sc-row">
      <div className="sc-key">{def.k.toUpperCase()}</div>
      <div className="sc-row-tx">
        <span className="sc-row-label">{def.label}</span>
        <span className="sc-row-hint">{def.hint || "váha faktoru"}</span>
      </div>
      <input className="sc-w" type="number" step="0.5" min="0" value={value ?? ""} disabled={!canEdit}
        onChange={(e) => onW(def.k, e.target.value === "" ? 0 : Number(e.target.value))} />
    </div>
  );

  return (
    <div className="page scoring-page">
      <div className="page-head">
        <div><div className="eyebrow">Konfigurace</div><h1>Nastavení scoringu</h1></div>
        <div className="head-meta">odvozeno ze zdrojových dat</div>
      </div>

      <section className="card sc-intro">
        <p>Skóre i riziko se počítají jako vážený součet faktorů hodnocených na škále <b>0–10</b>. Výchozí váhy odpovídají vzorcům ze zdrojové tabulky. Změna vah či prahů se ihned promítne do všech skóre v celé aplikaci.</p>
        {!canEdit && <div className="ro-banner"><Icon d={Ic.lock} size={14} /><span>Režim pouze pro čtení – nastavení může měnit jen administrátor.</span></div>}
      </section>

      <div className="sc-grid">
        <section className="card">
          <div className="card-head"><h3>Váhy skóre (S1–S5)</h3><span className="card-sub">vyšší skóre = atraktivnější produkt</span></div>
          {SCORE_DEFS.map((def) => <WeightRow key={def.k} def={def} value={draft.scoreW[def.k]} onW={setScoreW} />)}
          <div className="sc-formula">Skóre = {formula(SCORE_DEFS, draft.scoreW)}</div>
          <div className="sc-sum">Součet vah <b>{scoreSum}</b> · max. skóre <b>{scoreSum * 10}</b>{scoreSum !== 10 ? <span className="sc-warn"> (pro rozsah 0–100 by měl být součet 10)</span> : null}</div>
        </section>

        <section className="card">
          <div className="card-head"><h3>Váhy rizika (R1–R5)</h3><span className="card-sub">vyšší hodnota = příznivější (nižší riziko)</span></div>
          {RISK_DEFS.map((def) => <WeightRow key={def.k} def={def} value={draft.riskW[def.k]} onW={setRiskW} />)}
          <div className="sc-formula">Risk skóre = {formula(RISK_DEFS, draft.riskW)}</div>
          <div className="sc-sum">Součet vah <b>{riskSum}</b> · max. <b>{riskSum * 10}</b></div>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h3>Prahové hodnoty skóre</h3><span className="card-sub">určují barevné pásmo a klasifikaci</span></div>
        <div className="sc-thresh">
          <div className="sc-thresh-row">
            <span className="sc-dot" style={{ background: "var(--go)" }} />
            <span className="sc-thresh-l">Silný kandidát (zelená) — skóre ≥</span>
            <input className="sc-w" type="number" min="0" max="100" value={draft.goMin} disabled={!canEdit}
              onChange={(e) => setField("goMin", Number(e.target.value) || 0)} />
          </div>
          <div className="sc-thresh-row">
            <span className="sc-dot" style={{ background: "var(--hold)" }} />
            <span className="sc-thresh-l">Ke zvážení (oranžová) — skóre ≥</span>
            <input className="sc-w" type="number" min="0" max="100" value={draft.holdMin} disabled={!canEdit}
              onChange={(e) => setField("holdMin", Number(e.target.value) || 0)} />
          </div>
          <div className="sc-thresh-row">
            <span className="sc-dot" style={{ background: "var(--nogo)" }} />
            <span className="sc-thresh-l">Slabý profil (červená) — skóre pod hranicí „ke zvážení"</span>
          </div>
        </div>
        <div className="sc-preview">
          <div className="sc-preview-t">Dopad na portfolio (živý náhled)</div>
          <div className="sc-bands">
            <span className="sc-band"><b style={{ color: "var(--go)" }}>{bands.go}</b> silných</span>
            <span className="sc-band"><b style={{ color: "var(--hold)" }}>{bands.hold}</b> ke zvážení</span>
            <span className="sc-band"><b style={{ color: "var(--nogo)" }}>{bands.no}</b> slabých</span>
            <span className="sc-band"><b style={{ color: "var(--ink-3)" }}>{bands.none}</b> nehodnoceno</span>
          </div>
        </div>
      </section>

      {canEdit && (
        <div className="sc-actions">
          <button className="btn-ghost2" onClick={onReset}><Icon d={Ic.reset} size={15} /><span>Obnovit výchozí (dle zdroje)</span></button>
          <button className="login-btn compact" disabled={!dirty} onClick={() => onChange(JSON.parse(JSON.stringify(draft)))}>Uložit změny</button>
        </div>
      )}
    </div>
  );
}

function ProductTable({ rows, sort, onSort, onOpen, onEdit, onDelete, canEdit, sortable = true }) {
  const th = (key, label, align) => (
    <th onClick={sortable ? () => onSort(key) : undefined}
      style={{ textAlign: align || "left", cursor: sortable ? "pointer" : "default" }}>
      {label}{sortable && sort && sort.key === key && <span className="sort-ar">{sort.dir === -1 ? " ↓" : " ↑"}</span>}
    </th>
  );
  return (
    <table className="ptable wide">
      <thead><tr>
        {th("produkt", "Produkt")}
        {th("rada", "Řada")}
        {th("faze", "Fáze")}
        <th>Verdikt</th>
        {th("vyrobniCena", "Výrobní cena", "right")}
        {th("moq", "MOQ", "right")}
        {th("vstupniNaklad", "Vstupní náklad", "right")}
        {th("dmoc", "DMOC", "right")}
        {th("marze", "Marže e-shop", "right")}
        {th("marzeB2B", "Marže B2B", "right")}
        {th("skore", "Skóre")}
        {th("risk", "Risk", "center")}
        {th("obrat", "Předpokládaný obrat", "right")}
        <th style={{ textAlign: "center" }}>Akce</th>
      </tr></thead>
      <tbody>
        {rows.map(({ p, d }) => (
          <tr key={p.id} onClick={() => onOpen(p.id)}>
            <td><span className="cell-name">{p.produkt}</span>
              {p.ucinky?.length ? <span className="cell-tags">{p.ucinky.slice(0, 3).join(" · ")}</span> : null}</td>
            <td><SeriesPill value={p.rada} /></td>
            <td><PhasePill value={p.faze} /></td>
            <td className="verdict-cell">
              {p.verdict ? <Badge color={verdictColor(p.verdict)} solid>{verdictLabel(p.verdict)}</Badge> : null}
              {d.stopActive.map((c) => <StopChip key={c} code={c} />)}
            </td>
            <td style={{ textAlign: "right" }}><span className="num">{p.vyrobniCena == null ? "—" : fmtKc(p.vyrobniCena)}</span></td>
            <td style={{ textAlign: "right" }}><span className="num">{p.moq == null ? "—" : fmtNum(p.moq) + " ks"}</span></td>
            <td style={{ textAlign: "right" }}><span className="num">{d.vstupniNaklad == null ? "—" : fmtKc(d.vstupniNaklad)}</span></td>
            <td style={{ textAlign: "right" }}><span className="num">{p.dmoc == null ? "—" : fmtKc(p.dmoc)}</span></td>
            <td style={{ textAlign: "right" }}>{d.marzeEshop == null ? <span className="num">—</span> : <span className="mtag green">{fmtPct(d.marzeEshop)}</span>}</td>
            <td style={{ textAlign: "right" }}>{d.marzeB2B == null ? <span className="num">—</span> : <span className="mtag red">{fmtPct(d.marzeB2B)}</span>}</td>
            <td className="score-cell"><ScoreBar value={d.skore} /></td>
            <td style={{ textAlign: "center" }}><span className="num" style={{ color: scoreColor(d.riskSkore), fontWeight: 600 }}>{d.riskSkore ?? "—"}</span></td>
            <td style={{ textAlign: "right" }} className="num strong">{d.predpokladanyObrat ? fmtKc(d.predpokladanyObrat) : "—"}</td>
            <td onClick={(e) => e.stopPropagation()}>
              <div className="row-actions">
                <button className="act-btn" title="Zobrazit detail" onClick={() => onOpen(p.id)}><Icon d={Ic.eye} size={16} /></button>
                {canEdit && <button className="act-btn" title="Upravit produkt" onClick={() => onEdit(p.id)}><Icon d={Ic.edit} size={15} /></button>}
                {canEdit && <button className="act-btn danger" title="Smazat produkt" onClick={() => onDelete(p.id)}><Icon d={Ic.trash} size={15} /></button>}
              </div>
            </td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={14} className="empty-row">Žádné produkty neodpovídají filtru.</td></tr>}
      </tbody>
    </table>
  );
}

function Tabulka({ products, onOpen, onEdit, onDelete, canEdit, allProducts, onFilter, active }) {
  const [sort, setSort] = useState({ key: "skore", dir: -1 });
  const rows = products.map((p) => ({ p, d: derive(p) }));
  const val = (x, k) => {
    if (k === "skore") return x.d.skore ?? -1;
    if (k === "risk") return x.d.riskSkore ?? -1;
    if (k === "marze") return x.d.marzeEshop ?? -1;
    if (k === "marzeB2B") return x.d.marzeB2B ?? -1;
    if (k === "vstupniNaklad") return x.d.vstupniNaklad ?? -1;
    if (k === "obrat") return x.d.predpokladanyObrat ?? -1;
    if (k === "produkt" || k === "rada" || k === "faze") return (x.p[k] || "").toLowerCase();
    return x.p[k] ?? -1;
  };
  rows.sort((a, b) => {
    const va = val(a, sort.key), vb = val(b, sort.key);
    if (va < vb) return -1 * sort.dir; if (va > vb) return 1 * sort.dir; return 0;
  });
  const onSort = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }));
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Databáze</div><h1>Produkty</h1></div>
        <div className="head-meta">{products.length} záznamů</div>
      </div>
      {onFilter && <KpiRow products={allProducts || products} onFilter={onFilter} active={active} />}
      <div className="card table-card">
        <ProductTable rows={rows} sort={sort} onSort={onSort} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} canEdit={canEdit} sortable />
      </div>
    </div>
  );
}

/* ============================================================
   DETAIL PAGE (read-only) + AI analýzy
   ============================================================ */
function DetailPage({ product, canEdit, onBack, onEdit, onDelete }) {
  const d = derive(product);
  const pageRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [pdfErr, setPdfErr] = useState(false);
  const handleExport = async () => {
    const el = pageRef.current;
    if (!el || exporting) return;
    setPdfErr(false); setExporting(true);
    el.classList.add("pdf-export");
    const fname = "MOVit-" + (product.produkt || "produkt").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w\-áčďéěíňóřšťúůýž]/g, "") + ".pdf";
    try {
      await exportElementToPDF(el, fname);
    } catch (e) {
      setPdfErr(true);
    } finally {
      el.classList.remove("pdf-export");
      setExporting(false);
    }
  };
  const Info = ({ label, value }) => (
    <div className="dp-info"><div className="dp-info-l">{label}</div><div className="dp-info-v">{value}</div></div>
  );
  return (
    <div className="page detail-page" ref={pageRef}>
      <div className="dp-top">
        <button className="back-btn" onClick={onBack}><Icon d={Ic.back} size={16} /><span>Zpět na produkty</span></button>
        <div className="dp-actions">
          <button className="ghost-btn2" onClick={handleExport} disabled={exporting}>
            <Icon d={exporting ? Ic.refresh : Ic.pdf} size={15} /><span>{exporting ? "Generuji PDF…" : "Export PDF"}</span>
          </button>
          {canEdit && <button className="ghost-btn2" onClick={onEdit}><Icon d={Ic.edit} size={15} /><span>Upravit</span></button>}
          {canEdit && <button className="ghost-btn2 danger" onClick={onDelete}><Icon d={Ic.trash} size={15} /><span>Smazat</span></button>}
        </div>
      </div>
      {pdfErr && <div className="analysis-err" style={{ marginBottom: 14 }}>PDF se nepodařilo vygenerovat (nelze načíst generátor). Zkuste to prosím znovu, nebo použijte tisk prohlížeče (Ctrl/Cmd+P → Uložit jako PDF).</div>}

      <div className="print-only print-head">MOVit Energy — Detail produktu · {new Date().toLocaleDateString("cs-CZ")}</div>

      <div className="dp-head">
        <ScoreRing value={d.skore} size={66} />
        <div className="dp-head-tx">
          <div className="eyebrow">Detail produktu</div>
          <h1>{product.produkt}</h1>
          <div className="dp-badges">
            <SeriesPill value={product.rada} />
            <PhasePill value={product.faze} />
            {product.verdict ? <Badge color={verdictColor(product.verdict)} solid>{verdictLabel(product.verdict)}</Badge> : null}
            {d.stopActive.map((c) => <StopChip key={c} code={c} />)}
          </div>
        </div>
      </div>

      <section className="card">
        <div className="card-head"><h3>Klíčové údaje</h3></div>
        <div className="dp-grid">
          <Info label="Výrobní cena" value={product.vyrobniCena == null ? "—" : fmtKc(product.vyrobniCena)} />
          <Info label="MOQ" value={product.moq == null ? "—" : fmtNum(product.moq) + " ks"} />
          <Info label="Vstupní náklad" value={d.vstupniNaklad == null ? "—" : fmtKc(d.vstupniNaklad)} />
          <Info label="DMOC (s DPH)" value={product.dmoc == null ? "—" : fmtKc(product.dmoc)} />
          <Info label="VOC" value={product.voc == null ? "—" : fmtKc(product.voc)} />
          <Info label="Marže e-shop" value={fmtPct(d.marzeEshop)} />
          <Info label="Marže B2B" value={fmtPct(d.marzeB2B)} />
          <Info label="Skóre" value={d.skore == null ? "—" : Math.round(d.skore) + " / 100"} />
          <Info label="Risk skóre" value={d.riskSkore ?? "—"} />
          <Info label="Forecast" value={product.forecastKsRok == null ? "—" : fmtNum(product.forecastKsRok) + " ks/rok"} />
          <Info label="Předpokládaný obrat" value={d.predpokladanyObrat ? fmtKc(d.predpokladanyObrat) : "—"} />
          <Info label="Cena konkurence" value={product.cenaKonkurence == null ? "—" : fmtKc(product.cenaKonkurence)} />
        </div>
        {product.ucinky?.length ? (
          <div className="dp-extra"><div className="dp-info-l">Účinky</div>
            <div className="tags-edit ro">{product.ucinky.map((t, i) => <span className="tag" key={i}>{t}</span>)}</div></div>
        ) : null}
        {product.poznamka ? (
          <div className="dp-extra"><div className="dp-info-l">Poznámka</div><p className="dp-note-txt">{product.poznamka}</p></div>
        ) : null}
      </section>

      <div className="dp-score-grid">
        <section className="card">
          <div className="card-head"><h3>Hodnocení (skóre)</h3><span className="sec-num" style={{ marginLeft: "auto", color: scoreColor(d.skore) }}>{d.skore == null ? "—" : Math.round(d.skore)}/100</span></div>
          {SCORE_DEFS.map((def) => (
            <Slider key={def.k} label={def.label} hint={`${def.hint} · váha ${String(SCORING.scoreW[def.k] ?? def.w).replace(".", ",")}`}
              value={product[def.k]} readOnly />
          ))}
        </section>
        <section className="card">
          <div className="card-head"><h3>Rizika</h3>{d.riskSkore != null ? <span className="sec-num" style={{ marginLeft: "auto" }}>{d.riskSkore}/100</span> : null}</div>
          {RISK_DEFS.map((def) => (
            <Slider key={def.k} label={def.label} hint={`váha ${String(SCORING.riskW[def.k] ?? def.w).replace(".", ",")}`}
              value={product[def.k]} readOnly risk />
          ))}
        </section>
      </div>

      <CompetitionAnalysis product={product} />
      <TrendAnalysis product={product} />
      <RecommendationAnalysis product={product} />
      <ReferencesAnalysis product={product} />
    </div>
  );
}

function useAnalysis(storeKey, runner, product, autoRun = false) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [ts, setTs] = useState(null);
  const run = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await runner(product);
      const t = Date.now();
      setData(res); setTs(t);
      await saveAnalysis(storeKey, { data: res, ts: t });
      const type = storeKey.startsWith("movit:comp") ? "comp" : storeKey.startsWith("movit:trend") ? "trend" : storeKey.startsWith("movit:reco") ? "reco" : storeKey.startsWith("movit:refs") ? "refs" : null;
      if (type) recordAnalysisHistory(product, type, t);
    } catch (e) {
      setErr("Analýzu se nepodařilo načíst. Zkontrolujte připojení a zkuste to prosím znovu.");
    }
    setLoading(false);
  };
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    let live = true;
    setData(null); setErr(null); setTs(null);
    (async () => {
      const c = await loadAnalysis(storeKey);
      if (!live) return;
      if (c) { setData(c.data); setTs(c.ts); }
      else if (autoRun) { runRef.current(); }
    })();
    return () => { live = false; };
  }, [storeKey]);
  return { data, loading, err, ts, run };
}

function CompetitionAnalysis({ product, autoRun }) {
  const { data, loading, err, ts, run } = useAnalysis("movit:comp:" + product.id, analyzeCompetition, product, autoRun);
  return (
    <section className="card analysis-card">
      <div className="card-head">
        <div><h3 className="ic-h3"><Icon d={Ic.store} size={17} /> Analýza konkurence</h3>
          <span className="card-sub">10 nejprodávanějších konkurenčních produktů na českém trhu</span></div>
        <button className="run-btn" onClick={run} disabled={loading}>
          <Icon d={data ? Ic.refresh : Ic.search} size={15} /><span>{loading ? "Analyzuji…" : data ? "Aktualizovat" : "Spustit analýzu"}</span>
        </button>
      </div>
      {loading && <div className="analysis-loading"><span className="spinner" /> Vyhledávám konkurenční produkty na českém trhu…</div>}
      {err && <div className="analysis-err">{err}</div>}
      {!data && !loading && !err && <div className="analysis-empty">Spusťte analýzu pro vyhledání konkurence k produktu „{product.produkt}".</div>}
      {data && (
        <>
          {data.shrnuti && <p className="analysis-summary">{data.shrnuti}</p>}
          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead><tr><th>#</th><th>Produkt</th><th>Výrobce</th><th style={{ textAlign: "right" }}>Cena</th><th>Balení</th><th style={{ textAlign: "right" }}>Cena/ks</th><th>Hodnocení</th><th></th></tr></thead>
              <tbody>
                {(data.produkty || []).map((c, i) => (
                  <tr key={i}>
                    <td className="ac-idx">{i + 1}</td>
                    <td className="ac-name">{c.nazev}{c.poznamka ? <span className="ac-note">{c.poznamka}</span> : null}</td>
                    <td>{c.vyrobce || "—"}</td>
                    <td className="num" style={{ textAlign: "right" }}>{c.cena || "—"}</td>
                    <td>{c.baleni || "—"}</td>
                    <td className="num" style={{ textAlign: "right" }}>{c.cenaZaKus || "—"}</td>
                    <td>{c.hodnoceni || "—"}</td>
                    <td>{c.odkaz ? <a href={c.odkaz} target="_blank" rel="noreferrer" className="ac-link" title="Otevřít produkt"><Icon d={Ic.external} size={15} /></a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="analysis-note">Data sestavena z webového vyhledávání (Heureka, Zboží.cz, e-shopy) — ceny a dostupnost ověřte u zdroje.{ts ? " Aktualizováno " + new Date(ts).toLocaleString("cs-CZ") + "." : ""}</div>
        </>
      )}
    </section>
  );
}

function TrendTag({ t }) {
  const v = (t || "").toLowerCase();
  const col = v.includes("rost") ? "var(--go)" : v.includes("kles") ? "var(--nogo)" : "var(--hold)";
  const arrow = v.includes("rost") ? "↑" : v.includes("kles") ? "↓" : "→";
  return <span className="trend-tag" style={{ color: col, borderColor: col }}>{arrow} {t || "stabilní"}</span>;
}

function TrendAnalysis({ product, autoRun }) {
  const { data, loading, err, ts, run } = useAnalysis("movit:trend:" + product.id, analyzeTrends, product, autoRun);
  const fnum = (v) => (v == null || v === "" ? "—" : fmtNum(v));
  return (
    <section className="card analysis-card">
      <div className="card-head">
        <div><h3 className="ic-h3"><Icon d={Ic.chart} size={17} /> Analýza trendovosti vyhledávání</h3>
          <span className="card-sub">vyhledávanost klíčových slov a CPC z Google Ads (odhady)</span></div>
        <button className="run-btn" onClick={run} disabled={loading}>
          <Icon d={data ? Ic.refresh : Ic.search} size={15} /><span>{loading ? "Analyzuji…" : data ? "Aktualizovat" : "Spustit analýzu"}</span>
        </button>
      </div>
      {loading && <div className="analysis-loading"><span className="spinner" /> Analyzuji vyhledávanost klíčových slov…</div>}
      {err && <div className="analysis-err">{err}</div>}
      {!data && !loading && !err && <div className="analysis-empty">Spusťte analýzu trendovosti pro klíčová slova z názvu „{product.produkt}".</div>}
      {data && (
        <>
          {data.shrnuti && <p className="analysis-summary">{data.shrnuti}</p>}
          {data.casovaRada?.length ? (
            <div style={{ height: 250, marginBottom: 18 }}>
              <ResponsiveContainer>
                <AreaChart data={data.casovaRada} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
                  <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--pine-light)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--pine-light)" stopOpacity={0} />
                  </linearGradient></defs>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="obdobi" tick={{ fontSize: 11, fill: "var(--ink-2)" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--ink-2)" }} />
                  <Tooltip contentStyle={tipStyle} />
                  <Area type="monotone" dataKey="index" name="Index vyhledávanosti" stroke="var(--pine)" strokeWidth={2.2} fill="url(#tg)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : null}
          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead><tr>
                <th>Klíčové slovo</th><th>Trend</th>
                <th style={{ textAlign: "right" }}>6 měs.</th><th style={{ textAlign: "right" }}>12 měs.</th>
                <th style={{ textAlign: "right" }}>24 měs.</th><th style={{ textAlign: "right" }}>36 měs.</th>
                <th style={{ textAlign: "right" }}>CPC</th><th>Obtížnost</th>
              </tr></thead>
              <tbody>
                {(data.klicovaSlova || []).map((k, i) => (
                  <tr key={i}>
                    <td className="ac-name">{k.slovo}</td>
                    <td><TrendTag t={k.trend} /></td>
                    <td className="num" style={{ textAlign: "right" }}>{fnum(k.objem6)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{fnum(k.objem12)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{fnum(k.objem24)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{fnum(k.objem36)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{k.cpc || "—"}</td>
                    <td>{k.obtiznost || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="analysis-note">Objemy (průměr hledání / měsíc) i CPC jsou kvalifikované odhady sestavené z webového vyhledávání, ne data z napojeného účtu Google Ads / Trends. Pro produkční přesnost doporučujeme napojit Google Ads API nebo nástroj jako Marketing Miner či DataForSEO.{ts ? " Aktualizováno " + new Date(ts).toLocaleString("cs-CZ") + "." : ""}</div>
        </>
      )}
    </section>
  );
}

/* ============================================================
   ANALÝZA PRODUKTŮ (samostatná sekce)
   ============================================================ */
const RECO_COLOR = {
  "ANO": "var(--go)", "SPÍŠE ANO": "#3FA66F", "ZVÁŽIT": "var(--hold)",
  "SPÍŠE NE": "#D97A3D", "NE": "var(--nogo)",
};
function RecommendationAnalysis({ product, autoRun }) {
  const { data, loading, err, ts, run } = useAnalysis("movit:reco:" + product.id, analyzeRecommendation, product, autoRun);
  const col = data ? (RECO_COLOR[(data.doporuceni || "").toUpperCase()] || "var(--hold)") : "var(--hold)";
  const List = ({ items }) => <ul className="reco-list">{(items || []).map((x, i) => <li key={i}>{x}</li>)}</ul>;
  return (
    <section className="card analysis-card">
      <div className="card-head">
        <div><h3 className="ic-h3"><Icon d={Ic.target} size={17} /> Doporučení &amp; SWOT</h3>
          <span className="card-sub">zda a proč produkt vyrobit a zařadit do nabídky</span></div>
        <button className="run-btn" onClick={run} disabled={loading}>
          <Icon d={data ? Ic.refresh : Ic.search} size={15} /><span>{loading ? "Analyzuji…" : data ? "Aktualizovat" : "Spustit analýzu"}</span>
        </button>
      </div>
      {loading && <div className="analysis-loading"><span className="spinner" /> Vyhodnocuji atraktivitu produktu…</div>}
      {err && <div className="analysis-err">{err}</div>}
      {!data && !loading && !err && <div className="analysis-empty">Spusťte analýzu pro doporučení a SWOT k produktu „{product.produkt}".</div>}
      {data && (
        <>
          <div className="reco-verdict" style={{ borderColor: col }}>
            <div className="reco-badge" style={{ background: col }}>{data.doporuceni || "—"}</div>
            <div className="reco-score">Atraktivita <b style={{ color: col }}>{data.skore ?? "—"}</b><span>/100</span></div>
            {data.shrnuti && <p className="reco-summary">{data.shrnuti}</p>}
          </div>
          <div className="reco-cols">
            <div className="reco-col plus"><h4>Klady</h4><List items={data.plus} /></div>
            <div className="reco-col minus"><h4>Zápory</h4><List items={data.minus} /></div>
          </div>
          {data.swot && (
            <div className="swot">
              <div className="swot-q s"><h4>Silné stránky</h4><List items={data.swot.silne} /></div>
              <div className="swot-q w"><h4>Slabé stránky</h4><List items={data.swot.slabe} /></div>
              <div className="swot-q o"><h4>Příležitosti</h4><List items={data.swot.prilezitosti} /></div>
              <div className="swot-q t"><h4>Hrozby</h4><List items={data.swot.hrozby} /></div>
            </div>
          )}
          {data.komentar && <div className="reco-comment"><h4>Komentář a doporučení</h4><p>{data.komentar}</p></div>}
          <div className="analysis-note">Vyhodnocení je AI analýza sestavená z webového vyhledávání jako podklad pro rozhodnutí, nikoli závazné doporučení.{ts ? " Aktualizováno " + new Date(ts).toLocaleString("cs-CZ") + "." : ""}</div>
        </>
      )}
    </section>
  );
}

function RefList({ items, kind }) {
  if (!items || !items.length) return <div className="analysis-empty" style={{ padding: "4px 0 0" }}>Žádné zdroje nenalezeny.</div>;
  return (
    <div className="ref-list">
      {items.map((r, i) => (
        <div className="ref-item" key={i}>
          <div className="ref-ic"><Icon d={kind === "reg" ? Ic.lock : Ic.beaker} size={15} /></div>
          <div className="ref-tx">
            <div className="ref-name">{r.nazev}{kind === "reg" && r.urad ? <span className="ref-urad">{r.urad}</span> : null}</div>
            {r.popis ? <div className="ref-desc">{r.popis}</div> : null}
            {r.odkaz ? <a className="ref-link" href={r.odkaz} target="_blank" rel="noreferrer">{r.odkaz}<Icon d={Ic.external} size={13} /></a> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReferencesAnalysis({ product, autoRun }) {
  const { data, loading, err, ts, run } = useAnalysis("movit:refs:" + product.id, analyzeReferences, product, autoRun);
  return (
    <section className="card analysis-card">
      <div className="card-head">
        <div><h3 className="ic-h3"><Icon d={Ic.external} size={17} /> Studie &amp; regulace</h3>
          <span className="card-sub">vědecké studie (svět) a regulační zdroje úřadů ČR/EU</span></div>
        <button className="run-btn" onClick={run} disabled={loading}>
          <Icon d={data ? Ic.refresh : Ic.search} size={15} /><span>{loading ? "Analyzuji…" : data ? "Aktualizovat" : "Spustit analýzu"}</span>
        </button>
      </div>
      {loading && <div className="analysis-loading"><span className="spinner" /> Vyhledávám studie a regulační zdroje…</div>}
      {err && <div className="analysis-err">{err}</div>}
      {!data && !loading && !err && <div className="analysis-empty">Spusťte analýzu pro vyhledání vědeckých studií a regulačních zdrojů k „{product.produkt}".</div>}
      {data && (
        <>
          {data.shrnuti && <p className="analysis-summary">{data.shrnuti}</p>}
          <div className="ref-block-t">Vědecké studie (celý svět)</div>
          <RefList items={data.studie} kind="study" />
          <div className="ref-block-t" style={{ marginTop: 18 }}>Regulace a restrikce (úřady ČR &amp; EU)</div>
          <RefList items={data.regulace} kind="reg" />
          <div className="analysis-note">Zdroje jsou dohledané přes webové vyhledávání — před použitím (zejména u zdravotních tvrzení a regulace) ověřte u primárního zdroje.{ts ? " Aktualizováno " + new Date(ts).toLocaleString("cs-CZ") + "." : ""}</div>
        </>
      )}
    </section>
  );
}

function AnalyzaSection({ onAddProduct, canEdit, products, detail, setDetail }) {
  const [tab, setTab] = useState("new");

  if (detail) {
    return <AnalysisDetailView entry={detail} onBack={() => { setDetail(null); setTab("history"); }} onAddProduct={onAddProduct} />;
  }
  return (
    <div className="page analyza-page">
      <div className="page-head">
        <div><div className="eyebrow">Rychlá analýza</div><h1>Analýza produktů</h1></div>
      </div>
      <div className="subtabs">
        <button className={"subtab" + (tab === "new" ? " on" : "")} onClick={() => setTab("new")}><Icon d={Ic.beaker} size={15} /><span>Nová analýza</span></button>
        <button className={"subtab" + (tab === "history" ? " on" : "")} onClick={() => setTab("history")}><Icon d={Ic.table} size={15} /><span>Historie analýz</span></button>
      </div>
      {tab === "new" && <AnalyzaNew onAddProduct={onAddProduct} />}
      {tab === "history" && <AnalysisHistory products={products} onOpen={(e) => setDetail(e)} />}
    </div>
  );
}

function AnalyzaNew({ onAddProduct }) {
  const [phase, setPhase] = useState("form");
  const [name, setName] = useState("");
  const [cat, setCat] = useState("—");
  const [ana, setAna] = useState(null);
  const slug = (s) => s.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w\-áčďéěíňóřšťúůýž]/g, "");
  const start = () => {
    if (!name.trim()) return;
    setAna({ id: "ana:" + slug(name) + "|" + cat, produkt: name.trim(), rada: cat });
    setPhase("results");
  };
  const reset = () => { setPhase("form"); setName(""); setCat("—"); setAna(null); };

  if (phase === "form") {
    return (
      <section className="card ana-form-card">
        <div className="ana-form-intro">
          <div className="ana-form-ic"><Icon d={Ic.beaker} size={22} /></div>
          <p>Rychle posuďte atraktivitu potenciálního produktu před zařazením do nabídky. Zadejte název, vyberte kategorii a spusťte analýzu konkurence, vyhledávanosti a doporučení.</p>
        </div>
        <div className="ana-form">
          <label className="field"><span>Název produktu</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") start(); }} placeholder="např. Hořčík bisglycinát 400 mg" /></label>
          <label className="field"><span>Kategorie (Řada)</span>
            <div className="select full"><select value={cat} onChange={(e) => setCat(e.target.value)}>{SERIES.map((s) => <option key={s} value={s}>{s === "—" ? "Nezařazeno" : s}</option>)}</select>
              <Icon d={Ic.chevron} size={14} style={{ transform: "rotate(90deg)" }} /></div></label>
          <button className="login-btn" disabled={!name.trim()} onClick={start}><Icon d={Ic.beaker} size={16} /><span>Analyzovat</span></button>
        </div>
      </section>
    );
  }

  return (
    <div className="ana-results">
      <div className="dp-head">
        <div className="ana-result-ic"><Icon d={Ic.beaker} size={26} /></div>
        <div className="dp-head-tx">
          <div className="eyebrow">Analýza produktu</div>
          <h1>{ana.produkt}</h1>
          <div className="dp-badges"><SeriesPill value={ana.rada} /></div>
        </div>
      </div>

      <CompetitionAnalysis product={ana} autoRun />
      <TrendAnalysis product={ana} autoRun />
      <RecommendationAnalysis product={ana} autoRun />
      <ReferencesAnalysis product={ana} autoRun />

      <div className="ana-actions">
        <button className="btn-ghost2" onClick={reset}><Icon d={Ic.refresh} size={15} /><span>Vytvořit novou analýzu</span></button>
        <button className="login-btn compact" onClick={() => onAddProduct(ana)}><Icon d={Ic.plus} size={15} /><span>Přidat do seznamu produktů</span></button>
      </div>
    </div>
  );
}

function HistDot({ ok }) {
  return <span className={"hist-dot" + (ok ? " on" : "")} title={ok ? "Provedeno" : "Neprovedeno"} />;
}
function AnalysisHistory({ products, onOpen }) {
  const [list, setList] = useState(null);
  useEffect(() => { let live = true; (async () => { const l = await loadHistory(products); if (live) setList(l); })(); return () => { live = false; }; }, []);
  if (list == null) return <div className="analysis-loading"><span className="spinner" /> Načítám historii analýz…</div>;
  if (!list.length) return <div className="analysis-empty">Zatím nebyla provedena žádná analýza. Spusťte ji v záložce „Nová analýza" nebo na detailu produktu.</div>;
  return (
    <div className="card table-card">
      <table className="ptable">
        <thead><tr>
          <th>Produkt</th><th>Kategorie</th>
          <th style={{ textAlign: "center" }}>Konkurence</th>
          <th style={{ textAlign: "center" }}>Trendy</th>
          <th style={{ textAlign: "center" }}>Doporučení</th>
          <th style={{ textAlign: "center" }}>Studie/regulace</th>
          <th>Poslední analýza</th>
          <th style={{ textAlign: "center" }}>Akce</th>
        </tr></thead>
        <tbody>
          {list.map((e) => (
            <tr key={e.id} onClick={() => onOpen(e)}>
              <td><span className="cell-name">{e.produkt}</span>
                <span className="cell-tags">{String(e.id).startsWith("ana:") ? "rychlá analýza" : "produkt z portfolia"}</span></td>
              <td><SeriesPill value={e.rada} /></td>
              <td style={{ textAlign: "center" }}><HistDot ok={!!e.comp} /></td>
              <td style={{ textAlign: "center" }}><HistDot ok={!!e.trend} /></td>
              <td style={{ textAlign: "center" }}><HistDot ok={!!e.reco} /></td>
              <td style={{ textAlign: "center" }}><HistDot ok={!!e.refs} /></td>
              <td className="num">{e.updated ? new Date(e.updated).toLocaleString("cs-CZ") : "—"}</td>
              <td onClick={(ev) => ev.stopPropagation()} style={{ textAlign: "center" }}>
                <button className="act-btn" title="Zobrazit analýzu" onClick={() => onOpen(e)}><Icon d={Ic.eye} size={16} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalysisDetailView({ entry, onBack, onAddProduct }) {
  const ana = { id: entry.id, produkt: entry.produkt, rada: entry.rada };
  const isQuick = String(entry.id).startsWith("ana:");
  return (
    <div className="page analyza-page">
      <div className="dp-top">
        <button className="back-btn" onClick={onBack}><Icon d={Ic.back} size={16} /><span>Zpět na historii</span></button>
      </div>
      <div className="dp-head">
        <div className="ana-result-ic"><Icon d={Ic.beaker} size={26} /></div>
        <div className="dp-head-tx">
          <div className="eyebrow">{isQuick ? "Uložená analýza" : "Analýza produktu z portfolia"}</div>
          <h1>{ana.produkt}</h1>
          <div className="dp-badges"><SeriesPill value={ana.rada} /></div>
        </div>
      </div>

      <CompetitionAnalysis product={ana} />
      <TrendAnalysis product={ana} />
      <RecommendationAnalysis product={ana} />
      <ReferencesAnalysis product={ana} />

      {isQuick && (
        <div className="ana-actions">
          <button className="login-btn compact" onClick={() => onAddProduct(ana)}><Icon d={Ic.plus} size={15} /><span>Přidat do seznamu produktů</span></button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   DETAIL DRAWER
   ============================================================ */
function Drawer({ product, onClose, onChange, onDelete, canEdit }) {
  const d = derive(product);
  const num = (k) => (e) => { const v = e.target.value; onChange({ [k]: v === "" ? null : Number(v.replace(",", ".")) }); };
  const txt = (k) => (e) => onChange({ [k]: e.target.value });

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div style={{ flex: 1 }}>
            <input className="d-title" value={product.produkt} onChange={txt("produkt")} disabled={!canEdit} />
            <div className="d-sub">
              <Badge color={verdictColor(product.verdict)} solid>{verdictLabel(product.verdict)}</Badge>
              <span>{product.rada} · {product.faze}</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon d={Ic.close} size={18} /></button>
        </div>

        <div className="drawer-body">
          {/* score hero */}
          <div className="d-hero">
            <ScoreRing value={d.skore} size={68} />
            <div className="d-hero-tx">
              <div className="d-hero-label">Celkové skóre</div>
              <div className="d-hero-sub">{d.skore == null ? "Nehodnoceno" : d.skore >= 70 ? "Silný kandidát" : d.skore >= 55 ? "Ke zvážení" : "Slabý profil"}</div>
            </div>
            {d.riskSkore != null && (
              <div className="d-hero-risk">
                <div className="d-hero-label">Riziko</div>
                <div className="d-risk-val">{d.riskSkore}<span>/100</span></div>
              </div>
            )}
          </div>

          {!canEdit && (
            <div className="ro-banner"><Icon d={Ic.lock} size={14} /><span>Režim pouze pro čtení – úpravy jsou zakázané.</span></div>
          )}

          <fieldset className="d-edit" disabled={!canEdit}>
          {/* classification */}
          <Section title="Zařazení">
            <div className="grid2">
              <Field label="Řada"><select value={product.rada} onChange={txt("rada")}>{SERIES.map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Fáze"><select value={product.faze} onChange={txt("faze")}>{PHASES.map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Verdikt"><select value={product.verdict} onChange={txt("verdict")}>{VERDICTS.map((v) => <option key={v} value={v}>{verdictLabel(v)}</option>)}</select></Field>
              <Field label="Pouze B2C">
                <button className={"toggle" + (product.b2cOnly ? " on" : "")} onClick={() => onChange({ b2cOnly: !product.b2cOnly })}>
                  <span className="toggle-dot" />{product.b2cOnly ? "Ano" : "Ne"}
                </button>
              </Field>
            </div>
          </Section>

          {/* economics */}
          <Section title="Ekonomika">
            <div className="grid2">
              <NumField label="Výrobní cena (Kč)" value={product.vyrobniCena} onChange={num("vyrobniCena")} />
              <NumField label="MOQ (ks)" value={product.moq} onChange={num("moq")} />
              <NumField label="DMOC – maloobch. s DPH (Kč)" value={product.dmoc} onChange={num("dmoc")} />
              <NumField label="VOC – velkoobch. (Kč)" value={product.voc} onChange={num("voc")} />
            </div>
            <div className="readouts">
              <Readout label="Vstupní náklad" value={fmtKc(d.vstupniNaklad)} hint="výrobní cena × MOQ" />
              <Readout label="Marže e-shop" value={fmtPct(d.marzeEshop)} hint="z DMOC bez DPH" col={d.marzeEshop != null && d.marzeEshop >= 0.7 ? "var(--go)" : null} />
              <Readout label="Marže B2B" value={fmtPct(d.marzeB2B)} hint="z VOC" />
            </div>
          </Section>

          {/* market & competition */}
          <Section title="Trh a konkurence">
            <div className="grid2">
              <NumField label="Cena konkurence (Kč)" value={product.cenaKonkurence} onChange={num("cenaKonkurence")} />
              <NumField label="Velikost trhu (ks / rok)" value={product.velikostTrhu} onChange={num("velikostTrhu")} />
              <NumField label="Cílový podíl na trhu (%)" value={product.marketShareTarget} onChange={num("marketShareTarget")} />
              <NumField label="Růst trhu (% / rok)" value={product.rustTrhu} onChange={num("rustTrhu")} />
            </div>
            <div className="readouts">
              <Readout label="Cenová pozice vs. konkurence"
                value={d.cenovyRozdil == null ? "—" : (d.cenovyRozdil > 0 ? "+" : "") + fmtKc(d.cenovyRozdil)}
                hint={d.cenovyRozdil == null ? "doplňte DMOC a cenu konkurence" : d.cenovyRozdil > 0 ? "naše DMOC je dražší" : d.cenovyRozdil < 0 ? "naše DMOC je levnější" : "shodná cena"}
                col={d.cenovyRozdil == null ? null : d.cenovyRozdil <= 0 ? "var(--go)" : "var(--nogo)"} />
            </div>
          </Section>

          {/* scoring */}
          <Section title="Hodnocení (skóre)" right={<span className="sec-num" style={{ color: scoreColor(d.skore) }}>{d.skore == null ? "—" : Math.round(d.skore)}/100</span>}>
            {SCORE_DEFS.map((def) => (
              <Slider key={def.k} label={def.label} hint={`${def.hint} · váha ${String(def.w).replace(".", ",")}`}
                value={product[def.k]} onChange={(v) => onChange({ [def.k]: v })} />
            ))}
          </Section>

          {/* risk */}
          <Section title="Rizika" right={d.riskSkore != null ? <span className="sec-num">{d.riskSkore}/100</span> : null}>
            {RISK_DEFS.map((def) => (
              <Slider key={def.k} label={def.label} hint={`váha ${def.w}`}
                value={product[def.k]} onChange={(v) => onChange({ [def.k]: v })} risk />
            ))}
          </Section>

          {/* stop flags */}
          <Section title="Stop-flagy" right={d.stopActive.length ? <span className="sec-num" style={{ color: "var(--nogo)" }}>{d.stopActive.length} aktivní</span> : null}>
            <div className="stop-grid">
              {STOP_DEFS.map((s) => {
                const on = !!(product.stop && product.stop[s.k]);
                return (
                  <button key={s.k} className={"stop-chip" + (on ? " on" : "")} title={s.hint}
                    onClick={() => onChange({ stop: { ...(product.stop || {}), [s.k]: !on } })}>
                    <span className="stop-code">{s.k}</span>
                    <span className="stop-label">{s.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="stop-hint">Aktivní stop-flag označuje tvrdou překážku, která brání zařazení produktu bez ohledu na skóre.</div>
          </Section>

          {/* forecast */}
          <Section title="Prodejní výhled">
            <div className="grid2">
              <NumField label="Forecast (ks / rok)" value={product.forecastKsRok} onChange={num("forecastKsRok")} />
              <NumField label="Poměr B2B (0–1)" value={product.pomerB2B} onChange={num("pomerB2B")} step="0.05" />
              <NumField label="Skutečný obrat (Kč)" value={product.skutecnyObrat} onChange={num("skutecnyObrat")} />
            </div>
            <div className="readouts">
              <Readout label="Předpokládaný obrat" value={fmtKc(d.predpokladanyObrat)} hint="forecast × mix B2B/B2C" big />
            </div>
          </Section>

          {/* effects + note */}
          <Section title="Účinky">
            <div className="tags-edit">
              {(product.ucinky || []).map((t, i) => (
                <span className="tag" key={i}>{t}
                  <button onClick={() => onChange({ ucinky: product.ucinky.filter((_, j) => j !== i) })}>×</button>
                </span>
              ))}
              <input className="tag-add" placeholder="+ účinek, Enter"
                onKeyDown={(e) => { if (e.key === "Enter" && e.target.value.trim()) { onChange({ ucinky: [...(product.ucinky || []), e.target.value.trim()] }); e.target.value = ""; } }} />
            </div>
          </Section>
          <Section title="Poznámka">
            <textarea className="d-note" value={product.poznamka || ""} onChange={txt("poznamka")} placeholder="Interní poznámka k produktu…" rows={3} />
          </Section>
          </fieldset>

          {canEdit && (
            <button className="del-btn" onClick={() => { if (confirm("Opravdu smazat produkt?")) onDelete(); }}>
              <Icon d={Ic.trash} size={15} /><span>Smazat produkt</span>
            </button>
          )}
          <div className="d-foot-note">{canEdit ? "Změny se ukládají automaticky." : "Pro úpravy se přihlaste jako administrátor."}</div>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children, right }) {
  return (
    <section className="d-sec">
      <div className="d-sec-head"><h4>{title}</h4>{right}</div>
      {children}
    </section>
  );
}
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function NumField({ label, value, onChange, step }) {
  return <label className="field"><span>{label}</span>
    <input type="number" step={step || "any"} value={value ?? ""} onChange={onChange} placeholder="—" /></label>;
}
function Readout({ label, value, hint, col, big }) {
  return (
    <div className={"readout" + (big ? " big" : "")}>
      <div className="ro-label">{label}</div>
      <div className="ro-value" style={col ? { color: col } : null}>{value}</div>
      {hint && <div className="ro-hint">{hint}</div>}
    </div>
  );
}
function Slider({ label, hint, value, onChange, risk, readOnly }) {
  const v = value ?? 0;
  const col = risk ? "var(--amber)" : scoreColor(v * 10);
  return (
    <div className="sl">
      <div className="sl-top"><span className="sl-label">{label}</span><span className="sl-hint">{hint}</span>
        <span className="sl-val" style={{ color: value == null ? "var(--ink-3)" : col }}>{value == null ? "–" : value}</span></div>
      <div className="sl-track">
        {[...Array(11)].map((_, i) => (
          <button key={i} className={"sl-pip" + (value != null && i <= v ? " on" : "")}
            style={value != null && i <= v ? { background: col } : null}
            onClick={readOnly ? undefined : () => onChange(i === value ? null : i)}
            disabled={readOnly} title={String(i)} />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   STYLES
   ============================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
:root{
  --bg:#EBEFEC; --surface:#FFFFFF; --surface-2:#F4F7F4;
  --ink:#14211F; --ink-2:#4E5C59; --ink-3:#8B9794; --line:#DEE5E1;
  --pine:#0E3B3A; --pine-2:#0A2A29; --pine-light:#2C7A6F;
  --amber:#E8902B; --go:#1F9D6B; --hold:#D99A12; --nogo:#CF4F47; --pending:#93A29E;
  --display:'Space Grotesk',sans-serif; --body:'IBM Plex Sans',sans-serif; --mono:'IBM Plex Mono',monospace;
}
*{box-sizing:border-box;}
.app{display:flex;min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--body);font-size:14px;-webkit-font-smoothing:antialiased;}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit;}
input,select,textarea{font-family:inherit;font-size:14px;color:var(--ink);}
h1,h2,h3,h4{font-family:var(--display);margin:0;font-weight:600;}
.num{font-family:var(--mono);}

/* RAIL */
.rail{width:228px;flex:none;background:var(--pine-2);color:#D8E4E0;display:flex;flex-direction:column;padding:22px 16px;position:sticky;top:0;height:100vh;}
.brand{display:flex;align-items:center;gap:11px;padding:0 4px 24px;}
.brand-mark{width:38px;height:38px;border-radius:11px;background:linear-gradient(140deg,var(--amber),#f2b260);color:var(--pine-2);font-family:var(--display);font-weight:700;font-size:21px;display:grid;place-items:center;}
.brand-name{font-family:var(--display);font-weight:700;font-size:17px;color:#fff;letter-spacing:.3px;}
.brand-sub{font-size:11px;color:#7FA39C;letter-spacing:.5px;text-transform:uppercase;margin-top:1px;}
.nav{display:flex;flex-direction:column;gap:3px;margin-top:6px;}
.nav-btn{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:9px;color:#9DBAB3;font-size:14px;font-weight:500;transition:.15s;text-align:left;}
.nav-btn:hover{background:rgba(255,255,255,.05);color:#E5EFEC;}
.nav-btn.on{background:var(--pine);color:#fff;}
.rail-foot{margin-top:auto;display:flex;flex-direction:column;gap:14px;}
.ghost-btn{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.12);color:#9DBAB3;font-size:12.5px;transition:.15s;}
.ghost-btn:hover{border-color:rgba(255,255,255,.3);color:#fff;}
.rail-link{font-size:11.5px;color:#6F938C;text-decoration:none;padding:0 4px;letter-spacing:.3px;}
.rail-link:hover{color:var(--amber);}

/* MAIN */
.main{flex:1;display:flex;flex-direction:column;min-width:0;}
.topbar{display:flex;align-items:center;gap:14px;padding:16px 28px;background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5;}
.searchbox{display:flex;align-items:center;gap:9px;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:9px 13px;width:320px;max-width:34vw;}
.searchbox input{border:none;background:none;outline:none;width:100%;}
.filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.select{position:relative;display:flex;align-items:center;}
.select select{appearance:none;background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:8px 30px 8px 12px;font-size:13px;color:var(--ink-2);cursor:pointer;}
.select select:hover{border-color:var(--ink-3);}
.select svg{position:absolute;right:9px;pointer-events:none;color:var(--ink-3);}
.clear-f{font-size:12.5px;color:var(--nogo);padding:8px 6px;}
.clear-f:hover{text-decoration:underline;}
.add-btn{margin-left:auto;display:flex;align-items:center;gap:8px;background:var(--pine);color:#fff;padding:10px 16px;border-radius:10px;font-weight:600;font-size:13.5px;transition:.15s;}
.add-btn:hover{background:var(--pine-2);}
.content{padding:28px;overflow:auto;}

/* PAGE HEAD */
.page-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:22px;}
.eyebrow{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--amber);font-weight:600;margin-bottom:6px;}
.page-head h1{font-size:27px;letter-spacing:-.4px;}
.head-meta{font-size:13px;color:var(--ink-3);}

/* KPI */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:13px;margin-bottom:22px;}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:16px 17px;position:relative;}
.kpi-wide{grid-column:span 2;}
.kpi-label{font-size:12px;color:var(--ink-3);margin-bottom:9px;font-weight:500;display:flex;align-items:center;justify-content:space-between;gap:6px;}
.kpi-value{font-family:var(--display);font-size:27px;font-weight:600;letter-spacing:-.5px;line-height:1;}
.kpi-wide .kpi-value{font-size:23px;}
.kpi-click{cursor:pointer;transition:.14s;}
.kpi-click:hover{border-color:var(--pine-light);box-shadow:0 6px 18px rgba(14,59,58,.1);transform:translateY(-2px);}
.kpi-click:focus-visible{outline:2px solid var(--pine-light);outline-offset:2px;}
.kpi-on{border-color:var(--pine);box-shadow:0 0 0 1px var(--pine) inset;background:linear-gradient(180deg,rgba(14,59,58,.04),transparent);}
.kpi-on .kpi-arrow{opacity:1;transform:translateX(0);color:var(--pine);}
.kpi-arrow{font-family:var(--body);font-size:14px;color:var(--ink-3);opacity:0;transform:translateX(-4px);transition:.14s;}
.kpi-click:hover .kpi-arrow{opacity:1;transform:translateX(0);color:var(--pine);}
.filter-chip{display:inline-flex;align-items:center;gap:6px;background:#FBF0DD;border:1px solid #E9C97E;color:#9A6B12;border-radius:9px;padding:7px 11px;font-size:12.5px;font-weight:600;transition:.12s;}
.filter-chip:hover{background:#F7E6C4;}
.filter-chip-x{font-size:15px;line-height:1;opacity:.7;}

/* CARD */
.card{background:var(--surface);border:1px solid var(--line);border-radius:15px;padding:20px 22px;margin-bottom:18px;}
.card-head{display:flex;align-items:baseline;gap:12px;margin-bottom:16px;flex-wrap:wrap;}
.card-head h3{font-size:16px;}
.card-sub{font-size:12px;color:var(--ink-3);}
.dash-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;}

/* FUNNEL */
.funnel{display:flex;flex-direction:column;gap:11px;}
.funnel-row{display:grid;grid-template-columns:175px 1fr 130px;align-items:center;gap:16px;}
.funnel-label{font-size:13.5px;font-weight:500;display:flex;align-items:center;gap:10px;}
.funnel-idx{font-family:var(--mono);font-size:11px;color:var(--ink-3);}
.funnel-track{background:var(--surface-2);border-radius:8px;height:30px;overflow:hidden;}
.funnel-bar{height:100%;border-radius:8px;display:flex;align-items:center;justify-content:flex-end;padding-right:11px;min-width:34px;transition:width .5s;}
.funnel-count{font-family:var(--mono);font-weight:600;color:#fff;font-size:13px;}
.funnel-obrat{font-family:var(--mono);font-size:12.5px;color:var(--ink-2);text-align:right;}

/* TOPLIST */
.toplist{display:flex;flex-direction:column;}
.toprow{display:flex;align-items:center;gap:14px;padding:11px 8px;border-bottom:1px solid var(--line);text-align:left;transition:.12s;border-radius:8px;}
.toprow:last-child{border-bottom:none;}
.toprow:hover{background:var(--surface-2);}
.toprow-tx{flex:1;min-width:0;}
.toprow-name{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.toprow-meta{font-size:12px;color:var(--ink-3);margin-top:2px;}
.toprow-obrat{font-family:var(--mono);font-size:12.5px;color:var(--ink-2);min-width:110px;text-align:right;}

/* BADGE */
.badge{display:inline-flex;align-items:center;font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;border:1px solid;letter-spacing:.2px;white-space:nowrap;}

/* KANBAN */
.kanban{display:flex;gap:14px;overflow-x:auto;padding-bottom:10px;align-items:flex-start;}
.kcol{flex:1;min-width:212px;background:var(--surface-2);border:1px solid var(--line);border-radius:13px;padding:12px;transition:.15s;}
.kcol.over{border-color:var(--pine-light);background:#E8F1EE;}
.kcol-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}
.kcol-title{font-family:var(--display);font-weight:600;font-size:13.5px;}
.kcol-count{font-family:var(--mono);font-size:12px;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:1px 9px;color:var(--ink-2);}
.kcol-obrat{font-family:var(--mono);font-size:11.5px;color:var(--pine-light);margin-bottom:10px;}
.kcol-body{display:flex;flex-direction:column;gap:9px;min-height:40px;margin-top:8px;}
.kcard{background:var(--surface);border:1px solid var(--line);border-left:3px solid;border-radius:10px;padding:11px 12px;cursor:pointer;transition:.12s;}
.kcard:hover{box-shadow:0 4px 14px rgba(14,59,58,.09);transform:translateY(-1px);}
.kcard-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}
.kcard-name{font-weight:600;font-size:13px;line-height:1.3;}
.kcard-foot{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:9px;}
.kcard-rada{font-size:11px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.kempty{font-size:12px;color:var(--ink-3);text-align:center;padding:14px 0;}

/* TABLE */
.table-card{padding:6px 6px;overflow-x:auto;}
.ptable{width:100%;border-collapse:collapse;}
.ptable.wide{min-width:1080px;}
.ptable.wide td{white-space:nowrap;}
.ptable thead th{font-family:var(--body);font-size:11.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-3);font-weight:600;padding:13px 14px;border-bottom:1px solid var(--line);user-select:none;white-space:nowrap;}
.sort-ar{color:var(--amber);}
.ptable tbody tr{border-bottom:1px solid var(--line);cursor:pointer;transition:.1s;}
.ptable tbody tr:last-child{border-bottom:none;}
.ptable tbody tr:hover{background:var(--surface-2);}
.ptable td{padding:12px 14px;vertical-align:middle;}
.cell-name{font-weight:600;font-size:13.5px;display:block;}
.cell-tags{font-size:11.5px;color:var(--ink-3);margin-top:2px;display:block;}
.muted{color:var(--ink-2);font-size:13px;}
.phase-pill{font-size:12px;background:var(--surface-2);border:1px solid var(--line);padding:3px 9px;border-radius:7px;color:var(--ink-2);white-space:nowrap;}
.ptable .num{font-family:var(--mono);font-size:13px;color:var(--ink-2);}
.ptable .num.strong{color:var(--ink);font-weight:600;}
.empty-row{text-align:center;color:var(--ink-3);padding:36px;white-space:normal;}

/* table pills & widgets (dle předlohy) */
.series-pill{display:inline-flex;align-items:center;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;color:#fff;white-space:nowrap;max-width:170px;overflow:hidden;text-overflow:ellipsis;}
.phase-pill2{display:inline-flex;align-items:center;gap:6px;padding:4px 12px 4px 10px;border-radius:20px;font-size:12px;font-weight:600;color:#fff;white-space:nowrap;}
.phase-ic{font-size:12px;line-height:1;}
.verdict-cell{white-space:nowrap;}
.verdict-cell>*{margin-right:5px;}
.verdict-cell>*:last-child{margin-right:0;}
.stop-chip-tbl{display:inline-flex;align-items:center;gap:3px;background:#FBF0DD;border:1px solid #E9C97E;color:#9A6B12;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:600;white-space:nowrap;}
.mtag{display:inline-flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:12.5px;font-weight:600;padding:4px 10px;border-radius:8px;min-width:64px;}
.mtag.green{background:#E6F4EC;color:#1F9D6B;}
.mtag.red{background:#FBEAE8;color:#CF4F47;}
.score-cell{min-width:140px;}
.scorebar{display:flex;align-items:center;gap:10px;}
.scorebar-track{flex:1;height:8px;border-radius:5px;background:var(--surface-2);overflow:hidden;min-width:60px;}
.scorebar-fill{height:100%;border-radius:5px;transition:width .4s;}
.scorebar-num{font-family:var(--mono);font-weight:600;font-size:13px;min-width:22px;text-align:right;}


/* DRAWER */
.scrim{position:fixed;inset:0;background:rgba(10,30,29,.32);z-index:40;backdrop-filter:blur(1.5px);}
.drawer{position:fixed;top:0;right:0;height:100vh;width:520px;max-width:94vw;background:var(--surface);z-index:50;display:flex;flex-direction:column;box-shadow:-12px 0 40px rgba(10,30,29,.18);animation:slideIn .26s cubic-bezier(.2,.8,.2,1);}
@keyframes slideIn{from{transform:translateX(40px);opacity:.4;}to{transform:none;opacity:1;}}
.drawer-head{display:flex;align-items:flex-start;gap:12px;padding:20px 22px 16px;border-bottom:1px solid var(--line);}
.d-title{font-family:var(--display);font-weight:600;font-size:20px;border:none;outline:none;width:100%;background:none;padding:2px 0;letter-spacing:-.3px;}
.d-title:focus{border-bottom:1.5px solid var(--amber);}
.d-sub{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:12.5px;color:var(--ink-3);}
.icon-btn{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;color:var(--ink-2);transition:.12s;}
.icon-btn:hover{background:var(--surface-2);}
.drawer-body{overflow-y:auto;padding:18px 22px 40px;}

.d-hero{display:flex;align-items:center;gap:16px;background:var(--surface-2);border:1px solid var(--line);border-radius:13px;padding:15px 18px;margin-bottom:8px;}
.d-hero-tx{flex:1;}
.d-hero-label{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--ink-3);font-weight:600;}
.d-hero-sub{font-family:var(--display);font-weight:600;font-size:15px;margin-top:3px;}
.d-hero-risk{text-align:right;}
.d-risk-val{font-family:var(--mono);font-weight:600;font-size:20px;color:var(--amber);margin-top:2px;}
.d-risk-val span{font-size:12px;color:var(--ink-3);}

.d-sec{padding:18px 0;border-bottom:1px solid var(--line);}
.d-sec-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px;}
.d-sec-head h4{font-size:13px;text-transform:uppercase;letter-spacing:.7px;color:var(--ink-2);}
.sec-num{font-family:var(--mono);font-weight:600;font-size:14px;}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.field{display:flex;flex-direction:column;gap:5px;}
.field>span{font-size:12px;color:var(--ink-3);font-weight:500;}
.field input,.field select{background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:9px 11px;outline:none;transition:.12s;}
.field input:focus,.field select:focus{border-color:var(--pine-light);}
.toggle{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-size:13px;color:var(--ink-2);}
.toggle .toggle-dot{width:30px;height:17px;border-radius:20px;background:var(--line);position:relative;transition:.15s;flex:none;}
.toggle .toggle-dot::after{content:'';position:absolute;width:13px;height:13px;border-radius:50%;background:#fff;top:2px;left:2px;transition:.15s;}
.toggle.on .toggle-dot{background:var(--go);}
.toggle.on .toggle-dot::after{left:15px;}

.readouts{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;}
.readout{flex:1;min-width:120px;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:11px 13px;}
.readout.big{flex-basis:100%;background:linear-gradient(120deg,#10403E,#0A2A29);border:none;}
.ro-label{font-size:11px;color:var(--ink-3);font-weight:500;}
.readout.big .ro-label{color:#8FB3AC;}
.ro-value{font-family:var(--mono);font-weight:600;font-size:16px;margin-top:4px;}
.readout.big .ro-value{font-size:23px;color:#fff;}
.ro-hint{font-size:10.5px;color:var(--ink-3);margin-top:3px;}
.readout.big .ro-hint{color:#6F938C;}

/* slider pips */
.sl{margin-bottom:13px;}
.sl-top{display:flex;align-items:baseline;gap:8px;margin-bottom:6px;}
.sl-label{font-size:13px;font-weight:600;}
.sl-hint{font-size:11px;color:var(--ink-3);flex:1;}
.sl-val{font-family:var(--mono);font-weight:600;font-size:14px;}
.sl-track{display:flex;gap:4px;}
.sl-pip{flex:1;height:9px;border-radius:3px;background:var(--surface-2);border:1px solid var(--line);transition:.1s;}
.sl-pip:hover{transform:scaleY(1.5);}
.sl-pip.on{border-color:transparent;}

.tags-edit{display:flex;flex-wrap:wrap;gap:7px;align-items:center;}
.tag{display:inline-flex;align-items:center;gap:5px;background:var(--surface-2);border:1px solid var(--line);border-radius:20px;padding:4px 6px 4px 11px;font-size:12.5px;}
.tag button{color:var(--ink-3);font-size:15px;line-height:1;width:16px;height:16px;border-radius:50%;}
.tag button:hover{background:var(--nogo);color:#fff;}
.tag-add{border:1px dashed var(--line);border-radius:20px;padding:5px 12px;background:none;outline:none;width:140px;font-size:12.5px;}
.tag-add:focus{border-color:var(--pine-light);border-style:solid;}
.d-note{width:100%;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:11px;outline:none;resize:vertical;line-height:1.5;}
.d-note:focus{border-color:var(--pine-light);}

.del-btn{display:flex;align-items:center;gap:8px;color:var(--nogo);font-size:13px;font-weight:500;padding:12px 0 4px;margin-top:8px;}
.del-btn:hover{text-decoration:underline;}
.d-foot-note{font-size:11.5px;color:var(--ink-3);margin-top:4px;}

/* EXPORT */
.export-row{display:flex;gap:8px;}
.export-row .ghost-btn{flex:1;justify-content:center;padding:9px 6px;}

/* STOP FLAGS */
.stop-grid{display:flex;flex-wrap:wrap;gap:8px;}
.stop-chip{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:7px 11px;transition:.12s;}
.stop-chip:hover{border-color:var(--nogo);}
.stop-chip .stop-code{font-family:var(--mono);font-weight:700;font-size:13px;width:22px;height:22px;border-radius:6px;display:grid;place-items:center;background:var(--surface-2);color:var(--ink-3);}
.stop-chip .stop-label{font-size:12.5px;color:var(--ink-2);}
.stop-chip.on{border-color:var(--nogo);background:#FBECEA;}
.stop-chip.on .stop-code{background:var(--nogo);color:#fff;}
.stop-chip.on .stop-label{color:var(--nogo);font-weight:600;}
.stop-hint{font-size:11.5px;color:var(--ink-3);margin-top:11px;line-height:1.5;}
.stop-tags{display:inline-flex;gap:3px;margin-left:7px;vertical-align:middle;}
.stop-mini{font-family:var(--mono);font-size:9.5px;font-weight:700;width:15px;height:15px;border-radius:4px;display:inline-grid;place-items:center;background:var(--nogo);color:#fff;}
.kcard-stops{display:flex;align-items:center;gap:4px;margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);}
.kcard-stop-lbl{font-family:var(--display);font-size:9.5px;font-weight:700;letter-spacing:.6px;color:var(--nogo);margin-right:2px;}

/* USER CHIP + AUTH */
.user-chip{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:11px;padding:9px 10px;}
.user-av{width:32px;height:32px;flex:none;border-radius:9px;background:linear-gradient(140deg,var(--pine-light),#1f5e56);color:#fff;font-family:var(--display);font-weight:700;font-size:12.5px;display:grid;place-items:center;letter-spacing:.3px;}
.user-tx{flex:1;min-width:0;}
.user-name{font-size:12.5px;font-weight:600;color:#EAF2EF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.user-role{font-size:10.5px;color:#7FA39C;margin-top:1px;}
.user-role.admin{color:var(--amber);}
.user-logout{width:30px;height:30px;flex:none;border-radius:8px;display:grid;place-items:center;color:#9DBAB3;transition:.12s;}
.user-logout:hover{background:rgba(255,255,255,.1);color:#fff;}
.ro-banner{display:flex;align-items:center;gap:8px;background:#FBF4E7;border:1px solid #EBD9B3;color:#9A6B12;border-radius:10px;padding:9px 12px;font-size:12.5px;font-weight:500;margin:4px 0 6px;}
.d-edit{border:none;margin:0;padding:0;min-width:0;}
.d-edit:disabled{opacity:1;}
.d-edit:disabled .field input,.d-edit:disabled .field select,.d-edit:disabled .d-note{background:var(--surface-2);color:var(--ink-2);cursor:not-allowed;}
.d-edit:disabled .toggle,.d-edit:disabled .stop-chip,.d-edit:disabled .sl-pip,.d-edit:disabled .tag button{cursor:not-allowed;opacity:.85;}
.d-edit:disabled .tag-add{display:none;}
.d-edit:disabled .sl-pip:hover{transform:none;}

/* LOGIN */
.login-wrap{min-height:100vh;display:grid;place-items:center;background:linear-gradient(150deg,#0A2A29,#10403E 70%,#15524C);font-family:var(--body);padding:24px;}
.login-card{width:100%;max-width:380px;background:var(--surface);border-radius:18px;padding:30px 30px 26px;box-shadow:0 24px 70px rgba(5,20,19,.4);}
.login-brand{display:flex;align-items:center;gap:12px;margin-bottom:22px;}
.login-name{font-family:var(--display);font-weight:700;font-size:19px;color:var(--pine);letter-spacing:.3px;}
.login-sub{font-size:11px;color:var(--ink-3);letter-spacing:.5px;text-transform:uppercase;margin-top:1px;}
.login-title{font-size:20px;margin-bottom:18px;color:var(--ink);}
.login-card .field{margin-bottom:13px;}
.login-card .field input{background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:11px 12px;outline:none;transition:.12s;}
.login-card .field input:focus{border-color:var(--pine-light);}
.login-err{background:#FBECEA;border:1px solid #EBC4C0;color:var(--nogo);border-radius:8px;padding:8px 11px;font-size:12.5px;margin-bottom:13px;}
.login-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:var(--pine);color:#fff;padding:12px;border-radius:10px;font-weight:600;font-size:14px;transition:.15s;}
.login-btn:hover{background:var(--pine-2);}
.login-btn:disabled{opacity:.5;cursor:not-allowed;}
.login-btn.compact{width:auto;padding:10px 18px;font-size:13.5px;}
.login-demo{margin-top:20px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;color:var(--ink-2);line-height:1.7;}
.login-demo-title{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--ink-3);font-weight:600;margin-bottom:6px;}
.login-demo b{color:var(--ink);font-family:var(--mono);}

/* MODAL */
.modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:520px;max-width:94vw;max-height:90vh;background:var(--surface);border-radius:16px;z-index:50;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(10,30,29,.3);animation:slideIn .2s;}
.modal-head{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line);}
.modal-head h3{font-size:18px;}
.modal-body{padding:18px 22px;overflow-y:auto;display:flex;flex-direction:column;gap:13px;}
.modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:16px 22px;border-top:1px solid var(--line);}
.modal-note{background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:11px 13px;font-size:12px;color:var(--ink-2);line-height:1.6;}
.btn-ghost2{padding:11px 18px;border-radius:10px;border:1px solid var(--line);color:var(--ink-2);font-size:13.5px;font-weight:500;transition:.12s;}
.btn-ghost2:hover{border-color:var(--ink-3);background:var(--surface-2);}

/* TABLE ROW ACTIONS */
.row-actions{display:flex;align-items:center;justify-content:center;gap:4px;}
.act-btn{width:30px;height:30px;display:grid;place-items:center;border-radius:8px;color:var(--ink-3);transition:.12s;}
.act-btn:hover{background:var(--surface-2);color:var(--pine);}
.act-btn.danger:hover{background:#FBEAE8;color:var(--nogo);}

/* DETAIL PAGE */
.detail-page{max-width:1080px;}
.dp-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}
.back-btn{display:inline-flex;align-items:center;gap:7px;color:var(--ink-2);font-size:13.5px;font-weight:500;padding:8px 12px;border-radius:9px;border:1px solid var(--line);transition:.12s;}
.back-btn:hover{border-color:var(--ink-3);background:var(--surface-2);}
.dp-actions{display:flex;gap:9px;}
.ghost-btn2{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);color:var(--ink-2);font-size:13px;font-weight:500;padding:8px 13px;border-radius:9px;transition:.12s;}
.ghost-btn2:hover{border-color:var(--pine-light);color:var(--pine);background:var(--surface-2);}
.ghost-btn2.danger:hover{border-color:var(--nogo);color:var(--nogo);background:#FBEAE8;}
.dp-head{display:flex;align-items:center;gap:18px;margin-bottom:22px;}
.dp-head-tx h1{font-size:26px;letter-spacing:-.4px;margin:3px 0 9px;}
.dp-badges{display:flex;flex-wrap:wrap;align-items:center;gap:7px;}
.dp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:2px 0;}
.dp-score-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px;}
.dp-score-grid .sl-pip:disabled{cursor:default;opacity:1;}
@media(max-width:820px){.dp-score-grid{grid-template-columns:1fr;}}
.dp-info{padding:12px 4px;border-bottom:1px solid var(--line);}
.dp-info-l{font-size:11.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:5px;}
.dp-info-v{font-family:var(--mono);font-size:15px;color:var(--ink);font-weight:500;}
.dp-extra{margin-top:16px;}
.tags-edit.ro .tag button{display:none;}
.dp-note-txt{font-size:13.5px;color:var(--ink-2);line-height:1.6;margin-top:6px;white-space:pre-wrap;}

/* ANALYSIS CARDS */
.analysis-card{margin-top:18px;}
.ic-h3{display:flex;align-items:center;gap:8px;}
.run-btn{display:inline-flex;align-items:center;gap:8px;background:var(--pine);color:#fff;padding:9px 15px;border-radius:9px;font-weight:600;font-size:13px;transition:.15s;white-space:nowrap;}
.run-btn:hover{background:var(--pine-2);}
.run-btn:disabled{opacity:.6;cursor:wait;}
.analysis-empty{color:var(--ink-3);font-size:13.5px;padding:14px 2px 6px;}
.analysis-err{color:var(--nogo);font-size:13.5px;background:#FBEAE8;border:1px solid #EBC4C0;border-radius:9px;padding:11px 13px;margin-top:6px;}
.analysis-loading{display:flex;align-items:center;gap:11px;color:var(--ink-2);font-size:13.5px;padding:16px 2px;}
.analysis-summary{font-size:13.5px;color:var(--ink-2);line-height:1.6;margin:4px 0 16px;}
.analysis-note{font-size:11.5px;color:var(--ink-3);line-height:1.6;margin-top:12px;padding-top:11px;border-top:1px solid var(--line);}
.analysis-table-wrap{overflow-x:auto;}
.analysis-table{width:100%;border-collapse:collapse;font-size:13px;}
.analysis-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--ink-3);font-weight:600;padding:9px 11px;border-bottom:1px solid var(--line);white-space:nowrap;}
.analysis-table td{padding:10px 11px;border-bottom:1px solid var(--line);vertical-align:top;}
.analysis-table tr:last-child td{border-bottom:none;}
.analysis-table .num{font-family:var(--mono);color:var(--ink);white-space:nowrap;}
.ac-idx{color:var(--ink-3);font-family:var(--mono);font-size:12px;}
.ac-name{font-weight:600;color:var(--ink);min-width:160px;}
.ac-note{display:block;font-weight:400;font-size:11.5px;color:var(--ink-3);margin-top:3px;}
.ac-link{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:7px;color:var(--pine);background:var(--surface-2);transition:.12s;}
.ac-link:hover{background:var(--pine);color:#fff;}
.trend-tag{display:inline-flex;align-items:center;gap:3px;border:1px solid;border-radius:20px;padding:2px 9px;font-size:11.5px;font-weight:600;white-space:nowrap;}
.spinner{width:16px;height:16px;border:2px solid var(--line);border-top-color:var(--pine);border-radius:50%;display:inline-block;animation:spin .7s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}

/* TOP 15 table on dashboard */
.topscore-scroll{overflow-x:auto;margin:0 -6px;}
.topscore-scroll .ptable.wide{min-width:1080px;}

/* SCORING SETTINGS */
.scoring-page{max-width:1000px;}
.sc-intro p{font-size:13.5px;color:var(--ink-2);line-height:1.65;}
.sc-intro .ro-banner{margin-top:14px;}
.sc-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px;}
.sc-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);}
.sc-key{width:34px;height:34px;flex:none;border-radius:8px;background:var(--surface-2);color:var(--ink-2);font-family:var(--mono);font-weight:700;font-size:12px;display:grid;place-items:center;}
.sc-row-tx{flex:1;min-width:0;}
.sc-row-label{display:block;font-size:13.5px;font-weight:600;color:var(--ink);}
.sc-row-hint{display:block;font-size:11.5px;color:var(--ink-3);margin-top:1px;}
.sc-w{width:74px;flex:none;text-align:center;font-family:var(--mono);font-size:14px;font-weight:600;background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:9px 8px;outline:none;transition:.12s;color:var(--ink);}
.sc-w:focus{border-color:var(--pine-light);}
.sc-w:disabled{background:var(--surface-2);color:var(--ink-2);cursor:not-allowed;}
.sc-formula{margin-top:14px;font-family:var(--mono);font-size:12.5px;color:var(--pine);background:var(--surface-2);border-radius:9px;padding:10px 12px;word-break:break-word;}
.sc-sum{margin-top:9px;font-size:12.5px;color:var(--ink-2);}
.sc-warn{color:var(--hold);}
.sc-thresh{display:flex;flex-direction:column;gap:4px;}
.sc-thresh-row{display:flex;align-items:center;gap:10px;padding:9px 0;}
.sc-dot{width:11px;height:11px;border-radius:50%;flex:none;}
.sc-thresh-l{flex:1;font-size:13.5px;color:var(--ink-2);}
.sc-preview{margin-top:16px;padding-top:15px;border-top:1px solid var(--line);}
.sc-preview-t{font-size:11.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-3);font-weight:600;margin-bottom:11px;}
.sc-bands{display:flex;flex-wrap:wrap;gap:22px;}
.sc-band{font-size:13.5px;color:var(--ink-2);}
.sc-band b{font-family:var(--display);font-size:22px;margin-right:6px;}
.sc-actions{display:flex;align-items:center;justify-content:flex-end;gap:11px;margin-top:20px;}
@media(max-width:900px){.sc-grid{grid-template-columns:1fr;}}

/* ANALÝZA PRODUKTŮ */
.analyza-page{max-width:1040px;}
.ana-form-card{max-width:600px;}
.ana-form-intro{display:flex;gap:14px;align-items:flex-start;margin-bottom:20px;}
.ana-form-ic{width:44px;height:44px;flex:none;border-radius:12px;background:var(--surface-2);color:var(--pine);display:grid;place-items:center;}
.ana-form-intro p{font-size:13.5px;color:var(--ink-2);line-height:1.6;}
.ana-form{display:flex;flex-direction:column;gap:14px;}
.select.full{width:100%;}
.select.full select{width:100%;}
.ana-result-ic{width:60px;height:60px;flex:none;border-radius:16px;background:linear-gradient(140deg,var(--pine),var(--pine-light));color:#fff;display:grid;place-items:center;}
.ana-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:22px;flex-wrap:wrap;}

/* sub-tabs + historie analýz */
.subtabs{display:flex;gap:6px;border-bottom:1px solid var(--line);margin-bottom:20px;}
.subtab{display:inline-flex;align-items:center;gap:7px;padding:10px 15px;font-size:13.5px;font-weight:500;color:var(--ink-2);border-bottom:2px solid transparent;margin-bottom:-1px;transition:.12s;}
.subtab:hover{color:var(--pine);}
.subtab.on{color:var(--pine);border-bottom-color:var(--pine);font-weight:600;}
.hist-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--line);}
.hist-dot.on{background:var(--go);box-shadow:0 0 0 3px rgba(31,157,107,.15);}
.recent-ana{display:flex;flex-direction:column;}
.recent-row{display:flex;align-items:center;gap:12px;padding:11px 6px;border-bottom:1px solid var(--line);text-align:left;transition:.12s;border-radius:8px;}
.recent-row:last-child{border-bottom:none;}
.recent-row:hover{background:var(--surface-2);}
.recent-ic{width:32px;height:32px;flex:none;border-radius:9px;background:var(--surface-2);color:var(--pine);display:grid;place-items:center;}
.recent-tx{flex:1;min-width:0;}
.recent-name{font-size:13.5px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.recent-meta{font-size:11.5px;color:var(--ink-3);margin-top:1px;}
.recent-dots{display:flex;gap:5px;flex:none;}

/* RECO + SWOT */
.reco-verdict{display:flex;align-items:center;flex-wrap:wrap;gap:14px;border:1px solid;border-left-width:4px;border-radius:12px;padding:14px 16px;margin-bottom:18px;}
.reco-badge{color:#fff;font-family:var(--display);font-weight:700;font-size:14px;letter-spacing:.5px;padding:6px 14px;border-radius:8px;white-space:nowrap;}
.reco-score{font-size:13px;color:var(--ink-2);}
.reco-score b{font-family:var(--display);font-size:24px;}
.reco-score span{color:var(--ink-3);font-size:13px;}
.reco-summary{flex:1;min-width:240px;font-size:13.5px;color:var(--ink);line-height:1.55;margin:0;}
.reco-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;}
.reco-col{border:1px solid var(--line);border-radius:11px;padding:13px 15px;}
.reco-col h4{font-size:12.5px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:9px;}
.reco-col.plus h4{color:var(--go);}
.reco-col.minus h4{color:var(--nogo);}
.reco-list{list-style:none;display:flex;flex-direction:column;gap:7px;}
.reco-list li{position:relative;padding-left:16px;font-size:13px;color:var(--ink-2);line-height:1.5;}
.reco-list li::before{content:"";position:absolute;left:2px;top:8px;width:5px;height:5px;border-radius:50%;background:var(--ink-3);}
.reco-col.plus .reco-list li::before{background:var(--go);}
.reco-col.minus .reco-list li::before{background:var(--nogo);}
.swot{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;}
.swot-q{border-radius:11px;padding:13px 15px;border:1px solid var(--line);}
.swot-q h4{font-size:12px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:9px;}
.swot-q.s{background:#EAF6F0;border-color:#C9E8D8;}.swot-q.s h4{color:var(--go);}
.swot-q.w{background:#FBECEA;border-color:#F0CFCB;}.swot-q.w h4{color:var(--nogo);}
.swot-q.o{background:#EAF1FB;border-color:#CBDBF2;}.swot-q.o h4{color:#2563EB;}
.swot-q.t{background:#FBF4E7;border-color:#EBD9B3;}.swot-q.t h4{color:#9A6B12;}
.swot-q .reco-list li::before{background:currentColor;opacity:.5;}
.reco-comment{border-top:1px solid var(--line);padding-top:14px;}
.reco-comment h4{font-size:12.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-3);margin-bottom:8px;}
.reco-comment p{font-size:13.5px;color:var(--ink-2);line-height:1.65;}
@media(max-width:760px){.reco-cols,.swot{grid-template-columns:1fr;}}

/* STUDIE & REGULACE */
.ref-block-t{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-3);font-weight:600;margin-bottom:11px;}
.ref-list{display:flex;flex-direction:column;gap:10px;}
.ref-item{display:flex;gap:11px;padding:11px 13px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2);}
.ref-ic{width:30px;height:30px;flex:none;border-radius:8px;background:var(--surface);color:var(--pine);display:grid;place-items:center;border:1px solid var(--line);}
.ref-tx{flex:1;min-width:0;}
.ref-name{font-size:13.5px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.ref-urad{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#9A6B12;background:#FBF0DD;border:1px solid #E9C97E;border-radius:6px;padding:1px 7px;}
.ref-desc{font-size:12.5px;color:var(--ink-2);line-height:1.5;margin-top:3px;}
.ref-link{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--pine);margin-top:5px;word-break:break-all;}
.ref-link:hover{text-decoration:underline;}

.toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);background:var(--pine-2);color:#fff;padding:11px 22px;border-radius:11px;font-size:13.5px;font-weight:500;z-index:60;box-shadow:0 8px 26px rgba(10,30,29,.3);animation:slideIn .2s;}

@media(max-width:1100px){.kpis{grid-template-columns:repeat(3,1fr);}.dash-grid{grid-template-columns:1fr;}}
@media(max-width:820px){.rail{display:none;}.kpis{grid-template-columns:repeat(2,1fr);}.kpi-wide{grid-column:span 2;}.funnel-row{grid-template-columns:110px 1fr;}.funnel-obrat{display:none;}.topbar{flex-wrap:wrap;}}

/* PRINT / PDF EXPORT (detail produktu) */
.print-only{display:none;}
.print-head{font-family:var(--display);font-size:12px;color:#555;border-bottom:1px solid #ddd;padding-bottom:9px;margin-bottom:16px;letter-spacing:.3px;}
.detail-page.pdf-export{max-width:none;}
.detail-page.pdf-export .dp-top,.detail-page.pdf-export .run-btn,.detail-page.pdf-export .ana-actions,.detail-page.pdf-export .analysis-empty{display:none !important;}
.detail-page.pdf-export .print-only{display:block !important;}
.detail-page.pdf-export .card{box-shadow:none !important;border:1px solid #dcdcdc;}
.detail-page.pdf-export .analysis-table-wrap{overflow:visible !important;}
@media print{
  @page{margin:14mm;}
  html,body{background:#fff !important;}
  .rail,.topbar,.toast,.scrim,.drawer,.dp-top,.run-btn,.ana-actions,.sc-actions{display:none !important;}
  .app,.main{display:block !important;height:auto !important;overflow:visible !important;}
  .content{padding:0 !important;overflow:visible !important;height:auto !important;}
  .detail-page{max-width:none !important;}
  .print-only{display:block !important;}
  .card{box-shadow:none !important;border:1px solid #dcdcdc !important;margin-bottom:12px;}
  .analysis-table-wrap,.topscore-scroll{overflow:visible !important;}
  .swot-q,.reco-col,.reco-verdict,.sl,.dp-info,.analysis-table tr,.dp-score-grid section{break-inside:avoid;page-break-inside:avoid;}
  .dp-head{break-inside:avoid;}
}
`;
