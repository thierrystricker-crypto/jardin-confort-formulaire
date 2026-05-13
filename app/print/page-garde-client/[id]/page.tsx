"use client";
// ═══════════════════════════════════════════════════════════════
//  app/print/page-garde-client/[id]/page.tsx
//  Page de garde A4 pour envoi de colis — DIRECTEMENT DEPUIS FICHE CLIENT
//  (sans commande). Identique au design /print/page-garde-colis/[slug],
//  mais sans infos commande en bas (N° commande, date, etc.)
//  Param URL : ?addr=facturation (défaut) | livraison
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState } from "react";

const THEME  = "#2b8ad1";
const BLACK  = "#000000";
const GREY   = "#333333";

type Client = {
  id: number
  numero_client: string
  nom: string
  prenom: string | null
  societe: string | null
  complement_nom: string | null
  rue: string | null
  rue2: string | null
  numero_rue: string | null
  npa: string | null
  ville: string | null
  pays: string | null
  livr_societe: string | null
  livr_nom: string | null
  livr_prenom: string | null
  livr_complement_nom: string | null
  livr_rue: string | null
  livr_rue2: string | null
  livr_npa: string | null
  livr_ville: string | null
  livr_tel: string | null
}

export default function PrintPageGardeClient({ params }: { params: Promise<{ id: string }> }) {
  const [client, setClient] = useState<Client | null>(null);
  const [ready, setReady] = useState(false);
  const [addrMode, setAddrMode] = useState<"facturation" | "livraison">("facturation");

  useEffect(() => {
    async function load() {
      const { id } = await params;
      // Lire le query param ?addr=
      const urlParams = new URLSearchParams(window.location.search);
      const addr = urlParams.get("addr");
      if (addr === "livraison") setAddrMode("livraison");

      try {
        const res = await fetch(`/api/clients/${id}`);
        if (res.ok) {
          const json = await res.json();
          setClient(json.client);
        }
      } catch (e) {
        console.error("Erreur chargement client:", e);
      }
      setReady(true);
    }
    load();
  }, [params]);

  if (!ready) return <div style={{padding:40, textAlign:"center", color:GREY}}>Chargement…</div>;
  if (!client) return <div style={{padding:40, textAlign:"center", color:"#c00"}}>Client introuvable</div>;

  // Détermine si on peut utiliser l'adresse de livraison
  const hasLivraison = !!(client.livr_rue || client.livr_nom || client.livr_societe);
  const useLivraison = addrMode === "livraison" && hasLivraison;

  // Sélection des champs selon le mode
  const addrSociete       = useLivraison ? client.livr_societe        : client.societe;
  const addrNom           = useLivraison ? client.livr_nom            : client.nom;
  const addrPrenom        = useLivraison ? client.livr_prenom         : client.prenom;
  const addrComplementNom = useLivraison ? client.livr_complement_nom : client.complement_nom;
  const addrRue           = useLivraison ? client.livr_rue            : client.rue;
  const addrNumero        = useLivraison ? ""                          : (client.numero_rue || "");
  const addrRue2          = useLivraison ? client.livr_rue2           : client.rue2;
  const addrNpa           = useLivraison ? client.livr_npa            : client.npa;
  const addrVille         = useLivraison ? client.livr_ville          : client.ville;

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
          .mode-toggle {
            position: fixed; top: 16px; left: 16px; z-index: 100;
            display: flex; gap: 4px;
            background: white; border: 1px solid #ddd; border-radius: 8px;
            padding: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          }
          .mode-toggle button {
            background: transparent; border: 0;
            padding: 6px 14px; border-radius: 6px;
            font-size: 12px; font-weight: 600; cursor: pointer;
            color: #666;
          }
          .mode-toggle button.active {
            background: ${THEME}; color: white;
          }
          .mode-toggle button:disabled {
            opacity: 0.3; cursor: not-allowed;
          }
        }
        @media print {
          .print-btn, .mode-toggle { display: none !important; }
        }

        /* Ligne du haut : logo+retour à gauche, adresse client à droite */
        .top-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-top: 8mm;
          gap: 20px;
        }

        /* Bloc gauche : logo */
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

        /* Trait décoratif */
        .accent-bar {
          width: 60mm;
          height: 3px;
          background: ${THEME};
          margin-top: 8mm;
        }

        /* Indication mode (visible uniquement en bas) */
        .mode-indicator {
          margin-top: 8mm;
          font-size: 11px;
          color: ${GREY};
          font-style: italic;
        }
      `}</style>

      <button className="print-btn" onClick={() => window.print()}>🖨 Imprimer</button>

      {/* Toggle de mode (visible uniquement à l'écran) */}
      <div className="mode-toggle">
        <button
          className={addrMode === "facturation" ? "active" : ""}
          onClick={() => setAddrMode("facturation")}
        >
          📍 Facturation
        </button>
        <button
          className={addrMode === "livraison" ? "active" : ""}
          onClick={() => setAddrMode("livraison")}
          disabled={!hasLivraison}
          title={hasLivraison ? "Adresse de livraison" : "Pas d'adresse de livraison enregistrée"}
        >
          📦 Livraison
        </button>
      </div>

      <div className="doc-wrap">

        {/* HAUT : logo à gauche, adresse client à droite */}
        <div className="top-row">
          <div className="return-block">
            <img className="return-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/Logo_Jardin-Confort_et_adresse_vertical-01.png?v=1723586050"
              alt="Jardin-Confort" />
          </div>

          <div className="client-addr">
            {addrSociete && <div className="client-addr-line">{addrSociete}</div>}
            <div className="client-addr-name">{addrNom} {addrPrenom}</div>
            {addrComplementNom && <div className="client-addr-line">{addrComplementNom}</div>}
            {addrRue && <div className="client-addr-line">{addrRue} {addrNumero}</div>}
            {addrRue2 && <div className="client-addr-line">{addrRue2}</div>}
            {addrNpa && <div className="client-addr-line">{addrNpa} {addrVille}</div>}
          </div>
        </div>

        {/* Trait décoratif */}
        <div className="accent-bar" />

        {/* Indication discrète du mode utilisé */}
        <div className="mode-indicator">
          Adresse {useLivraison ? "de livraison" : "de facturation"} · Client {client.numero_client}
        </div>

      </div>
    </>
  );
}