"use client";
// components/AnnexesBlock.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Carte « Annexes » d'un dossier (chantier annexes, 18.08.2026 — doc 14 §5).
//
// UNE carte pour N pièces, généralisation du motif FicheTravailPreview :
// bandeau de vignettes en haut, UN aperçu de 600 px, un bouton de
// téléchargement rendant le nom d'origine. Le scan de commande (preuve papier,
// déposé par le chat) est épinglé en tête et sélectionné par défaut — le tri
// est fait côté serveur (GET /api/pieces-jointes).
//
// La carte existe même vide, avec sa zone de dépôt — sinon personne ne
// découvre la fonction. Dépôt multiple, uploads séquentiels (une requête par
// fichier, motif du chat Jardi), images ré-encodées JPEG 2000 px côté
// navigateur (lib/preparer-fichier — HEIC, EXIF, transparence traités).
//
// Usage :
//   <AnnexesBlock entityType="commande" entitySlug={slug} ajoutePar={commercial} />
//
// Montage : /dashboard/[slug] (offres ET commandes) et /dashboard/draft/[slug].
// JAMAIS sur /offre/[slug] — l'annexe vit dans le dossier interne (doc 14 §1).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from "react";
import { preparerFichier } from "@/lib/preparer-fichier";

type EntityType = "draft" | "offre" | "commande";

type Piece = {
  id: string;
  categorie: string;
  nom_fichier: string;
  libelle: string | null;
  mime: string;
  taille_octets: number;
  ajoute_par: string;
  created_at: string;
  url: string | null;
};

type EnvoiEnCours = { nom: string; etat: "envoi" | "erreur"; message?: string };

const CATEGORIES: { valeur: string; libelle: string }[] = [
  { valeur: "plan_client", libelle: "Plan client" },
  { valeur: "photo", libelle: "Photo" },
  { valeur: "document", libelle: "Document" },
  { valeur: "autre", libelle: "Autre" },
];

function libelleCategorie(cat: string): string {
  if (cat === "scan_commande") return "Scan commande";
  return CATEGORIES.find((c) => c.valeur === cat)?.libelle || cat;
}

function fmtTaille(octets: number): string {
  if (octets >= 1024 * 1024) return (octets / (1024 * 1024)).toFixed(1).replace(".", ",") + " Mo";
  return Math.max(1, Math.round(octets / 1024)) + " Ko";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function AnnexesBlock({
  entityType,
  entitySlug,
  ajoutePar,
}: {
  entityType: EntityType;
  entitySlug: string;
  ajoutePar?: string | null;
}) {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [envois, setEnvois] = useState<EnvoiEnCours[]>([]);
  const [glisse, setGlisse] = useState(false);
  const [edition, setEdition] = useState(false);
  const [editLibelle, setEditLibelle] = useState("");
  const [editCategorie, setEditCategorie] = useState("document");
  const [sauvegarde, setSauvegarde] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const charger = useCallback(async (selectionner?: string) => {
    try {
      const res = await fetch(
        `/api/pieces-jointes?entity_type=${entityType}&entity_slug=${encodeURIComponent(entitySlug)}`
      );
      if (!res.ok) return;
      const json = await res.json();
      const liste = (json.pieces || []) as Piece[];
      setPieces(liste);
      setSelectionId((precedent) => {
        if (selectionner && liste.some((p) => p.id === selectionner)) return selectionner;
        if (precedent && liste.some((p) => p.id === precedent)) return precedent;
        return liste[0]?.id ?? null; // le scan est en tête (tri serveur)
      });
    } catch (e) {
      console.error("Annexes :", e);
    } finally {
      setLoading(false);
    }
  }, [entityType, entitySlug]);

  useEffect(() => {
    if (!entitySlug) return;
    charger();
    // ⚠️ Un fichier lâché À CÔTÉ de la zone de dépôt fait naviguer le
    // navigateur VERS ce fichier : la page disparaît avec la saisie en cours.
    // Garde global obligatoire dès qu'une page reçoit un glisser-déposer.
    const bloquerDepot = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", bloquerDepot);
    window.addEventListener("drop", bloquerDepot);
    return () => {
      window.removeEventListener("dragover", bloquerDepot);
      window.removeEventListener("drop", bloquerDepot);
    };
  }, [entitySlug, charger]);

  // ── Dépôt ──────────────────────────────────────────────────────────────────
  async function deposerFichiers(fichiers: FileList | File[]) {
    const bruts = Array.from(fichiers);
    if (!bruts.length) return;
    let dernierId: string | undefined;
    for (const brut of bruts) {
      const nomAffiche = brut.name || "fichier";
      setEnvois((p) => [...p, { nom: nomAffiche, etat: "envoi" }]);
      try {
        const pret = await preparerFichier(brut);
        const corps = new FormData();
        corps.append("file", pret);
        corps.append("entity_type", entityType);
        corps.append("entity_slug", entitySlug);
        if (ajoutePar) corps.append("ajoute_par", ajoutePar);
        const res = await fetch("/api/pieces-jointes", { method: "POST", body: corps });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((json as { error?: string }).error || `Erreur ${res.status}`);
        }
        dernierId = (json as { piece?: { id?: string } }).piece?.id;
        setEnvois((p) => p.filter((e) => e.nom !== nomAffiche || e.etat !== "envoi"));
      } catch (err) {
        setEnvois((p) =>
          p.map((e) =>
            e.nom === nomAffiche && e.etat === "envoi"
              ? { nom: nomAffiche, etat: "erreur", message: (err as Error).message }
              : e
          )
        );
      }
    }
    await charger(dernierId);
  }

  function surDepot(e: React.DragEvent) {
    e.preventDefault();
    setGlisse(false);
    if (e.dataTransfer?.files?.length) deposerFichiers(e.dataTransfer.files);
  }

  // ── Édition libellé / catégorie ────────────────────────────────────────────
  const selection = pieces.find((p) => p.id === selectionId) || null;
  const estScan = selection?.categorie === "scan_commande";

  function ouvrirEdition() {
    if (!selection) return;
    setEditLibelle(selection.libelle || "");
    setEditCategorie(
      CATEGORIES.some((c) => c.valeur === selection.categorie) ? selection.categorie : "document"
    );
    setEdition(true);
  }

  async function sauverEdition() {
    if (!selection) return;
    setSauvegarde(true);
    try {
      const corps: Record<string, string> = { libelle: editLibelle };
      if (!estScan) corps.categorie = editCategorie;
      const res = await fetch(`/api/pieces-jointes/${selection.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || `Erreur ${res.status}`);
      setEdition(false);
      await charger(selection.id);
    } catch (err) {
      alert("Modification impossible : " + (err as Error).message);
    } finally {
      setSauvegarde(false);
    }
  }

  async function supprimerSelection() {
    if (!selection) return;
    const nom = selection.libelle || selection.nom_fichier;
    if (!confirm(`Retirer « ${nom} » du dossier ?\n(Suppression douce : la pièce est masquée, le fichier est conservé.)`)) return;
    setSuppression(true);
    try {
      const res = await fetch(`/api/pieces-jointes/${selection.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || `Erreur ${res.status}`);
      setEdition(false);
      setSelectionId(null);
      await charger();
    } catch (err) {
      alert("Suppression impossible : " + (err as Error).message);
    } finally {
      setSuppression(false);
    }
  }

  // ── Rendu ──────────────────────────────────────────────────────────────────
  const zoneDepot = (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setGlisse(true);
      }}
      onDragLeave={() => setGlisse(false)}
      onDrop={surDepot}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center text-sm transition ${
        glisse
          ? "border-sky-400/60 bg-sky-500/10 text-sky-200"
          : "border-white/15 bg-black/10 text-zinc-500 hover:border-white/30 hover:text-zinc-300"
      }`}>
      📎 Glisse ici un plan, une photo ou un PDF — ou clique pour choisir
      <div className="mt-1 text-xs text-zinc-600">
        JPEG, PNG, WebP, HEIC (converti) ou PDF · images redimensionnées, PDF max 4 Mo
      </div>
    </div>
  );

  return (
    <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
      <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          📎 Annexes{pieces.length > 0 && <span className="text-sm font-normal text-zinc-400">({pieces.length})</span>}
          <span className="text-xs font-normal text-amber-300/70 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5">Interne</span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            className="rounded-xl border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 hover:bg-[#40454b]">
            + Ajouter
          </button>
          {selection?.url && (
            <a
              href={selection.url}
              target="_blank"
              rel="noopener noreferrer"
              download={selection.nom_fichier}
              className="rounded-xl border border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/20">
              Télécharger ↓
            </a>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) deposerFichiers(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Envois en cours / en erreur */}
      {envois.length > 0 && (
        <div className="mb-3 space-y-1">
          {envois.map((e, i) => (
            <div
              key={`${e.nom}-${i}`}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                e.etat === "erreur"
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  : "border-white/10 bg-black/10 text-zinc-400"
              }`}>
              <span className="truncate">
                {e.etat === "erreur" ? "❌" : "⏳"} {e.nom}
                {e.message ? ` — ${e.message}` : ""}
              </span>
              {e.etat === "erreur" && (
                <button
                  onClick={() => setEnvois((p) => p.filter((x) => x !== e))}
                  className="shrink-0 text-zinc-500 hover:text-zinc-300">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-500">Chargement…</div>
      ) : pieces.length === 0 ? (
        zoneDepot
      ) : (
        <>
          {/* Bandeau de vignettes */}
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {pieces.map((p) => {
              const active = p.id === selectionId;
              const estImage = p.mime.startsWith("image/");
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectionId(p.id);
                    setEdition(false);
                  }}
                  title={p.libelle || p.nom_fichier}
                  className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border transition ${
                    active
                      ? "border-sky-400/70 ring-2 ring-sky-400/30"
                      : "border-white/10 hover:border-white/30"
                  }`}>
                  {estImage && p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black/20 px-1 text-[10px] text-zinc-400">
                      <span className="text-xl">{p.categorie === "scan_commande" ? "🧾" : "📄"}</span>
                      <span className="w-full truncate text-center">{p.libelle || p.nom_fichier}</span>
                    </span>
                  )}
                  {p.categorie === "scan_commande" && (
                    <span className="absolute left-0 top-0 rounded-br-lg bg-amber-500/90 px-1 text-[9px] font-bold text-black">
                      SCAN
                    </span>
                  )}
                </button>
              );
            })}
            {/* Vignette d'ajout */}
            <button
              onClick={() => inputRef.current?.click()}
              title="Ajouter un fichier"
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-white/15 text-2xl text-zinc-500 transition hover:border-white/30 hover:text-zinc-300">
              +
            </button>
          </div>

          {selection && (
            <>
              {/* Bandeau contextuel */}
              {estScan ? (
                <div className="mb-3 text-xs text-amber-300/80 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                  🧾 Preuve papier — {selection.nom_fichier} · déposé par {selection.ajoute_par} le {fmtDate(selection.created_at)}
                </div>
              ) : (
                <div className="mb-3 flex items-center justify-between gap-2 flex-wrap text-xs text-zinc-400 bg-black/10 border border-white/10 rounded-lg px-3 py-2">
                  <span className="truncate">
                    <span className="text-zinc-200">{selection.libelle || selection.nom_fichier}</span>
                    {" · "}{libelleCategorie(selection.categorie)}
                    {" · "}{fmtTaille(selection.taille_octets)}
                    {" · "}par {selection.ajoute_par} le {fmtDate(selection.created_at)}
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <button onClick={ouvrirEdition} className="text-sky-300 hover:text-sky-200">
                      ✏️ Modifier
                    </button>
                    <button
                      onClick={supprimerSelection}
                      disabled={suppression}
                      className="text-rose-400/80 hover:text-rose-300 disabled:opacity-50">
                      {suppression ? "…" : "🗑 Retirer"}
                    </button>
                  </span>
                </div>
              )}

              {/* Édition libellé / catégorie */}
              {edition && !estScan && (
                <div className="mb-3 flex items-end gap-2 flex-wrap rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2">
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    Libellé
                    <input
                      value={editLibelle}
                      onChange={(e) => setEditLibelle(e.target.value)}
                      placeholder={selection.nom_fichier}
                      maxLength={120}
                      className="w-56 rounded-lg border border-white/10 bg-[#34383d] px-2 py-1 text-sm text-zinc-100 outline-none focus:border-sky-500/50"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    Catégorie
                    <select
                      value={editCategorie}
                      onChange={(e) => setEditCategorie(e.target.value)}
                      className="rounded-lg border border-white/10 bg-[#34383d] px-2 py-1 text-sm text-zinc-100 outline-none focus:border-sky-500/50">
                      {CATEGORIES.map((c) => (
                        <option key={c.valeur} value={c.valeur}>{c.libelle}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={sauverEdition}
                    disabled={sauvegarde}
                    className="rounded-lg border border-sky-500/30 bg-sky-500/15 px-3 py-1 text-xs text-sky-200 hover:bg-sky-500/25 disabled:opacity-50">
                    {sauvegarde ? "…" : "💾 Enregistrer"}
                  </button>
                  <button
                    onClick={() => setEdition(false)}
                    className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200">
                    Annuler
                  </button>
                </div>
              )}

              {/* Aperçu — hauteur FIXE (600 px) quel que soit le contenu : sans
                  elle, changer de vignette redimensionne la carte et fait
                  perdre le cadrage de défilement (constaté au smoke test). */}
              {selection.url ? (
                <div className="h-[600px] overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                  {selection.mime === "application/pdf" ? (
                    <iframe src={selection.url} title="Aperçu annexe" className="h-full w-full border-0" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selection.url} alt={selection.libelle || selection.nom_fichier} className="h-full w-full object-contain" />
                  )}
                </div>
              ) : (
                <div className="flex h-[600px] items-center justify-center rounded-2xl border border-white/10 bg-black/10 p-8 text-center text-sm text-zinc-500">
                  Pièce jointe indisponible.
                </div>
              )}
            </>
          )}

          {/* Zone de dépôt compacte sous l'aperçu */}
          <div className="mt-3">{zoneDepot}</div>
        </>
      )}
    </section>
  );
}
