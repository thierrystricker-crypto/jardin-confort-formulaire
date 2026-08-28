"use client";
// app/dashboard/qr-libre/page.tsx
// QR-paiement à la volée — génère un bulletin de paiement suisse (QR) pour un
// montant libre, sans passer par le QR figé d'une commande.
//
// Cas d'usage : acompte demandé à un nouveau client, ou client qui a déjà payé
// une partie au magasin (carte/cash) et veut régler le solde — ou un montant
// différent du 50 % / 100 % convenu — par QR.
//
// Pré-remplissage : recherche dans le fichier clients, ou depuis un numéro de
// commande/offre (adresse + total proposé). Tout reste modifiable à la main.
// Génération via /api/qr-libre (chaîne pdf.co → pdf4me, comme le QR commande).

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EQUIPE_JARDI, CLE_UTILISATEUR } from "@/lib/jardi-equipe";

type ClientHit = {
  id: number;
  nom: string | null;
  prenom: string | null;
  societe: string | null;
  rue: string | null;
  numero_rue: string | null;
  npa: string | null;
  ville: string | null;
};

type DocInfo = {
  numero_affiche: string;
  type_document: string;
  statut: string | null;
  payment_mode: string | null;
  total_ttc: number | null;
  societe: string;
  nom: string;
  prenom: string;
  rue: string;
  numero: string;
  npa: string;
  ville: string;
};

type HistRow = {
  id: number;
  created_at: string;
  societe: string | null;
  nom: string | null;
  prenom: string | null;
  montant: number;
  libelle: string | null;
  reference: string | null;
  commande_numero: string | null;
  commercial: string | null;
  pdf_url: string | null;
};

function fmtMoney(v: number): string {
  return "CHF " + new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function parseMontant(raw: string): number {
  return Math.round(parseFloat(raw.replace(/'/g, "").replace(",", ".")) * 100) / 100;
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:border-[#2B8AD1]/60 focus:outline-none";
const lblCls = "mb-1 block text-xs font-medium text-zinc-400";

export default function QrLibrePage() {
  // ─── Formulaire ───
  const [societe, setSociete] = useState("");
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [rue, setRue] = useState("");
  const [numero, setNumero] = useState("");
  const [npa, setNpa] = useState("");
  const [ville, setVille] = useState("");
  const [montant, setMontant] = useState("");
  const [libelle, setLibelle] = useState("Acompte");
  const [reference, setReference] = useState("");
  const [commercial, setCommercial] = useState("");

  // ─── Pré-remplissage client ───
  const [clientQuery, setClientQuery] = useState("");
  const [clientHits, setClientHits] = useState<ClientHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Pré-remplissage commande ───
  const [cmdQuery, setCmdQuery] = useState("");
  const [docInfo, setDocInfo] = useState<DocInfo | null>(null);
  const [cmdLoading, setCmdLoading] = useState(false);
  const [cmdError, setCmdError] = useState("");

  // ─── Génération ───
  const [confirming, setConfirming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [error, setError] = useState("");

  // ─── Historique ───
  const [historique, setHistorique] = useState<HistRow[]>([]);

  useEffect(() => {
    try {
      const u = localStorage.getItem(CLE_UTILISATEUR);
      if (u && (EQUIPE_JARDI as readonly string[]).includes(u)) setCommercial(u);
    } catch { /* localStorage indisponible : champ vide */ }
    loadHistorique();

    // ─── Pré-remplissage par l'URL ───
    // Boutons « Créer QR paiement à la volée » des autres pages :
    //   ?prefill=<JSON>  (fiche client : societe, nom, prenom, rue, numero, npa, ville)
    //   ?commande=CMD-XXXXX  (page offre/commande : charge le document)
    // window.location plutôt que useSearchParams : évite le Suspense imposé
    // par Next au prerender, et ne tourne qu'au montage côté navigateur.
    try {
      const params = new URLSearchParams(window.location.search);
      const prefillRaw = params.get("prefill");
      if (prefillRaw) {
        const p = JSON.parse(prefillRaw) as Record<string, unknown>;
        const v = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
        setSociete(v("societe"));
        setNom(v("nom"));
        setPrenom(v("prenom"));
        setRue(v("rue"));
        setNumero(v("numero"));
        setNpa(v("npa"));
        setVille(v("ville"));
      }
      const cmd = (params.get("commande") || "").trim();
      if (cmd) {
        setCmdQuery(cmd);
        loadCommandeFor(cmd);
      }
    } catch { /* paramètre illisible : formulaire vierge */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadHistorique() {
    try {
      const res = await fetch("/api/qr-libre");
      const json = await res.json();
      if (res.ok) setHistorique(json.historique || []);
    } catch { /* non bloquant */ }
  }

  // ─── Recherche client (debounce 300 ms) ───
  function onClientQuery(v: string) {
    setClientQuery(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (v.trim().length < 2) { setClientHits([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(v.trim())}&limit=8`);
        const json = await res.json();
        setClientHits(res.ok ? (json.clients || []) : []);
      } catch {
        setClientHits([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function pickClient(c: ClientHit) {
    setSociete(c.societe || "");
    setNom(c.nom || "");
    setPrenom(c.prenom || "");
    setRue(c.rue || "");
    setNumero(c.numero_rue || "");
    setNpa(c.npa || "");
    setVille(c.ville || "");
    setClientQuery("");
    setClientHits([]);
  }

  // ─── Chargement commande/offre ───
  function loadCommande() {
    loadCommandeFor(cmdQuery.trim());
  }

  async function loadCommandeFor(q: string) {
    if (!q) return;
    setCmdLoading(true);
    setCmdError("");
    setDocInfo(null);
    try {
      const res = await fetch(`/api/qr-libre?commande=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      const doc: DocInfo = json.document;
      setDocInfo(doc);
      setSociete(doc.societe);
      setNom(doc.nom);
      setPrenom(doc.prenom);
      setRue(doc.rue);
      setNumero(doc.numero);
      setNpa(doc.npa);
      setVille(doc.ville);
      setReference(doc.numero_affiche);
      setLibelle(`Acompte ${doc.numero_affiche}`);
    } catch (e) {
      setCmdError(String(e instanceof Error ? e.message : e));
    } finally {
      setCmdLoading(false);
    }
  }

  function setPartDuTotal(part: number) {
    if (docInfo?.total_ttc == null) return;
    setMontant((Math.round(docInfo.total_ttc * part * 100) / 100).toFixed(2));
  }

  // ─── Validation locale avant récapitulatif ───
  function verifier(): string {
    if (!societe.trim() && !nom.trim()) return "Nom ou société obligatoire.";
    if (!rue.trim() || !npa.trim() || !ville.trim()) return "Adresse complète obligatoire (rue, NPA, ville) — exigée par le QR suisse.";
    const m = parseMontant(montant);
    if (!Number.isFinite(m) || m <= 0) return "Montant invalide.";
    return "";
  }

  function demanderConfirmation() {
    const err = verifier();
    if (err) { setError(err); return; }
    setError("");
    setConfirming(true);
  }

  async function generer() {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/qr-libre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          societe, nom, prenom, rue, numero, npa, ville,
          montant: parseMontant(montant),
          libelle, reference,
          commande_numero: docInfo?.numero_affiche || "",
          commercial,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      setPdfUrl(json.pdf_url);
      setConfirming(false);
      loadHistorique();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  }

  function reinitialiser() {
    setSociete(""); setNom(""); setPrenom("");
    setRue(""); setNumero(""); setNpa(""); setVille("");
    setMontant(""); setLibelle("Acompte"); setReference("");
    setCmdQuery(""); setDocInfo(null); setCmdError("");
    setPdfUrl(""); setError(""); setConfirming(false);
  }

  const nomClient = societe.trim() || [prenom, nom].map(v => v.trim()).filter(Boolean).join(" ");
  const montantParse = parseMontant(montant);

  return (
    <main className="min-h-screen bg-[#1f2125]">
      <div className="mx-auto max-w-4xl px-4 py-8 text-zinc-100">

        {/* HEADER */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">💳 QR-paiement à la volée</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Bulletin de paiement suisse pour un montant libre — acompte ou solde,
              indépendant du QR figé d&apos;une commande.
            </p>
          </div>
          <Link href="/dashboard" className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-200 transition hover:bg-[#40454b]">
            ← Dashboard
          </Link>
        </div>

        {/* RÉSULTAT */}
        {pdfUrl && (
          <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6">
            <div className="text-sm font-semibold text-emerald-300">✅ QR-paiement généré</div>
            <div className="mt-1 text-sm text-zinc-300">
              {nomClient} · {Number.isFinite(montantParse) ? fmtMoney(montantParse) : ""}
              {reference ? ` · réf. ${reference}` : ""}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center rounded-xl bg-[#2B8AD1] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2478b8]">
                Ouvrir le PDF ↗
              </a>
              <button onClick={reinitialiser}
                className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-5 py-2.5 text-sm text-zinc-200 transition hover:bg-[#40454b]">
                + Nouveau QR
              </button>
            </div>
          </div>
        )}

        {!pdfUrl && (
          <>
            {/* PRÉ-REMPLISSAGE */}
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Recherche client */}
              <div className="relative rounded-2xl border border-white/10 bg-[#2a2d31] p-5">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Client existant</div>
                <input type="text" value={clientQuery} placeholder="Rechercher (nom, société, ville, téléphone…)"
                  autoComplete="off" className={inputCls}
                  onChange={e => onClientQuery(e.target.value)} />
                {searching && <div className="mt-2 text-xs text-zinc-500">Recherche…</div>}
                {clientHits.length > 0 && (
                  <div className="absolute left-5 right-5 z-10 mt-1 max-h-64 overflow-auto rounded-xl border border-white/10 bg-[#34383d] shadow-xl">
                    {clientHits.map(c => (
                      <button key={c.id} onClick={() => pickClient(c)}
                        className="block w-full border-b border-white/5 px-3 py-2 text-left text-sm last:border-0 hover:bg-[#40454b]">
                        <span className="font-medium text-zinc-100">
                          {[c.nom, c.prenom].filter(Boolean).join(" ") || c.societe || "—"}
                        </span>
                        <span className="ml-2 text-xs text-zinc-400">
                          {c.societe && [c.nom, c.prenom].some(Boolean) ? `${c.societe} · ` : ""}
                          {[c.npa, c.ville].filter(Boolean).join(" ")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-zinc-500">Pré-remplit nom et adresse depuis le fichier clients.</p>
              </div>

              {/* Depuis une commande */}
              <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-5">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Depuis une commande / offre</div>
                <div className="flex gap-2">
                  <input type="text" value={cmdQuery} placeholder="CMD-80923 ou DEV-2026-748"
                    autoComplete="off" className={inputCls}
                    onChange={e => setCmdQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") loadCommande(); }} />
                  <button onClick={loadCommande} disabled={cmdLoading || !cmdQuery.trim()}
                    className="shrink-0 rounded-xl border border-[#2B8AD1]/40 bg-[#2B8AD1]/15 px-4 py-2 text-sm text-sky-300 transition hover:bg-[#2B8AD1]/25 disabled:opacity-50">
                    {cmdLoading ? "…" : "Charger"}
                  </button>
                </div>
                {cmdError && <div className="mt-2 text-xs text-rose-300">{cmdError}</div>}
                {docInfo && (
                  <div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-zinc-300">
                    <div>
                      <span className="font-semibold text-sky-300">{docInfo.numero_affiche}</span>
                      {" · "}{docInfo.type_document}{docInfo.statut ? ` · ${docInfo.statut}` : ""}
                    </div>
                    {docInfo.total_ttc != null && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span>Total : <strong className="text-zinc-100">{fmtMoney(docInfo.total_ttc)}</strong></span>
                        <button onClick={() => setPartDuTotal(1)} className="rounded-lg border border-white/10 bg-[#34383d] px-2 py-0.5 hover:bg-[#40454b]">100 %</button>
                        <button onClick={() => setPartDuTotal(0.5)} className="rounded-lg border border-white/10 bg-[#34383d] px-2 py-0.5 hover:bg-[#40454b]">50 %</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* FORMULAIRE */}
            <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
              <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">Débiteur (payeur)</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={lblCls}>Société (si client professionnel)</label>
                  <input type="text" value={societe} autoComplete="off" className={inputCls}
                    onChange={e => setSociete(e.target.value)} />
                </div>
                <div>
                  <label className={lblCls}>Nom {societe.trim() ? "" : "*"}</label>
                  <input type="text" value={nom} autoComplete="off" className={inputCls}
                    onChange={e => setNom(e.target.value)} />
                </div>
                <div>
                  <label className={lblCls}>Prénom</label>
                  <input type="text" value={prenom} autoComplete="off" className={inputCls}
                    onChange={e => setPrenom(e.target.value)} />
                </div>
                <div>
                  <label className={lblCls}>Rue *</label>
                  <input type="text" value={rue} autoComplete="off" className={inputCls}
                    onChange={e => setRue(e.target.value)} />
                </div>
                <div>
                  <label className={lblCls}>N°</label>
                  <input type="text" value={numero} autoComplete="off" className={inputCls}
                    onChange={e => setNumero(e.target.value)} />
                </div>
                <div>
                  <label className={lblCls}>NPA *</label>
                  <input type="text" value={npa} autoComplete="off" className={inputCls}
                    onChange={e => setNpa(e.target.value)} />
                </div>
                <div>
                  <label className={lblCls}>Ville *</label>
                  <input type="text" value={ville} autoComplete="off" className={inputCls}
                    onChange={e => setVille(e.target.value)} />
                </div>
              </div>

              <div className="mb-4 mt-6 text-xs font-semibold uppercase tracking-wide text-zinc-400">Paiement</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={lblCls}>Montant CHF *</label>
                  <input type="text" value={montant} placeholder="450.00" inputMode="decimal"
                    autoComplete="off" className={inputCls}
                    onChange={e => setMontant(e.target.value)} />
                </div>
                <div>
                  <label className={lblCls}>Libellé (affiché sur le bulletin)</label>
                  <input type="text" value={libelle} autoComplete="off" className={inputCls}
                    onChange={e => setLibelle(e.target.value)} />
                </div>
                <div>
                  <label className={lblCls}>Référence (n° de commande ou texte libre)</label>
                  <input type="text" value={reference} autoComplete="off" className={inputCls}
                    onChange={e => setReference(e.target.value)} />
                </div>
                <div>
                  <label className={lblCls}>Conseiller</label>
                  <select value={commercial} className={inputCls}
                    onChange={e => setCommercial(e.target.value)}>
                    <option value="">—</option>
                    {EQUIPE_JARDI.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
              )}

              {/* CONFIRMATION */}
              {confirming ? (
                <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
                  <div className="text-sm font-semibold text-amber-300">Vérifier avant génération</div>
                  <div className="mt-2 space-y-1 text-sm text-zinc-200">
                    <div>Payeur : <strong>{nomClient}</strong></div>
                    <div>Adresse : {[rue, numero].filter(Boolean).join(" ")}, {npa} {ville}</div>
                    <div>Montant : <strong className="text-lg">{Number.isFinite(montantParse) ? fmtMoney(montantParse) : "—"}</strong></div>
                    <div>Libellé : {libelle || "—"}{reference ? ` · Référence : ${reference}` : ""}</div>
                  </div>
                  <div className="mt-4 flex gap-3">
                    <button onClick={generer} disabled={generating}
                      className="rounded-xl bg-[#2B8AD1] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2478b8] disabled:opacity-50">
                      {generating ? "Génération en cours… (~15 s)" : "Confirmer et générer"}
                    </button>
                    <button onClick={() => setConfirming(false)} disabled={generating}
                      className="rounded-xl border border-white/10 bg-[#34383d] px-5 py-2.5 text-sm text-zinc-200 transition hover:bg-[#40454b] disabled:opacity-50">
                      Modifier
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-6">
                  <button onClick={demanderConfirmation}
                    className="rounded-xl bg-[#2B8AD1] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#2478b8]">
                    Générer le QR-paiement
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* HISTORIQUE */}
        <div className="mt-8">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Derniers QR générés</div>
          {historique.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6 text-center text-sm text-zinc-500">
              Aucun QR généré pour l&apos;instant.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#2a2d31]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-zinc-400">
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Client</th>
                      <th className="px-4 py-3 text-right font-medium">Montant</th>
                      <th className="px-4 py-3 font-medium">Libellé / référence</th>
                      <th className="px-4 py-3 font-medium">Conseiller</th>
                      <th className="px-4 py-3 text-right font-medium">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historique.map(h => (
                      <tr key={h.id} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-3 whitespace-nowrap text-zinc-400">{fmtDateTime(h.created_at)}</td>
                        <td className="px-4 py-3 font-medium text-zinc-100">
                          {h.societe || [h.nom, h.prenom].filter(Boolean).join(" ") || "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{fmtMoney(Number(h.montant) || 0)}</td>
                        <td className="px-4 py-3 text-zinc-300">
                          {h.libelle || "—"}
                          {(h.reference || h.commande_numero) && (
                            <span className="text-zinc-500"> · {h.reference || h.commande_numero}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{h.commercial || "—"}</td>
                        <td className="px-4 py-3 text-right">
                          {h.pdf_url ? (
                            <a href={h.pdf_url} target="_blank" rel="noopener noreferrer"
                              className="rounded-lg border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-300 transition hover:bg-sky-500/25">
                              Ouvrir ↗
                            </a>
                          ) : <span className="text-xs text-zinc-600">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
