"use client";
// components/FilsMailsCard.tsx
// Carte « Fils de discussion mail » (chantier fiche client, 29.08.2026).
// Utilisée par la FICHE CLIENT (/dashboard/clients/[id], source =
// /api/clients/[id]/fils) et par la PAGE COMMANDE (/dashboard/[slug],
// source = /api/fils-mails?email=…, avec une `note` rappelant que les
// échanges sont rattachés au CLIENT, pas à cette commande précisément).
// Les fils viennent du connecteur jardi-mail (/api/client-fils : en-têtes
// References en composantes + sujet normalisé par client, dédup par
// message_id — même logique que le chat Jardi). Lecture seule, jamais IMAP.

import React, { useEffect, useState } from "react";

type MessageFil = {
  date: string | null
  sens: "entrant" | "sortant"
  boite?: string
  dossier?: string
  uid?: number
  de: string
  sujet: string
  apercu: string
  thunderbird?: string
}
type FilMail = {
  sujet: string
  nb_messages: number
  du: string | null
  au: string | null
  dernier_sens: string
  messages: MessageFil[]
  messages_tronques?: number
}
type ReponseFils = {
  fils?: FilMail[]
  total_mails?: number
  total_fils?: number
  perimetre?: string
  erreur?: string
}

function fmtJour(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" })
}
function fmtJourHeure(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export default function FilsMailsCard({ source, note }: { source: string; note?: string }) {
  const [data, setData] = useState<ReponseFils | null>(null)
  const [chargement, setChargement] = useState(true)
  const [ouverts, setOuverts] = useState<Set<number>>(new Set())

  useEffect(() => {
    let actif = true
    setChargement(true)
    setOuverts(new Set())
    fetch(source)
      .then(async r => {
        const j = await r.json().catch(() => ({ erreur: `réponse ${r.status} illisible` }))
        if (actif) setData(r.ok ? j : { erreur: j?.erreur || `connecteur : ${r.status}` })
      })
      .catch(e => { if (actif) setData({ erreur: String(e) }) })
      .finally(() => { if (actif) setChargement(false) })
    return () => { actif = false }
  }, [source])

  function basculer(i: number) {
    setOuverts(prev => {
      const s = new Set(prev)
      if (s.has(i)) s.delete(i)
      else s.add(i)
      return s
    })
  }

  const fils = data?.fils || []

  return (
    <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Fils de discussion mail</h2>
        {data?.total_fils !== undefined && (
          <span className="text-sm text-zinc-500">{data.total_mails} mail(s) · {data.total_fils} fil(s)</span>
        )}
      </div>
      {note && <div className="mb-4 text-xs text-zinc-500">{note}</div>}
      {!note && <div className="mb-3" />}

      {chargement ? (
        <div className="rounded-xl border border-white/10 bg-black/10 p-6 text-center text-zinc-500">
          Chargement des échanges…
        </div>
      ) : data?.erreur ? (
        // Indisponible ≠ vide : ambre, jamais « à jour » (invariant to-do)
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          Fils indisponibles : {data.erreur}
        </div>
      ) : fils.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/10 p-6 text-center text-zinc-500">
          Aucun échange mail dans l&apos;index pour ce client.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {fils.map((f, i) => {
            const attend = f.dernier_sens === "entrant"
            const ouvert = ouverts.has(i)
            return (
              <div key={i} className="rounded-xl border border-white/10 bg-black/10">
                <button type="button" onClick={() => basculer(i)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/5">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-zinc-100">{f.sujet}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {f.nb_messages} message{f.nb_messages > 1 ? "s" : ""} · {fmtJour(f.du)} → {fmtJour(f.au)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {attend ? (
                      <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                        ⏳ attend une réponse
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                        ✓ répondu
                      </span>
                    )}
                    <span className="text-zinc-500">{ouvert ? "▴" : "▾"}</span>
                  </div>
                </button>
                {ouvert && (
                  <div className="border-t border-white/5 px-4 py-3">
                    {f.messages_tronques ? (
                      <div className="mb-2 text-xs text-zinc-500">
                        … {f.messages_tronques} message(s) plus ancien(s) non affiché(s)
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-3">
                      {f.messages.map((m, j) => (
                        <div key={j}
                          className={`rounded-lg border p-3 ${m.sens === "sortant" ? "border-sky-500/20 bg-sky-500/5" : "border-white/10 bg-white/[0.03]"}`}>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                            <span className={m.sens === "sortant" ? "font-medium text-sky-300" : "font-medium text-zinc-300"}>
                              {m.sens === "sortant" ? "→ Jardin Confort" : `← ${m.de}`}
                            </span>
                            <span>·</span>
                            <span>{fmtJourHeure(m.date)}</span>
                            {m.boite && (
                              <span className="text-zinc-600">· {m.boite}{m.dossier ? ` / ${m.dossier}` : ""}</span>
                            )}
                          </div>
                          {m.apercu ? (
                            <div className="mt-1 text-sm text-zinc-300">{m.apercu}</div>
                          ) : (
                            <div className="mt-1 text-sm italic text-zinc-600">
                              (pas d&apos;aperçu disponible — ouvrir le mail dans Thunderbird)
                            </div>
                          )}
                          {m.thunderbird && (
                            <a href={m.thunderbird}
                              className="mt-1 inline-block text-xs text-sky-400 hover:underline">
                              📧 Ouvrir le mail original dans Thunderbird
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {data?.perimetre && <div className="mt-4 text-xs text-zinc-600">{data.perimetre}</div>}
    </section>
  )
}
