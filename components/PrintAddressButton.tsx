"use client"
import React, { useState } from "react"

type Client = {
  id: number
  livr_rue?: string | null
  livr_nom?: string | null
  livr_societe?: string | null
}

export default function PrintAddressButton({
  client,
  compact = false,
}: {
  client: Client
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const hasLivraison = !!(client.livr_rue || client.livr_nom || client.livr_societe)

  function openPrint(addr: "facturation" | "livraison") {
    window.open(`/print/page-garde-client/${client.id}?addr=${addr}`, "_blank")
    setOpen(false)
  }

  const btnClass = compact
    ? "rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-xs text-violet-300 hover:bg-violet-500/20"
    : "inline-flex items-center rounded-xl border border-violet-500/30 bg-violet-500/15 px-4 py-2 text-sm text-violet-300 hover:bg-violet-500/25"

  return (
    <div style={{ position: "relative", display: "inline-block" }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => {
          if (!hasLivraison) {
            openPrint("facturation")
          } else {
            setOpen(v => !v)
          }
        }}
        className={btnClass}
        title="Imprimer page de garde A4 avec adresse pour colis"
      >
        📦 Page garde
      </button>

      {open && hasLivraison && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              zIndex: 50,
              minWidth: 220,
            }}
            className="rounded-xl border border-violet-500/40 bg-[#2a2d31] shadow-xl"
          >
            <button
              type="button"
              onClick={() => openPrint("facturation")}
              className="block w-full px-4 py-2.5 text-left text-xs text-zinc-200 hover:bg-violet-500/15 rounded-t-xl border-b border-white/5"
            >
              <div className="font-semibold">📍 Adresse de facturation</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Adresse principale du client</div>
            </button>
            <button
              type="button"
              onClick={() => openPrint("livraison")}
              className="block w-full px-4 py-2.5 text-left text-xs text-zinc-200 hover:bg-violet-500/15 rounded-b-xl"
            >
              <div className="font-semibold">📦 Adresse de livraison</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Adresse alternative pour les colis</div>
            </button>
          </div>
        </>
      )}
    </div>
  )
}