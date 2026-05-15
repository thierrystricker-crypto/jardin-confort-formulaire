"use client";
// app/dashboard/draft/[slug]/page.tsx

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TransformerModal from "./TransformerModal";

type TypeDocument = "Offre" | "Commande";

type DraftRecord = {
  id: number;
  slug: string;
  numero_draft: number;
  numero_affiche: string;
  type_document: string;

  reference: string | null;
  date_document: string | null;
  commercial: string | null;
  validite_duree: string | null;
  payment_mode: string | null;
  delivery_mode: string | null;
  lead_time: string | null;
  client_type: string | null;

  client_societe: string | null;
  client_nom: string | null;
  client_prenom: string | null;
  client_complement_nom: string | null;
  client_email: string | null;
  client_tel1: string | null;
  client_tel2: string | null;
  client_rue: string | null;
  client_numero: string | null;
  client_npa: string | null;
  client_ville: string | null;
  client_numero_client: string | null;

  livr_diff: boolean;
  livr_societe: string | null;
  livr_nom: string | null;
  livr_prenom: string | null;
  livr_complement_nom: string | null;
  livr_tel: string | null;
  livr_rue: string | null;
  livr_numero: string | null;
  livr_npa: string | null;
  livr_ville: string | null;

  sous_total: number;
  remise_chf: number;
  services_total: number;
  arrondi: number;
  tva_montant: number;
  total_ttc: number;
  nb_articles: number;

  remarques: string | null;
  notes_internes: string | null;
  note_commerciale: string | null;

  data: Record<string, unknown>;

  created_at: string;
  updated_at: string | null;
  transformed_at: string | null;
  transformed_into_offre_slug: string | null;
  archived: boolean;
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtMoney(v: number | null | undefined) {
  if (!v) return "—";
  return (
    "CHF\u00a0" +
    new Intl.NumberFormat("de-CH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v)
  );
}
function nomClient(d: DraftRecord) {
  return [d.client_prenom, d.client_nom].filter(Boolean).join(" ") || "—";
}

export default function DashboardDraftDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showTransformModal, setShowTransformModal] = useState(false);

  useEffect(() => {
    async function load() {
      const { slug: s } = await params;
      setSlug(s);
      try {
        const res = await fetch(`/api/drafts/${s}`);
        if (res.status === 404) {
          setError("not_found");
          return;
        }
        if (!res.ok) throw new Error(`Erreur ${res.status}`);
        const json = await res.json();
        setDraft(json.draft as DraftRecord);
      } catch (e) {
        setError((e as Error).message || "error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params]);

  async function dupliquerBrouillon() {
    if (!draft || duplicating) return;
    setDuplicating(true);
    try {
      // Traçabilité Session 8 : on injecte le slug + numéro du brouillon source
      // dans data.copiedFromDraftSlug / copiedFromDraftNumero. Le brouillon
      // source reste intact (la copie est indépendante).
      // Si le brouillon source était lui-même issu d'une offre copiée, on
      // PRÉSERVE copiedFromOffreSlug — c'est l'info d'origine ultime, la plus
      // utile pour retrouver la racine de la chaîne de copies.
      const data = {
        ...(draft.data || {}),
        copiedFromDraftSlug: draft.slug,
        copiedFromDraftNumero: draft.numero_affiche,
      };
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      const json = await res.json();
      if (!res.ok || !json.editUrl) {
        alert("Erreur duplication : " + (json.error || res.status));
        return;
      }
      router.push(json.editUrl);
    } catch (e) {
      alert("Erreur réseau : " + (e as Error).message);
    } finally {
      setDuplicating(false);
    }
  }

  async function supprimerBrouillon() {
    if (!draft || deleting) return;
    if (draft.transformed_at) {
      alert("Ce brouillon a été transformé en offre et ne peut plus être supprimé.");
      return;
    }
    const ok = confirm(
      `Supprimer définitivement le brouillon ${draft.numero_affiche} ?\n\n` +
        "Cette action est irréversible."
    );
    if (!ok) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/drafts/${slug}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/dashboard");
        return;
      }
      const json = await res.json().catch(() => ({}));
      alert("Erreur suppression : " + (json.error || res.status));
    } catch (e) {
      alert("Erreur réseau : " + (e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  // ═══ États de chargement / erreur ═══

  if (loading) {
    return (
      <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
        <div className="mx-auto max-w-[1800px] rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-zinc-400">
          Chargement…
        </div>
      </main>
    );
  }

  if (error === "not_found") {
    return (
      <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
        <div className="mx-auto max-w-[1800px] rounded-2xl border border-rose-500/20 bg-[#2a2d31] p-8">
          <h1 className="text-xl font-semibold text-rose-300">
            Brouillon introuvable
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Aucun brouillon trouvé pour le slug{" "}
            <code className="text-zinc-300">{slug}</code>. Il a peut-être été
            supprimé.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]"
            >
              ← Retour au dashboard
            </Link>
            <Link
              href="/drafts/nouveau"
              className="inline-flex items-center rounded-xl border border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm text-amber-300 hover:bg-amber-500/25"
            >
              + Nouveau brouillon
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (error || !draft) {
    return (
      <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
        <div className="mx-auto max-w-[1800px] rounded-2xl border border-red-500/20 bg-[#2a2d31] p-8 text-red-300">
          <h1 className="text-xl font-semibold">Erreur de chargement</h1>
          <p className="mt-2 text-sm">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]"
          >
            🔄 Réessayer
          </button>
        </div>
      </main>
    );
  }

  // ═══ Rendu principal ═══

  const d = draft.data as Record<string, unknown>;
  const typeDocument: TypeDocument =
    ((d.formType as TypeDocument) || "Offre") === "Commande"
      ? "Commande"
      : "Offre";
  const isTransformed = draft.transformed_at !== null;
  // Session 7 : page print dédiée aux brouillons avec filigrane "BROUILLON — DRA-XXX"
  const urlPrint = `/print/draft/${draft.slug}`;

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1800px] space-y-6">

        {/* ═══ BANDEAU BROUILLON ═══ */}
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/15 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📝</span>
              <div>
                <div className="text-base font-bold uppercase tracking-wider text-amber-200">
                  Brouillon
                </div>
                <div className="text-xs text-amber-300/80">
                  Document de travail · non engageant · modifiable
                </div>
              </div>
            </div>
            <div className="text-xs text-amber-300/70">
              Créé le {fmtDateTime(draft.created_at)}
              {draft.updated_at && draft.updated_at !== draft.created_at && (
                <> · Modifié le {fmtDateTime(draft.updated_at)}</>
              )}
            </div>
          </div>
        </div>

        {/* ═══ BANDEAU TRANSFORMÉ ═══ */}
        {isTransformed && (
          <div className="rounded-2xl border border-orange-500/40 bg-orange-500/15 px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔒</span>
                <div>
                  <div className="text-base font-bold text-orange-200">
                    Brouillon transformé en offre
                  </div>
                  <div className="text-xs text-orange-300/80">
                    Transformé le {fmtDateTime(draft.transformed_at)} · Ce
                    brouillon est conservé pour archive et duplication, mais ne
                    peut plus être modifié ni re-transformé.
                  </div>
                </div>
              </div>
              {draft.transformed_into_offre_slug && (
                <Link
                  href={`/dashboard/${draft.transformed_into_offre_slug}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-orange-400/40 bg-orange-500/15 px-4 py-2 text-sm font-semibold text-orange-200 transition hover:bg-orange-500/25"
                >
                  Voir l&apos;offre
                  <span className="text-orange-300">→</span>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* ═══ TOP ═══ */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
          <div className="grid gap-6 lg:grid-cols-2">

            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Navigation
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]"
                  >
                    ← Retour au dashboard
                  </Link>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <img
                    src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/picto_jardin_confort_apple_low.png?v=1775944940"
                    alt=""
                    className="h-16 w-16 rounded-xl object-contain opacity-70"
                  />
                  <div>
                    <div className="text-sm text-zinc-400">Brouillon</div>
                    <h1 className="mt-1 text-3xl font-semibold">
                      {draft.numero_affiche}
                    </h1>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">
                        📝 Brouillon
                      </span>
                      <span className="text-sm text-zinc-400">
                        Type cible : {typeDocument}
                      </span>
                      {isTransformed && (
                        <span className="inline-flex items-center rounded-full bg-orange-500/15 px-3 py-1 text-xs font-medium text-orange-300">
                          🔒 Transformé
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-zinc-100">
                    {fmtMoney(draft.total_ttc)}
                  </div>
                  <div className="mt-1 text-sm text-zinc-400">
                    {draft.payment_mode || "—"}
                  </div>
                  <div className="mt-1 text-sm text-zinc-500">
                    {draft.nb_articles} article
                    {draft.nb_articles !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-400/70">
                  Actions brouillon
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isTransformed ? (
                    <button
                      disabled
                      title="Un brouillon transformé n'est plus modifiable. Dupliquez-le pour créer une variante."
                      className="inline-flex cursor-not-allowed items-center rounded-xl border border-white/10 bg-[#34383d]/50 px-4 py-2 text-sm text-zinc-500"
                    >
                      ✏️ Modifier
                    </button>
                  ) : (
                    <Link
                      href={`/drafts/${draft.slug}/editer`}
                      className="inline-flex items-center rounded-xl border border-sky-500/30 bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-300 transition hover:bg-sky-500/25"
                    >
                      ✏️ Modifier
                    </Link>
                  )}

                  {isTransformed ? (
                    <button
                      disabled
                      title="Ce brouillon a déjà été transformé. Pour générer une variante, dupliquez-le puis transformez la copie."
                      className="inline-flex cursor-not-allowed items-center rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-sm text-emerald-300/40"
                    >
                      🔄 Transformer en offre
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowTransformModal(true)}
                      className="inline-flex items-center rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
                    >
                      🔄 Transformer en offre
                    </button>
                  )}

                  <a
                    href={urlPrint}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Ouvrir l'aperçu print du brouillon (avec filigrane BROUILLON)"
                    className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-200 transition hover:bg-[#40454b]"
                  >
                    👁 Aperçu
                  </a>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ═══ GRILLE PRINCIPALE ═══ */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_660px]">

          <div className="space-y-6">

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <h2 className="mb-4 text-xl font-semibold">Client</h2>
                <div className="space-y-2 text-sm">
                  {(
                    [
                      ["Nom", nomClient(draft)],
                      ["Société", draft.client_societe],
                      ["Email", draft.client_email],
                      ["Tél.", draft.client_tel1],
                      [
                        "Rue",
                        [draft.client_rue, draft.client_numero]
                          .filter(Boolean)
                          .join(" "),
                      ],
                      [
                        "NPA / Ville",
                        [draft.client_npa, draft.client_ville]
                          .filter(Boolean)
                          .join(" "),
                      ],
                      ["Type", draft.client_type],
                    ] as [string, string | null][]
                  ).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="w-28 shrink-0 text-zinc-400">
                        {k} :
                      </span>
                      <span>{v || "—"}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <h2 className="mb-4 text-xl font-semibold">Brouillon</h2>
                <div className="space-y-2 text-sm">
                  {(
                    [
                      ["Conseiller", draft.commercial],
                      ["Type cible", typeDocument],
                      ["Date", fmtDate(draft.date_document)],
                      ["Paiement", draft.payment_mode],
                      ["Livraison", draft.delivery_mode],
                      ["Délai", draft.lead_time],
                      ["Validité", draft.validite_duree],
                      ["Référence", draft.reference],
                      ["Articles", String(draft.nb_articles || 0)],
                    ] as [string, string | null | undefined][]
                  ).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="w-28 shrink-0 text-zinc-400">
                        {k} :
                      </span>
                      <span>{v || "—"}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {draft.livr_diff && (
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <h2 className="mb-4 text-xl font-semibold">
                  Livraison{" "}
                  <span className="text-xs font-normal text-amber-300/70">
                    (adresse différente)
                  </span>
                </h2>
                <div className="space-y-2 text-sm">
                  {(
                    [
                      [
                        "Destinataire",
                        [draft.livr_prenom, draft.livr_nom]
                          .filter(Boolean)
                          .join(" "),
                      ],
                      ["Société", draft.livr_societe],
                      ["Tél.", draft.livr_tel],
                      [
                        "Rue",
                        [draft.livr_rue, draft.livr_numero]
                          .filter(Boolean)
                          .join(" "),
                      ],
                      [
                        "NPA / Ville",
                        [draft.livr_npa, draft.livr_ville]
                          .filter(Boolean)
                          .join(" "),
                      ],
                    ] as [string, string | null][]
                  ).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="w-28 shrink-0 text-zinc-400">
                        {k} :
                      </span>
                      <span>{v || "—"}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
              <h2 className="mb-4 text-xl font-semibold">Montants</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    ["Sous-total", fmtMoney(draft.sous_total)],
                    [
                      "Remise",
                      draft.remise_chf > 0
                        ? `− ${fmtMoney(draft.remise_chf)}`
                        : "—",
                    ],
                    [
                      "Services",
                      draft.services_total > 0
                        ? fmtMoney(draft.services_total)
                        : "—",
                    ],
                    ["TVA 8.1%", fmtMoney(draft.tva_montant)],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div
                    key={k}
                    className="rounded-xl border border-white/10 bg-black/10 p-4"
                  >
                    <div className="text-xs text-zinc-400">{k}</div>
                    <div className="mt-2 text-lg font-semibold text-zinc-100">
                      {v}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 px-6 py-4">
                <span className="text-lg font-semibold text-zinc-100">
                  TOTAL TTC (estimé)
                </span>
                <span className="text-2xl font-bold text-white">
                  {fmtMoney(draft.total_ttc)}
                </span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Les totaux d&apos;un brouillon sont indicatifs. Le calcul
                définitif aura lieu à la transformation en offre.
              </p>
            </section>

            {draft.remarques && (
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <h2 className="mb-3 text-xl font-semibold">Remarques client</h2>
                <p className="whitespace-pre-wrap text-sm text-zinc-300">
                  {draft.remarques}
                </p>
              </section>
            )}

            {draft.notes_internes && (
              <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-6">
                <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold">
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    🔒 Interne
                  </span>
                  Notes internes
                </h2>
                <p className="whitespace-pre-wrap text-sm text-zinc-300">
                  {draft.notes_internes}
                </p>
              </section>
            )}

          </div>

          <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
            <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
              <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-xl font-semibold">Aperçu</h2>
                <a
                  href={urlPrint}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 hover:bg-[#40454b]"
                >
                  ⛶ Plein écran
                </a>
              </div>
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-white">
                <iframe
                  src={urlPrint}
                  title="Aperçu brouillon"
                  className="h-[900px] w-full border-0"
                />
              </div>
            </section>
          </div>

        </div>

        {/* ═══ FOOTER ═══ */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]"
            >
              ← Retour au dashboard
            </Link>
            <Link
              href="/drafts/nouveau"
              className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]"
            >
              + Nouveau brouillon
            </Link>
            <button
              onClick={dupliquerBrouillon}
              disabled={duplicating}
              className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
              title="Crée une copie indépendante de ce brouillon. La source reste intacte."
            >
              {duplicating
                ? "Duplication…"
                : "📋 Dupliquer en nouveau brouillon"}
            </button>
            <button
              onClick={supprimerBrouillon}
              disabled={deleting || isTransformed}
              className="inline-flex items-center rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              title={
                isTransformed
                  ? "Un brouillon transformé est conservé pour archive et duplication. Suppression impossible."
                  : "Supprimer définitivement ce brouillon"
              }
            >
              {deleting ? "Suppression…" : "🗑 Supprimer le brouillon"}
            </button>
          </div>
        </div>

        {/* ═══ MODAL TRANSFORMATION (Session 5) ═══ */}
        <TransformerModal
          open={showTransformModal}
          onClose={() => setShowTransformModal(false)}
          draft={{
            slug: draft.slug,
            numero_affiche: draft.numero_affiche,
            client_societe: draft.client_societe,
            client_nom: draft.client_nom,
            client_prenom: draft.client_prenom,
            commercial: draft.commercial,
            sous_total: Number(draft.sous_total) || 0,
            tva_montant: Number(draft.tva_montant) || 0,
            total_ttc: Number(draft.total_ttc) || 0,
            nb_articles: draft.nb_articles,
          }}
        />

      </div>
    </main>
  );
}