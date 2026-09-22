// app/print/planner/[token]/page.tsx
// Fiche imprimable d'une VERSION figée du planner 3D — même gabarit que
// /print/offre/[slug] (Raleway, logo, méta, filets bleus, totaux, pied).
//   ?prix=0 → sans aucun prix (articles, quantités, cotes).
// Composant SERVEUR : lit la version dans Supabase et rend un document
// statique, sans WebGL ni JS — c'est ce que pdf.co convertit en PDF
// (POST /api/planner/scenes/[id]/pdf) et ce que le bouton « Fiche » ouvre.
// Route interne (verrou proxy.ts) : cookie pour un humain, `jc_token` en
// query pour pdf.co, comme les autres pages /print.

import React from "react";
import { supabaseAdmin } from "@/lib/supabase";
import { MENTION_IA, MENTION_LEGALE, type SceneItem } from "@/lib/planner-types";

export const dynamic = "force-dynamic";

const THEME = "#2b8ad1", BLACK = "#000000", GREY = "#333333", LIGHT = "#f9f9f9";
const LOGO = "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698";
const APP_URL = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch";

type ItemVersion = SceneItem & { dims?: { l: number; p: number; h: number } };

function fmt(v: number): string {
  return `CHF ${new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
}
function dateCH(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Zurich" });
}

// Titre du document (onglet et métadonnée « Title » du PDF pdf.co)
export async function generateMetadata({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const { data } = await supabaseAdmin.from("planner_scenes_versions").select("nom, numero").eq("token", /^[0-9a-f]{32}$/.test(token) ? token : "").maybeSingle();
  if (!data) return { title: "Plan 3D — Jardin-Confort" };
  return { title: `${data.nom} — Plan 3D V${data.numero}${sp.prix === "0" ? " (sans prix)" : ""} — Jardin-Confort` };
}

export default async function PagePrintPlanner({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const avecPrix = sp.prix !== "0";

  const { data: v } = await supabaseAdmin
    .from("planner_scenes_versions")
    .select("scene_id, numero, nom, terrasse, sol, items, mode, vue, cree_par, cree_le, capture_url, ambiance_url, ambiance_prompt")
    .eq("token", /^[0-9a-f]{32}$/.test(token) ? token : "")
    .maybeSingle();
  if (!v) {
    return <div style={{ padding: 40, textAlign: "center", color: GREY, fontFamily: "sans-serif" }}>Version de plan introuvable.</div>;
  }

  const items = (v.items as ItemVersion[]) || [];
  // Une ligne par fiche et variante, avec quantité
  const groupes = new Map<string, { it: ItemVersion; qty: number }>();
  for (const it of items) {
    const cle = `${it.product_id}|${it.variant_id || ""}`;
    const e = groupes.get(cle);
    if (e) e.qty++; else groupes.set(cle, { it, qty: 1 });
  }
  const lignes = [...groupes.values()];
  const total = lignes.reduce((n, { it, qty }) => n + (it.prix || 0) * qty, 0);
  const totalApprox = lignes.some(({ it }) => it.prix != null && !it.prix_exact);
  const TVA = 0.081;
  const tva = total - total / (1 + TVA);
  const lien = `${APP_URL.replace(/\/$/, "")}/planner/partage/${token}`;
  const terrasse = v.terrasse as { largeur: number; profondeur: number };
  const des = (it: ItemVersion) => (it.prix_exact ? "" : "dès ");

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;700;900&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Raleway', 'Helvetica Neue', Arial, sans-serif; font-size: 13px; line-height: 1.5; color: ${GREY}; background: white; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        @page { size: A4 portrait; margin: 14mm 16mm 14mm 14mm; }
        @media screen {
          .doc-wrap { max-width: 794px; margin: 0 auto; padding: 20px 28px; box-shadow: 0 0 20px rgba(0,0,0,0.08); }
          .print-btn { position: fixed; top: 16px; right: 16px; z-index: 100; background: ${THEME}; color: white; border: 0; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; }
        }
        @media print { .print-btn { display: none !important; } }
        .doc-header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 3mm; width: 100%; }
        .doc-header-left { flex: 0 0 46%; } .doc-header-right { flex: 0 0 50%; }
        .doc-logo { max-width: 150px; max-height: 50px; object-fit: contain; display: block; margin-bottom: 6px; }
        .doc-type { font-size: 26px; font-weight: 400; color: ${THEME}; margin-bottom: 8px; line-height: 1.1; }
        .doc-meta-table { border-collapse: collapse; width: 100%; }
        .doc-meta-table td { padding: 1px 6px 1px 0; vertical-align: top; font-size: 12px; line-height: 1.35; }
        .doc-meta-label { font-weight: 700; color: ${BLACK}; white-space: nowrap; width: 28%; }
        .doc-plan-name { font-size: 19px; font-weight: 700; color: ${BLACK}; line-height: 1.3; margin: 6px 0 4px; }
        .doc-plan-sub { font-size: 12px; color: #666; }
        .doc-hr { border: 0; border-top: 2px solid ${THEME}; margin: 4mm 0; width: 100%; }
        .doc-capture { width: 100%; margin-bottom: 6mm; page-break-inside: avoid; break-inside: avoid; }
        .doc-capture img { display: block; width: 100%; border: 1px solid #e5e7eb; border-radius: 4px; }
        /* Plan + ambiance IA : pleine largeur, l'un sous l'autre, hauteurs
           bornées pour remplir la première page à eux deux (A4 : ~249 mm
           utiles, en-tête ~38 mm) ; le tableau des articles suit en page 2. */
        .doc-duo { margin-bottom: 4mm; }
        .doc-duo .doc-capture { margin-bottom: 3mm; page-break-inside: avoid; break-inside: avoid; }
        /* Largeur FIXE identique pour les deux, hauteur calculée : quelle que
           soit la proportion de chaque image, elles s'alignent au pixel près
           (en 3:2, capture 1536×1024 et rendu IA font 94 mm de haut chacune). */
        .doc-duo .doc-capture img { width: 141mm; height: auto; max-height: 100mm; object-fit: contain; display: block; margin: 0 auto; background: #fff; }
        .doc-duo + .doc-table { page-break-before: always; break-before: page; }
        .doc-capture-caption { font-size: 10px; color: #777; font-style: italic; margin-top: 5px; text-align: center; }
        .doc-table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
        .doc-table thead th { padding: 7px 4px; border-top: 2px solid ${THEME}; border-bottom: 2px solid ${THEME}; font-weight: 700; font-size: 12px; color: ${BLACK}; }
        .th-left { text-align: left; } .th-center { text-align: center; } .th-right { text-align: right; }
        .doc-table tbody tr td { padding: 8px 4px; border-bottom: 1px solid #efefef; vertical-align: top; font-size: 12px; }
        .doc-table tbody tr:nth-child(odd) td { background: ${LIGHT}; }
        .td-img { width: 56px; vertical-align: middle; text-align: center; }
        .td-img img { max-width: 52px; max-height: 52px; object-fit: contain; }
        .td-desc { padding-left: 8px !important; }
        .td-center { text-align: center; vertical-align: middle; white-space: nowrap; }
        .td-right { text-align: right; vertical-align: middle; white-space: nowrap; }
        .td-total { text-align: right; vertical-align: middle; white-space: nowrap; font-weight: 700; color: ${BLACK}; }
        .item-title { font-weight: 700; color: ${BLACK}; line-height: 1.35; }
        .item-sku { font-size: 11px; color: #777; margin-top: 2px; font-weight: 400; }
        .item-warn { font-size: 11px; font-weight: 600; color: #E67E22; margin-top: 3px; }
        .doc-bottom-wrap { display: flex; gap: 20px; margin-bottom: 8mm; align-items: flex-end; page-break-inside: avoid; break-inside: avoid; }
        .doc-notes-col { flex: 1; font-size: 11px; color: #666; line-height: 1.55; }
        .doc-totals-col { flex: 0 0 44%; }
        .doc-pricing { width: 100%; border-collapse: collapse; }
        .doc-pricing td { padding: 5px 4px; font-size: 12px; }
        .doc-pricing tr:nth-child(even) td { background: ${LIGHT}; }
        .doc-pricing .pt-label { font-weight: 600; color: ${BLACK}; }
        .doc-pricing .pt-value { text-align: right; white-space: nowrap; color: ${BLACK}; }
        .doc-pricing .pt-tva td { color: #666; font-size: 11px; }
        .doc-pricing .pt-total td { border-top: 2px solid ${THEME} !important; border-bottom: 2px solid ${THEME} !important; padding: 8px 4px !important; }
        .pt-total-label { font-weight: 900 !important; font-size: 15px !important; color: ${BLACK} !important; }
        .pt-total-value { font-weight: 900 !important; font-size: 15px !important; color: ${BLACK} !important; text-align: right; white-space: nowrap; }
        .doc-3d { margin: 0 0 6mm 0; background: linear-gradient(135deg, #EEF6FF 0%, #E8F4FF 100%); border: 1.5px solid ${THEME}; border-radius: 12px; padding: 14px 20px; display: flex; align-items: center; gap: 20px; page-break-inside: avoid; break-inside: avoid; }
        .doc-3d-title { font-size: 13px; font-weight: 700; color: #0a1551; margin-bottom: 4px; }
        .doc-3d-text { font-size: 11px; color: #5e678f; line-height: 1.6; margin-bottom: 10px; }
        .doc-3d-btn { display: inline-block; background: ${THEME}; color: white; border-radius: 20px; padding: 8px 18px; font-size: 12px; font-weight: 700; letter-spacing: 0.02em; text-decoration: none; }
        .doc-3d-url { margin-top: 6px; font-size: 10px; color: #5e678f; word-break: break-all; }
        .doc-3d-qr { flex-shrink: 0; text-align: center; }
        .doc-3d-qr img { width: 110px; height: 110px; border-radius: 8px; border: 1px solid #c7dff5; }
        .doc-3d-qr div { font-size: 9px; color: #5e678f; margin-top: 4px; }
        .doc-thanks { text-align: center; font-weight: 700; color: ${THEME}; margin: 6mm 0 3px; font-size: 13px; }
        .doc-terms { text-align: center; font-size: 10px; color: #888; line-height: 1.5; margin-bottom: 6mm; }
        .doc-footer { border-top: 1px solid #ddd; padding-top: 6px; text-align: center; font-size: 11px; color: #666; line-height: 1.7; }
        .doc-footer strong { color: ${BLACK}; }
        .doc-footer-url { font-weight: 700; color: ${THEME}; }
      `}</style>

      {/* Composant serveur : pas de onClick React — un mini script suffit */}
      <button className="print-btn" id="btn-print" type="button">🖨 Imprimer</button>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('btn-print').onclick=function(){window.print()}" }} />
      <div className="doc-wrap">
        <div className="doc-header">
          <div className="doc-header-left">
            <img className="doc-logo" src={LOGO} alt="Jardin-Confort" />
            <div className="doc-type">Plan 3D</div>
            {/* En-tête compact (2 lignes) : la première page est réservée aux images */}
            <table className="doc-meta-table"><tbody>
              <tr><td className="doc-meta-label">N° de plan</td><td>{String(v.scene_id).slice(0, 8)} · V{v.numero as number} du {dateCH(v.cree_le as string)}{v.cree_par ? ` · ${v.cree_par as string}` : ""}</td></tr>
              <tr><td className="doc-meta-label">Terrasse</td><td>{terrasse.largeur} × {terrasse.profondeur} m · {items.length} article{items.length > 1 ? "s" : ""}{v.mode === "maquette" ? " · rendu maquette (sans couleurs)" : ""}</td></tr>
            </tbody></table>
          </div>
          <div className="doc-header-right">
            <div className="doc-plan-name">{v.nom as string}</div>
            <div className="doc-plan-sub">Composition réalisée avec le planner 3D Jardin-Confort.</div>
          </div>
        </div>
        <hr className="doc-hr" />

        {/* Le texte de l'ambiance (prompt) reste interne : il se lit dans le
            planner (galerie), jamais sur le document. */}
        {v.capture_url && v.ambiance_url ? (
          <div className="doc-duo">
            <div className="doc-capture">
              <img src={v.capture_url as string} alt="" />
              <div className="doc-capture-caption">Plan 3D, vue {v.vue === "plan" ? "de dessus" : "en perspective"} — {MENTION_LEGALE}</div>
            </div>
            <div className="doc-capture doc-capture-ia">
              <img src={v.ambiance_url as string} alt="" />
              <div className="doc-capture-caption">{MENTION_IA} — seuls les meubles du plan font référence</div>
            </div>
          </div>
        ) : v.capture_url ? (
          <div className="doc-capture">
            <img src={v.capture_url as string} alt="" />
            <div className="doc-capture-caption">Vue {v.vue === "plan" ? "de dessus" : "en perspective"} — {MENTION_LEGALE}</div>
          </div>
        ) : null}

        <table className="doc-table">
          <thead><tr>
            <th style={{ width: 56 }}></th>
            <th className="th-left">Description de l&apos;article</th>
            <th className="th-center" style={{ width: 62 }}>Qté</th>
            {avecPrix ? <><th className="th-right" style={{ width: 90 }}>Prix/pce</th><th className="th-right" style={{ width: 100 }}>Total</th></> : null}
          </tr></thead>
          <tbody>
            {lignes.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: "center", padding: 20, color: "#aaa", fontStyle: "italic" }}>Aucun article</td></tr>
            ) : lignes.map(({ it, qty }) => (
              <tr key={it.uid}>
                <td className="td-img">{it.image_url ? <img src={it.image_url} alt="" /> : null}</td>
                <td className="td-desc">
                  <div className="item-title">{it.titre}</div>
                  {it.sku ? <div className="item-sku">Réf. {it.sku}</div> : null}
                  {it.dims ? <div className="item-sku">Cotes 3D {Math.round(it.dims.l * 100)} × {Math.round(it.dims.p * 100)} × H {Math.round(it.dims.h * 100)} cm</div> : null}
                  {it.size_warn ? <div className="item-warn">Taille : rendu 3D indicatif</div> : null}
                  {it.color_warn && v.mode === "couleurs" ? <div className="item-warn">Couleur : rendu 3D indicatif</div> : null}
                </td>
                <td className="td-center">× {qty}</td>
                {avecPrix ? (
                  <>
                    <td className="td-right">{it.prix != null ? des(it) + fmt(it.prix) : "—"}</td>
                    <td className="td-total">{it.prix != null ? des(it) + fmt(it.prix * qty) : "—"}</td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>

        {avecPrix ? (
          <div className="doc-bottom-wrap">
            <div className="doc-notes-col">{totalApprox ? "« dès » : prix le plus bas de la fiche, la variante exacte (taille, coloris) n'étant pas encore choisie." : ""}</div>
            <div className="doc-totals-col"><table className="doc-pricing"><tbody>
              <tr><td className="pt-label">Sous-total articles</td><td className="pt-value">{totalApprox ? "dès " : ""}{fmt(total)}</td></tr>
              <tr className="pt-tva"><td className="pt-label">TVA 8.1% (incluse)</td><td className="pt-value">{fmt(tva)}</td></tr>
              <tr className="pt-total"><td className="pt-total-label">TOTAL TTC{totalApprox ? " (dès)" : ""}</td><td className="pt-total-value">{fmt(total)}</td></tr>
            </tbody></table></div>
          </div>
        ) : null}

        <div className="doc-3d">
          <div style={{ flex: 1 }}>
            <div className="doc-3d-title">🧊 Votre plan en 3D</div>
            <div className="doc-3d-text">Tournez autour de votre projet, en vue de dessus ou en perspective, depuis votre smartphone ou votre ordinateur : cliquez sur le bouton ci-dessous, ou scannez le QR code si vous lisez ce document sur papier. Ce lien montre la version V{v.numero as number} du plan, telle qu&apos;imprimée ici ; si votre conseiller retravaille le projet, la page vous le signalera et vous proposera la version la plus récente.</div>
            <a href={lien} target="_blank" rel="noopener noreferrer" className="doc-3d-btn">Ouvrir mon plan en 3D →</a>
            <div className="doc-3d-url">{lien}</div>
          </div>
          <div className="doc-3d-qr">
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(lien)}`} alt="QR code plan 3D" />
            <div>Scanner pour ouvrir le plan 3D</div>
          </div>
        </div>

        <p className="doc-thanks">Nous nous réjouissons de vous accompagner dans votre projet. Merci pour votre confiance !</p>
        <p className="doc-terms">
          {MENTION_LEGALE}.{avecPrix ? " Prix TTC indicatifs au jour de l'export, sous réserve d'une offre." : ""}<br />
          {avecPrix ? "Les articles, quantités et prix mentionnés" : "Les articles et quantités mentionnés"} peuvent différer de l&apos;offre finale. Seule l&apos;offre signée ou la confirmation de commande fait foi.
        </p>
        <div className="doc-footer">
          <div><strong>Jardin-Confort SA</strong></div>
          <div>Route de Lavaux 425 · 1095 Lutry · Suisse</div>
          <div>contact@jardinconfort.ch · +41 21 791 36 71</div>
          <div>TVA : CHE-100.142.327</div>
          <div className="doc-footer-url">www.jardin-confort.ch</div>
        </div>
      </div>
    </>
  );
}
