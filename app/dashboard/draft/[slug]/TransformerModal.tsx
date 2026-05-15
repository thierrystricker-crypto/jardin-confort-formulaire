"use client";
// app/dashboard/draft/[slug]/TransformerModal.tsx
//
// Session 5 — Modal de confirmation pour transformer un brouillon en offre.
// Transformation TOUJOURS en Offre (cf. décisions Session 5). Pas de sélecteur
// Offre/Commande : le passage offre → commande reste géré par le flux existant
// /api/offres/save côté commande.
//
// Comportement :
// 1. À l'ouverture : récap + 2 checkboxes décochées + bouton "Transformer" disabled
// 2. Au check des 2 cases : le bouton Transformer s'active
// 3. Au clic Transformer : POST /api/drafts/[slug]/transformer + loading state
// 4. Sur 200 : router.push(dashboardUrl) → redirection silencieuse vers /dashboard/<offreSlug>
// 5. Sur 409 : switch vers vue "Déjà transformé" + bouton "Voir l'offre existante"
// 6. Sur 404/500/réseau : message d'erreur + bouton Fermer/Réessayer

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type TransformerModalProps = {
  open: boolean;
  onClose: () => void;
  draft: {
    slug: string;
    numero_affiche: string;
    client_societe: string | null;
    client_nom: string | null;
    client_prenom: string | null;
    commercial: string | null;
    sous_total: number;
    tva_montant: number;
    total_ttc: number;
    remise_chf: number;
    services_total: number;
    arrondi: number;
    discountPercent?: string;
    nb_articles: number;
  };
};

type ModalState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "already_transformed"; existingOffreSlug: string | null }
  | { kind: "error"; message: string };

function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return (
    "CHF\u00a0" +
    new Intl.NumberFormat("de-CH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v)
  );
}

function nomClient(d: TransformerModalProps["draft"]) {
  const direct = [d.client_prenom, d.client_nom].filter(Boolean).join(" ");
  if (direct) return direct;
  if (d.client_societe) return d.client_societe;
  return "—";
}

export default function TransformerModal({
  open,
  onClose,
  draft,
}: TransformerModalProps) {
  const router = useRouter();
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [state, setState] = useState<ModalState>({ kind: "idle" });
  const overlayRef = useRef<HTMLDivElement>(null);

  // Reset complet quand la modal se ferme/réouvre
  useEffect(() => {
    if (open) {
      setCheck1(false);
      setCheck2(false);
      setState({ kind: "idle" });
    }
  }, [open]);

  // Fermeture par touche Escape
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && state.kind !== "submitting") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, state.kind, onClose]);

  if (!open) return null;

  const canSubmit =
    check1 && check2 && state.kind === "idle";

  async function handleTransform() {
    setState({ kind: "submitting" });
    try {
      const res = await fetch(`/api/drafts/${draft.slug}/transformer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (res.ok) {
        const json = (await res.json()) as { dashboardUrl?: string };
        if (!json.dashboardUrl) {
          setState({
            kind: "error",
            message: "Réponse serveur invalide (pas de dashboardUrl).",
          });
          return;
        }
        // Redirection silencieuse vers le dashboard de la nouvelle offre.
        // La modal disparaît avec le démontage de la page.
        router.push(json.dashboardUrl);
        return;
      }

      // Tentative de parsing du body d'erreur
      const errJson = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        existingOffreSlug?: string | null;
      };

      if (res.status === 409 && errJson.error === "ALREADY_TRANSFORMED") {
        setState({
          kind: "already_transformed",
          existingOffreSlug: errJson.existingOffreSlug || null,
        });
        return;
      }

      if (res.status === 404) {
        setState({
          kind: "error",
          message:
            "Brouillon introuvable. Il a peut-être été supprimé. Rafraîchissez la page.",
        });
        return;
      }

      setState({
        kind: "error",
        message:
          errJson.message ||
          errJson.error ||
          `Erreur serveur (${res.status})`,
      });
    } catch (e) {
      setState({
        kind: "error",
        message:
          "Erreur réseau : " + (e instanceof Error ? e.message : String(e)),
      });
    }
  }

  // Click overlay = fermeture, sauf pendant submission
  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current && state.kind !== "submitting") {
      onClose();
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transformer-modal-title"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#2a2d31] p-6 text-zinc-100 shadow-2xl">
        {state.kind === "already_transformed" ? (
          // ═══ Vue "déjà transformé" (409) ═══
          <div>
            <div className="mb-4 flex items-center gap-3">
              <span className="text-3xl">🔒</span>
              <h2
                id="transformer-modal-title"
                className="text-xl font-bold text-orange-300"
              >
                Brouillon déjà transformé
              </h2>
            </div>
            <p className="mb-4 text-sm text-zinc-300">
              Ce brouillon a déjà été transformé en offre. Pour générer une
              variante, dupliquez-le d&apos;abord, puis transformez la copie.
            </p>
            <div className="flex flex-wrap justify-end gap-3 pt-2">
              {state.existingOffreSlug && (
                <Link
                  href={`/dashboard/${state.existingOffreSlug}`}
                  className="inline-flex items-center rounded-xl border border-orange-400/40 bg-orange-500/15 px-4 py-2 text-sm font-semibold text-orange-200 transition hover:bg-orange-500/25"
                >
                  Voir l&apos;offre existante →
                </Link>
              )}
              <button
                onClick={onClose}
                className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]"
              >
                Fermer
              </button>
            </div>
          </div>
        ) : state.kind === "error" ? (
          // ═══ Vue erreur générique (500, 404, réseau) ═══
          <div>
            <div className="mb-4 flex items-center gap-3">
              <span className="text-3xl">⚠️</span>
              <h2
                id="transformer-modal-title"
                className="text-xl font-bold text-red-300"
              >
                Erreur de transformation
              </h2>
            </div>
            <p className="mb-4 text-sm text-zinc-300">{state.message}</p>
            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <button
                onClick={() => setState({ kind: "idle" })}
                className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]"
              >
                ← Retour
              </button>
              <button
                onClick={onClose}
                className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]"
              >
                Fermer
              </button>
            </div>
          </div>
        ) : (
          // ═══ Vue principale (idle / submitting) ═══
          <div>
            <div className="mb-4 flex items-center gap-3">
              <span className="text-3xl">🔄</span>
              <h2
                id="transformer-modal-title"
                className="text-xl font-bold"
              >
                Transformer en offre
              </h2>
            </div>

            <p className="mb-5 text-sm text-zinc-400">
              Cette action crée une offre définitive à partir du brouillon{" "}
              <strong className="text-zinc-200">{draft.numero_affiche}</strong>.
              Le brouillon sera archivé et ne sera plus modifiable.
            </p>

            {/* Récap */}
            <div className="mb-5 rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Récapitulatif
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-zinc-500">Client</div>
                  <div className="font-medium text-zinc-100">
                    {nomClient(draft)}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500">Conseiller</div>
                  <div className="font-medium text-zinc-100">
                    {draft.commercial || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500">Nombre d&apos;articles</div>
                  <div className="font-medium text-zinc-100">
                    {draft.nb_articles}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500">Type cible</div>
                  <div className="font-medium text-zinc-100">Offre</div>
                </div>
              </div>

              <div className="mt-4 border-t border-white/10 pt-3 text-sm">
                <div className="flex justify-between text-zinc-400">
                  <span>Sous-total HT</span>
                  <span>{fmtMoney(draft.sous_total)}</span>
                </div>
                {draft.remise_chf > 0 && (
                  <div className="flex justify-between text-zinc-400">
                    <span>
                      Remise
                      {draft.discountPercent && Number(draft.discountPercent) > 0
                        ? ` (${draft.discountPercent}%)`
                        : ""}
                    </span>
                    <span className="text-emerald-400">− {fmtMoney(draft.remise_chf)}</span>
                  </div>
                )}
                {draft.services_total > 0 && (
                  <div className="flex justify-between text-zinc-400">
                    <span>Services inclus</span>
                    <span>+ {fmtMoney(draft.services_total)}</span>
                  </div>
                )}
                {draft.arrondi !== 0 && (
                  <div className="flex justify-between text-zinc-400">
                    <span>Arrondi</span>
                    <span>{fmtMoney(draft.arrondi)}</span>
                  </div>
                )}
                <div className="flex justify-between text-zinc-400">
                  <span>TVA 8.1%</span>
                  <span>{fmtMoney(draft.tva_montant)}</span>
                </div>
                <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-base font-semibold text-zinc-100">
                  <span>Total TTC</span>
                  <span>{fmtMoney(draft.total_ttc)}</span>
                </div>
              </div>
            </div>

            {/* Checkboxes */}
            <div className="mb-5 space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/10 p-3 text-sm transition hover:bg-black/20">
                <input
                  type="checkbox"
                  checked={check1}
                  onChange={(e) => setCheck1(e.target.checked)}
                  disabled={state.kind === "submitting"}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-emerald-500"
                />
                <span className="text-zinc-200">
                  J&apos;ai vérifié toutes les informations (client, prix,
                  quantités, remarques)
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/10 p-3 text-sm transition hover:bg-black/20">
                <input
                  type="checkbox"
                  checked={check2}
                  onChange={(e) => setCheck2(e.target.checked)}
                  disabled={state.kind === "submitting"}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-emerald-500"
                />
                <span className="text-zinc-200">
                  Je confirme que cette transformation est{" "}
                  <strong className="text-zinc-100">définitive</strong> et que
                  l&apos;offre ne sera plus modifiable
                </span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <button
                onClick={onClose}
                disabled={state.kind === "submitting"}
                className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={handleTransform}
                disabled={!canSubmit}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-5 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-[#34383d]/50 disabled:text-zinc-500"
              >
                {state.kind === "submitting" ? (
                  <>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
                    Transformation…
                  </>
                ) : (
                  <>🔄 Transformer en offre</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}