"use client";
// app/dashboard/arrivages/page.tsx
// Chantier « Arrivages » — réception par ligne d'article et par quantité
// (spec : claude/chantier-arrivages.md). Une seule page responsive : plein
// écran tactile au dépôt / comptoir (gros boutons) et mobile sur le téléphone.
//
// Deux voies de scan, sans toucher un champ :
//   - douchette : la page entière écoute le clavier (rafale terminée par Entrée) ;
//   - caméra : bouton « Scanner », décodage QR en JS embarqué (html5-qrcode,
//     installé en npm — jamais un CDN ; chargé à la demande, jamais au SSR).
// Trois états de ligne (stock à la commande ≥ qty / partiel / rien), « Tout
// reçu » ne solde que ce qui attend quelque chose, confirmation explicite avant
// toute écriture. Une erreur se corrige par une ligne négative, jamais par
// écrasement (append-only garanti en base).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CommandeArrivage, Candidat, LigneArrivage } from "@/lib/arrivages";

type Html5QrcodeInstance = {
  start: (
    camera: { facingMode: string },
    config: { fps: number; qrbox: number|{ width: number; height: number } },
    onSuccess: (texte: string) => void,
    onError?: (e: unknown) => void,
  ) => Promise<void>
  stop: () => Promise<void>
  clear: () => void
}

function fmtDate(iso: string|null|undefined) {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function aujourdhui() { return new Date().toISOString().slice(0, 10); }
function nomClient(c: { client_nom: string|null; client_prenom: string|null; client_societe: string|null }) {
  const personne = [c.client_nom, c.client_prenom].filter(Boolean).join(" ");
  return c.client_societe ? `${c.client_societe}${personne ? ` — ${personne}` : ""}` : personne || "—";
}
function n(v: number) { return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ""); }

const CLE_SAISI_PAR = "jc_arrivages_saisi_par";

export default function ArrivagesPage() {
  const [saisie, setSaisie] = useState("");
  const [commande, setCommande] = useState<CommandeArrivage|null>(null);
  const [candidats, setCandidats] = useState<Candidat[]|null>(null);
  const [dernierScan, setDernierScan] = useState("");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);
  // Saisie en cours : position → quantité à enregistrer (peut être négative)
  const [saisies, setSaisies] = useState<Record<number, number>>({});
  const [corrections, setCorrections] = useState<Record<number, boolean>>({});
  const [dateReception, setDateReception] = useState(aujourdhui());
  const [note, setNote] = useState("");
  const [saisiPar, setSaisiPar] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [succes, setSucces] = useState("");
  const [historique, setHistorique] = useState(false);
  // Caméra
  const [cameraOuverte, setCameraOuverte] = useState(false);
  const [cameraErreur, setCameraErreur] = useState("");
  const scannerRef = useRef<Html5QrcodeInstance|null>(null);
  const tamponRef = useRef("");
  const dernierCaractereRef = useRef(0);
  const champRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { setSaisiPar(localStorage.getItem(CLE_SAISI_PAR) || ""); } catch { /* navigation privée */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CLE_SAISI_PAR, saisiPar); } catch { /* idem */ }
  }, [saisiPar]);

  // ─── Recherche ────────────────────────────────────────────────────────────
  const chercher = useCallback(async (q: string) => {
    const texte = q.trim();
    if (!texte) return;
    setChargement(true); setErreur(""); setSucces(""); setCandidats(null);
    setDernierScan(texte);
    try {
      const res = await fetch(`/api/arrivages?q=${encodeURIComponent(texte)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      if (json.commande) {
        setCommande(json.commande); setSaisies({}); setCorrections({}); setNote(""); setHistorique(false);
      } else {
        setCommande(null);
        setCandidats(json.candidats || []);
      }
    } catch (e) { setErreur((e as Error).message); }
    finally { setChargement(false); setSaisie(""); }
  }, []);

  // Arrivée depuis le dashboard délais ou la page commande : ?q=<numéro>
  // (lu sur window, pas via useSearchParams → pas de Suspense à poser).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) chercher(q);
  }, [chercher]);

  const ouvrirCandidat = useCallback(async (c: Candidat) => {
    setChargement(true); setErreur("");
    try {
      const res = await fetch(`/api/arrivages?boutique=${encodeURIComponent(c.boutique)}&numero=${encodeURIComponent(c.numero_commande)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      setCommande(json.commande); setCandidats(null); setSaisies({}); setCorrections({}); setNote(""); setHistorique(false);
    } catch (e) { setErreur((e as Error).message); }
    finally { setChargement(false); }
  }, []);

  // ─── Douchette : la page entière écoute le clavier ────────────────────────
  // Une douchette tape vite (< 50 ms entre deux caractères) et termine par
  // Entrée. Quand un champ de saisie a le focus, on le laisse faire (son propre
  // Entrée déclenche la recherche).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cible = e.target as HTMLElement|null;
      const tag = cible?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || cible?.isContentEditable) return;
      if (confirmation) return;
      const maintenant = Date.now();
      if (maintenant - dernierCaractereRef.current > 400) tamponRef.current = "";
      dernierCaractereRef.current = maintenant;
      if (e.key === "Enter") {
        const t = tamponRef.current.trim();
        tamponRef.current = "";
        if (t.length >= 2) { e.preventDefault(); chercher(t); }
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        tamponRef.current += e.key;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chercher, confirmation]);

  // ─── Caméra (html5-qrcode, import dynamique) ──────────────────────────────
  async function ouvrirCamera() {
    setCameraErreur(""); setCameraOuverte(true);
    try {
      const mod = await import("html5-qrcode");
      // Laisser React poser le conteneur avant de démarrer.
      await new Promise(r => setTimeout(r, 50));
      const scanner = new mod.Html5Qrcode("zone-camera") as unknown as Html5QrcodeInstance;
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (texte) => { fermerCamera(); chercher(texte); },
        () => { /* pas de QR dans l'image : normal */ },
      );
    } catch (e) {
      setCameraErreur(`Caméra indisponible : ${(e as Error)?.message || String(e)}. HTTPS requis et autorisation à accorder.`);
    }
  }
  async function fermerCamera() {
    const s = scannerRef.current;
    scannerRef.current = null;
    setCameraOuverte(false);
    if (s) { try { await s.stop(); s.clear(); } catch { /* déjà arrêté */ } }
  }
  useEffect(() => () => { if (scannerRef.current) scannerRef.current.stop().catch(() => {}); }, []);

  // ─── Saisie des quantités ─────────────────────────────────────────────────
  function poser(l: LigneArrivage, qty: number) {
    setSaisies(prev => {
      const next = { ...prev };
      if (qty === 0) delete next[l.position]; else next[l.position] = qty;
      return next;
    });
  }
  function defaut(l: LigneArrivage) { return l.qty_restante > 0 ? l.qty_restante : 1; }
  function toutRecu() {
    if (!commande) return;
    const next: Record<number, number> = {};
    for (const l of commande.lignes) if (l.qty_restante > 0) next[l.position] = l.qty_restante;
    setSaisies(next);
  }

  const aEnregistrer = useMemo(() => {
    if (!commande) return [];
    return commande.lignes
      .filter(l => saisies[l.position] !== undefined && saisies[l.position] !== 0)
      .map(l => ({ ligne: l, qty: saisies[l.position] }));
  }, [commande, saisies]);

  const resume = useMemo(() => {
    if (!commande) return null;
    const total = commande.lignes.length;
    const couvertes = commande.lignes.filter(l => l.etat === "complete" || l.etat === "excedent").length;
    const enStock = commande.lignes.filter(l => l.mode_ligne === "en_stock").length;
    const attendues = commande.lignes.filter(l => l.qty_restante > 0).length;
    return { total, couvertes, enStock, attendues };
  }, [commande]);

  async function enregistrer() {
    if (!commande || !aEnregistrer.length) return;
    setEnregistrement(true); setErreur("");
    try {
      const res = await fetch("/api/arrivages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boutique: commande.boutique, numero_commande: commande.numero_commande,
          date_reception: dateReception, commentaire: note, saisi_par: saisiPar,
          lignes: aEnregistrer.map(a => ({ position: a.ligne.position, qty_recue: a.qty })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      setCommande(json.commande || commande);
      setSaisies({}); setCorrections({}); setNote(""); setConfirmation(false);
      setSucces(`${json.enregistrees} ligne(s) enregistrée(s) sur ${commande.numero_commande} — ${fmtDate(dateReception)}.`);
    } catch (e) { setErreur((e as Error).message); }
    finally { setEnregistrement(false); }
  }

  // ─── Rendu ────────────────────────────────────────────────────────────────
  const btn = "inline-flex items-center justify-center rounded-2xl border text-base font-semibold transition active:scale-[0.98] disabled:opacity-40 select-none";
  const btnGris = `${btn} border-white/10 bg-[#2a2d31] text-zinc-200 hover:bg-[#34383d]`;
  const btnVert = `${btn} border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25`;
  const btnBleu = `${btn} border-sky-400/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25`;

  return (
    <main className="min-h-screen bg-[#1f2125] px-3 py-4 text-zinc-100 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-[1100px] space-y-4">

        {/* En-tête */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/picto_jardin_confort_apple_low.png?v=1775944940" alt="" className="h-12 w-12 rounded-xl object-contain"/>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">📦 Arrivages</h1>
              <p className="text-sm text-zinc-400">Scanner la commande, cocher ce qui est arrivé. Rien n&apos;est écrit avant la confirmation.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input value={saisiPar} onChange={e => setSaisiPar(e.target.value)} placeholder="Qui reçoit ? (prénom)"
              className="w-40 rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"/>
            <Link href="/dashboard/delais" className={`${btnGris} px-4 py-2 text-sm`}>⏱ Délais</Link>
            <Link href="/dashboard" className={`${btnGris} px-4 py-2 text-sm`}>← Dashboard</Link>
          </div>
        </div>

        {/* Scan / saisie */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
          <form onSubmit={e => { e.preventDefault(); chercher(saisie); }} className="flex flex-col gap-3 sm:flex-row">
            <input ref={champRef} value={saisie} onChange={e => setSaisie(e.target.value)} autoComplete="off" inputMode="search"
              placeholder="Scanner le QR (douchette) ou taper : CMD-80877, JAR-13585, nom du client…"
              className="flex-1 rounded-2xl border border-white/10 bg-[#1f2125] px-4 py-4 text-lg text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-sky-400/50"/>
            <button type="submit" disabled={chargement || !saisie.trim()} className={`${btnBleu} px-6 py-4`}>🔍 Chercher</button>
            <button type="button" onClick={cameraOuverte ? fermerCamera : ouvrirCamera} className={`${cameraOuverte ? btnGris : btnVert} px-6 py-4`}>
              {cameraOuverte ? "✕ Fermer la caméra" : "📷 Scanner"}
            </button>
          </form>
          {cameraOuverte && (
            <div className="mt-3">
              <div id="zone-camera" className="mx-auto w-full max-w-[420px] overflow-hidden rounded-2xl bg-black"/>
              <p className="mt-2 text-center text-xs text-zinc-500">Viser le QR de la fiche de travail (N° de commande ou réf. client).</p>
            </div>
          )}
          {cameraErreur && <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">{cameraErreur}</div>}
          {dernierScan && !chargement && <div className="mt-2 text-xs text-zinc-500">Dernier scan : <span className="text-zinc-300">{dernierScan}</span></div>}
        </div>

        {chargement && <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4 text-zinc-400">Recherche…</div>}
        {erreur && <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{erreur}</div>}
        {succes && <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">✅ {succes}</div>}

        {/* Plusieurs candidats → on propose, on ne choisit pas */}
        {candidats && (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
            {candidats.length === 0 ? (
              <div className="text-zinc-300">Aucune commande ouverte ne correspond à « {dernierScan} ». Vérifier le numéro ou taper le nom du client.</div>
            ) : (
              <>
                <div className="mb-3 text-sm text-zinc-400">{candidats.length} commandes ouvertes correspondent à « {dernierScan} » — laquelle ?</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {candidats.map(c => (
                    <button key={`${c.boutique}|${c.numero_commande}`} onClick={() => ouvrirCandidat(c)}
                      className="rounded-2xl border border-white/10 bg-[#1f2125] p-4 text-left transition hover:bg-[#31353b]">
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-semibold">{c.numero_commande}</span>
                        <span className="text-xs text-zinc-500">{c.boutique === "magasin" ? "Mag" : "web"} · {fmtDate(c.date_commande)}</span>
                      </div>
                      <div className="text-sm text-zinc-300">{nomClient(c)}</div>
                      <div className="mt-1 text-xs text-zinc-500">{c.marques.join(" · ")}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Commande */}
        {commande && resume && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-2xl font-bold">{commande.numero_commande} <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-zinc-300">{commande.canal}</span></div>
                  <div className="text-lg text-zinc-200">{nomClient(commande)}</div>
                  <div className="text-sm text-zinc-500">Commandé le {fmtDate(commande.date_commande)}</div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-2xl font-bold text-emerald-300">{resume.couvertes}<span className="text-base text-zinc-500">/{resume.total} lignes couvertes</span></div>
                  <div className="text-zinc-400">{resume.enStock} en stock à la commande · {resume.attendues} en attente</div>
                  {commande.mouvements.length > 0 && (
                    <button onClick={() => setHistorique(h => !h)} className="mt-1 text-xs text-sky-300 underline">{historique ? "Masquer" : "Voir"} l&apos;historique ({commande.mouvements.length})</button>
                  )}
                </div>
              </div>
              {historique && (
                <div className="mt-3 space-y-1 border-t border-white/5 pt-3 text-sm">
                  {commande.mouvements.map(m => (
                    <div key={m.id} className="flex flex-wrap gap-x-3 text-zinc-400">
                      <span className="w-20 text-zinc-500">{fmtDate(m.date_reception)}</span>
                      <span className={`font-semibold ${m.qty_recue < 0 ? "text-rose-300" : "text-emerald-300"}`}>{m.qty_recue > 0 ? "+" : ""}{n(m.qty_recue)}</span>
                      <span className="text-zinc-300">{m.titre || m.sku || `ligne ${m.position}`}</span>
                      <span className="text-zinc-500">{m.saisi_par}{m.commentaire ? ` · ${m.commentaire}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Lignes */}
            <div className="space-y-2">
              {commande.lignes.map(l => {
                const qty = saisies[l.position];
                const enCorrection = corrections[l.position];
                const couverte = l.etat === "complete" || l.etat === "excedent";
                const afficheBouton = l.mode_ligne !== "en_stock" || enCorrection;
                return (
                  <div key={l.position} className={`rounded-2xl border p-4 ${couverte && qty === undefined ? "border-emerald-500/20 bg-emerald-500/5" : "border-white/10 bg-[#2a2d31]"}`}>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className={`text-base font-medium ${l.mode_ligne === "en_stock" && !enCorrection ? "text-zinc-400" : "text-zinc-100"}`}>
                          <span className="mr-2 text-zinc-500">{l.position}.</span>{l.titre || l.sku || "Ligne sans titre"}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                          {l.sku && <span>SKU {l.sku}</span>}
                          {l.marque ? <span>{l.marque}</span> : <span className="text-amber-300/80">ligne à la volée</span>}
                          <span>commandé <b className="text-zinc-300">{n(l.qty_commandee)}</b></span>
                          {l.qty_stock_cmd > 0 && <span>en stock à la commande <b className="text-zinc-300">{n(l.qty_stock_cmd)}</b></span>}
                          {l.stock_cmd === "sur_commande" && <span>sur commande</span>}
                          {l.qty_recue_totale !== 0 && <span>reçu <b className="text-emerald-300">{n(l.qty_recue_totale)}</b>{l.derniere_reception ? ` (${fmtDate(l.derniere_reception)})` : ""}</span>}
                          {l.ligne_disparue && <span className="text-rose-300">ligne retirée de la commande</span>}
                        </div>
                        <div className="mt-2">
                          {l.mode_ligne === "en_stock" && !enCorrection && (
                            <span className="inline-flex items-center gap-2 rounded-full bg-zinc-500/15 px-3 py-1 text-sm text-zinc-300">
                              🏬 Déjà en stock — rien à recevoir
                              <button onClick={() => setCorrections(c => ({ ...c, [l.position]: true }))} className="text-xs text-sky-300 underline">corriger</button>
                            </span>
                          )}
                          {l.mode_ligne === "partiel_stock" && (
                            <span className="inline-flex items-center rounded-full bg-amber-500/15 px-3 py-1 text-sm text-amber-200">
                              En stock : {n(l.qty_stock_cmd)}/{n(l.qty_commandee)} — reçu : {n(l.qty_recue_totale)} — reste {n(l.qty_restante)}
                            </span>
                          )}
                          {l.mode_ligne === "a_recevoir" && (
                            couverte
                              ? <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-3 py-1 text-sm text-emerald-200">✅ Reçu {n(l.qty_recue_totale)}/{n(l.qty_commandee)}{l.etat === "excedent" ? " (excédent)" : ""}</span>
                              : <span className="inline-flex items-center rounded-full bg-sky-500/15 px-3 py-1 text-sm text-sky-200">⏳ Reste à recevoir : {n(l.qty_restante)}{l.qty_recue_totale > 0 ? ` (déjà reçu ${n(l.qty_recue_totale)})` : ""}</span>
                          )}
                        </div>
                      </div>

                      {afficheBouton && (
                        <div className="flex items-center gap-2 md:justify-end">
                          {qty === undefined ? (
                            <>
                              {l.qty_restante > 0 || enCorrection || couverte ? (
                                <button onClick={() => poser(l, defaut(l))} className={`${btnVert} px-5 py-3`}>
                                  📦 Reçu {l.qty_restante > 0 ? n(l.qty_restante) : ""}
                                </button>
                              ) : null}
                              {l.qty_recue_totale > 0 && (
                                <button onClick={() => poser(l, -1)} title="Annuler une réception enregistrée par erreur (ligne négative)" className={`${btnGris} px-4 py-3 text-sm`}>↩︎ Annuler</button>
                              )}
                            </>
                          ) : (
                            <div className={`flex items-center gap-1 rounded-2xl border p-1 ${qty < 0 ? "border-rose-400/40 bg-rose-500/10" : "border-emerald-400/40 bg-emerald-500/10"}`}>
                              <button onClick={() => poser(l, qty - 1)} className={`${btnGris} h-12 w-12 text-xl`}>−</button>
                              <input type="number" step="any" value={qty} onChange={e => poser(l, Number(e.target.value) || 0)}
                                className="h-12 w-20 rounded-xl border border-white/10 bg-[#1f2125] text-center text-xl font-bold text-zinc-100 outline-none"/>
                              <button onClick={() => poser(l, qty + 1)} className={`${btnGris} h-12 w-12 text-xl`}>+</button>
                              <button onClick={() => poser(l, 0)} className={`${btnGris} h-12 px-3 text-sm`}>✕</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Barre d'action */}
            <div className="sticky bottom-0 rounded-2xl border border-white/10 bg-[#2a2d31]/95 p-4 backdrop-blur">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <button onClick={toutRecu} disabled={resume.attendues === 0} className={`${btnBleu} px-5 py-3`}>✅ Tout reçu ({resume.attendues})</button>
                <label className="flex items-center gap-2 text-sm text-zinc-400">Date
                  <input type="date" value={dateReception} onChange={e => setDateReception(e.target.value)}
                    className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2.5 text-base text-zinc-100 outline-none"/>
                </label>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (colis abîmé, couleur différente, PLAN B…)"
                  className="flex-1 rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2.5 text-base text-zinc-100 outline-none placeholder:text-zinc-500"/>
                <button onClick={() => setConfirmation(true)} disabled={!aEnregistrer.length} className={`${btnVert} px-6 py-3 text-lg`}>
                  Enregistrer ({aEnregistrer.length})
                </button>
              </div>
            </div>
          </div>
        )}

        {!commande && !candidats && !chargement && (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-zinc-500">
            Scanner le QR d&apos;une fiche de travail, ou taper un numéro de commande / un nom de client.
          </div>
        )}
      </div>

      {/* Confirmation — rien n'est écrit avant */}
      {confirmation && commande && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={() => !enregistrement && setConfirmation(false)}>
          <div className="w-full max-w-[640px] rounded-2xl border border-white/10 bg-[#2a2d31] p-5" onClick={e => e.stopPropagation()}>
            <div className="text-xl font-semibold">Confirmer la réception — {commande.numero_commande}</div>
            <div className="mt-1 text-sm text-zinc-400">{nomClient(commande)} · {fmtDate(dateReception)}{saisiPar ? ` · par ${saisiPar}` : ""}</div>
            <div className="mt-4 max-h-[45vh] space-y-2 overflow-y-auto">
              {aEnregistrer.map(a => (
                <div key={a.ligne.position} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-[#1f2125] px-3 py-2">
                  <div className="min-w-0 text-sm">
                    <div className="truncate text-zinc-100">{a.ligne.titre || a.ligne.sku || `Ligne ${a.ligne.position}`}</div>
                    <div className="text-xs text-zinc-500">commandé {n(a.ligne.qty_commandee)} · déjà couvert {n(a.ligne.qty_couverte)}</div>
                  </div>
                  <div className={`text-2xl font-bold ${a.qty < 0 ? "text-rose-300" : "text-emerald-300"}`}>{a.qty > 0 ? "+" : ""}{n(a.qty)}</div>
                </div>
              ))}
            </div>
            {note && <div className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200">📝 {note}</div>}
            {!saisiPar && <div className="mt-3 text-xs text-amber-300/80">Astuce : indiquer qui reçoit (champ en haut) pour retrouver la saisie plus tard.</div>}
            <div className="mt-5 flex gap-3">
              <button onClick={() => setConfirmation(false)} disabled={enregistrement} className={`${btnGris} flex-1 px-5 py-4`}>Annuler</button>
              <button onClick={enregistrer} disabled={enregistrement} className={`${btnVert} flex-1 px-5 py-4 text-lg`}>{enregistrement ? "Enregistrement…" : "✅ Enregistrer"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
