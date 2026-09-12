"use client";
// components/ListeAchatPanneau.tsx
// Panneau « Liste d'achat » de la page Stock list (12.09.2026) : barre fixe en
// bas de page, repliée par défaut. Le panier vit dans le state de la page
// (mémorisé en localStorage par la page) ; ici on l'édite, on le sauvegarde en
// base, on le recharge, et on le transforme en brouillon DRA-xxx.
//
// Aucun prix stocké : le total affiché vient des prix Shopify lus par la page
// pour les lignes visibles, et le brouillon relit tout chez Shopify.

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { EQUIPE_JARDI, CLE_UTILISATEUR, normaliserMembre } from "@/lib/jardi-equipe";
import { cleLigne, nbArticles, PANIER_VIDE, type ListeAchat, type PanierLocal } from "@/lib/listes-achat";
import ListeAchatLignes from "@/components/ListeAchatLignes";

type Props = {
  panier: PanierLocal;
  setPanier: React.Dispatch<React.SetStateAction<PanierLocal>>;
  prix: Record<string, number | null>; // clé ligne → prix TTC connu (lignes déjà vues dans le tableau)
};

function fmtCHF(n: number) {
  return `CHF ${n.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ListeAchatPanneau({ panier, setPanier, prix }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [utilisateur, setUtilisateur] = useState<string>("");
  const [listes, setListes] = useState<ListeAchat[]>([]);
  const [busy, setBusy] = useState<"" | "sauver" | "brouillon" | "charger">("");
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);

  const total = nbArticles(panier.lignes);

  // Utilisateur (même clé que Jardi : un poste partagé au magasin, on change d'un clic)
  useEffect(() => {
    try {
      const u = normaliserMembre(window.localStorage.getItem(CLE_UTILISATEUR));
      if (u) setUtilisateur(u);
    } catch { /* localStorage indisponible */ }
  }, []);
  function choisirUtilisateur(u: string) {
    setUtilisateur(u);
    try { window.localStorage.setItem(CLE_UTILISATEUR, u); } catch { /* ignore */ }
  }

  async function chargerListes() {
    setBusy("charger");
    try {
      const res = await fetch("/api/listes-achat?statut=ouverte");
      const json = await res.json();
      if (res.ok) setListes(json.listes || []);
    } finally { setBusy(""); }
  }
  useEffect(() => { if (ouvert) chargerListes(); }, [ouvert]);

  function signaler(type: "ok" | "erreur", texte: string) {
    setMessage({ type, texte });
    setTimeout(() => setMessage((m) => (m?.texte === texte ? null : m)), 4000);
  }

  // Sauvegarde : POST si nouvelle, PATCH si copie de travail d'une liste existante.
  async function sauver(): Promise<ListeAchat | null> {
    const nom = panier.nom.trim();
    if (!nom) { signaler("erreur", "Donne un nom à la liste."); return null; }
    if (panier.lignes.length === 0) { signaler("erreur", "La liste est vide."); return null; }
    if (!utilisateur) { signaler("erreur", "Choisis qui tu es (à droite)."); return null; }
    setBusy("sauver");
    try {
      const corps = { nom, cree_par: utilisateur, lignes: panier.lignes, est_modele: panier.est_modele };
      const res = await fetch(panier.id ? `/api/listes-achat/${panier.id}` : "/api/listes-achat", {
        method: panier.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      const liste = json.liste as ListeAchat;
      setPanier((p) => ({ ...p, id: liste.id, nom: liste.nom, est_modele: liste.est_modele }));
      signaler("ok", `Liste « ${liste.nom} » enregistrée.`);
      chargerListes();
      return liste;
    } catch (e) {
      signaler("erreur", String(e));
      return null;
    } finally { setBusy(""); }
  }

  async function creerBrouillon() {
    if (panier.lignes.length === 0) { signaler("erreur", "La liste est vide."); return; }
    if (!utilisateur) { signaler("erreur", "Choisis qui tu es (à droite)."); return; }
    // Un modèle ne se transforme pas lui-même : on enregistre d'abord une copie
    // ordinaire (nouvelle liste), puis on la transforme.
    let id = panier.id;
    if (!id || panier.est_modele) {
      const nom = panier.nom.trim() || `Liste du ${new Date().toLocaleDateString("fr-CH")}`;
      setBusy("sauver");
      try {
        const res = await fetch("/api/listes-achat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nom: panier.est_modele ? `${nom} — ${new Date().toLocaleDateString("fr-CH")}` : nom, cree_par: utilisateur, lignes: panier.lignes, est_modele: false }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
        id = (json.liste as ListeAchat).id;
      } catch (e) { signaler("erreur", String(e)); setBusy(""); return; }
    } else {
      const liste = await sauver();
      if (!liste) return;
    }
    setBusy("brouillon");
    try {
      const res = await fetch(`/api/listes-achat/${id}/brouillon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cree_par: utilisateur }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      signaler("ok", `Brouillon ${json.numeroAffiche} créé${json.nbCustom > 0 ? ` — ${json.nbCustom} article(s) hors Shopify à compléter` : ""}.`);
      window.open(json.editUrl, "_blank", "noopener,noreferrer");
      // La liste ordinaire est consommée ; on repart d'un panier vide.
      setPanier(PANIER_VIDE);
      chargerListes();
    } catch (e) {
      signaler("erreur", String(e));
    } finally { setBusy(""); }
  }

  function charger(liste: ListeAchat) {
    // Un modèle se charge en copie (id null → l'enregistrement créera une nouvelle liste)
    setPanier({
      id: liste.est_modele ? null : liste.id,
      nom: liste.nom,
      est_modele: false,
      lignes: liste.lignes,
    });
    signaler("ok", liste.est_modele ? `Modèle « ${liste.nom} » chargé (copie).` : `Liste « ${liste.nom} » chargée.`);
  }

  const prixLigne = (l: PanierLocal["lignes"][number]) => (l.variant_id ? prix[cleLigne(l)] : l.prix);
  const totalConnu = panier.lignes.reduce((s, l) => {
    const p = prixLigne(l);
    return typeof p === "number" ? s + p * l.qty : s;
  }, 0);
  const nbSansPrix = panier.lignes.filter((l) => typeof prixLigne(l) !== "number").length;

  return (
    <div className={`fixed inset-x-0 bottom-0 z-40 ${ouvert ? "p-3 lg:p-4" : ""}`}>
      <div className={`mx-auto max-w-[1900px] ${
        ouvert
          ? "rounded-2xl border-2 border-sky-400 bg-[#1b1d21] px-4 shadow-2xl shadow-black/60 ring-4 ring-sky-500/20 lg:px-6"
          : "border-t border-white/10 bg-[#25282c]/95 px-4 backdrop-blur lg:px-6"
      }`}>
        {/* Barre repliée */}
        <div className="flex items-center gap-3 py-2.5">
          <button type="button" onClick={() => setOuvert((o) => !o)} className="flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 text-sm text-sky-200 transition hover:bg-sky-500/25">
            🛒 Liste d&apos;achat
            <span className="rounded-full bg-sky-500 px-2 text-xs font-bold text-black">{total}</span>
            <span className="text-xs text-sky-300/70">{ouvert ? "▼" : "▲"}</span>
          </button>
          {panier.nom && <span className="truncate text-sm text-zinc-300">{panier.nom}{panier.est_modele ? " · modèle" : ""}</span>}
          {message && (
            <span className={`text-xs ${message.type === "ok" ? "text-emerald-300" : "text-rose-300"}`}>{message.texte}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <select value={utilisateur} onChange={(e) => choisirUtilisateur(e.target.value)} className="rounded-lg border border-white/10 bg-[#1f2125] px-2 py-1 text-xs text-zinc-200" title="Qui prépare cette liste">
              <option value="">Qui es-tu ?</option>
              {EQUIPE_JARDI.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <Link href="/dashboard/listes-achat" className="text-xs text-zinc-400 hover:text-zinc-200 hover:underline">Toutes les listes →</Link>
          </div>
        </div>

        {ouvert && (
          <div className="border-t border-white/5 pb-3 pt-2">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input
                value={panier.nom}
                onChange={(e) => setPanier((p) => ({ ...p, nom: e.target.value }))}
                placeholder="Nom de la liste (client, chantier, combo…)"
                className="min-w-[260px] flex-1 rounded-lg border border-white/10 bg-[#1f2125] px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-sky-500/50"
              />
              <label className="flex items-center gap-1.5 text-xs text-zinc-400" title="Combo réutilisable (socle + poids + tube + parasol…) : jamais transformé lui-même, on part d'une copie">
                <input type="checkbox" checked={panier.est_modele} onChange={(e) => setPanier((p) => ({ ...p, est_modele: e.target.checked }))} />
                Modèle réutilisable
              </label>
              <select
                value=""
                onChange={(e) => { const l = listes.find((x) => x.id === e.target.value); if (l) charger(l); }}
                className="rounded-lg border border-white/10 bg-[#1f2125] px-2 py-1.5 text-xs text-zinc-200"
                title="Charger une liste ou un modèle enregistré"
              >
                <option value="">{busy === "charger" ? "Chargement…" : "Charger une liste / un modèle…"}</option>
                {listes.filter((l) => l.est_modele).map((l) => <option key={l.id} value={l.id}>⭐ {l.nom} ({l.nb_articles})</option>)}
                {listes.filter((l) => !l.est_modele).map((l) => <option key={l.id} value={l.id}>{l.nom} — {l.cree_par || "?"} ({l.nb_articles})</option>)}
              </select>
              <button type="button" onClick={() => sauver()} disabled={busy !== ""} className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-sm text-zinc-100 transition hover:bg-[#40454b] disabled:opacity-50">
                {busy === "sauver" ? "Enregistrement…" : panier.id ? "Enregistrer les modifications" : "Enregistrer la liste"}
              </button>
              <button type="button" onClick={creerBrouillon} disabled={busy !== "" || panier.lignes.length === 0} className="rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30 disabled:opacity-50" title="Crée un brouillon DRA avec les prix Shopify du moment et l'ouvre dans l'éditeur">
                {busy === "brouillon" ? "Création…" : "Créer un brouillon →"}
              </button>
              <button type="button" onClick={() => { if (confirm("Vider la liste en cours ?")) setPanier(PANIER_VIDE); }} className="text-xs text-zinc-500 hover:text-rose-300">Vider</button>
            </div>

            <ListeAchatLignes
              lignes={panier.lignes}
              onChange={(lignes) => setPanier((p) => ({ ...p, lignes }))}
              prix={prix}
              hauteur="h-[40vh]"
            />
            {panier.lignes.length > 0 && (
              <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                <span>{panier.lignes.length} référence{panier.lignes.length > 1 ? "s" : ""} · {total} pièce{total > 1 ? "s" : ""}</span>
                <span>
                  Total indicatif TTC : <span className="text-zinc-200">{fmtCHF(totalConnu)}</span>
                  {nbSansPrix > 0 && <span> ({nbSansPrix} sans prix connu)</span>}
                  {" "}— prix relus chez Shopify à la création du brouillon
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
