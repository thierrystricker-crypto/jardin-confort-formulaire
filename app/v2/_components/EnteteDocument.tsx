"use client";
// app/v2/_components/EnteteDocument.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dashboard 2.0 — en-tête de la fiche offre / commande (demande du 09.10.2026) :
// le NOM et le PRÉNOM du client en grand, avec le NUMÉRO du document, tout en
// haut. Un bandeau compact reprend nom + numéro quand on fait défiler la page.
// Le bouton « Aperçu » descend sur la carte d'aperçu de la fiche v1 (conservée).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Entete = {
  slug: string;
  type_document: "Offre" | "Commande";
  numero_affiche: string;
  numero_commande: string | null;
  offre_origine: string | null;
  statut: string;
  date_document: string | null;
  reference: string | null;
  commercial: string | null;
  client_societe: string | null;
  client_nom: string | null;
  client_prenom: string | null;
  client_ville: string | null;
  total_ttc: number | null;
  statut_livraison: "ouverte" | "livree" | null;
  date_livraison: string | null;
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtMoney(v: number | null | undefined) {
  if (!v) return "—";
  return "CHF " + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}
function classeStatut(statut: string, type: string) {
  if (type === "Commande" || statut === "Acceptée" || statut === "Convertie") return "b-ok";
  if (statut === "Abandonnée" || statut === "Refusée") return "b-bad";
  if (statut === "Envoyée") return "b-info";
  return "b-warn";
}

/** La carte « Aperçu commande / offre » de la fiche v1. */
function trouverApercu(): HTMLElement | null {
  const iframe = document.querySelector<HTMLIFrameElement>(
    '.v2-legacy iframe[title="Aperçu commande"], .v2-legacy iframe[title="Aperçu offre"]',
  );
  if (!iframe) return null;
  return (iframe.closest(".rounded-2xl") as HTMLElement | null) ?? iframe;
}

export default function EnteteDocument() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const [e, setE] = useState<Entete | null>(null);
  const [erreur, setErreur] = useState(false);
  const [bandeau, setBandeau] = useState(false);
  const [apercu, setApercu] = useState(false);
  const carte = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!slug) return;
    let annule = false;
    fetch(`/api/v2/entete/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => !annule && setE(j.entete as Entete))
      .catch(() => !annule && setErreur(true));
    return () => {
      annule = true;
    };
  }, [slug]);

  // Bandeau compact quand l'en-tête sort de l'écran
  useEffect(() => {
    const el = carte.current;
    if (!el) return;
    const io = new IntersectionObserver(([x]) => setBandeau(!x.isIntersecting), { rootMargin: "-60px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [e]);

  // La carte d'aperçu est montée par la fiche v1 après son propre chargement
  useEffect(() => {
    if (trouverApercu()) {
      setApercu(true);
      return;
    }
    const mo = new MutationObserver(() => {
      if (trouverApercu()) {
        setApercu(true);
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  const allerApercu = () => trouverApercu()?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (erreur) return null; // la fiche v1 dessous affiche déjà son propre message
  const nom = e ? [e.client_prenom, e.client_nom].filter(Boolean).join(" ") : "";
  const titre = nom || e?.client_societe || "Client";
  const isCmd = e?.type_document === "Commande";

  return (
    <>
      {bandeau && e && (
        <div className="v2-bandeau">
          <b>{titre}</b>
          <span className="num">{e.numero_affiche}</span>
          <span className={`v2-badge ${classeStatut(e.statut, e.type_document)}`}>{e.statut}</span>
          <span className="v2-spacer" />
          {apercu && (
            <button type="button" className="v2-btn v2-btn-petit" onClick={allerApercu}>
              👁 Aperçu
            </button>
          )}
          <button type="button" className="v2-btn v2-btn-petit" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            ↑ Haut
          </button>
        </div>
      )}

      <div className="v2-entete">
        <div className="v2-fil">
          <Link href="/v2">Offres & commandes</Link> / {e?.numero_affiche ?? "…"}
        </div>
        <div className="v2-carte v2-entete-carte" ref={carte}>
          <div style={{ minWidth: 0 }}>
            <div className="v2-entete-numero">
              <b>{e?.numero_affiche ?? "…"}</b>
              {e && <span className={`v2-badge ${isCmd ? "b-info" : "b-neu"}`}>{e.type_document}</span>}
              {e && <span className={`v2-badge ${classeStatut(e.statut, e.type_document)}`}>{e.statut}</span>}
              {e && isCmd &&
                (e.statut_livraison === "livree" ? (
                  <span className="v2-badge b-ok">🚚 Livrée{e.date_livraison ? ` le ${fmtDate(e.date_livraison)}` : ""}</span>
                ) : (
                  <span className="v2-badge b-warn">⏳ À livrer</span>
                ))}
            </div>
            <h1 className="v2-entete-nom">{e ? titre : " "}</h1>
            {e && nom && e.client_societe && <div className="v2-entete-societe">{e.client_societe}</div>}
            {e && (
              <div className="v2-entete-meta">
                {e.reference && <span className="v2-badge b-warn" title="Référence client">📌 {e.reference}</span>}
                {e.client_ville && <span>📍 {e.client_ville}</span>}
                {e.commercial && <span>· {e.commercial}</span>}
                {e.date_document && <span>· {fmtDate(e.date_document)}</span>}
                {e.offre_origine && <span>· ← {e.offre_origine}</span>}
                {!isCmd && e.numero_commande && <span>· → {e.numero_commande}</span>}
              </div>
            )}
          </div>
          <div className="v2-entete-droite">
            {e && (
              <div className="v2-entete-montant">
                {fmtMoney(e.total_ttc)}
                <small>Total TTC</small>
              </div>
            )}
            <div className="v2-entete-actions">
              {apercu && (
                <button type="button" className="v2-btn" onClick={allerApercu}>
                  👁 Aperçu {isCmd ? "de la commande" : "de l'offre"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
