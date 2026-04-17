"use client";
// ═══════════════════════════════════════════════════════════════
//  app/dashboard/page.tsx
//  Dashboard backoffice — liste offres & commandes depuis Supabase
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type OffreSummary = {
  id: number;
  slug: string;
  type_document: string;
  numero_affiche: string;
  numero_offre: string | null;
  numero_commande: string | null;
  reference: string | null;
  statut: string;
  date_document: string | null;
  commercial: string | null;
  client_type: string | null;
  client_nom: string | null;
  client_prenom: string | null;
  client_societe: string | null;
  client_email: string | null;
  client_npa: string | null;
  client_ville: string | null;
  total_ttc: number | null;
  nb_articles: number;
  date_envoi: string | null;
  date_relance_prevue: string | null;
  nb_relances: number;
  created_at: string;
  updated_at: string;
};

const STATUT_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  "En cours":  { label: "En cours",  bg: "rgba(245,158,11,0.15)",  color: "#f59e0b", border: "rgba(245,158,11,0.3)"  },
  "Envoyée":   { label: "Envoyée",   bg: "rgba(96,165,250,0.15)",  color: "#60a5fa", border: "rgba(96,165,250,0.3)"  },
  "Acceptée":  { label: "Acceptée",  bg: "rgba(74,222,128,0.15)",  color: "#4ade80", border: "rgba(74,222,128,0.3)"  },
  "Refusée":   { label: "Refusée",   bg: "rgba(248,113,113,0.15)", color: "#f87171", border: "rgba(248,113,113,0.3)" },
  "Convertie": { label: "Convertie", bg: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "rgba(167,139,250,0.3)" },
  "Abandonnée":{ label: "Abandonnée",bg: "rgba(113,113,122,0.15)", color: "#71717a", border: "rgba(113,113,122,0.3)" },
  "Commande":  { label: "Commande",  bg: "rgba(74,222,128,0.15)",  color: "#4ade80", border: "rgba(74,222,128,0.3)"  },
};

function formatMoney(v: number | null) {
  if (v === null || v === undefined) return "—";
  return "CHF " + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getDaysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function StatutBadge({ statut }: { statut: string }) {
  const cfg = STATUT_CONFIG[statut] || STATUT_CONFIG["En cours"];
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 700,
      background: cfg.bg,
      color: cfg.color,
      border: `1px solid ${cfg.border}`,
      whiteSpace: "nowrap",
    }}>{cfg.label}</span>
  );
}

export default function DashboardPage() {
  const [offres, setOffres] = useState<OffreSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all"|"Offre"|"Commande">("all");
  const [filterStatut, setFilterStatut] = useState("all");
  const [filterCommercial, setFilterCommercial] = useState("all");
  const [sortKey, setSortKey] = useState<string>("created_at");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");

  useEffect(() => {
    fetch("/api/dashboard/offres")
      .then((r) => r.json())
      .then((data) => setOffres(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // KPIs
  const kpis = useMemo(() => {
    const offresActives = offres.filter((o) => o.type_document === "Offre" && !["Abandonnée","Refusée","Convertie"].includes(o.statut));
    const commandes = offres.filter((o) => o.type_document === "Commande" || o.statut === "Acceptée");
    const abandonnees = offres.filter((o) => ["Abandonnée","Refusée"].includes(o.statut));
    const totalCA = commandes.reduce((s, o) => s + (o.total_ttc || 0), 0);
    const totalPotentiel = offresActives.reduce((s, o) => s + (o.total_ttc || 0), 0);
    const aRelancer = offres.filter((o) => {
      if (!o.date_relance_prevue) return false;
      return new Date(o.date_relance_prevue) <= new Date();
    });
    return { offresActives: offresActives.length, commandes: commandes.length, abandonnees: abandonnees.length, totalCA, totalPotentiel, aRelancer: aRelancer.length, total: offres.length };
  }, [offres]);

  // Commerciaux uniques
  const commerciaux = useMemo(() => {
    const set = new Set(offres.map((o) => o.commercial).filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [offres]);

  // Filtrage + tri
  const filtered = useMemo(() => {
    let list = [...offres];
    if (filterType !== "all") list = list.filter((o) => o.type_document === filterType);
    if (filterStatut !== "all") list = list.filter((o) => o.statut === filterStatut);
    if (filterCommercial !== "all") list = list.filter((o) => o.commercial === filterCommercial);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((o) =>
        [o.numero_affiche, o.client_nom, o.client_prenom, o.client_email, o.client_ville, o.reference, o.commercial]
          .some((v) => v?.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => {
      let av: string | number = (a as any)[sortKey] || "";
      let bv: string | number = (b as any)[sortKey] || "";
      if (sortKey === "total_ttc") { av = Number(av); bv = Number(bv); }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [offres, filterType, filterStatut, filterCommercial, search, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function SortIcon({ k }: { k: string }) {
    if (sortKey !== k) return <span style={{color:"#555", marginLeft:4}}>↕</span>;
    return <span style={{color:"#60a5fa", marginLeft:4}}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const thStyle: React.CSSProperties = {
    padding: "10px 12px", textAlign: "left", fontSize: 11,
    fontWeight: 700, color: "#71717a", textTransform: "uppercase",
    letterSpacing: "0.06em", cursor: "pointer", whiteSpace: "nowrap",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  };
  const tdStyle: React.CSSProperties = {
    padding: "10px 12px", fontSize: 13,
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    verticalAlign: "middle",
  };

  return (
    <div style={{minHeight:"100vh", background:"#1f2125", color:"#f4f4f5", fontFamily:"system-ui,sans-serif", padding:"24px"}}>
      <div style={{maxWidth:1700, margin:"0 auto"}}>

        {/* TOP BAR */}
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12}}>
          <div style={{display:"flex", alignItems:"center", gap:12}}>
            <img
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/picto_jardin_confort_apple_low.png?v=1775944940"
              alt="JC" style={{width:44, height:44, borderRadius:10, objectFit:"cover"}}
            />
            <div>
              <div style={{fontSize:11, color:"#71717a", textTransform:"uppercase", letterSpacing:"0.08em"}}>Jardin-Confort · Backoffice</div>
              <div style={{fontSize:22, fontWeight:700}}>Suivi offres & commandes</div>
            </div>
          </div>
          <Link href="/offres/nouveau" style={{
            display:"inline-flex", alignItems:"center", gap:8,
            background:"#3b82f6", color:"white", padding:"10px 20px",
            borderRadius:20, fontWeight:700, fontSize:14, textDecoration:"none",
          }}>
            ✚ Nouvelle offre / commande
          </Link>
        </div>

        {/* KPIs */}
        {!loading && (
          <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))", gap:12, marginBottom:24}}>
            {[
              { label: "Offres actives", value: kpis.offresActives, sub: `${formatMoney(kpis.totalPotentiel)} potentiel`, color: "#60a5fa" },
              { label: "Commandes", value: kpis.commandes, sub: `${formatMoney(kpis.totalCA)} CA`, color: "#4ade80" },
              { label: "Abandonnées", value: kpis.abandonnees, sub: "", color: "#f87171" },
              { label: "À relancer", value: kpis.aRelancer, sub: "relance prévue dépassée", color: "#f59e0b" },
              { label: "Total dossiers", value: kpis.total, sub: "", color: "#a78bfa" },
            ].map((kpi) => (
              <div key={kpi.label} style={{background:"#2a2d31", borderRadius:16, padding:"16px 20px", border:"1px solid rgba(255,255,255,0.06)"}}>
                <div style={{fontSize:11, color:"#71717a", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6}}>{kpi.label}</div>
                <div style={{fontSize:32, fontWeight:900, color:kpi.color, lineHeight:1}}>{kpi.value}</div>
                {kpi.sub && <div style={{fontSize:12, color:"#71717a", marginTop:4}}>{kpi.sub}</div>}
              </div>
            ))}
          </div>
        )}

        {/* FILTRES */}
        <div style={{background:"#2a2d31", borderRadius:16, padding:"16px 20px", marginBottom:16, border:"1px solid rgba(255,255,255,0.06)", display:"flex", gap:12, flexWrap:"wrap", alignItems:"center"}}>
          <input
            placeholder="🔍 Recherche : nom, email, numéro, ville…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{flex:1, minWidth:220, background:"#1f2125", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"8px 12px", color:"#f4f4f5", fontSize:13, outline:"none"}}
          />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as any)}
            style={{background:"#1f2125", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"8px 12px", color:"#f4f4f5", fontSize:13}}>
            <option value="all">Tous types</option>
            <option value="Offre">Offres</option>
            <option value="Commande">Commandes</option>
          </select>
          <select value={filterStatut} onChange={(e) => setFilterStatut(e.target.value)}
            style={{background:"#1f2125", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"8px 12px", color:"#f4f4f5", fontSize:13}}>
            <option value="all">Tous statuts</option>
            {Object.keys(STATUT_CONFIG).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterCommercial} onChange={(e) => setFilterCommercial(e.target.value)}
            style={{background:"#1f2125", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"8px 12px", color:"#f4f4f5", fontSize:13}}>
            <option value="all">Tous conseillers</option>
            {commerciaux.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <span style={{fontSize:13, color:"#71717a"}}>{filtered.length} résultat(s)</span>
        </div>

        {/* TABLEAU */}
        <div style={{background:"#2a2d31", borderRadius:16, border:"1px solid rgba(255,255,255,0.06)", overflow:"auto"}}>
          {loading ? (
            <div style={{padding:40, textAlign:"center", color:"#71717a"}}>Chargement…</div>
          ) : filtered.length === 0 ? (
            <div style={{padding:40, textAlign:"center", color:"#71717a"}}>Aucun résultat</div>
          ) : (
            <table style={{width:"100%", borderCollapse:"collapse", minWidth:900}}>
              <thead>
                <tr style={{background:"rgba(0,0,0,0.2)"}}>
                  <th style={thStyle} onClick={() => toggleSort("numero_affiche")}>N° <SortIcon k="numero_affiche"/></th>
                  <th style={thStyle} onClick={() => toggleSort("client_nom")}>Client <SortIcon k="client_nom"/></th>
                  <th style={thStyle} onClick={() => toggleSort("client_ville")}>Ville <SortIcon k="client_ville"/></th>
                  <th style={thStyle} onClick={() => toggleSort("commercial")}>Conseiller <SortIcon k="commercial"/></th>
                  <th style={thStyle} onClick={() => toggleSort("total_ttc")}>Montant <SortIcon k="total_ttc"/></th>
                  <th style={thStyle} onClick={() => toggleSort("statut")}>Statut <SortIcon k="statut"/></th>
                  <th style={thStyle} onClick={() => toggleSort("created_at")}>Créé le <SortIcon k="created_at"/></th>
                  <th style={thStyle} onClick={() => toggleSort("date_relance_prevue")}>Relance <SortIcon k="date_relance_prevue"/></th>
                  <th style={{...thStyle, cursor:"default"}}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const daysAgo = getDaysAgo(o.created_at);
                  const relanceDepassee = o.date_relance_prevue && new Date(o.date_relance_prevue) <= new Date();
                  return (
                    <tr key={o.id} style={{transition:"background 0.1s"}}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={tdStyle}>
                        <div style={{fontWeight:700, color:"#f4f4f5"}}>{o.numero_affiche}</div>
                        {o.reference && <div style={{fontSize:11, color:"#71717a", marginTop:2}}>{o.reference}</div>}
                        <div style={{fontSize:10, color:"#555", marginTop:2}}>{o.type_document}</div>
                      </td>
                      <td style={tdStyle}>
                        <div style={{fontWeight:600}}>{o.client_nom} {o.client_prenom}</div>
                        {o.client_societe && <div style={{fontSize:11, color:"#71717a"}}>{o.client_societe}</div>}
                        {o.client_email && <div style={{fontSize:11, color:"#71717a"}}>{o.client_email}</div>}
                      </td>
                      <td style={{...tdStyle, color:"#a1a1aa"}}>{o.client_npa} {o.client_ville}</td>
                      <td style={{...tdStyle, color:"#a1a1aa"}}>{o.commercial || "—"}</td>
                      <td style={{...tdStyle, fontWeight:700}}>{formatMoney(o.total_ttc)}</td>
                      <td style={tdStyle}><StatutBadge statut={o.statut} /></td>
                      <td style={{...tdStyle, color:"#71717a", fontSize:12}}>
                        {formatDate(o.created_at)}
                        {daysAgo !== null && <div style={{fontSize:11, color:"#555"}}>{daysAgo}j</div>}
                      </td>
                      <td style={tdStyle}>
                        {o.date_relance_prevue ? (
                          <span style={{
                            fontSize:12, fontWeight:600,
                            color: relanceDepassee ? "#f59e0b" : "#71717a",
                          }}>
                            {relanceDepassee ? "⚠ " : ""}{formatDate(o.date_relance_prevue)}
                          </span>
                        ) : <span style={{color:"#555"}}>—</span>}
                      </td>
                      <td style={tdStyle}>
                        <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
                          <Link href={`/dashboard/${o.slug}`}
                            style={{padding:"4px 10px", borderRadius:8, background:"rgba(59,130,246,0.15)", color:"#60a5fa", fontSize:12, fontWeight:600, textDecoration:"none", border:"1px solid rgba(59,130,246,0.25)"}}>
                            Détail
                          </Link>
                          <a href={`/offre/${o.slug}`} target="_blank"
                            style={{padding:"4px 10px", borderRadius:8, background:"rgba(74,222,128,0.1)", color:"#4ade80", fontSize:12, fontWeight:600, textDecoration:"none", border:"1px solid rgba(74,222,128,0.2)"}}>
                            Client ↗
                          </a>
                          <a href={`/print/offre/${o.slug}`} target="_blank"
                            style={{padding:"4px 10px", borderRadius:8, background:"rgba(255,255,255,0.05)", color:"#a1a1aa", fontSize:12, fontWeight:600, textDecoration:"none", border:"1px solid rgba(255,255,255,0.1)"}}>
                            🖨
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}