"use client";
// app/v2/housses/HoussesApp.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Monte l'app « Trouver ma housse » du thème Shopify dans la coquille v2.
//
//   1. GET /api/housses → housses (mêmes données que la page du site) + adresses
//      CDN du JS et du CSS du thème publié ;
//   2. charge ce CSS et ce JS (une fois par session) ;
//   3. window.TMH.mount(div, …) — sans toucher à l'URL ni au bouton « retour »
//      (history: false), liens vers les fiches sur jardin-confort.ch, et un
//      bouton « Copier le N° » sur chaque housse (à coller dans la recherche
//      d'articles du formulaire d'offre).
//
// Rien à maintenir ici quand l'app évolue : on corrige le thème, on publie,
// le formulaire suit (cache 5 min côté /api/housses).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";

type Housse = { id: number; sku: string; title: string; price: string; url: string; image: string };
type MountOpts = {
  data: unknown[];
  glatz: unknown[];
  sunc: unknown[];
  base: string;
  history: boolean;
  pick?: { label: string; fn: (h: Housse) => string | void };
};
type Instance = { destroy: () => void };

declare global {
  interface Window {
    TMH?: { mount: (el: HTMLElement, opts: MountOpts) => Instance | null; version?: string };
  }
}

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

// Une seule balise <script> / <link> par adresse, même si la page est rouverte.
const chargements = new Map<string, Promise<void>>();
function charger(tag: "script" | "link", url: string): Promise<void> {
  const cle = tag + "|" + url;
  const deja = chargements.get(cle);
  if (deja) return deja;
  const p = new Promise<void>((ok, ko) => {
    const el = document.createElement(tag);
    if (tag === "script") {
      (el as HTMLScriptElement).src = url;
      (el as HTMLScriptElement).async = true;
    } else {
      (el as HTMLLinkElement).rel = "stylesheet";
      (el as HTMLLinkElement).href = url;
    }
    el.onload = () => ok();
    el.onerror = () => {
      chargements.delete(cle);
      ko(new Error("Chargement impossible : " + url));
    };
    document.head.appendChild(el);
  });
  chargements.set(cle, p);
  return p;
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
  const ref = useRef<HTMLDivElement>(null);
  const [etat, setEtat] = useState<"chargement" | "pret" | "erreur">("chargement");
  const [erreur, setErreur] = useState("");
  const [lu, setLu] = useState("");
  const [essai, setEssai] = useState(0);
  const relire = () => {
    setEtat("chargement");
    setEssai((n) => n + 1);
  };

  useEffect(() => {
    let annule = false;
    let instance: Instance | null = null;
    (async () => {
      try {
        const res = await fetch("/api/housses" + (essai ? "?frais=1" : ""), { cache: "no-store" });
        const p = (await res.json()) as Payload;
        if (!res.ok || p.error) throw new Error(p.error || "Erreur " + res.status);
        await Promise.all([charger("link", p.css), charger("script", p.js)]);
        if (annule || !ref.current) return;
        if (!window.TMH) throw new Error("Le script de l'app housses ne s'est pas initialisé (version du thème < 1.8 ?)");
        instance = window.TMH.mount(ref.current, {
          data: p.data,
          glatz: p.glatz,
          sunc: p.sunc,
          base: p.base,
          history: false,
          pick: {
            label: "📋 Copier le N°",
            fn: (h) => {
              if (!h.sku) return "Pas de N°";
              void copier(h.sku);
              return "✓ " + h.sku + " copié";
            },
          },
        });
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
      instance?.destroy();
    };
  }, [essai]);

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

      {etat === "chargement" && <p style={{ opacity: 0.7 }}>Chargement des housses depuis Shopify…</p>}
      {etat === "erreur" && (
        <div style={{ background: "#fbe5e3", color: "#b3261e", borderRadius: 8, padding: ".8rem 1rem" }}>
          {erreur}{" "}
          <button type="button" className="v2-btn" onClick={relire}>
            Réessayer
          </button>
        </div>
      )}

      {/* Carte claire en mode sombre aussi : l'app a ses propres couleurs (celles du site). */}
      <div
        ref={ref}
        className="tmh tmh--alone"
        style={{
          display: etat === "pret" ? "block" : "none",
          background: "#fff",
          borderRadius: 12,
          padding: "1rem 1.25rem 1.5rem",
          boxShadow: "0 1px 3px rgba(0,0,0,.08)",
        }}
      />
    </div>
  );
}
