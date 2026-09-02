"use client";
// ═══════════════════════════════════════════════════════════════
//  app/print/page-garde-colis/[slug]/page.tsx
//  Template d'impression — PAGE DE GARDE pour envoi de colis
//  A4 minimaliste : adresse retour Jardin-Confort à gauche (vertical),
//  adresse client en haut à droite, infos commande en bas à gauche.
//  Uniquement pour les commandes internes (CMD-XXXXX)
//
//  02.09.2026 — ÉDITABLE À L'ÉCRAN avant impression : chaque ligne de
//  l'adresse (société, nom, complément, rue, NPA ville) et la ligne « Accès »
//  se corrigent en place (adresse du voisin, du bureau, un c/o…). Choix
//  Livraison / Facturation quand les deux diffèrent. Rien n'est enregistré :
//  la commande n'est jamais modifiée, on corrige, on imprime.
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState } from "react";
import {
  PrintData,
  formatDate,
} from "@/lib/jc-print-types";

const THEME  = "#2b8ad1";
const BLACK  = "#000000";
const GREY   = "#333333";

const EMPTY: PrintData = {
  formType: "Commande", clientType: "Privé (prix TTC)",
  paymentMode: "Paiement d'avance à la commande", offerStatus: "En cours",
  date: "", commercial: "", offerNumber: "", reference: "",
  societe: "", nom: "", prenom: "", rue: "", numero: "", npa: "", ville: "",
  telephone1: "", telephone2: "", email: "", customerNumber: "",
  livrDiff: false, livrSociete: "", livrNom: "", livrPrenom: "",
  livrTel: "", livrRue: "", livrNumero: "", livrNpa: "", livrVille: "",
  lines: [], discount: "0", discountPercent: "0", manualRounding: "",
  enabledServices: {}, servicePrices: {}, remarks: "", leadTime: "",
  ambianceImages: [],
  deliveryMode: "Livraison à domicile",
} as any;

// Les 5 lignes de l'adresse, telles qu'imprimées (une chaîne par ligne)
type Adresse = { societe: string; nom: string; complement: string; rue: string; npaVille: string };
type SourceAdresse = "livraison" | "facturation";

function joindre(...parts: Array<string | undefined>): string {
  return parts.map((p) => (p || "").trim()).filter(Boolean).join(" ");
}

function adresseDepuis(data: PrintData, source: SourceAdresse): Adresse {
  if (source === "livraison") {
    return {
      societe: data.livrSociete || "",
      nom: joindre(data.livrNom, data.livrPrenom),
      complement: data.livr_complement_nom || "",
      rue: joindre(data.livrRue, data.livrNumero),
      npaVille: joindre(data.livrNpa, data.livrVille),
    };
  }
  return {
    societe: data.societe || "",
    nom: joindre(data.nom, data.prenom),
    complement: data.complement_nom || "",
    rue: joindre(data.rue, data.numero),
    npaVille: joindre(data.npa, data.ville),
  };
}

const LIGNES: Array<{ key: keyof Adresse; placeholder: string; bold?: boolean }> = [
  { key: "societe",    placeholder: "Société (facultatif)" },
  { key: "nom",        placeholder: "Nom Prénom", bold: true },
  { key: "complement", placeholder: "Complément : c/o, voisin, étage… (facultatif)" },
  { key: "rue",        placeholder: "Rue et numéro" },
  { key: "npaVille",   placeholder: "NPA Ville" },
];

export default function PrintPageGardeColisSlug({ params }: { params: Promise<{ slug: string }> }) {
  const [data, setData] = useState<PrintData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [numeroAffiche, setNumeroAffiche] = useState("");

  // ── Édition (écran seulement, jamais enregistré) ──
  const [source, setSource] = useState<SourceAdresse>("facturation");
  const [adresse, setAdresse] = useState<Adresse>({ societe: "", nom: "", complement: "", rue: "", npaVille: "" });
  const [acces, setAcces] = useState("");

  useEffect(() => {
    async function load() {
      const { slug } = await params;
      try {
        const res = await fetch(`/api/offres/${slug}?snapshot=false`);
        if (res.ok) {
          const json = await res.json();
          const offreData = json.offre?.data;
          if (offreData) {
            setNumeroAffiche(json.offre?.numero_affiche || offreData.offerNumber || slug);
            const d: PrintData = { ...EMPTY, ...offreData, customerNumber: json.offre?.numero_client || "" };
            setData(d);
            // Comme avant : livraison prioritaire si différente (et pas « À l'emporter »)
            const src: SourceAdresse = (d as any).deliveryMode !== "À l'emporter" && d.livrDiff ? "livraison" : "facturation";
            setSource(src);
            setAdresse(adresseDepuis(d, src));
            setAcces((d as any).accesLivraison || "");
          }
        }
      } catch (e) {
        console.error("Erreur chargement commande:", e);
      }
      setReady(true);
    }
    load();
  }, [params]);

  if (!ready) return <div style={{padding:40, textAlign:"center", color:GREY}}>Chargement…</div>;

  const aDeuxAdresses = (data as any).deliveryMode !== "À l'emporter" && data.livrDiff;
  const adresseOrigine = adresseDepuis(data, source);
  const modifie = LIGNES.some((l) => adresse[l.key] !== adresseOrigine[l.key]) || acces !== ((data as any).accesLivraison || "");
  const setLigne = (key: keyof Adresse, v: string) => setAdresse((a) => ({ ...a, [key]: v }));
  const choisirSource = (s: SourceAdresse) => { setSource(s); setAdresse(adresseDepuis(data, s)); };
  const toutRemettre = () => { setAdresse(adresseDepuis(data, source)); setAcces((data as any).accesLivraison || ""); };
  const montrerAcces = (data as any).deliveryMode !== "À l'emporter";

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;700;900&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Raleway', 'Helvetica Neue', Arial, sans-serif;
          font-size: 14px; line-height: 1.5; color: ${GREY};
          background: white;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        @page { size: A4 portrait; margin: 14mm 14mm 14mm 14mm; }
        @media screen {
          .doc-wrap {
            max-width: 794px;
            margin: 64px auto 0;
            padding: 30px;
            box-shadow: 0 0 20px rgba(0,0,0,0.08);
            min-height: 1000px;
            position: relative;
          }
        }

        /* ── Barre d'édition (écran seulement) ── */
        .pg-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 100; background: #1f2226; color: #e5e7eb; display: flex; align-items: center; gap: 8px; padding: 8px 14px; flex-wrap: wrap; box-shadow: 0 2px 10px rgba(0,0,0,.35); }
        .pg-bar .pg-info { font-size: 12px; color: #a1a1aa; margin-right: auto; }
        .pg-bar .pg-info b { color: #fff; }
        .pg-btn { border: 1px solid rgba(255,255,255,.15); background: #34383d; color: #e5e7eb; padding: 7px 12px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; font-family: inherit; }
        .pg-btn:hover { background: #40454b; }
        .pg-btn:disabled { opacity: .45; cursor: default; }
        .pg-btn.primary { background: ${THEME}; border-color: ${THEME}; color: white; }
        .pg-seg { display: inline-flex; border: 1px solid rgba(255,255,255,.15); border-radius: 8px; overflow: hidden; }
        .pg-seg button { border: 0; background: #2a2d31; color: #a1a1aa; padding: 7px 12px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; }
        .pg-seg button.on { background: ${THEME}; color: white; }

        /* ── Champs éditables en place (écran seulement) ── */
        .pg-field { display: block; width: 100%; font-family: inherit; color: ${BLACK}; background: #f0f7ff; border: 1.5px dashed ${THEME}; border-radius: 6px; padding: 2px 8px; margin: 2px 0; }
        .pg-field:hover { background: #e0efff; }
        .pg-field:focus { outline: 2px solid ${THEME}; outline-offset: 1px; }
        .pg-field::placeholder { color: #94a3b8; font-weight: 400; font-style: italic; font-size: 14px; }
        .pg-field.empty { background: #f8fafc; border-color: #cbd5e1; }
        .pg-hint { font-size: 11px; color: #64748b; margin-top: 6px; }
        .pg-only-print { display: none; }
        @media print {
          .pg-bar, .pg-only-screen, .pg-hint { display: none !important; }
          .pg-only-print { display: block; }
        }

        /* Ligne du haut : logo+retour à gauche, adresse client à droite */
        .top-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-top: 8mm;
          gap: 20px;
        }

        /* Bloc gauche : logo + adresse retour Jardin-Confort */
        .return-block {
          display: flex;
          gap: 18px;
          align-items: flex-start;
          flex: 0 0 auto;
        }
        .return-logo {
          max-width: 320px;
          max-height: 200px;
          object-fit: contain;
        }

        /* Adresse client : grande taille, droite, position style fenêtre enveloppe */
        .client-addr {
          flex: 0 0 auto;
          padding: 12px 24px;
          min-width: 90mm;
          max-width: 110mm;
          margin-top: 30mm;
        }
        .client-addr-line {
          font-size: 22px;
          color: ${BLACK};
          line-height: 1.35;
          font-weight: 400;
        }
        .client-addr-name {
          font-size: 24px;
          font-weight: 700;
          color: ${BLACK};
          line-height: 1.3;
          margin-bottom: 2px;
        }

        /* Bloc infos commande (en bas du bloc retour, sous le logo) */
        .order-info {
          margin-top: 6mm;
          padding-left: 0;
        }
        .order-info-line {
          font-size: 14px;
          color: ${BLACK};
          line-height: 1.7;
        }
        .order-info-line strong { font-weight: 700; }
        .pg-acces { font-size: 14px; font-style: italic; color: ${GREY}; min-height: 2.4em; resize: vertical; line-height: 1.5; }

        /* Trait décoratif */
        .accent-bar {
          width: 60mm;
          height: 3px;
          background: ${THEME};
          margin-top: 8mm;
        }
      `}</style>

      {/* ── BARRE (écran uniquement) ── */}
      <div className="pg-bar">
        <span className="pg-info">
          Page de garde <b>{numeroAffiche || data.offerNumber}</b> · l&apos;adresse se corrige directement sur la page
          {modifie && <span style={{color:"#fbbf24"}}> · modifiée (rien n&apos;est enregistré)</span>}
        </span>
        {aDeuxAdresses && (
          <span className="pg-seg" title="Quelle adresse de la commande prendre comme base">
            <button className={source === "livraison" ? "on" : ""} onClick={() => choisirSource("livraison")}>Livraison</button>
            <button className={source === "facturation" ? "on" : ""} onClick={() => choisirSource("facturation")}>Facturation</button>
          </span>
        )}
        <button className="pg-btn" onClick={toutRemettre} disabled={!modifie} title="Revient à l'adresse de la commande">↺ Tout remettre</button>
        <button className="pg-btn primary" onClick={() => window.print()}>🖨 Imprimer</button>
      </div>

      <div className="doc-wrap">

        {/* HAUT : logo + retour à gauche, adresse client à droite */}
        <div className="top-row">
          <div className="return-block">
            <img className="return-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/Logo_Jardin-Confort_et_adresse_vertical-01.png?v=1723586050"
              alt="Jardin-Confort" />
          </div>

          <div className="client-addr">
            {/* Écran : une ligne = un champ, même vide (pour pouvoir en ajouter une) */}
            <div className="pg-only-screen">
              {LIGNES.map((l) => (
                <input key={l.key}
                  className={`pg-field ${l.bold ? "client-addr-name" : "client-addr-line"} ${adresse[l.key] ? "" : "empty"}`}
                  value={adresse[l.key]} placeholder={l.placeholder} maxLength={80}
                  onChange={(e) => setLigne(l.key, e.target.value)} />
              ))}
              <div className="pg-hint">✎ Cliquez une ligne pour la corriger — voisin, bureau, c/o… Les lignes vides ne s&apos;impriment pas.</div>
            </div>
            {/* Impression : texte, comme avant */}
            <div className="pg-only-print">
              {LIGNES.map((l) => adresse[l.key].trim() ? (
                <div key={l.key} className={l.bold ? "client-addr-name" : "client-addr-line"}>{adresse[l.key].trim()}</div>
              ) : null)}
            </div>
          </div>
        </div>

        {/* Trait décoratif */}
        <div className="accent-bar" />

        {/* BAS : infos commande */}
        <div className="order-info">
          <div className="order-info-line">
            <strong>N° de commande :</strong> {numeroAffiche || data.offerNumber}
          </div>
          <div className="order-info-line">
            <strong>Date :</strong> {formatDate(data.date)}
          </div>
          {(data as any).deliveryMode && (
            <div className="order-info-line">
              <strong>Expédition :</strong> {(data as any).deliveryMode}
            </div>
          )}
          {data.commercial && (
            <div className="order-info-line">
              <strong>Commercial :</strong> {data.commercial}
            </div>
          )}
          {montrerAcces && (
            <>
              <div className="pg-only-screen" style={{marginTop: 6}}>
                <div className="order-info-line"><strong>Accès :</strong></div>
                <textarea className="pg-field pg-acces" value={acces} maxLength={300} rows={2}
                  placeholder="Consigne pour le livreur : étage, code, « déposer chez le voisin »… (facultatif)"
                  onChange={(e) => setAcces(e.target.value)} />
              </div>
              {acces.trim() && (
                <div className="pg-only-print order-info-line" style={{fontStyle:"italic", color:GREY, marginTop: 6, whiteSpace: "pre-wrap"}}>
                  <strong style={{color:BLACK, fontStyle:"normal"}}>Accès :</strong> {acces.trim()}
                </div>
              )}
            </>
          )}
        </div>

      </div>
    </>
  );
}
