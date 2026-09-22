"use client";
// components/Faisabilite3DCard.tsx
// Card « Faisabilité 3D » sur les pages brouillon / offre / commande (étape 3
// du planner, 21.09.2026). Lecture seule : elle interroge
// /api/planner/faisabilite (qui relit les lignes en base à chaque affichage,
// donc suit les révisions) et propose d'ouvrir le planner pré-rempli. Elle ne
// modifie jamais le document.
//
//   « 5/8 articles de cette offre sont disponibles pour un plan-rendu en 3D.
//     Ouvrir le planner avec les articles de cette commande. »

import React, { useEffect, useState } from "react";

type Ligne = {
  id: string; title: string; sku_ligne: string; qty: number; image: string | null;
  has_3d: boolean; size_warn: boolean; color_warn: boolean; marque: string | null; par: "variante" | "sku" | null;
};
type Reponse = { total: number; avec_3d: number; lignes: Ligne[]; numero: string | null; type_document: string; error?: string };
type SceneLiee = {
  id: string; nom: string; updated_at: string; nb_items: number;
  sur_documents?: boolean;
  derniere_version: { numero: number; token: string; capture_url: string | null; ambiance_url: string | null; pdf_url: string | null; pdf_sans_prix_url: string | null; cree_le: string } | null;
};

export default function Faisabilite3DCard({ type, slug }: { type: "offre" | "brouillon"; slug: string }) {
  const [rep, setRep] = useState<Reponse | null>(null);
  const [scenes, setScenes] = useState<SceneLiee[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState("");
  const [copie, setCopie] = useState<string | null>(null);   // id de scène dont le lien vient d'être copié

  // Lien client (version figée la plus récente) à coller dans un mail
  async function copierLien(sceneId: string, token: string) {
    const url = `${window.location.origin}/planner/partage/${token}`;
    try { await navigator.clipboard.writeText(url); setCopie(sceneId); setTimeout(() => setCopie(null), 2500); }
    catch { window.prompt("Copie manuelle du lien :", url); }
  }

  useEffect(() => {
    let vivant = true;
    fetch(`/api/planner/faisabilite?type=${type}&slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j) => { if (!vivant) return; if (j.error) setErreur(j.error); else setRep(j); })
      .catch((e) => vivant && setErreur((e as Error).message));
    fetch(`/api/planner/scenes?offre_slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j) => { if (vivant && Array.isArray(j.scenes)) setScenes(j.scenes); })
      .catch(() => {});
    return () => { vivant = false; };
  }, [type, slug]);

  if (erreur) return null;                       // la card ne doit jamais gêner la page
  if (!rep || rep.total === 0) return null;      // rien à dire sans ligne produit

  const manquants = rep.lignes.filter((l) => !l.has_3d);
  const avert = rep.lignes.filter((l) => l.has_3d && (l.size_warn || l.color_warn)).length;
  const ratio = rep.avec_3d / rep.total;
  const couleur = rep.avec_3d === 0 ? "border-white/10 bg-[#2a2d31]" : ratio === 1 ? "border-emerald-500/30 bg-emerald-500/5" : "border-sky-500/30 bg-sky-500/5";
  const nomDoc = rep.type_document === "Commande" ? "cette commande" : type === "brouillon" ? "ce brouillon" : "cette offre";
  const hrefPlanner = `/planner?depuis=${type}:${encodeURIComponent(slug)}`;

  return (
    <section className={`rounded-2xl border p-6 ${couleur}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">🧊 Faisabilité 3D</h2>
          <p className="mt-1 text-sm text-zinc-300">
            <strong className="text-white">{rep.avec_3d}/{rep.total}</strong> article{rep.total > 1 ? "s" : ""} de {nomDoc} {rep.avec_3d > 1 ? "sont disponibles" : "est disponible"} pour un plan-rendu en 3D.
            {avert > 0 && <span className="text-amber-300"> {avert} avec taille ou couleur indicative.</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rep.avec_3d > 0 && (scenes.length === 0 ? (
            <a href={hrefPlanner} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/30">
              🪑 Ouvrir le planner avec {rep.avec_3d > 1 ? "ces articles" : "cet article"}
            </a>
          ) : (
            <a href={hrefPlanner} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-1.5 text-xs text-zinc-400 hover:bg-[#34383d]" title="Repart de zéro : nouveau plan avec les articles du document. Pour reprendre le plan existant, clique sur sa vignette.">
              ＋ Autre plan
            </a>
          ))}
          <button type="button" onClick={() => setOuvert((v) => !v)} className="rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#34383d]">
            {ouvert ? "Masquer le détail" : "Détail"}
          </button>
        </div>
      </div>

      {scenes.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Plan{scenes.length > 1 ? "s" : ""} lié{scenes.length > 1 ? "s" : ""} à ce document</div>
          <div className="flex flex-wrap gap-3">
            {scenes.map((s) => {
              const v = s.derniere_version;
              // Un seul plan : la carte occupe la largeur disponible et les
              // deux images sont grandes (sinon la moitié droite reste vide).
              const large = scenes.length === 1;
              return (
                <div key={s.id} className={`${large ? "w-full max-w-[760px]" : "w-[320px]"} overflow-hidden rounded-xl border bg-black/20 ${s.sur_documents ? "border-emerald-500/40" : "border-white/10"}`}>
                  {/* Aperçus légers (PNG, pas de WebGL) : le plan, et l'image
                      d'ambiance IA retenue quand il y en a une. */}
                  <a href={`/planner?scene=${s.id}`} target="_blank" rel="noopener noreferrer" title="Ouvrir dans le planner" className="flex gap-px bg-white/5">
                    {v?.capture_url ? (
                      <img src={v.capture_url} alt="Plan 3D" loading="lazy" className={`block ${large ? "h-[230px]" : "h-[130px]"} ${v.ambiance_url ? "w-1/2" : "w-full"} object-cover`} />
                    ) : (
                      <div className={`flex ${large ? "h-[230px]" : "h-[130px]"} w-full items-center justify-center px-2 text-center text-xs text-zinc-500`}>Aucun aperçu — fais une Fiche ou une Capture</div>
                    )}
                    {v?.ambiance_url && <img src={v.ambiance_url} alt="Ambiance IA" loading="lazy" className={`block ${large ? "h-[230px]" : "h-[130px]"} w-1/2 object-cover`} />}
                  </a>
                  <div className="p-2 text-xs">
                    <a href={`/planner?scene=${s.id}`} target="_blank" rel="noopener noreferrer" className="mb-1.5 block rounded-lg border border-sky-500/40 bg-sky-500/20 px-2 py-1 text-center text-sm text-sky-200 hover:bg-sky-500/30">
                      🪑 Reprendre ce plan
                    </a>
                    <div className="truncate font-medium text-zinc-100" title={s.nom}>{s.nom}</div>
                    <div className="text-zinc-500">{s.nb_items} article{s.nb_items > 1 ? "s" : ""}{v ? ` · V${v.numero}` : ""} · {new Date(s.updated_at).toLocaleDateString("fr-CH")}</div>
                    {s.sur_documents
                      ? <div className="mt-0.5 text-emerald-300" title="Le plan et l'image d'ambiance apparaissent en dernière page de l'offre / commande, sans prix">✓ Sur les documents du client</div>
                      : <div className="mt-0.5 text-zinc-600" title="À cocher dans le planner pour joindre le plan aux documents">Pas sur les documents</div>}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {v && <a href={`/planner/partage/${v.token}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/10 bg-[#2a2d31] px-2 py-0.5 text-zinc-300 hover:bg-[#34383d]">🧊 3D client</a>}
                      {v && (
                        <button type="button" onClick={() => copierLien(s.id, v.token)} className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-emerald-200 hover:bg-emerald-500/25" title="Copier le lien du plan 3D (version figée) pour l'envoyer au client">
                          {copie === s.id ? "✓ Lien copié" : "🔗 Copier le lien"}
                        </button>
                      )}
                      {v?.pdf_url && <a href={v.pdf_url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 text-violet-200">⬇ PDF</a>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ouvert && (
        <div className="mt-4 space-y-1 text-sm">
          {rep.lignes.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1">
              <span className={`w-8 shrink-0 rounded px-1 text-center text-[10px] ${l.has_3d ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-zinc-500"}`}>{l.has_3d ? "3D" : "—"}</span>
              <span className="w-8 shrink-0 text-right text-zinc-400">× {l.qty}</span>
              <span className="min-w-0 flex-1 truncate">{l.title}</span>
              <span className="shrink-0 text-xs text-zinc-500">{l.sku_ligne}</span>
              {l.has_3d && l.size_warn && <span className="shrink-0 rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">taille ?</span>}
              {l.has_3d && l.color_warn && <span className="shrink-0 rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">couleur ?</span>}
            </div>
          ))}
          {manquants.length > 0 && (
            <p className="pt-2 text-xs text-zinc-500">
              Sans modèle 3D : {[...new Set(manquants.map((l) => l.marque).filter(Boolean))].join(", ") || "marques non indexées"} — à compléter dans la bibliothèque.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
