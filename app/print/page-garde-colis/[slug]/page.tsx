"use client";
// ═══════════════════════════════════════════════════════════════
//  app/print/page-garde-colis/[slug]/page.tsx
//  Template d'impression — PAGE DE GARDE pour envoi de colis
//  A4 minimaliste : adresse retour Jardin-Confort à gauche (vertical),
//  adresse client en haut à droite, infos commande en bas à gauche.
//  Uniquement pour les commandes internes (CMD-XXXXX)
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

export default function PrintPageGardeColisSlug({ params }: { params: Promise<{ slug: string }> }) {
  const [data, setData] = useState<PrintData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [numeroAffiche, setNumeroAffiche] = useState("");

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
            setData({
              ...EMPTY,
              ...offreData,
              customerNumber: json.offre?.numero_client || "",
            });
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

  // Détermine quelle adresse afficher (livraison prioritaire si différente)
  const showLivrDiff = (data as any).deliveryMode !== "À l'emporter" && data.livrDiff;
  const addrSociete = showLivrDiff ? data.livrSociete : data.societe;
  const addrNom = showLivrDiff ? data.livrNom : data.nom;
  const addrPrenom = showLivrDiff ? data.livrPrenom : data.prenom;
  const addrRue = showLivrDiff ? data.livrRue : data.rue;
  const addrNumero = showLivrDiff ? data.livrNumero : data.numero;
  const addrNpa = showLivrDiff ? data.livrNpa : data.npa;
  const addrVille = showLivrDiff ? data.livrVille : data.ville;

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
            margin: 0 auto;
            padding: 30px;
            box-shadow: 0 0 20px rgba(0,0,0,0.08);
            min-height: 1000px;
            position: relative;
          }
          .print-btn {
            position: fixed; top: 16px; right: 16px; z-index: 100;
            background: ${THEME}; color: white; border: 0;
            padding: 10px 20px; border-radius: 6px;
            font-size: 14px; font-weight: 700; cursor: pointer;
          }
        }
        @media print { .print-btn { display: none !important; } }

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
        .return-addr {
          font-size: 11px;
          color: ${GREY};
          line-height: 1.4;
          /* Texte vertical façon adresse retour postale */
          writing-mode: vertical-rl;
          transform: rotate(180deg);
          text-orientation: mixed;
          padding: 4px 0;
          font-weight: 600;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }

        /* Adresse client : grande taille, droite, position style fenêtre enveloppe */
        .client-addr {
          flex: 0 0 auto;
          padding: 12px 24px;
          min-width: 90mm;
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

        /* Trait décoratif */
        .accent-bar {
          width: 60mm;
          height: 3px;
          background: ${THEME};
          margin-top: 8mm;
        }
      `}</style>

      <button className="print-btn" onClick={() => window.print()}>🖨 Imprimer</button>

      <div className="doc-wrap">

        {/* HAUT : logo + retour à gauche, adresse client à droite */}
        <div className="top-row">
          <div className="return-block">
            <img className="return-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/Logo_Jardin-Confort_et_adresse_vertical-01.png?v=1723586050"
              alt="Jardin-Confort" />
          </div>

          <div className="client-addr">
            {addrSociete && <div className="client-addr-line">{addrSociete}</div>}
            <div className="client-addr-name">{addrNom} {addrPrenom}</div>
            {addrRue && <div className="client-addr-line">{addrRue} {addrNumero}</div>}
            {addrNpa && <div className="client-addr-line">{addrNpa} {addrVille}</div>}
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
          {(data as any).accesLivraison && (data as any).deliveryMode !== "À l'emporter" && (
            <div className="order-info-line" style={{fontStyle:"italic", color:GREY, marginTop: 6}}>
              <strong style={{color:BLACK}}>Accès :</strong> {(data as any).accesLivraison}
            </div>
          )}
        </div>

      </div>
    </>
  );
}