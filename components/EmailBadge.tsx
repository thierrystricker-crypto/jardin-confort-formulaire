"use client"
// components/EmailBadge.tsx
//
// Logique simplifiée :
//   - Les emails NORMAUX (Shopify, manuel, offre, WinBiz historique) = 'verified' → AUCUN badge affiché
//   - Les imports AUTO (Thunderbird Phase 1, fuzzy Phase 2) = 'auto_thunderbird' / 'auto_low_confidence'
//     → badge orange/rouge "À vérifier" + boutons Confirmer/Supprimer
//   - Une fois confirmé manuellement, statut passe à 'verified' → badge disparaît
//
// Le badge n'attire l'attention QUE quand il y a une vraie action à faire.
//
// Usage :
//   <EmailBadge
//     clientId={client.id}
//     email={client.email}
//     emailStatus={client.email_status}
//     emailSource={client.email_source}
//     emailVerifiedAt={client.email_verified_at}
//     onUpdate={(updated) => setClient(updated)}
//   />

import React, { useState } from "react"

type EmailStatus =
  | "verified"
  | "auto_thunderbird"
  | "auto_low_confidence"
  | "manual_unverified"
  | null

type EmailBadgeProps = {
  clientId: number
  email: string | null
  emailStatus: EmailStatus | undefined
  emailSource?: string | null
  emailVerifiedAt?: string | null
  onUpdate?: (updatedClient: {
    id: number
    email: string | null
    email_status: EmailStatus
    email_source: string | null
    email_verified_at: string | null
  }) => void
  /** Mode compact pour les listings (juste petite icône, pas de boutons) */
  compact?: boolean
}

function getBadgeStyle(status: EmailStatus | undefined): {
  label: string
  cls: string
  icon: string
} | null {
  switch (status) {
    case "auto_thunderbird":
      return {
        label: "À vérifier (Thunderbird)",
        cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
        icon: "⚠",
      }
    case "auto_low_confidence":
      return {
        label: "Incertain (à vérifier)",
        cls: "bg-rose-500/15 text-rose-300 border-rose-500/30",
        icon: "⚠",
      }
    case "manual_unverified":
      return {
        label: "Non confirmé",
        cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
        icon: "?",
      }
    // 'verified' et NULL → pas de badge
    default:
      return null
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export default function EmailBadge({
  clientId,
  email,
  emailStatus,
  emailSource,
  emailVerifiedAt,
  onUpdate,
  compact = false,
}: EmailBadgeProps) {
  const [loading, setLoading] = useState<"confirm" | "delete" | null>(null)
  const [error, setError] = useState("")
  const badge = getBadgeStyle(emailStatus)

  // Pas d'email OU statut 'verified'/NULL → rien à afficher
  if (!email || !badge) return null

  // Actions disponibles si statut "à vérifier"
  const showActions =
    !compact &&
    (emailStatus === "auto_thunderbird" ||
      emailStatus === "auto_low_confidence" ||
      emailStatus === "manual_unverified")

  async function callApi(action: "confirm" | "delete") {
    setLoading(action)
    setError("")
    try {
      const res = await fetch(`/api/clients/${clientId}/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Erreur")
      onUpdate?.(json.client)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(null)
    }
  }

  function handleConfirm() {
    if (loading) return
    callApi("confirm")
  }

  function handleDelete() {
    if (loading) return
    if (
      !window.confirm(
        `Supprimer l'email "${email}" ? Cela retirera l'email du client (le client lui-même reste intact).`
      )
    )
      return
    callApi("delete")
  }

  const tooltipParts: string[] = []
  if (emailSource) tooltipParts.push(`Source : ${emailSource}`)
  if (emailVerifiedAt) tooltipParts.push(`Vérifié le ${fmtDate(emailVerifiedAt)}`)
  const tooltip = tooltipParts.join(" · ")

  if (compact) {
    return (
      <span
        title={tooltip || badge.label}
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}
      >
        {badge.icon}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          title={tooltip || badge.label}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}
        >
          <span>{badge.icon}</span>
          <span>{badge.label}</span>
        </span>

        {showActions && (
          <div className="flex gap-1.5">
            <button
              onClick={handleConfirm}
              disabled={loading !== null}
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
            >
              {loading === "confirm" ? "…" : "✓ Confirmer"}
            </button>
            <button
              onClick={handleDelete}
              disabled={loading !== null}
              className="rounded-lg border border-rose-500/30 bg-rose-500/15 px-2.5 py-0.5 text-xs text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
            >
              {loading === "delete" ? "…" : "✕ Supprimer"}
            </button>
          </div>
        )}
      </div>

      {emailSource && (
        <div className="text-[10px] text-zinc-500">
          Source : <span className="font-mono">{emailSource}</span>
        </div>
      )}

      {error && (
        <div className="text-[10px] text-rose-300">Erreur : {error}</div>
      )}
    </div>
  )
}