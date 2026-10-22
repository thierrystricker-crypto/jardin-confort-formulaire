"use client";
// app/v2/toiles/ToilesApp.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Monte le nuancier « Toiles Glatz » du thème Shopify dans la coquille v2
// (même principe que « Trouver une housse » et « Configurateur parasol »).
//
//   1. GET /api/toiles → adresses CDN du JS, du CSS et des données du thème
//      publié + best-sellers + textes de la section ;
//   2. l'app tourne dans un IFRAME ISOLÉ (sandbox sans allow-same-origin) :
//      origine opaque, aucun accès aux cookies ni aux API du formulaire ; CSP
//      sans réseau (connect-src 'none'), scripts/styles limités au CDN Shopify ;
//   3. dialogue par postMessage :
//        iframe → page : { type: "tgz-sel", c, n }      toile choisie (N° + nom)
//                        { type: "tgz-copy", texte }   lien « Copier le lien » de l'app
//                        { type: "tgz-hauteur", h }    hauteur du contenu
//                        { type: "tgz-erreur", message }
//        page → iframe : { type: "tgz-theme", theme }  clair / sombre
//                        { type: "tgz-choisir", c }    afficher une toile
//      La page vérifie la source et le format, et n'exécute rien de ce qu'elle reçoit.
//
// En plus du site : une « sélection pour le client » (plusieurs toiles → un lien
// …/pages/toiles-glatz?toile=684,686,527 à coller dans un mail ou une offre).
// Rien à maintenir ici quand l'app évolue : on corrige le thème, on publie.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

type Theme = "light" | "dark";

function themeV2(el: Element | null): Theme {
  const r = el?.closest("[data-theme]");
  return r?.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

type Payload = {
  js: string;
  css: string;
  data: string;
  reco: string[];
  txt: Record<string, unknown>;
  v: string;
  base: string;
  page: string;
  lu: string;
  error?: string;
};

type Toile = { c: string; n: string };

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

// Mode sombre (uniquement dans le formulaire : le site reste clair).
// Les photos de toile, le parasol et le bandeau gardent leurs vraies couleurs.
const CSS_SOMBRE = `
html[data-theme="dark"],html[data-theme="dark"] body{background:#1c1f24;color:#e6e6e6;color-scheme:dark}
html[data-theme="dark"] .tgz{--tgz-ink:#e8e6e1;--tgz-mute:#a3a8b0;--tgz-line:#3a4049;--tgz-soft:#262a31;--tgz-chip:#2d3239;--tgz-ok:#7fd18b;--tgz-bad:#f28b82;color:#e6e6e6}
html[data-theme="dark"] .tgz-fiche,html[data-theme="dark"] .tgz-seg,html[data-theme="dark"] .tgz-seg button,html[data-theme="dark"] .tgz-search-box,html[data-theme="dark"] .tgz-rond,html[data-theme="dark"] .tgz-mods a,html[data-theme="dark"] .tgz-fam,html[data-theme="dark"] .tgz-opt,html[data-theme="dark"] .tgz-reco-c,html[data-theme="dark"] .tgz-btn,html[data-theme="dark"] .tgz-carte{background:#22262c;border-color:#3a4049}
html[data-theme="dark"] .tgz-search-box{border-color:#a3a8b0}
html[data-theme="dark"] .tgz-seg button[aria-pressed="true"],html[data-theme="dark"] .tgz-opt[aria-pressed="true"],html[data-theme="dark"] .tgz-btn--pri,html[data-theme="dark"] .tgz-opt[data-k="reco"][aria-pressed="true"]{background:#e8e6e1;color:#1c1f24;border-color:#e8e6e1}
html[data-theme="dark"] .tgz-btn--pri:hover{color:#1c1f24}
html[data-theme="dark"] .tgz-fam[aria-pressed="true"]{background:#2d3239;border-color:#e8e6e1}
html[data-theme="dark"] .tgz-roue-lab span,html[data-theme="dark"] .tgz-chips span,html[data-theme="dark"] .tgz-lien code,html[data-theme="dark"] .tgz-reco-t li,html[data-theme="dark"] .tgz-carte-m,html[data-theme="dark"] .tgz-sec > p{color:#cfd2d6}
html[data-theme="dark"] .tgz-chips .is-qs,html[data-theme="dark"] .tgz-selban{background:#1f3a26;color:#7fd18b}
html[data-theme="dark"] .tgz-chips .is-del{background:#3d2a1a;color:#f0b35a}
html[data-theme="dark"] .tgz-reco{background:#2f2a20}
html[data-theme="dark"] .tgz-opt[data-k="reco"]{background:#2f2a20;border-color:#5a4a2c}
html[data-theme="dark"] .tgz-badge,html[data-theme="dark"] .tgz-apercu,html[data-theme="dark"] .tgz-hors{color:#1d1d1b}
html[data-theme="dark"] .tgz-hors{color:#8a2a12}
html[data-theme="dark"] .tgz-specs,html[data-theme="dark"] .tgz-sens,html[data-theme="dark"] .tgz-filtres,html[data-theme="dark"] .tgz-sec{border-color:#3a4049}
html[data-theme="dark"] .tgz-sens-v b[style*="e3dfd8"]{background:#3a4049!important}
html[data-theme="dark"] .tgz-roue svg circle:first-of-type{fill:#3a4049}
`;

// Document complet de l'iframe (srcdoc).
function documentIframe(p: Payload, theme: Theme): string {
  const sources = Array.from(
    new Set([origine(p.js), origine(p.css), origine(p.data), origine(p.base), "https://cdn.shopify.com"].filter(Boolean)),
  ).join(" ");
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
  const opts = jsonPourScript({ base: p.base, page: p.page, reco: p.reco, txt: p.txt });
  return `<!doctype html>
<html lang="fr" data-theme="${theme}"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attr(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${attr(p.css)}">
<style>
  html,body{margin:0;background:#fff}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1d1d1b}
  #app{padding:16px 20px 24px}
${CSS_SOMBRE}
</style>
</head><body>
<div id="app"></div>
<script>window.__TGZ_OPTS = ${opts};</script>
<script src="${attr(p.data)}"></script>
<script src="${attr(p.js)}"></script>
<script>
(function () {
  var parent = window.parent;
  var O = window.__TGZ_OPTS;
  if (!window.TGZ || !window.TGZ_DATA) { parent.postMessage({ type: "tgz-erreur", message: "Script du nuancier non initialisé" }, "*"); return; }
  var app = document.getElementById("app");
  var api = window.TGZ.mount(app, {
    data: window.TGZ_DATA, root: "/", base: O.base, page: O.page, history: false, target: "_blank",
    reco: O.reco, txt: O.txt,
    copy: function (t) { parent.postMessage({ type: "tgz-copy", texte: String(t).slice(0, 300) }, "*"); }
  });
  // toile choisie : la case encadrée de la grille (l'app la tient à jour)
  var derniere = "";
  function envoyerSel() {
    var b = app.querySelector(".tgz-carre.is-on");
    if (!b) return;
    var c = b.getAttribute("data-c") || "";
    if (c === derniere) return;
    derniere = c;
    var n = (b.querySelector(".tgz-carre-n") || {}).textContent || "";
    parent.postMessage({ type: "tgz-sel", c: c.slice(0, 8), n: n.slice(0, 60) }, "*");
  }
  new MutationObserver(envoyerSel).observe(app, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });
  envoyerSel();
  // messages de la page (seule source acceptée : la page parente)
  window.addEventListener("message", function (e) {
    if (e.source !== parent || !e.data) return;
    if (e.data.type === "tgz-theme") document.documentElement.setAttribute("data-theme", e.data.theme === "dark" ? "dark" : "light");
    else if (e.data.type === "tgz-choisir" && /^\\d{2,4}$/.test(String(e.data.c)) && api.select) api.select(String(e.data.c));
  });
  var dernier = 0;
  function hauteur() {
    var h = Math.ceil(document.body.getBoundingClientRect().height) + 4;
    if (Math.abs(h - dernier) > 2) { dernier = h; parent.postMessage({ type: "tgz-hauteur", h: h }, "*"); }
  }
  new ResizeObserver(hauteur).observe(document.body);
  hauteur();
})();
</script>
</body></html>`;
}

async function copier(texte: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    return false;
  }
}

export default function ToilesApp() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boiteRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const themeRef = useRef<Theme>("light");
  const [etat, setEtat] = useState<"chargement" | "pret" | "erreur">("chargement");
  const [erreur, setErreur] = useState("");
  const [lu, setLu] = useState("");
  const [doc, setDoc] = useState("");
  const [base, setBase] = useState("https://www.jardin-confort.ch");
  const [page, setPage] = useState("toiles-glatz");
  const [hauteur, setHauteur] = useState(1600);
  const [essai, setEssai] = useState(0);
  const [courante, setCourante] = useState<Toile | null>(null);
  const [selection, setSelection] = useState<Toile[]>([]);
  const [message, setMessage] = useState(""); // « ✓ copié » ou texte à copier à la main
  const [aCopier, setACopier] = useState("");
  const baseRef = useRef(base);
  const pageRef = useRef(page);

  const lienPage = base + "/pages/" + page;
  const lienSelection = selection.length ? lienPage + "?toile=" + selection.map((t) => t.c).join(",") : "";

  const relire = () => {
    setEtat("chargement");
    setEssai((n) => n + 1);
  };

  async function copierTexte(texte: string, quoi: string) {
    const ok = await copier(texte);
    setACopier(ok ? "" : texte);
    setMessage(ok ? "✓ " + quoi + " copié" : "");
    if (ok) setTimeout(() => setMessage(""), 2000);
  }

  // 1. Adresses du code du thème + réglages de la section
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await fetch("/api/toiles" + (essai ? "?frais=1" : ""), { cache: "no-store" });
        const p = (await res.json()) as Payload;
        if (!res.ok || p.error) throw new Error(p.error || "Erreur " + res.status);
        if (![p.js, p.css, p.data].every((u) => /^https:\/\//.test(u))) throw new Error("Adresses du thème invalides");
        if (annule) return;
        baseRef.current = p.base;
        pageRef.current = p.page;
        setBase(p.base);
        setPage(p.page);
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

  // Suit le bouton clair/sombre de la v2 (sans recharger l'app)
  useEffect(() => {
    const racine = boiteRef.current?.closest("[data-theme]");
    const appliquer = () => {
      const t = themeV2(boiteRef.current);
      themeRef.current = t;
      setTheme(t);
      frameRef.current?.contentWindow?.postMessage({ type: "tgz-theme", theme: t }, "*");
    };
    appliquer();
    if (!racine) return;
    const obs = new MutationObserver(appliquer);
    obs.observe(racine, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // 2. Messages de l'iframe (seule source acceptée : notre iframe)
  useEffect(() => {
    function recevoir(e: MessageEvent) {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const m = e.data as { type?: unknown; h?: unknown; c?: unknown; n?: unknown; texte?: unknown; message?: unknown };
      if (!m || typeof m !== "object") return;
      if (m.type === "tgz-hauteur" && typeof m.h === "number" && isFinite(m.h)) {
        setHauteur(Math.max(600, Math.min(30000, Math.round(m.h))));
      } else if (m.type === "tgz-sel" && typeof m.c === "string" && /^\d{2,4}$/.test(m.c)) {
        setCourante({ c: m.c, n: typeof m.n === "string" ? m.n.slice(0, 60) : "" });
      } else if (m.type === "tgz-copy" && typeof m.texte === "string") {
        // seul un lien vers notre page de toiles est accepté
        const t = m.texte.slice(0, 300);
        const debut = baseRef.current + "/pages/" + pageRef.current + "?toile=";
        if (t.startsWith(debut) && /^[\d,]+$/.test(t.slice(debut.length))) void copierTexte(t, "Lien");
      } else if (m.type === "tgz-erreur" && typeof m.message === "string") {
        setErreur(m.message.slice(0, 200));
        setEtat("erreur");
      }
    }
    window.addEventListener("message", recevoir);
    return () => window.removeEventListener("message", recevoir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dansSel = courante ? selection.some((t) => t.c === courante.c) : false;
  const sombre = theme === "dark";
  const barre: CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 5,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".5rem .75rem",
    padding: ".6rem .9rem",
    marginBottom: ".75rem",
    borderRadius: 10,
    background: sombre ? "#262a31" : "#f6efe2",
    boxShadow: "0 1px 3px rgba(0,0,0,.08)",
    fontSize: ".9rem",
  };
  const pastille: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: ".3rem",
    padding: ".2rem .3rem .2rem .6rem",
    borderRadius: 999,
    background: sombre ? "#22262c" : "#fff",
    border: "1px solid " + (sombre ? "#3a4049" : "#e0d6c2"),
    fontWeight: 600,
  };

  return (
    <div ref={boiteRef} style={{ padding: "1rem 1.25rem 3rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: ".75rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>🎨 Toiles Glatz</h1>
          <p style={{ margin: ".25rem 0 0", opacity: 0.7, fontSize: ".92rem" }}>
            Même nuancier que sur jardin-confort.ch. Ajoutez des toiles à la sélection puis copiez le lien pour le client.
          </p>
        </div>
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center", fontSize: ".85rem", opacity: 0.8 }}>
          {lu && <span>Données Shopify : {new Date(lu).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" })}</span>}
          <button type="button" className="v2-btn" onClick={relire} title="Relire le nuancier dans Shopify">
            ↻ Actualiser
          </button>
          <a className="v2-btn" href={courante ? lienPage + "?toile=" + courante.c : lienPage} target="_blank" rel="noopener noreferrer">
            Ouvrir sur le site ↗
          </a>
        </div>
      </div>

      {etat === "pret" && (
        <div style={barre}>
          {courante ? (
            <>
              <span>
                Toile affichée : <b style={{ fontSize: "1.1rem" }}>N° {courante.c}</b> {courante.n}
              </span>
              <button type="button" className="v2-btn" onClick={() => void copierTexte(courante.c, "N°")}>
                📋 Copier le N°
              </button>
              <button
                type="button"
                className="v2-btn"
                disabled={dansSel || selection.length >= 12}
                onClick={() => setSelection((s) => (s.some((t) => t.c === courante.c) ? s : [...s, courante]))}
              >
                {dansSel ? "✓ Dans la sélection" : "＋ Ajouter à la sélection"}
              </button>
            </>
          ) : (
            <span style={{ opacity: 0.7 }}>Choisissez une toile sur le parasol ou dans la grille.</span>
          )}
          <span style={{ flexBasis: "100%", height: 0 }} />
          <span style={{ fontWeight: 600 }}>Sélection pour le client{selection.length ? ` (${selection.length})` : ""} :</span>
          {selection.length === 0 && <span style={{ opacity: 0.7 }}>vide</span>}
          {selection.map((t) => (
            <span key={t.c} style={pastille} title={t.n}>
              <button
                type="button"
                onClick={() => frameRef.current?.contentWindow?.postMessage({ type: "tgz-choisir", c: t.c }, "*")}
                style={{ border: 0, background: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}
                title={"Afficher " + t.c + " " + t.n}
              >
                {t.c}
              </button>
              <button
                type="button"
                aria-label={"Retirer " + t.c}
                onClick={() => setSelection((s) => s.filter((x) => x.c !== t.c))}
                style={{ border: 0, background: "none", padding: "0 .3rem", cursor: "pointer", color: "inherit", opacity: 0.6 }}
              >
                ×
              </button>
            </span>
          ))}
          {selection.length > 0 && (
            <>
              <button type="button" className="v2-btn" onClick={() => void copierTexte(lienSelection, "Lien de la sélection")}>
                🔗 Copier le lien
              </button>
              <a className="v2-btn" href={lienSelection} target="_blank" rel="noopener noreferrer">
                Voir ↗
              </a>
              <button type="button" className="v2-btn" onClick={() => setSelection([])}>
                Vider
              </button>
            </>
          )}
          {message && <span style={{ color: sombre ? "#7fd18b" : "#1f5a43", fontWeight: 600 }}>{message}</span>}
        </div>
      )}

      {aCopier && (
        <div style={{ background: "#fdf1dc", color: "#9a5b00", borderRadius: 8, padding: ".6rem 1rem", marginBottom: ".75rem", wordBreak: "break-all" }}>
          Copie automatique refusée par le navigateur — à copier : <b style={{ userSelect: "all" }}>{aCopier}</b>{" "}
          <button type="button" className="v2-btn" onClick={() => setACopier("")}>OK</button>
        </div>
      )}
      {etat === "chargement" && <p style={{ opacity: 0.7 }}>Chargement du nuancier depuis Shopify…</p>}
      {etat === "erreur" && (
        <div style={{ background: "#fbe5e3", color: "#b3261e", borderRadius: 8, padding: ".8rem 1rem" }}>
          {erreur}{" "}
          <button type="button" className="v2-btn" onClick={relire}>
            Réessayer
          </button>
        </div>
      )}

      {doc && (
        <iframe
          ref={frameRef}
          title="Toiles Glatz"
          srcDoc={doc}
          // allow-scripts SANS allow-same-origin : origine opaque, aucun accès au formulaire.
          // allow-popups(+escape) : les liens (fiches parasol, configurateur, housses) s'ouvrent sur jardin-confort.ch.
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          onLoad={() => frameRef.current?.contentWindow?.postMessage({ type: "tgz-theme", theme: themeRef.current }, "*")}
          style={{
            display: etat === "pret" ? "block" : "none",
            width: "100%",
            height: hauteur,
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
