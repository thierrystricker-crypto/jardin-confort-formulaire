"use client";
// app/v2/housses/HoussesApp.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Monte l'app « Trouver ma housse » du thème Shopify dans la coquille v2.
//
//   1. GET /api/housses → housses (mêmes données que la page du site) + adresses
//      CDN du JS et du CSS du thème publié ;
//   2. l'app tourne dans un IFRAME ISOLÉ (sandbox="allow-scripts", SANS
//      allow-same-origin) : le code venu du thème Shopify s'exécute dans une
//      origine opaque — aucun accès aux cookies du formulaire, ni à ses API, ni
//      à la page autour. Une CSP interdit en plus toute requête réseau
//      (connect-src 'none') et ne laisse charger que le CDN de la boutique ;
//   3. dialogue par postMessage, dans un seul sens utile :
//        iframe → page : { type: "tmh-pick", sku } (copier le N°)
//                        { type: "tmh-hauteur", h } (hauteur du contenu)
//      La page n'exécute jamais rien de ce que l'iframe envoie : elle vérifie
//      la source, le type, et ne lit qu'un texte court.
//
// Rien à maintenir ici quand l'app évolue : on corrige le thème, on publie,
// le formulaire suit (cache 5 min côté /api/housses).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";

type Payload = {
  data: unknown[];
  glatz: unknown[];
  sunc: unknown[];
  js: string;
  css: string;
  base: string;
  lu: string;
  error?: string;
};

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
function documentIframe(p: Payload): string {
  const sources = Array.from(
    new Set([origine(p.js), origine(p.css), origine(p.base), "https://cdn.shopify.com"].filter(Boolean)),
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
  const donnees = jsonPourScript({ data: p.data, glatz: p.glatz, sunc: p.sunc, base: p.base });
  return `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attr(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${attr(p.css)}">
<style>
  html,body{margin:0;background:#fff}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#2b2b2b}
  #app{padding:16px 20px 24px}
</style>
</head><body>
<div id="app" class="tmh tmh--alone"></div>
<script>window.__TMH_DONNEES = ${donnees};</script>
<script src="${attr(p.js)}"></script>
<script>
(function () {
  var parent = window.parent;
  var D = window.__TMH_DONNEES;
  if (!window.TMH) { parent.postMessage({ type: "tmh-erreur", message: "Script de l'app housses non initialisé (thème < v1.8 ?)" }, "*"); return; }
  window.TMH.mount(document.getElementById("app"), {
    data: D.data, glatz: D.glatz, sunc: D.sunc, base: D.base, history: false,
    pick: { label: "📋 Copier le N°", fn: function (h) {
      if (!h.sku) return "Pas de N°";
      parent.postMessage({ type: "tmh-pick", sku: String(h.sku).slice(0, 64) }, "*");
      return "✓ " + h.sku + " copié";
    } }
  });
  var dernier = 0;
  function hauteur() {
    var h = Math.ceil(document.body.getBoundingClientRect().height) + 4;
    if (Math.abs(h - dernier) > 2) { dernier = h; parent.postMessage({ type: "tmh-hauteur", h: h }, "*"); }
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

export default function HoussesApp() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [etat, setEtat] = useState<"chargement" | "pret" | "erreur">("chargement");
  const [erreur, setErreur] = useState("");
  const [lu, setLu] = useState("");
  const [doc, setDoc] = useState("");
  const [hauteur, setHauteur] = useState(900);
  const [aCopier, setACopier] = useState(""); // N° à copier à la main si le presse-papiers refuse
  const [essai, setEssai] = useState(0);

  const relire = () => {
    setEtat("chargement");
    setEssai((n) => n + 1);
  };

  // 1. Données + adresses du code du thème
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await fetch("/api/housses" + (essai ? "?frais=1" : ""), { cache: "no-store" });
        const p = (await res.json()) as Payload;
        if (!res.ok || p.error) throw new Error(p.error || "Erreur " + res.status);
        if (!/^https:\/\//.test(p.js) || !/^https:\/\//.test(p.css)) throw new Error("Adresses du thème invalides");
        if (annule) return;
        setDoc(documentIframe(p));
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

  // 2. Messages de l'iframe (seule source acceptée : notre iframe)
  useEffect(() => {
    function recevoir(e: MessageEvent) {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const m = e.data as { type?: unknown; sku?: unknown; h?: unknown; message?: unknown };
      if (!m || typeof m !== "object") return;
      if (m.type === "tmh-hauteur" && typeof m.h === "number" && isFinite(m.h)) {
        setHauteur(Math.max(400, Math.min(20000, Math.round(m.h))));
      } else if (m.type === "tmh-pick" && typeof m.sku === "string") {
        const sku = m.sku.slice(0, 64);
        void copier(sku).then((ok) => setACopier(ok ? "" : sku));
      } else if (m.type === "tmh-erreur" && typeof m.message === "string") {
        setErreur(m.message.slice(0, 200));
        setEtat("erreur");
      }
    }
    window.addEventListener("message", recevoir);
    return () => window.removeEventListener("message", recevoir);
  }, []);

  return (
    <div style={{ padding: "1rem 1.25rem 3rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: ".75rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>🛡 Trouver une housse</h1>
          <p style={{ margin: ".25rem 0 0", opacity: 0.7, fontSize: ".92rem" }}>
            Même outil que sur jardin-confort.ch. « Copier le N° » puis collez-le dans la recherche d&apos;articles de l&apos;offre.
          </p>
        </div>
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center", fontSize: ".85rem", opacity: 0.8 }}>
          {lu && <span>Données Shopify : {new Date(lu).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" })}</span>}
          <button type="button" className="v2-btn" onClick={relire} title="Relire les housses dans Shopify">
            ↻ Actualiser
          </button>
          <a className="v2-btn" href="https://www.jardin-confort.ch/pages/trouver-ma-housse" target="_blank" rel="noopener noreferrer">
            Ouvrir sur le site ↗
          </a>
        </div>
      </div>

      {aCopier && (
        <div style={{ background: "#fdf1dc", color: "#9a5b00", borderRadius: 8, padding: ".6rem 1rem", marginBottom: ".75rem" }}>
          Copie automatique refusée par le navigateur — N° d&apos;article : <b style={{ userSelect: "all" }}>{aCopier}</b>{" "}
          <button type="button" className="v2-btn" onClick={() => setACopier("")}>OK</button>
        </div>
      )}
      {etat === "chargement" && <p style={{ opacity: 0.7 }}>Chargement des housses depuis Shopify…</p>}
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
          title="Trouver une housse"
          srcDoc={doc}
          // allow-scripts SANS allow-same-origin : origine opaque, aucun accès au formulaire.
          // allow-popups(+escape) : « Voir l'article » ouvre la fiche jardin-confort.ch normalement.
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          style={{
            display: etat === "pret" ? "block" : "none",
            width: "100%",
            height: hauteur,
            border: 0,
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 1px 3px rgba(0,0,0,.08)",
          }}
        />
      )}
    </div>
  );
}
