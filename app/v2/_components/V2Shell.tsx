"use client";
// app/v2/_components/V2Shell.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dashboard 2.0 — la coquille commune : menu latéral par métier, barre du haut
// (recherche Ctrl+K, notifications, + Nouvelle offre), bascule clair/sombre.
//
// Les pages v1 montées dans la v2 gardent leurs liens « /dashboard/… » : la
// coquille les réécrit à la volée vers « /v2/… » (voir versV2), pour qu'un
// vendeur entré dans la v2 y reste. Aucune page v1 n'est modifiée.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { versV1, versV2 } from "../_lib/routes";

type Theme = "light" | "dark";
const CLE_THEME = "jc-v2-theme";
const CLE_MENU = "jc-v2-menu-reduit";

type Entree = {
  href: string;
  label: string;
  icon: string;
  externe?: boolean; // ouvre dans un nouvel onglet (pages plein écran)
  compteur?: "remises";
};
type Groupe = { titre: string; entrees: Entree[] };

const MENU: Groupe[] = [
  {
    titre: "Vente",
    entrees: [
      { href: "/v2", label: "Offres & commandes", icon: "🏠" },
      { href: "/v2/clients", label: "Clients", icon: "👥" },
      { href: "/v2/listes-achat", label: "Listes d'achat", icon: "🛒" },
      { href: "/v2/todo", label: "To-do du jour", icon: "☑️" },
    ],
  },
  {
    titre: "Stock & fournisseurs",
    entrees: [
      { href: "/v2/stock-list", label: "Stock list", icon: "🔎" },
      { href: "/v2/arrivages", label: "Arrivages", icon: "📦" },
      { href: "/v2/delais", label: "Délais fournisseurs", icon: "⏱" },
      { href: "/v2/stock-movements", label: "Mouvements de stock", icon: "↕️" },
      { href: "/v2/stock-remises", label: "Remises en stock", icon: "↩️", compteur: "remises" },
    ],
  },
  {
    titre: "Outils",
    entrees: [
      { href: "/v2/jardi", label: "Jardi", icon: "💬" },
      { href: "/planner", label: "Planner 3D", icon: "🪑", externe: true },
      { href: "/v2/modeles-3d", label: "Index 3D", icon: "🧊" },
      { href: "/v2/qr-libre", label: "QR paiement libre", icon: "💳" },
    ],
  },
  {
    titre: "Gestion",
    entrees: [
      { href: "/v2/statistiques", label: "Statistiques", icon: "📊" },
      { href: "/v2/comptabilite", label: "Comptabilité", icon: "🧾" },
      { href: "/v2/notifications", label: "Notifications", icon: "🔔" },
      { href: "/v2/brand-logos", label: "Logos des marques", icon: "🏷" },
    ],
  },
];

// Pages rarement utilisées : hors du menu, mais toujours trouvables par Ctrl+K.
const PAGES_SECONDAIRES: Entree[] = [
  { href: "/v2/clients/review-emails", label: "Revue des e-mails clients importés", icon: "✉️" },
  { href: "/v2/winbiz-adresses", label: "Fichier clients WinBiz", icon: "🏦" },
];

// ─── Palette Ctrl+K : documents chargés à la première ouverture ───
type DocPalette = {
  slug: string;
  numero_affiche: string;
  type_document: string;
  client_prenom: string | null;
  client_nom: string | null;
  client_societe: string | null;
  client_ville: string | null;
};
let cacheDocs: DocPalette[] | null = null;

type ClientPalette = {
  id: number;
  numero_client: string | null;
  nom?: string | null;
  prenom?: string | null;
  societe?: string | null;
  ville?: string | null;
  email?: string | null;
};

function normaliser(s: string | null | undefined) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

type ItemPalette = { groupe: string; label: string; detail: string; aller: () => void };

function Palette({ ouverte, fermer }: { ouverte: boolean; fermer: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [docs, setDocs] = useState<DocPalette[]>(cacheDocs || []);
  const [clients, setClients] = useState<ClientPalette[]>([]);
  const [chercheClients, setChercheClients] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clients : même recherche que la page Clients (/api/clients, pertinence,
  // multi-mots, téléphone…), en différé de 300 ms.
  useEffect(() => {
    const t = q.trim();
    if (!ouverte || t.length < 2) {
      setClients([]);
      setChercheClients(false);
      return;
    }
    const ctrl = new AbortController();
    const minuterie = setTimeout(() => {
      setChercheClients(true);
      fetch(`/api/clients?q=${encodeURIComponent(t)}&limit=6`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => setClients(Array.isArray(j?.clients) ? (j.clients as ClientPalette[]).slice(0, 6) : []))
        .catch(() => {})
        .finally(() => setChercheClients(false));
    }, 300);
    return () => {
      clearTimeout(minuterie);
      ctrl.abort();
    };
  }, [q, ouverte]);

  useEffect(() => {
    if (!ouverte) return;
    setQ("");
    setSel(0);
    setTimeout(() => inputRef.current?.focus(), 10);
    if (!cacheDocs) {
      fetch("/api/dashboard/offres")
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => {
          cacheDocs = Array.isArray(d) ? (d as DocPalette[]) : [];
          setDocs(cacheDocs);
        })
        .catch(() => {});
    }
  }, [ouverte]);

  const items = useMemo<ItemPalette[]>(() => {
    const n = normaliser(q.trim());
    const mots = n.split(/\s+/).filter(Boolean);
    const ok = (champs: (string | null | undefined)[]) => {
      if (!mots.length) return true;
      const blob = champs.map(normaliser).join(" ");
      return mots.every((m) => blob.includes(m));
    };
    const out: ItemPalette[] = [];
    if (mots.length) {
      clients.forEach((c) => {
        const nom = [c.nom, c.prenom].filter(Boolean).join(" ") || c.societe || "—";
        const detail = [nom !== c.societe ? c.societe : null, c.ville].filter(Boolean).join(" · ");
        out.push({
          groupe: "Clients",
          label: `👤  ${nom}${detail ? ` — ${detail}` : ""}`,
          detail: c.numero_client ? `fiche n° ${c.numero_client}` : "fiche client",
          aller: () => router.push(`/v2/clients/${c.id}`),
        });
      });
      docs
        .filter((d) =>
          ok([d.numero_affiche, d.client_prenom, d.client_nom, d.client_societe, d.client_ville]),
        )
        .slice(0, 6)
        .forEach((d) =>
          out.push({
            groupe: "Documents",
            label: `${d.numero_affiche} — ${[d.client_societe, [d.client_nom, d.client_prenom].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "—"}`,
            detail: d.type_document,
            aller: () => router.push(`/v2/${d.slug}`),
          }),
        );
    }
    [...MENU.flatMap((g) => g.entrees), ...PAGES_SECONDAIRES]
      .filter((e) => ok([e.label]))
      .forEach((e) =>
        out.push({
          groupe: "Pages",
          label: `${e.icon}  ${e.label}`,
          detail: e.externe ? "nouvel onglet" : "aller",
          aller: () => (e.externe ? window.open(e.href, "_blank", "noopener,noreferrer") : router.push(e.href)),
        }),
      );
    const actions: ItemPalette[] = [
      {
        groupe: "Actions",
        label: "＋  Nouvelle offre (brouillon)",
        detail: "nouvel onglet",
        aller: () => window.open("/drafts/nouveau", "_blank", "noopener,noreferrer"),
      },
      {
        groupe: "Actions",
        label: "↩  Revenir à la version actuelle",
        detail: "v1",
        aller: () => (window.location.href = versV1(window.location.pathname + window.location.search)),
      },
    ];
    actions.filter((a) => ok([a.label])).forEach((a) => out.push(a));
    return out;
  }, [q, docs, clients, router]);

  useEffect(() => {
    if (sel >= items.length) setSel(0);
  }, [items.length, sel]);

  if (!ouverte) return null;

  let i = -1;
  let groupeCourant = "";
  return (
    <div className="v2-overlay" onMouseDown={(e) => e.target === e.currentTarget && fermer()}>
      <div className="v2-palette" role="dialog" aria-label="Recherche rapide">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => (items.length ? (s + 1) % items.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => (items.length ? (s - 1 + items.length) % items.length : 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const it = items[sel];
              if (it) {
                fermer();
                it.aller();
              }
            } else if (e.key === "Escape") {
              fermer();
            }
          }}
          placeholder="Chercher un client, un document (n°, nom), ou aller à une page…"
        />
        <div className="v2-palette-res">
          {items.length === 0 && <div className="v2-palette-grp">{chercheClients ? "Recherche…" : "Aucun résultat"}</div>}
          {items.map((it) => {
            i++;
            const idx = i;
            const titre = it.groupe !== groupeCourant ? it.groupe : null;
            groupeCourant = it.groupe;
            return (
              <React.Fragment key={idx}>
                {titre && <div className="v2-palette-grp">{titre}</div>}
                <button
                  type="button"
                  className={`v2-palette-item${idx === sel ? " sel" : ""}`}
                  onMouseEnter={() => setSel(idx)}
                  onClick={() => {
                    fermer();
                    it.aller();
                  }}
                >
                  <span>{it.label}</span>
                  <small>{it.detail}</small>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Compteurs (mêmes endpoints que la v1) ───
function useCompteurs() {
  const [nonLues, setNonLues] = useState(0);
  const [alerteMake, setAlerteMake] = useState(false);
  const [remises, setRemises] = useState(0);

  const charger = useCallback(async () => {
    try {
      const [n, h] = await Promise.all([
        fetch("/api/notifications?status=unread&limit=1"),
        fetch("/api/make-health"),
      ]);
      if (n.ok) setNonLues((await n.json()).unread_count || 0);
      if (h.ok) setAlerteMake((await h.json()).alert === true);
    } catch {
      /* compteur = confort, jamais bloquant */
    }
  }, []);

  useEffect(() => {
    charger();
    const t = setInterval(charger, 30000);
    fetch("/api/stock-remises?countOnly=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.stats?.a_remettre != null) setRemises(j.stats.a_remettre);
      })
      .catch(() => {});
    return () => clearInterval(t);
  }, [charger]);

  return { nonLues, alerteMake, remises };
}

// ─── Réécriture des liens /dashboard → /v2 dans les pages v1 montées ───
function useLiensVersV2(racine: React.RefObject<HTMLDivElement | null>) {
  const router = useRouter();

  useEffect(() => {
    const el = racine.current;
    if (!el) return;

    const ancre = (t: EventTarget | null) =>
      (t instanceof Element ? t.closest("a[href]") : null) as HTMLAnchorElement | null;

    const cible = (a: HTMLAnchorElement): string | null => {
      try {
        const u = new URL(a.href, window.location.href);
        if (u.origin !== window.location.origin) return null;
        return versV2(u.pathname + u.search + u.hash);
      } catch {
        return null;
      }
    };

    // Survol / pression : l'attribut href est réécrit, donc Ctrl+clic, clic
    // milieu et « ouvrir dans un nouvel onglet » partent aussi vers la v2.
    const reecrire = (e: Event) => {
      const a = ancre(e.target);
      if (!a) return;
      const v2 = cible(a);
      if (v2) a.setAttribute("href", v2);
    };

    // Clic gauche simple : un <Link> Next pousserait SA prop href (v1).
    // On l'intercepte avant lui et on navigue nous-mêmes vers la v2.
    const clic = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = ancre(e.target);
      if (!a) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;
      const u = new URL(a.href, window.location.href);
      if (u.origin !== window.location.origin) return;
      const chemin = u.pathname + u.search + u.hash;
      const v2 = versV2(chemin) ?? (chemin.startsWith("/v2") ? chemin : null);
      if (!v2) return;
      e.preventDefault();
      e.stopPropagation();
      router.push(v2);
    };

    el.addEventListener("pointerover", reecrire, true);
    el.addEventListener("pointerdown", reecrire, true);
    el.addEventListener("focusin", reecrire, true);
    el.addEventListener("click", clic, true);

    // Navigations « dures » (window.location.href = "/dashboard/…", utilisé
    // par les lignes cliquables des listes v1) : Navigation API, si le
    // navigateur la connaît (Chrome, Edge). Sinon, la page v1 s'ouvre — rien
    // de cassé, on sort juste de la v2.
    type NavEvent = Event & {
      cancelable: boolean;
      hashChange: boolean;
      navigationType: string;
      destination: { url: string; sameDocument: boolean };
    };
    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    const surNavigation = (ev: Event) => {
      const e = ev as NavEvent;
      if (!e.cancelable || e.hashChange || e.destination?.sameDocument) return;
      if (e.navigationType !== "push" && e.navigationType !== "replace") return;
      try {
        const u = new URL(e.destination.url);
        if (u.origin !== window.location.origin) return;
        const v2 = versV2(u.pathname + u.search + u.hash);
        if (!v2) return;
        e.preventDefault();
        window.location.assign(v2);
      } catch {
        /* on laisse passer */
      }
    };
    nav?.addEventListener("navigate", surNavigation);

    return () => {
      el.removeEventListener("pointerover", reecrire, true);
      el.removeEventListener("pointerdown", reecrire, true);
      el.removeEventListener("focusin", reecrire, true);
      el.removeEventListener("click", clic, true);
      nav?.removeEventListener("navigate", surNavigation);
    };
  }, [racine, router]);
}

// Posé AVANT l'hydratation : évite le flash clair→sombre au chargement.
const SCRIPT_THEME = `try{var t=localStorage.getItem("${CLE_THEME}");var r=document.currentScript.parentElement;if(t==="dark"||t==="light")r.setAttribute("data-theme",t);if(localStorage.getItem("${CLE_MENU}")==="1")r.classList.add("v2-reduit")}catch(e){}`;

export default function V2Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/v2";
  const racine = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const [reduit, setReduit] = useState(false);
  // Jardi (10.10.2026) : le chat a sa propre colonne d'historique — le menu
  // se replie tout seul sur cette page, sans toucher au réglage mémorisé.
  const estJardi = pathname === "/v2/jardi" || pathname.startsWith("/v2/jardi/");
  const [deplieJardi, setDeplieJardi] = useState(false);
  const reduitEffectif = estJardi ? !deplieJardi : reduit;
  const [menuMobile, setMenuMobile] = useState(false);
  const [palette, setPalette] = useState(false);
  const { nonLues, alerteMake, remises } = useCompteurs();

  useLiensVersV2(racine);

  useEffect(() => {
    try {
      const t = localStorage.getItem(CLE_THEME);
      if (t === "dark" || t === "light") setTheme(t);
      setReduit(localStorage.getItem(CLE_MENU) === "1");
    } catch {
      /* stockage indisponible : thème clair par défaut */
    }
  }, []);

  const changerTheme = () => {
    const t: Theme = theme === "dark" ? "light" : "dark";
    setTheme(t);
    try {
      localStorage.setItem(CLE_THEME, t);
    } catch {}
  };
  const changerMenu = () => {
    if (estJardi) {
      setDeplieJardi((d) => !d);
      return;
    }
    const r = !reduit;
    setReduit(r);
    try {
      localStorage.setItem(CLE_MENU, r ? "1" : "0");
    } catch {}
  };

  useEffect(() => setMenuMobile(false), [pathname]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const actif = (href: string) =>
    href === "/v2"
      ? pathname === "/v2" || /^\/v2\/(?!todo|jardi|clients|listes-achat|stock-|arrivages|delais|modeles-3d|qr-libre|statistiques|comptabilite|notifications|brand-logos|winbiz-adresses)[^/]+$/.test(pathname)
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <div
      ref={racine}
      className={`v2-root${reduitEffectif ? " v2-reduit" : ""}`}
      data-theme={theme}
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: SCRIPT_THEME }} />
      <div className="v2-app">
        {menuMobile && <div className="v2-voile" onClick={() => setMenuMobile(false)} />}
        <aside className={`v2-sidebar${menuMobile ? " ouvert" : ""}`}>
          <Link href="/v2" className="v2-brand">
            <img
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/picto_jardin_confort_apple_low.png?v=1775944940"
              alt=""
              className="v2-logo"
            />
            <span className="v2-lbl">
              <b>Jardin-Confort</b>
              <small>Offres & commandes</small>
            </span>
          </Link>
          <nav className="v2-nav">
            {MENU.map((g) => (
              <div key={g.titre}>
                <h6>{g.titre}</h6>
                {g.entrees.map((e) => {
                  const n = e.compteur === "remises" ? remises : 0;
                  const contenu = (
                    <>
                      <span className="v2-ic">{e.icon}</span>
                      <span className="v2-lbl">{e.label}</span>
                      {e.externe && <span className="v2-ext v2-lbl">↗</span>}
                      {n > 0 && <span className="v2-count alerte">{n}</span>}
                    </>
                  );
                  return e.externe ? (
                    <a key={e.href} href={e.href} target="_blank" rel="noopener noreferrer" title={e.label}>
                      {contenu}
                    </a>
                  ) : (
                    <Link key={e.href} href={e.href} className={actif(e.href) ? "actif" : ""} title={e.label}>
                      {contenu}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="v2-sb-pied">
            <button type="button" onClick={changerTheme} title="Changer de thème">
              <span className="v2-ic">{theme === "dark" ? "☀️" : "🌙"}</span>
              <span className="v2-lbl">{theme === "dark" ? "Mode clair" : "Mode sombre"}</span>
            </button>
            <a href={versV1(pathname)} title="Revenir à la version actuelle du dashboard">
              <span className="v2-ic">↩</span>
              <span className="v2-lbl">Version actuelle</span>
            </a>
            <button type="button" onClick={changerMenu} className="v2-masque-mobile" title="Réduire / agrandir le menu">
              <span className="v2-ic">{reduitEffectif ? "⇥" : "⇤"}</span>
              <span className="v2-lbl">Réduire le menu</span>
            </button>
          </div>
        </aside>

        <div className="v2-main">
          <header className="v2-topbar">
            <button type="button" className="v2-burger" onClick={() => setMenuMobile(true)} aria-label="Menu">
              ☰
            </button>
            <button type="button" className="v2-recherche" onClick={() => setPalette(true)}>
              <span>🔍</span>
              <span className="v2-recherche-txt">Rechercher un client, un document, une page…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className="v2-spacer" />
            <Link
              href="/v2/notifications"
              className={`v2-btn v2-btn-icone${nonLues > 0 ? " v2-btn-alerte" : ""}`}
              title={alerteMake ? "Le flow Make semble en panne — voir les notifications" : "Notifications"}
            >
              🔔
              {nonLues > 0 && <span className="v2-pastille">{nonLues}</span>}
              {alerteMake && <span className="v2-make">⚠</span>}
            </Link>
            <a href="/drafts/nouveau" target="_blank" rel="noopener noreferrer" className="v2-btn v2-btn-primaire">
              ＋ <span className="v2-masque-mobile">Nouvelle offre</span>
            </a>
          </header>
          <div className="v2-contenu">{children}</div>
        </div>
      </div>
      <Palette ouverte={palette} fermer={() => setPalette(false)} />
    </div>
  );
}
