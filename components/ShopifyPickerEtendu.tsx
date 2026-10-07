"use client";

// Vue etendue du picker Shopify (07.10.2026).
//
// Panneau plein ecran ouvert depuis les deux pickers de DraftFormulaire
// (colonne droite « Grand ecran » et tuiles « Mode normal »). Il partage la
// MEME recherche que le formulaire (state search / shopifyItems du parent) :
// il n'interroge rien lui-meme et n'ecrit rien. L'ajout passe par la fonction
// addShopifyItem du parent, donc exactement le meme chemin que les autres pickers.
//
// Deux niveaux :
//   - vue « Produits » : une carte par produit maitre, stock = somme des
//     variantes TROUVEES (les variantes non retenues par la recherche ne sont
//     pas chargees, donc pas comptees) ; clic = ouvre ses variantes.
//   - vue « Variantes » : liste a plat, une seule photo (celle de la variante).
//
// Somme du stock : seules les quantites POSITIVES sont additionnees. Une
// variante CONTINUE a -3 (vendue sur commande) ne retire pas 3 pieces aux
// autres couleurs qui, elles, sont physiquement la.
//
// Pas d'aria-modal="true" sur le panneau : le style global de DraftFormulaire
// remet margin/padding a revert-layer sous [role=dialog][aria-modal=true]
// (correctif TransformerModal), ce qui effacerait les espacements ci-dessous.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  badgeStockPicker,
  etatStockPicker,
  COULEURS_STOCK,
  type EtatStockPicker,
  type PolitiqueStock,
} from "@/lib/badge-stock-picker";

export type PickerEtenduItem = {
  id: string;
  sku: string;
  variant: string;
  price: string;
  compareAtPrice: string | null;
  stock: number | null;
  inventoryPolicy: PolitiqueStock;
  productUrl: string;
  variantImage: string;
  delaiLivraison?: string;
  orderUnit?: number | null;
  has3d?: boolean;
  productHandle?: string;
  productTitle?: string;
  variantTitle?: string;
  vendor?: string;
  productImage?: string;
};

type Vue = "produits" | "variantes";
type Tri = "pertinence" | "stock_desc" | "stock_asc" | "nom" | "prix_asc" | "prix_desc";
type FiltreStock = "tous" | "en_stock" | "sur_commande" | "rupture";

type Props<T extends PickerEtenduItem> = {
  open: boolean;
  onClose: () => void;
  search: string;
  onSearchChange: (v: string) => void;
  items: T[];
  loading: boolean;
  error: string;
  onAdd: (item: T) => void;
  flashId: string | null;
};

type Groupe<T> = {
  key: string;
  titre: string;
  marque: string;
  image: string;
  url: string;
  rang: number;
  variantes: T[];
  stockTotal: number;
  nbConnus: number;
  nbInconnus: number;
  nbEnStock: number;
  nbSurCommande: number;
  nbRupture: number;
  prixMin: number;
  prixMax: number;
  promo: boolean;
};

const LIBELLES_TRI: Record<Tri, string> = {
  pertinence: "Pertinence",
  stock_desc: "Stock (plus haut)",
  stock_asc: "Stock (plus bas)",
  nom: "Nom A-Z",
  prix_asc: "Prix croissant",
  prix_desc: "Prix décroissant",
};

const LIBELLES_FILTRE: Record<FiltreStock, string> = {
  tous: "Tous",
  en_stock: "En stock",
  sur_commande: "Sur commande",
  rupture: "Rupture",
};

function prixNum(s: string | null | undefined): number {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
}

function enPromo(i: PickerEtenduItem): boolean {
  return !!i.compareAtPrice && prixNum(i.compareAtPrice) > prixNum(i.price);
}

// Repli si l'API ne renvoie pas encore les champs produit (deploiement decale) :
// le libelle « Produit / Variante » est construit par /api/shopify-search.
function titreProduit(i: PickerEtenduItem): string {
  if (i.productTitle) return i.productTitle;
  const idx = i.variant.indexOf(" / ");
  return idx > 0 ? i.variant.slice(0, idx) : i.variant;
}

function titreVariante(i: PickerEtenduItem): string {
  if (i.variantTitle !== undefined) return i.variantTitle && i.variantTitle !== "Default Title" ? i.variantTitle : "";
  const idx = i.variant.indexOf(" / ");
  return idx > 0 ? i.variant.slice(idx + 3) : "";
}

function cleProduit(i: PickerEtenduItem): string {
  return i.productHandle || titreProduit(i);
}

const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

// Stock inconnu toujours en fin de liste, quel que soit le sens du tri.
function cmpStock(a: number | null, b: number | null, sens: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * sens;
}

function chf(n: number): string {
  return "CHF " + n.toFixed(2);
}

export default function ShopifyPickerEtendu<T extends PickerEtenduItem>({
  open,
  onClose,
  search,
  onSearchChange,
  items,
  loading,
  error,
  onAdd,
  flashId,
}: Props<T>) {
  const [vue, setVue] = useState<Vue>("produits");
  const [tri, setTri] = useState<Tri>("pertinence");
  const [filtre, setFiltre] = useState<FiltreStock>("tous");
  const [promoSeul, setPromoSeul] = useState(false);
  const [marque, setMarque] = useState("");
  const [produitOuvert, setProduitOuvert] = useState<string | null>(null);
  const [ajouts, setAjouts] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // A l'ouverture : focus sur la recherche, compteur d'ajouts remis a zero,
  // defilement de la page bloque.
  useEffect(() => {
    if (!open) return;
    setAjouts({});
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Nouvelle recherche = on revient a la liste des produits.
  useEffect(() => {
    setProduitOuvert(null);
  }, [search]);

  const marques = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) if (i.vendor) s.add(i.vendor);
    return Array.from(s).sort(collator.compare);
  }, [items]);

  // Une marque choisie qui disparait des resultats ne doit pas tout masquer.
  const marqueActive = marque && marques.includes(marque) ? marque : "";

  const passeFiltres = useMemo(() => {
    return (i: PickerEtenduItem) => {
      if (marqueActive && i.vendor !== marqueActive) return false;
      if (promoSeul && !enPromo(i)) return false;
      if (filtre !== "tous" && etatStockPicker(i.stock, i.inventoryPolicy) !== filtre) return false;
      return true;
    };
  }, [marqueActive, promoSeul, filtre]);

  const trierVariantes = useMemo(() => {
    return (liste: T[]): T[] => {
      if (tri === "pertinence") return liste;
      const copie = [...liste];
      copie.sort((a, b) => {
        switch (tri) {
          case "stock_desc": return cmpStock(a.stock, b.stock, -1);
          case "stock_asc": return cmpStock(a.stock, b.stock, 1);
          case "nom": return collator.compare(a.variant, b.variant);
          case "prix_asc": return prixNum(a.price) - prixNum(b.price);
          case "prix_desc": return prixNum(b.price) - prixNum(a.price);
          default: return 0;
        }
      });
      return copie;
    };
  }, [tri]);

  // Groupes calcules sur TOUTES les variantes trouvees (filtre marque seul) :
  // le stock total d'un produit ne doit pas changer selon le filtre de stock.
  const groupes = useMemo<Groupe<T>[]>(() => {
    const map = new Map<string, Groupe<T>>();
    items.forEach((i, idx) => {
      if (marqueActive && i.vendor !== marqueActive) return;
      const key = cleProduit(i);
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          titre: titreProduit(i),
          marque: i.vendor || "",
          image: i.productImage || i.variantImage,
          url: i.productUrl.split("?")[0],
          rang: idx,
          variantes: [],
          stockTotal: 0,
          nbConnus: 0,
          nbInconnus: 0,
          nbEnStock: 0,
          nbSurCommande: 0,
          nbRupture: 0,
          prixMin: Infinity,
          prixMax: -Infinity,
          promo: false,
        };
        map.set(key, g);
      }
      g.variantes.push(i);
      const etat: EtatStockPicker = etatStockPicker(i.stock, i.inventoryPolicy);
      if (etat === "inconnu") g.nbInconnus++;
      else {
        g.nbConnus++;
        if (i.stock !== null && i.stock > 0) g.stockTotal += i.stock;
        if (etat === "en_stock") g.nbEnStock++;
        else if (etat === "sur_commande") g.nbSurCommande++;
        else g.nbRupture++;
      }
      const p = prixNum(i.price);
      if (p < g.prixMin) g.prixMin = p;
      if (p > g.prixMax) g.prixMax = p;
      if (enPromo(i)) g.promo = true;
    });
    return Array.from(map.values());
  }, [items, marqueActive]);

  const groupesVisibles = useMemo(() => {
    const liste = groupes
      .map((g) => ({ g, nbVisibles: g.variantes.filter(passeFiltres).length }))
      .filter((x) => x.nbVisibles > 0);
    liste.sort((a, b) => {
      switch (tri) {
        case "stock_desc": return cmpStock(a.g.nbConnus ? a.g.stockTotal : null, b.g.nbConnus ? b.g.stockTotal : null, -1);
        case "stock_asc": return cmpStock(a.g.nbConnus ? a.g.stockTotal : null, b.g.nbConnus ? b.g.stockTotal : null, 1);
        case "nom": return collator.compare(a.g.titre, b.g.titre);
        case "prix_asc": return a.g.prixMin - b.g.prixMin;
        case "prix_desc": return b.g.prixMax - a.g.prixMax;
        default: return a.g.rang - b.g.rang;
      }
    });
    return liste;
  }, [groupes, passeFiltres, tri]);

  const variantesVisibles = useMemo(
    () => trierVariantes(items.filter(passeFiltres)),
    [items, passeFiltres, trierVariantes]
  );

  // Un seul produit dans les resultats : on l'ouvre directement.
  const seulProduit = vue === "produits" && groupesVisibles.length === 1 ? groupesVisibles[0].g.key : null;
  const cleOuverte = vue === "produits" ? (produitOuvert ?? seulProduit) : null;
  const groupeOuvert = cleOuverte ? groupes.find((g) => g.key === cleOuverte) ?? null : null;
  const variantesGroupe = groupeOuvert ? trierVariantes(groupeOuvert.variantes.filter(passeFiltres)) : [];

  function ajouter(item: T) {
    onAdd(item);
    setAjouts((a) => ({ ...a, [item.id]: (a[item.id] ?? 0) + 1 }));
  }

  if (!open) return null;

  const nbAjouts = Object.values(ajouts).reduce((s, n) => s + n, 0);
  const aucunResultat = !loading && !error && search.trim() !== "" && items.length === 0;
  const toutFiltre = items.length > 0 && variantesVisibles.length === 0;

  return (
    <div className="jcx-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="jcx-panel" role="dialog" aria-label="Catalogue Shopify - vue étendue">
        {/* ── En-tete : recherche + fermeture ── */}
        <div className="jcx-head">
          <div className="jcx-head-row">
            <div className="jcx-title">Catalogue Shopify <span className="jcx-title-sub">vue étendue</span></div>
            <div className="jcx-search-wrap">
              <input
                ref={inputRef}
                className="jcx-search"
                placeholder="SKU, produit ou variante…"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                autoComplete="new-password"
                name="f-picker-etendu"
                data-form-type="other"
              />
              {search && (
                <button type="button" className="jcx-btn jcx-btn-ghost" onClick={() => onSearchChange("")}>✕</button>
              )}
            </div>
            <div className="jcx-head-right">
              {nbAjouts > 0 && <span className="jcx-ajouts">✓ {nbAjouts} ajouté{nbAjouts > 1 ? "s" : ""}</span>}
              <button type="button" className="jcx-btn jcx-btn-close" onClick={onClose} title="Fermer (Echap)">Fermer ✕</button>
            </div>
          </div>

          {/* ── Barre d'outils : vue, filtres, tri ── */}
          <div className="jcx-tools">
            <div className="jcx-seg" role="tablist">
              <button type="button" className={vue === "produits" ? "jcx-seg-on" : ""} onClick={() => { setVue("produits"); setProduitOuvert(null); }}>
                Produits{groupesVisibles.length ? ` (${groupesVisibles.length})` : ""}
              </button>
              <button type="button" className={vue === "variantes" ? "jcx-seg-on" : ""} onClick={() => setVue("variantes")}>
                Variantes{variantesVisibles.length ? ` (${variantesVisibles.length})` : ""}
              </button>
            </div>

            <div className="jcx-chips">
              {(Object.keys(LIBELLES_FILTRE) as FiltreStock[]).map((f) => (
                <button
                  type="button"
                  key={f}
                  className={`jcx-chip${filtre === f ? " jcx-chip-on" : ""}`}
                  onClick={() => setFiltre(f)}
                >
                  {f !== "tous" && <span className="jcx-dot" style={{ background: COULEURS_STOCK[f] }} />}
                  {LIBELLES_FILTRE[f]}
                </button>
              ))}
              <button type="button" className={`jcx-chip${promoSeul ? " jcx-chip-on" : ""}`} onClick={() => setPromoSeul((p) => !p)}>
                En promo
              </button>
            </div>

            <div className="jcx-selects">
              {marques.length > 1 && (
                <select className="jcx-select" value={marqueActive} onChange={(e) => setMarque(e.target.value)}>
                  <option value="">Toutes les marques</option>
                  {marques.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              <select className="jcx-select" value={tri} onChange={(e) => setTri(e.target.value as Tri)}>
                {(Object.keys(LIBELLES_TRI) as Tri[]).map((t) => (
                  <option key={t} value={t}>Tri : {LIBELLES_TRI[t]}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Corps ── */}
        <div className="jcx-body">
          {!search.trim() && <div className="jcx-hint">Tapez un SKU, un nom de produit ou une variante.</div>}
          {loading && <div className="jcx-hint"><span className="jcx-spinner" /> Recherche en cours sur Shopify…</div>}
          {error && <div className="jcx-hint jcx-error">⚠ {error}</div>}
          {aucunResultat && <div className="jcx-hint">Aucun résultat pour « {search} »</div>}
          {toutFiltre && <div className="jcx-hint">Aucun article ne correspond aux filtres ({items.length} résultat{items.length > 1 ? "s" : ""} masqué{items.length > 1 ? "s" : ""}).</div>}

          {/* Vue produits — liste des produits maitres */}
          {vue === "produits" && !groupeOuvert && groupesVisibles.length > 0 && (
            <div className="jcx-grid jcx-grid-produits">
              {groupesVisibles.map(({ g, nbVisibles }) => {
                const etat: EtatStockPicker =
                  g.nbConnus === 0 ? "inconnu" : g.stockTotal > 0 ? "en_stock" : g.nbSurCommande > 0 ? "sur_commande" : "rupture";
                const libelle =
                  etat === "inconnu" ? "Stock à vérifier"
                  : etat === "en_stock" ? `${g.stockTotal} pce${g.stockTotal > 1 ? "s" : ""} en stock`
                  : etat === "sur_commande" ? "Sur commande"
                  : "Rupture";
                return (
                  <button type="button" key={g.key} className="jcx-card jcx-card-produit" onClick={() => setProduitOuvert(g.key)}>
                    <div className="jcx-img">{g.image ? <img src={g.image} alt="" loading="lazy" /> : null}</div>
                    <div className="jcx-info">
                      {g.marque && <div className="jcx-marque">{g.marque}</div>}
                      <div className="jcx-nom">{g.titre}</div>
                      <div className="jcx-sous">
                        {nbVisibles === g.variantes.length
                          ? `${g.variantes.length} variante${g.variantes.length > 1 ? "s" : ""}`
                          : `${nbVisibles} / ${g.variantes.length} variantes`}
                      </div>
                      <div className="jcx-prix">
                        {g.prixMin === g.prixMax ? chf(g.prixMin) : `${chf(g.prixMin)} – ${g.prixMax.toFixed(2)}`}
                        {g.promo && <span className="jcx-promo">promo</span>}
                      </div>
                      <div className="jcx-pill" style={{ background: COULEURS_STOCK[etat] }}>{libelle}</div>
                      <div className="jcx-repartition">
                        {g.nbEnStock > 0 && <span><span className="jcx-dot" style={{ background: COULEURS_STOCK.en_stock }} />{g.nbEnStock} en stock</span>}
                        {g.nbSurCommande > 0 && <span><span className="jcx-dot" style={{ background: COULEURS_STOCK.sur_commande }} />{g.nbSurCommande} sur cde</span>}
                        {g.nbRupture > 0 && <span><span className="jcx-dot" style={{ background: COULEURS_STOCK.rupture }} />{g.nbRupture} rupture</span>}
                        {g.nbInconnus > 0 && <span><span className="jcx-dot" style={{ background: COULEURS_STOCK.inconnu }} />{g.nbInconnus} à vérifier</span>}
                      </div>
                    </div>
                    <div className="jcx-voir">Voir les variantes</div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Vue produits — un produit ouvert */}
          {vue === "produits" && groupeOuvert && (
            <>
              <div className="jcx-fil">
                {!seulProduit || produitOuvert ? (
                  <button type="button" className="jcx-btn jcx-btn-ghost" onClick={() => setProduitOuvert(null)}>← Tous les produits</button>
                ) : null}
                <span className="jcx-fil-titre">{groupeOuvert.titre}</span>
                <span className="jcx-fil-stock">
                  Stock total : <strong>{groupeOuvert.nbConnus ? groupeOuvert.stockTotal : "?"}</strong>
                  {" "}· {groupeOuvert.variantes.length} variante{groupeOuvert.variantes.length > 1 ? "s" : ""} trouvée{groupeOuvert.variantes.length > 1 ? "s" : ""}
                </span>
                <a href={groupeOuvert.url} target="_blank" rel="noopener noreferrer" className="jcx-lien">Ouvrir sur la boutique</a>
              </div>
              {variantesGroupe.length === 0 ? (
                <div className="jcx-hint">Aucune variante de ce produit ne correspond aux filtres.</div>
              ) : (
                <div className="jcx-grid">
                  {variantesGroupe.map((item) => (
                    <CarteVariante key={item.id} item={item} flash={flashId === item.id} ajouts={ajouts[item.id] ?? 0} onAdd={ajouter} masquerProduit />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Vue variantes — liste a plat */}
          {vue === "variantes" && variantesVisibles.length > 0 && (
            <div className="jcx-grid">
              {variantesVisibles.map((item) => (
                <CarteVariante key={item.id} item={item} flash={flashId === item.id} ajouts={ajouts[item.id] ?? 0} onAdd={ajouter} />
              ))}
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .jcx-overlay {
          position: fixed; inset: 0; z-index: 900;
          background: rgba(0,0,0,0.55);
          display: flex; align-items: stretch; justify-content: center;
          padding: 18px;
        }
        .jcx-panel {
          width: 100%; max-width: 1680px;
          background: var(--bg); color: var(--text);
          border: 1px solid var(--border-2); border-radius: 16px;
          display: flex; flex-direction: column; overflow: hidden;
          box-shadow: 0 20px 60px rgba(0,0,0,0.45);
        }
        .jcx-head { padding: 16px 20px 12px; border-bottom: 1px solid var(--border); background: var(--card); }
        .jcx-head-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
        .jcx-title { font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; }
        .jcx-title-sub { font-weight: 500; color: var(--text-dim); text-transform: none; letter-spacing: 0; margin-left: 4px; }
        .jcx-search-wrap { flex: 1; min-width: 260px; display: flex; gap: 8px; align-items: center; }
        .jcx-panel input.jcx-search {
          width: 100%; font-size: 16px; padding: 11px 14px;
          border: 1px solid var(--accent); border-radius: 12px;
          background: var(--card-2); color: var(--text);
        }
        .jcx-head-right { display: flex; align-items: center; gap: 10px; }
        .jcx-ajouts { font-size: 13px; font-weight: 700; color: var(--ok); white-space: nowrap; }
        .jcx-btn { border: 1px solid var(--border-2); background: transparent; color: var(--text); border-radius: 10px; padding: 8px 12px; cursor: pointer; font-size: 13px; white-space: nowrap; }
        .jcx-btn:hover { background: var(--card-2); }
        .jcx-btn-close { font-weight: 600; }

        .jcx-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 12px; }
        .jcx-seg { display: inline-flex; border: 1px solid var(--border-2); border-radius: 10px; overflow: hidden; }
        .jcx-seg button { background: transparent; color: var(--text-muted); border: none; padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .jcx-seg button + button { border-left: 1px solid var(--border-2); }
        .jcx-seg button.jcx-seg-on { background: var(--accent); color: #fff; }
        .jcx-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .jcx-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border-2); background: transparent; color: var(--text-muted); border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
        .jcx-chip-on { border-color: var(--accent); color: var(--text); background: rgba(59,130,246,0.15); }
        .jcx-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
        .jcx-chip .jcx-dot { margin-right: 0; }
        .jcx-selects { display: flex; gap: 8px; margin-left: auto; }
        .jcx-panel select.jcx-select { width: auto; font-size: 13px; padding: 7px 10px; border-radius: 10px; }

        .jcx-body { flex: 1; overflow-y: auto; padding: 18px 20px 28px; }
        .jcx-hint { padding: 18px 4px; color: var(--text-muted); font-size: 14px; display: flex; align-items: center; gap: 10px; }
        .jcx-error { color: var(--danger); }
        .jcx-spinner { width: 16px; height: 16px; border: 2px solid var(--border-2); border-top-color: var(--accent); border-radius: 50%; animation: jcx-spin 0.8s linear infinite; display: inline-block; }
        @keyframes jcx-spin { to { transform: rotate(360deg); } }

        .jcx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
        .jcx-card {
          position: relative; display: flex; flex-direction: column;
          background: var(--card); border: 1px solid var(--border-2); border-radius: 14px;
          overflow: hidden; text-align: left; color: var(--text);
          transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
        }
        .jcx-card:hover { border-color: var(--accent); }
        .jcx-card-produit { cursor: pointer; font: inherit; padding: 0; }
        .jcx-card-produit:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.25); }
        .jcx-card.jcx-flash { border-color: #4ade80; box-shadow: 0 0 0 2px rgba(74,222,128,0.35); }
        .jcx-img { background: #fff; height: 170px; display: flex; align-items: center; justify-content: center; padding: 10px; }
        .jcx-img img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
        .jcx-info { padding: 12px 14px 10px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
        .jcx-marque { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-dim); }
        .jcx-produit { font-size: 12px; color: var(--text-muted); line-height: 1.3; }
        .jcx-nom { font-size: 16px; font-weight: 700; line-height: 1.3; word-break: break-word; }
        .jcx-sous { font-size: 12px; color: var(--text-muted); }
        .jcx-sku { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
        .jcx-badge3d { padding: 0 5px; border-radius: 4px; background: rgba(16,185,129,.18); color: #34d399; font-size: 10px; font-weight: 700; font-family: inherit; }
        .jcx-prix { font-size: 18px; font-weight: 800; margin-top: 4px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
        .jcx-prix-barre { font-size: 13px; font-weight: 500; color: #9CA3AF; text-decoration: line-through; }
        .jcx-promo { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #dc2626; border: 1px solid currentColor; border-radius: 4px; padding: 0 5px; }
        .jcx-pill { align-self: flex-start; margin-top: 6px; color: #fff; border-radius: 999px; padding: 4px 12px; font-size: 13px; font-weight: 700; }
        .jcx-delai { font-size: 12px; color: var(--text-muted); }
        .jcx-unite { font-size: 12px; font-weight: 600; color: #3b82f6; }
        .jcx-repartition { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .jcx-voir { padding: 9px 14px; border-top: 1px solid var(--border); font-size: 12px; font-weight: 600; color: var(--accent); }
        .jcx-actions { display: flex; align-items: center; gap: 8px; padding: 10px 14px 12px; border-top: 1px solid var(--border); }
        .jcx-lien { font-size: 12px; color: var(--text-muted); text-decoration: underline; }
        .jcx-add { margin-left: auto; background: var(--accent); color: #fff; border: none; border-radius: 10px; padding: 8px 16px; font-size: 14px; font-weight: 700; cursor: pointer; }
        .jcx-add:hover { background: var(--accent-h); }
        .jcx-deja { font-size: 12px; font-weight: 700; color: var(--ok); }

        .jcx-fil { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
        .jcx-fil-titre { font-size: 18px; font-weight: 800; }
        .jcx-fil-stock { font-size: 13px; color: var(--text-muted); }

        @media (max-width: 700px) {
          .jcx-overlay { padding: 0; }
          .jcx-panel { border-radius: 0; }
          .jcx-selects { margin-left: 0; }
          .jcx-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
        }
      `}</style>
    </div>
  );
}

function CarteVariante<T extends PickerEtenduItem>({
  item,
  flash,
  ajouts,
  onAdd,
  masquerProduit,
}: {
  item: T;
  flash: boolean;
  ajouts: number;
  onAdd: (item: T) => void;
  masquerProduit?: boolean;
}) {
  const b = badgeStockPicker(item.stock, item.inventoryPolicy);
  const promo = enPromo(item);
  const variante = titreVariante(item);
  return (
    <div className={`jcx-card${flash ? " jcx-flash" : ""}`}>
      <div className="jcx-img">{item.variantImage ? <img src={item.variantImage} alt="" loading="lazy" /> : null}</div>
      <div className="jcx-info">
        {!masquerProduit && <div className="jcx-produit">{titreProduit(item)}</div>}
        <div className="jcx-nom">{variante || titreProduit(item)}</div>
        <div className="jcx-sku">
          {item.sku || "—"}
          {item.has3d && <span className="jcx-badge3d" title="Modèle 3D disponible (planner)">3D</span>}
        </div>
        <div className="jcx-prix">
          {promo && <span className="jcx-prix-barre">CHF {item.compareAtPrice}</span>}
          <span style={promo ? { color: "#dc2626" } : undefined}>CHF {item.price}</span>
        </div>
        <div className="jcx-pill" style={{ background: b.couleur }}>{b.texte}</div>
        {/* Delai : meme regle que la ligne et les autres pickers (CONTINUE a 0 seulement). */}
        {item.stock !== null && item.stock < 1 && item.inventoryPolicy === "CONTINUE"
          && item.delaiLivraison && item.delaiLivraison !== "Sur commande" && (
          <div className="jcx-delai">Délai {item.delaiLivraison}</div>
        )}
        {item.orderUnit && item.orderUnit > 1 ? (
          <div className="jcx-unite">Vente par {item.orderUnit} pièces (même couleur)</div>
        ) : null}
      </div>
      <div className="jcx-actions">
        <a href={item.productUrl} target="_blank" rel="noopener noreferrer" className="jcx-lien">Boutique</a>
        {ajouts > 0 && <span className="jcx-deja">✓ ×{ajouts}</span>}
        <button type="button" className="jcx-add" onClick={() => onAdd(item)}>+ Ajouter</button>
      </div>
    </div>
  );
}
