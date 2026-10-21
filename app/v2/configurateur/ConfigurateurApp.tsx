"use client";
// app/v2/configurateur/ConfigurateurApp.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Monte le configurateur de parasols Glatz du thème Shopify dans la coquille v2
// (21.10.2026). Même principe que « Trouver une housse » (HoussesApp.tsx) :
//
//   1. GET /api/configurateur → données de la section (modèles, réglages, format
//      de prix) + adresses CDN du code du thème publié (JS, données, CSS) ;
//   2. l'app tourne dans un IFRAME ISOLÉ (sandbox="allow-scripts", SANS
//      allow-same-origin) : origine opaque, aucun accès aux cookies du formulaire,
//      à ses API ni à la page autour. CSP : aucune requête réseau (connect-src 'none'),
//      scripts et styles limités au CDN de la boutique ;
//   3. dialogue par postMessage. L'iframe DEMANDE, la page décide :
//        cfgp-get     { id, path }    → la page relaie par /api/configurateur/shopify,
//                                       qui n'accepte que les 2 lectures publiques de l'app ;
//        cfgp-liste   { id, payload } → POST /api/configurateur/liste (articles relus chez Shopify) ;
//        cfgp-copy    { text }        → presse-papiers ;
//        cfgp-scroll  { y, mode }     → défilement de la page ;
//        cfgp-hauteur { h }           → hauteur de l'iframe.
//      Réponses : cfgp-reponse { id, ok, text | msg }.
//
// Rien à maintenir ici quand l'app évolue : on corrige le thème, on publie,
// le formulaire suit (cache 5 min côté /api/configurateur).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { CLE_UTILISATEUR, normaliserMembre } from "@/lib/jardi-equipe";

type Payload = {
  models: Record<string, unknown>;
  cfg: Record<string, unknown>;
  shop: Record<string, unknown>;
  js: string;
  data: string;
  css: string;
  v: string;
  base: string;
  lu: string;
  error?: string;
};

type ListeCreee = { id: string; nom: string; nb: number };

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
    new Set([origine(p.js), origine(p.data), origine(p.css), "https://cdn.shopify.com"].filter(Boolean)),
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
  const donnees = jsonPourScript({ models: p.models, cfg: p.cfg, shop: p.shop, base: p.base });
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
  h1,h2,h3,p{margin-top:0}
</style>
</head><body>
<div id="app" class="cfgp"></div>
<script>window.CFGP_NOAUTO = true; window.__CFGP_DONNEES = ${donnees};</script>
<script src="${attr(p.data)}"></script>
<script src="${attr(p.js)}"></script>
<script>
(function () {
  var parent = window.parent, D = window.__CFGP_DONNEES, n = 0, attente = {};
  if (!window.CFGP || !window.CFGP.mount || !window.CFGP_DATA) {
    parent.postMessage({ type: "cfgp-erreur", message: "Configurateur non initialisé (thème < v1.6 ?)" }, "*"); return;
  }
  function demander(type, extra) {
    return new Promise(function (ok) {
      var id = ++n; attente[id] = ok;
      var m = { type: type, id: id }; for (var k in extra) m[k] = extra[k];
      parent.postMessage(m, "*");
    });
  }
  window.addEventListener("message", function (e) {
    if (e.source !== parent || !e.data || e.data.type !== "cfgp-reponse") return;
    var f = attente[e.data.id]; if (!f) return;
    delete attente[e.data.id]; f(e.data);
  });
  window.CFGP.mount(document.getElementById("app"), {
    shop: D.shop, models: D.models, cfg: D.cfg, base: D.base, data: window.CFGP_DATA,
    get: function (path) { return demander("cfgp-get", { path: String(path).slice(0, 400) }).then(function (r) { return r.ok ? r.text : null; }); },
    liste: function (payload) { return demander("cfgp-liste", { payload: payload }).then(function (r) { return { ok: !!r.ok, msg: r.msg }; }); },
    copy: function (t) { parent.postMessage({ type: "cfgp-copy", text: String(t).slice(0, 4000) }, "*"); },
    scroll: function (y, mode) { parent.postMessage({ type: "cfgp-scroll", y: +y || 0, mode: mode === "reveal" ? "reveal" : "go" }, "*"); }
  });
  var dernier = 0;
  function hauteur() {
    var h = Math.ceil(document.body.getBoundingClientRect().height) + 4;
    if (Math.abs(h - dernier) > 2) { dernier = h; parent.postMessage({ type: "cfgp-hauteur", h: h }, "*"); }
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

// Conteneur qui défile autour de l'iframe (la coquille v2 peut défiler dans un <main>)
function conteneurDefilant(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null;
  while (p) {
    const s = getComputedStyle(p).overflowY;
    if ((s === "auto" || s === "scroll") && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return null;
}

export default function ConfigurateurApp() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [etat, setEtat] = useState<"chargement" | "pret" | "erreur">("chargement");
  const [erreur, setErreur] = useState("");
  const [lu, setLu] = useState("");
  const [doc, setDoc] = useState("");
  const [hauteur, setHauteur] = useState(1200);
  const [essai, setEssai] = useState(0);
  const [liste, setListe] = useState<ListeCreee | null>(null);
  const [brouillon, setBrouillon] = useState<"" | "en-cours" | "erreur">("");
  const [aCopier, setACopier] = useState("");
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
        const res = await fetch("/api/configurateur" + (essai ? "?frais=1" : ""), { cache: "no-store" });
        const p = (await res.json()) as Payload;
        if (!res.ok || p.error) throw new Error(p.error || "Erreur " + res.status);
        if (![p.js, p.data, p.css].every((u) => /^https:\/\//.test(u))) throw new Error("Adresses du thème invalides");
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
    function repondre(id: unknown, data: Record<string, unknown>) {
      if (typeof id !== "number") return;
      frameRef.current?.contentWindow?.postMessage({ type: "cfgp-reponse", id, ...data }, "*");
    }
    async function recevoir(e: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const m = e.data as Record<string, unknown>;
      if (!m || typeof m !== "object") return;

      if (m.type === "cfgp-hauteur" && typeof m.h === "number" && isFinite(m.h)) {
        setHauteur(Math.max(500, Math.min(40000, Math.round(m.h))));
      } else if (m.type === "cfgp-get" && typeof m.path === "string") {
        try {
          const r = await fetch("/api/configurateur/shopify?p=" + encodeURIComponent(m.path.slice(0, 400)), { cache: "no-store" });
          repondre(m.id, r.ok ? { ok: true, text: await r.text() } : { ok: false });
        } catch {
          repondre(m.id, { ok: false });
        }
      } else if (m.type === "cfgp-liste" && m.payload && typeof m.payload === "object") {
        if (Date.now() - dernierEnvoi.current < 3000) {
          repondre(m.id, { ok: false, msg: "Un instant…" });
          return;
        }
        dernierEnvoi.current = Date.now();
        try {
          const r = await fetch("/api/configurateur/liste", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...(m.payload as Record<string, unknown>), cree_par: utilisateur() }),
          });
          const j = (await r.json()) as { id?: string; nom?: string; nb?: number; error?: string };
          if (!r.ok || !j.id) throw new Error(j.error || "Erreur " + r.status);
          setListe({ id: j.id, nom: j.nom || "", nb: j.nb || 0 });
          setBrouillon("");
          window.scrollTo({ top: 0, behavior: "smooth" });
          conteneurDefilant(frame)?.scrollTo({ top: 0, behavior: "smooth" });
          repondre(m.id, { ok: true, msg: `✓ Liste d'achat créée : « ${j.nom} » (${j.nb} article${(j.nb || 0) > 1 ? "s" : ""}).` });
        } catch (err) {
          repondre(m.id, { ok: false, msg: (err as Error).message.slice(0, 200) });
        }
      } else if (m.type === "cfgp-copy" && typeof m.text === "string") {
        const t = m.text.slice(0, 4000);
        void copier(t).then((ok) => setACopier(ok ? "" : t));
      } else if (m.type === "cfgp-scroll" && typeof m.y === "number" && isFinite(m.y)) {
        const box = conteneurDefilant(frame);
        const fr = frame.getBoundingClientRect();
        const haut = box ? box.getBoundingClientRect().top : 0;
        const hVue = box ? box.clientHeight : window.innerHeight;
        const pos = fr.top - haut + m.y; // position de la cible dans la zone visible
        if (m.mode === "reveal" && pos > 60 && pos < hVue - 140) return;
        const cible = (box ? box.scrollTop : window.scrollY) + pos - 70;
        (box || window).scrollTo({ top: Math.max(0, cible), behavior: "smooth" });
      } else if (m.type === "cfgp-erreur" && typeof m.message === "string") {
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

  return (
    <div style={{ padding: "1rem 1.25rem 3rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: ".75rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>☂ Configurateur parasol Glatz</h1>
          <p style={{ margin: ".25rem 0 0", opacity: 0.7, fontSize: ".92rem" }}>
            Même outil que sur jardin-confort.ch. En fin de parcours : « Créer une liste d&apos;achat », puis le brouillon d&apos;offre.
          </p>
        </div>
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center", fontSize: ".85rem", opacity: 0.8 }}>
          {lu && <span>Données Shopify : {new Date(lu).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" })}</span>}
          <button type="button" className="v2-btn" onClick={relire} title="Relire le configurateur dans Shopify (recommence la configuration)">
            ↻ Actualiser
          </button>
          <a className="v2-btn" href="https://www.jardin-confort.ch/pages/configurer-mon-parasol" target="_blank" rel="noopener noreferrer">
            Ouvrir sur le site ↗
          </a>
        </div>
      </div>

      {liste && (
        <div style={{ background: "#e7f3e8", color: "#1f5c24", borderRadius: 8, padding: ".7rem 1rem", marginBottom: ".75rem", display: "flex", gap: ".6rem", alignItems: "center", flexWrap: "wrap" }}>
          <span>
            ✓ Liste d&apos;achat créée : <b>{liste.nom}</b> ({liste.nb} article{liste.nb > 1 ? "s" : ""}).
          </span>
          <button type="button" className="v2-btn" onClick={creerBrouillon} disabled={brouillon === "en-cours"}>
            {brouillon === "en-cours" ? "…" : "Créer le brouillon →"}
          </button>
          <a className="v2-btn" href="/v2/listes-achat">Voir les listes d&apos;achat</a>
          {brouillon === "erreur" && <span style={{ color: "#b3261e" }}>Brouillon impossible — réessayez depuis les listes d&apos;achat.</span>}
          <button type="button" className="v2-btn" onClick={() => setListe(null)} aria-label="Fermer">✕</button>
        </div>
      )}
      {aCopier && (
        <div style={{ background: "#fdf1dc", color: "#9a5b00", borderRadius: 8, padding: ".6rem 1rem", marginBottom: ".75rem" }}>
          Copie automatique refusée par le navigateur — sélectionnez le texte :
          <textarea readOnly value={aCopier} style={{ display: "block", width: "100%", height: 160, marginTop: ".4rem", fontFamily: "inherit" }} />
          <button type="button" className="v2-btn" onClick={() => setACopier("")}>OK</button>
        </div>
      )}
      {etat === "chargement" && <p style={{ opacity: 0.7 }}>Chargement du configurateur depuis Shopify…</p>}
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
          key={essai}
          ref={frameRef}
          title="Configurateur parasol Glatz"
          srcDoc={doc}
          // allow-scripts SANS allow-same-origin : origine opaque, aucun accès au formulaire.
          // allow-popups(+escape) : le lien de la fiche parasol s'ouvre normalement sur jardin-confort.ch.
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          style={{
            display: etat === "pret" ? "block" : "none",
            width: "100%",
            height: hauteur,
            border: 0,
            background: "#fff",
            colorScheme: "light",
            borderRadius: 12,
            boxShadow: "0 1px 3px rgba(0,0,0,.08)",
          }}
        />
      )}
    </div>
  );
}
