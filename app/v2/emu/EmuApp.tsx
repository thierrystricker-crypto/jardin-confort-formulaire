"use client";
// app/v2/emu/EmuApp.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Monte l'app « Accords couleurs EMU » du thème Shopify dans la coquille v2
// (13.11.2026). Même principe que le configurateur parasol (ConfigurateurApp.tsx) :
//
//   1. GET /api/emu → produits EMU + coussins compatibles (lus dans la section du
//      thème publié) + adresses CDN du code (JS, CSS) + format de prix ;
//   2. l'app tourne dans un IFRAME ISOLÉ (sandbox="allow-scripts", SANS
//      allow-same-origin) : origine opaque, aucun accès aux cookies du formulaire,
//      à ses API ni à la page autour. CSP : aucune requête réseau (connect-src 'none'),
//      scripts et styles limités au CDN de la boutique. Les données sont fournies
//      d'avance (window.EMUA.mount(el, { raw, cush, … })) : l'app ne lit rien elle-même ;
//   3. dialogue par postMessage. L'iframe DEMANDE, la page décide :
//        emua-liste  { id, payload } → POST /api/configurateur/liste (source "emu" ;
//                                      articles relus chez Shopify, rien d'autre n'est cru) ;
//        emua-erreur { message }     → affichage de l'erreur.
//      Réponses : emua-reponse { id, ok, msg } · thème : emua-theme { theme }.
//   4. l'iframe a la hauteur de l'écran et défile À L'INTÉRIEUR : les colonnes collantes
//      (liste, « Mon ensemble ») restent visibles comme sur le site.
//
// Mode sombre : suit le bouton clair/sombre de la v2 (sans recharger l'app ni perdre
// l'ensemble) ; les photos produit (packshots détourés) gardent un fond blanc arrondi,
// les pastilles de couleur EMU gardent leurs vraies couleurs.
//
// Rien à maintenir ici quand l'app évolue : on corrige le thème, on publie,
// le formulaire suit (cache 5 min côté /api/emu).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { CLE_UTILISATEUR, normaliserMembre } from "@/lib/jardi-equipe";

type Payload = {
  raw: unknown[];
  cush: unknown[];
  js: string;
  css: string;
  money: string;
  base: string;
  lu: string;
  error?: string;
};

type ListeCreee = { id: string; nom: string; nb: number };

type Theme = "light" | "dark";

// Thème de la coquille v2 : attribut data-theme de .v2-root (bouton clair/sombre).
function themeV2(el: Element | null): Theme {
  const r = el?.closest("[data-theme]");
  return r?.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

// Boutons de l'app (sur le site, ils viennent du thème).
const CSS_BOUTONS = `
.emua .btn{display:inline-flex;align-items:center;justify-content:center;gap:.4em;border-radius:999px;padding:.75em 1.2em;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--emua-acc);line-height:1.2}
.emua .btn--primary{background:var(--emua-acc);color:#fff}
.emua .btn--primary:hover{filter:brightness(1.08)}
.emua .btn[disabled]{opacity:.55;cursor:progress}
.emua a{color:var(--emua-acc)}
.emua .emua-card-t{color:inherit}
`;

// Vrai mode sombre (uniquement dans le formulaire : le site reste clair).
const CSS_SOMBRE = `
html[data-theme="dark"],html[data-theme="dark"] body{background:#1c1f24;color:#e6e6e6;color-scheme:dark}
html[data-theme="dark"] .emua{--emua-acc:#6aa7e8;--emua-accbg:#1d2d42;--emua-line:#3a4049;--emua-soft:#272c33;--emua-text:#e6e6e6;--emua-muted:#a3a8b0;
  --emua-sh-card:0 14px 30px -20px rgba(0,0,0,.7);--emua-sh-hover:0 10px 22px -12px rgba(0,0,0,.75);--emua-sh-on:0 8px 20px -12px rgba(0,0,0,.7)}
html[data-theme="dark"] .emua-side,html[data-theme="dark"] .emua-pane,html[data-theme="dark"] .emua-set,
html[data-theme="dark"] .emua-q,html[data-theme="dark"] .emua-chip,html[data-theme="dark"] .emua-sw,html[data-theme="dark"] .emua-card,
html[data-theme="dark"] .emua-add,html[data-theme="dark"] .emua-qty,html[data-theme="dark"] .emua-cu-m,
html[data-theme="dark"] .emua-modal-b,html[data-theme="dark"] .emua-modal-f{background:#22262c;color:#e6e6e6}
html[data-theme="dark"] .emua-tab[aria-pressed="true"]{background:#22262c}
html[data-theme="dark"] .emua-sw[aria-pressed="true"],html[data-theme="dark"] .emua-chip[aria-pressed="true"],
html[data-theme="dark"] .emua-item[aria-current="true"],html[data-theme="dark"] .emua-cu-m[aria-pressed="true"]{background:var(--emua-accbg)}
html[data-theme="dark"] .emua-add:hover{background:var(--emua-acc);color:#10141a}
html[data-theme="dark"] .emua .btn--primary{color:#10141a}
html[data-theme="dark"] .emua-n{color:#10141a}
html[data-theme="dark"] .emua-im,html[data-theme="dark"] .emua-cu-sel img,html[data-theme="dark"] .emua-cu-m img,html[data-theme="dark"] .emua-cu-sw{background:#fff}
html[data-theme="dark"] .emua-im--none{background:#2c3138}
html[data-theme="dark"] .emua-imnote{background:rgba(34,38,44,.92);color:#f0b35a}
html[data-theme="dark"] .emua-unit.is-multi{background:#3d3015;color:#f0b35a}
html[data-theme="dark"] .emua-stock{color:#f0b35a}
html[data-theme="dark"] .emua-stock.is-in{color:#7fd18b}
html[data-theme="dark"] .emua-stock.is-out{color:#f28b82}
html[data-theme="dark"] .emua-msg.is-ok{color:#7fd18b}
html[data-theme="dark"] .emua-msg.is-bad{color:#f28b82}
html[data-theme="dark"] .emua-dot{box-shadow:0 0 0 1px rgba(255,255,255,.22)}
html[data-theme="dark"] .emua-modal{background:rgba(0,0,0,.65)}
html[data-theme="dark"] .emua-set.is-flash{animation:none}
`;

// JSON sûr dans un <script> : pas de « </script> » ni de commentaire HTML possible.
function jsonPourScript(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function origine(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// Document complet de l'iframe (srcdoc).
function documentIframe(p: Payload, theme: Theme): string {
  const sources = Array.from(new Set([origine(p.js), origine(p.css), "https://cdn.shopify.com"].filter(Boolean))).join(" ");
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${sources}`,
    `style-src 'unsafe-inline' ${sources}`,
    "img-src https: data:",
    "font-src https: data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  const donnees = jsonPourScript({ raw: p.raw, cush: p.cush, money: p.money, base: p.base });
  return `<!doctype html>
<html lang="fr" data-theme="${theme}"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attr(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${attr(p.css)}">
<style>
  html,body{margin:0;background:#fff}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#2b2b2b;font-size:15px;line-height:1.45}
  #app{padding:16px 18px 24px}
  h1,h2,h3,p{margin-top:0}
  button,input{font:inherit}
${CSS_BOUTONS}
${CSS_SOMBRE}
</style>
</head><body>
<div id="app" class="emua"><div class="emua-app"></div></div>
<script>window.EMUA_NOAUTO = true; window.__EMUA_DONNEES = ${donnees};</script>
<script src="${attr(p.js)}"></script>
<script>
(function () {
  var parent = window.parent, D = window.__EMUA_DONNEES, n = 0, attente = {};
  if (!window.EMUA || !window.EMUA.mount) {
    parent.postMessage({ type: "emua-erreur", message: "App EMU non initialisée (thème < v2.1 ?)" }, "*"); return;
  }
  window.addEventListener("message", function (e) {
    if (e.source !== parent || !e.data) return;
    if (e.data.type === "emua-theme") { document.documentElement.setAttribute("data-theme", e.data.theme === "dark" ? "dark" : "light"); return; }
    if (e.data.type !== "emua-reponse") return;
    var f = attente[e.data.id]; if (!f) return;
    delete attente[e.data.id]; f(e.data);
  });
  window.EMUA.mount(document.getElementById("app"), {
    raw: D.raw, cush: D.cush, money: D.money, base: D.base, locale: "fr",
    liste: function (payload) {
      return new Promise(function (ok) {
        var id = ++n; attente[id] = ok;
        parent.postMessage({ type: "emua-liste", id: id, payload: payload }, "*");
      }).then(function (r) { return { ok: !!r.ok, msg: r.msg }; });
    }
  });
})();
</script>
</body></html>`;
}

export default function EmuApp() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boiteRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const themeRef = useRef<Theme>("light");
  const [etat, setEtat] = useState<"chargement" | "pret" | "erreur">("chargement");
  const [erreur, setErreur] = useState("");
  const [lu, setLu] = useState("");
  const [doc, setDoc] = useState("");
  const [essai, setEssai] = useState(0);
  const [liste, setListe] = useState<ListeCreee | null>(null);
  const [brouillon, setBrouillon] = useState<"" | "en-cours" | "erreur">("");
  const dernierEnvoi = useRef(0);

  const utilisateur = (): string | null => {
    try {
      return normaliserMembre(window.localStorage.getItem(CLE_UTILISATEUR));
    } catch {
      return null;
    }
  };

  const relire = () => {
    setEtat("chargement");
    setListe(null);
    setEssai((n) => n + 1);
  };

  // 1. Données + adresses du code du thème
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await fetch("/api/emu" + (essai ? "?frais=1" : ""), { cache: "no-store" });
        const p = (await res.json()) as Payload;
        if (!res.ok || p.error) throw new Error(p.error || "Erreur " + res.status);
        if (![p.js, p.css].every((u) => /^https:\/\//.test(u))) throw new Error("Adresses du thème invalides");
        if (annule) return;
        setDoc(documentIframe(p, themeV2(boiteRef.current)));
        setLu(p.lu);
        setEtat("pret");
      } catch (e) {
        if (annule) return;
        setErreur((e as Error).message);
        setEtat("erreur");
      }
    })();
    return () => {
      annule = true;
    };
  }, [essai]);

  // Suit le bouton clair/sombre de la v2 (sans recharger l'app ni perdre l'ensemble)
  useEffect(() => {
    const racine = boiteRef.current?.closest("[data-theme]");
    const appliquer = () => {
      const t = themeV2(boiteRef.current);
      themeRef.current = t;
      setTheme(t);
      frameRef.current?.contentWindow?.postMessage({ type: "emua-theme", theme: t }, "*");
    };
    appliquer();
    if (!racine) return;
    const obs = new MutationObserver(appliquer);
    obs.observe(racine, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // 2. Messages de l'iframe (seule source acceptée : notre iframe)
  useEffect(() => {
    function repondre(id: unknown, data: Record<string, unknown>) {
      if (typeof id !== "number") return;
      frameRef.current?.contentWindow?.postMessage({ type: "emua-reponse", id, ...data }, "*");
    }
    async function recevoir(e: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const m = e.data as Record<string, unknown>;
      if (!m || typeof m !== "object") return;

      if (m.type === "emua-liste" && m.payload && typeof m.payload === "object") {
        if (Date.now() - dernierEnvoi.current < 3000) {
          repondre(m.id, { ok: false, msg: "Un instant…" });
          return;
        }
        dernierEnvoi.current = Date.now();
        try {
          const r = await fetch("/api/configurateur/liste", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...(m.payload as Record<string, unknown>), source: "emu", cree_par: utilisateur() }),
          });
          const j = (await r.json()) as { id?: string; nom?: string; nb?: number; error?: string };
          if (!r.ok || !j.id) throw new Error(j.error || "Erreur " + r.status);
          setListe({ id: j.id, nom: j.nom || "", nb: j.nb || 0 });
          setBrouillon("");
          repondre(m.id, { ok: true, msg: `✓ Liste d'achat créée : « ${j.nom} » (${j.nb} article${(j.nb || 0) > 1 ? "s" : ""}).` });
        } catch (err) {
          repondre(m.id, { ok: false, msg: (err as Error).message.slice(0, 200) });
        }
      } else if (m.type === "emua-erreur" && typeof m.message === "string") {
        setErreur(m.message.slice(0, 200));
        setEtat("erreur");
      }
    }
    window.addEventListener("message", recevoir);
    return () => window.removeEventListener("message", recevoir);
  }, []);

  async function creerBrouillon() {
    if (!liste) return;
    setBrouillon("en-cours");
    try {
      const r = await fetch(`/api/listes-achat/${liste.id}/brouillon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cree_par: utilisateur() }),
      });
      const j = (await r.json()) as { editUrl?: string; error?: string };
      if (!r.ok || !j.editUrl) throw new Error(j.error || "Erreur");
      window.open(j.editUrl, "_blank", "noopener,noreferrer");
      setBrouillon("");
      setListe(null);
    } catch {
      setBrouillon("erreur");
    }
  }

  const sombre = theme === "dark";

  return (
    <div ref={boiteRef} style={{ padding: "1rem 1.25rem 1.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: ".75rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>🪑 Accords couleurs EMU</h1>
          <p style={{ margin: ".25rem 0 0", opacity: 0.7, fontSize: ".92rem" }}>
            Même outil que sur jardin-confort.ch. Composez l&apos;ensemble, puis « Créer une liste d&apos;achat » et le brouillon d&apos;offre.
          </p>
        </div>
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center", fontSize: ".85rem", opacity: 0.8 }}>
          {lu && <span>Données Shopify : {new Date(lu).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" })}</span>}
          <button type="button" className="v2-btn" onClick={relire} title="Relire les articles EMU dans Shopify (vide l'ensemble en cours)">
            ↻ Actualiser
          </button>
          <a className="v2-btn" href="https://www.jardin-confort.ch/pages/configurateur-emu-couleur" target="_blank" rel="noopener noreferrer">
            Ouvrir sur le site ↗
          </a>
        </div>
      </div>

      {liste && (
        <div style={{ background: sombre ? "#1f3a26" : "#e7f3e8", color: sombre ? "#7fd18b" : "#1f5c24", borderRadius: 8, padding: ".7rem 1rem", marginBottom: ".75rem", display: "flex", gap: ".6rem", alignItems: "center", flexWrap: "wrap" }}>
          <span>
            ✓ Liste d&apos;achat créée : <b>{liste.nom}</b> ({liste.nb} article{liste.nb > 1 ? "s" : ""}).
          </span>
          <button type="button" className="v2-btn" onClick={creerBrouillon} disabled={brouillon === "en-cours"}>
            {brouillon === "en-cours" ? "…" : "Créer le brouillon →"}
          </button>
          <a className="v2-btn" href="/v2/listes-achat">Voir les listes d&apos;achat</a>
          {brouillon === "erreur" && <span style={{ color: sombre ? "#f28b82" : "#b3261e" }}>Brouillon impossible — réessayez depuis les listes d&apos;achat.</span>}
          <button type="button" className="v2-btn" onClick={() => setListe(null)} aria-label="Fermer">✕</button>
        </div>
      )}
      {etat === "chargement" && <p style={{ opacity: 0.7 }}>Chargement des articles EMU depuis Shopify…</p>}
      {etat === "erreur" && (
        <div style={{ background: sombre ? "#432220" : "#fbe5e3", color: sombre ? "#f28b82" : "#b3261e", borderRadius: 8, padding: ".8rem 1rem" }}>
          {erreur}{" "}
          <button type="button" className="v2-btn" onClick={relire}>
            Réessayer
          </button>
        </div>
      )}

      {doc && (
        <iframe
          key={essai}
          ref={frameRef}
          title="Accords couleurs EMU"
          srcDoc={doc}
          // allow-scripts SANS allow-same-origin : origine opaque, aucun accès au formulaire.
          // allow-popups(+escape) : les fiches produit s'ouvrent normalement sur jardin-confort.ch.
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          onLoad={() => frameRef.current?.contentWindow?.postMessage({ type: "emua-theme", theme: themeRef.current }, "*")}
          style={{
            display: etat === "pret" ? "block" : "none",
            width: "100%",
            height: "calc(100vh - 170px)",
            minHeight: 620,
            border: 0,
            background: sombre ? "#1c1f24" : "#fff",
            colorScheme: sombre ? "dark" : "light",
            borderRadius: 12,
            boxShadow: "0 1px 3px rgba(0,0,0,.08)",
          }}
        />
      )}
    </div>
  );
}
