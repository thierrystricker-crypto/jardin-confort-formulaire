"use client";
// components/BulletinsLivraisonBlock.tsx
// Carte « Bulletins de livraison » de /dashboard/[slug] — chantier du 02.09.2026.
//
// Liste les bulletins ENREGISTRÉS d'une commande (envois partiels, lignes
// ajoutées…), avec leur PDF et leur réimpression, et ouvre l'éditeur pour en
// faire un nouveau. Une commande sans bulletin enregistré garde la carte,
// sinon personne ne découvre la fonction (même principe que les annexes).
//
// Usage :
//   import BulletinsLivraisonBlock from "@/components/BulletinsLivraisonBlock"
//   {isCommandeReelle && <BulletinsLivraisonBlock slug={slug} />}

import React, { useEffect, useState, useCallback } from "react";

type Bulletin = {
  id: string;
  numero_bulletin: number;
  mention: string | null;
  nb_lignes: number;
  nb_pieces: number;
  pdf_url: string | null;
  pdf_erreur: string | null;
  date_bulletin: string | null;
  cree_par: string | null;
  created_at: string;
};

function fmtDateJour(iso: string) {
  try { return new Date(iso + "T00:00:00").toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return iso; }
}
function fmtDateHeure(iso: string) {
  try {
    return new Date(iso).toLocaleString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export default function BulletinsLivraisonBlock({ slug }: { slug: string }) {
  const [bulletins, setBulletins] = useState<Bulletin[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bulletins-livraison?slug=${encodeURIComponent(slug)}`);
      if (res.ok) {
        const json = await res.json();
        setBulletins(json.bulletins || []);
      }
    } catch (e) {
      console.error("Bulletins livraison error:", e);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
    // L'éditeur s'ouvre dans un autre onglet : on recharge au retour sur celui-ci
    const onFocus = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [load]);

  // Lien RELATIF, volontairement : NEXT_PUBLIC_APP_URL vaut la prod même sur
  // une preview Vercel, et un lien absolu y ouvrirait la page de PRODUCTION
  // (piège constaté le 02.09 sur les autres boutons Documents du dashboard).
  const urlEditeur = `/print/bulletin-livraison/${slug}`;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          🚚 Bulletins de livraison
          {bulletins.length > 0 && (
            <span className="text-xs font-normal text-zinc-400">({bulletins.length} enregistré{bulletins.length > 1 ? "s" : ""})</span>
          )}
        </h2>
        <a href={urlEditeur} target="_blank" rel="noopener noreferrer"
          className="rounded-xl border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/25"
          title="Ouvre le bulletin de la commande, modifiable : envoi partiel, quantités, lignes ajoutées. Impression et PDF.">
          ✏️ Nouveau bulletin (envoi partiel…)
        </a>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">Chargement…</div>
      ) : bulletins.length === 0 ? (
        <div className="text-sm text-zinc-500 italic">
          Aucun bulletin enregistré. Le bouton « Bulletin livraison » imprime la commande telle quelle ;
          pour un envoi partiel ou une ligne ajoutée, ouvrez l&apos;éditeur et enregistrez le bulletin en PDF — il apparaîtra ici.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-black/20 text-left text-xs text-zinc-400 uppercase">
              <tr>
                <th className="px-3 py-2">N°</th>
                <th className="px-3 py-2">Date du bulletin</th>
                <th className="px-3 py-2">Mention</th>
                <th className="px-3 py-2 text-center">Articles</th>
                <th className="px-3 py-2 text-center">Pièces</th>
                <th className="px-3 py-2 text-right">Documents</th>
              </tr>
            </thead>
            <tbody>
              {bulletins.map((b, idx) => (
                <tr key={b.id} className={`border-t border-white/5 ${idx % 2 === 0 ? "bg-white/[0.02]" : ""}`}>
                  <td className="px-3 py-2 font-semibold text-zinc-200">{b.numero_bulletin}</td>
                  <td className="px-3 py-2 text-xs text-zinc-300" title={"Enregistré le " + fmtDateHeure(b.created_at)}>{b.date_bulletin ? fmtDateJour(b.date_bulletin) : fmtDateHeure(b.created_at)}</td>
                  <td className="px-3 py-2 text-zinc-300 text-xs">{b.mention || <span className="text-zinc-600">—</span>}</td>
                  <td className="px-3 py-2 text-center text-zinc-300">{b.nb_lignes}</td>
                  <td className="px-3 py-2 text-center text-zinc-300">{b.nb_pieces}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {b.pdf_url ? (
                      <a href={b.pdf_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20 mr-1">
                        📄 PDF
                      </a>
                    ) : (
                      <span className="inline-flex items-center rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 mr-1"
                        title={b.pdf_erreur || "PDF non généré"}>
                        ⚠️ sans PDF
                      </span>
                    )}
                    <a href={`${urlEditeur}?bulletin=${b.id}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center rounded-lg border border-white/10 bg-[#34383d] px-2 py-1 text-xs text-zinc-300 hover:bg-[#40454b]"
                      title="Rouvre ce bulletin tel qu'enregistré, pour le réimprimer">
                      🖨 Réimprimer
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
