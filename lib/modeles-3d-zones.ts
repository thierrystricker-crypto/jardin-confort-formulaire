// lib/modeles-3d-zones.ts
// Couleurs 3D appliquées à l'affichage (Fermob, 04.10.2026).
//
// Une fiche à zones a UNE forme (géométrie, matières nommées « zone_… ») et
// une palette de couleurs par marque ; le lecteur repeint le modèle selon la
// variante choisie. Référence : snippet de thème model-3d-cascade.liquid et le
// doc projet « passation-couleurs-3d-a-la-volee.md ».
//
// Ce module est PUR (aucun accès réseau ni Supabase) : il sert côté serveur
// (synchro, faisabilité) comme côté navigateur (planner, three.js).

export type ZoneConfig = {
  option: string;                 // nom exact de l'option Shopify (espace final compris)
  palette: string;                // sous-palette : structure | toile | rivage | parisienne…
  materiaux: string[];            // noms des matières visées dans le fichier
  teinte?: boolean;               // garder la texture d'origine et la teinter
  ech?: [number, number];         // échelle du motif dans le fichier
};

export type ZonesConfig = {
  marque?: string;
  forme?: string;                                   // URL du .bin (meshopt)
  zones?: Record<string, ZoneConfig>;
  formes?: { option: string; par_code: Record<string, string> };   // un fichier par couleur
};

export type EntreePalette = {
  n?: string;                     // nom lisible (« Carbone »)
  c?: [number, number, number];   // couleur LINÉAIRE (baseColorFactor glTF)
  r?: number;                     // rugosité imposée (finition brillante)
  t?: "url" | "embarque";         // texture à charger / texture du fichier
  u?: string;                     // URL de la texture si t = "url"
  sc?: [number, number];          // échelle Fermob du motif
};

export type Palette = Record<string, Record<string, Record<string, EntreePalette>>>;
// palette[marque][sous-palette][code] = entrée

// Une consigne de peinture prête à appliquer sur le modèle chargé.
export type Peinture = {
  materiaux: string[];
  couleur?: [number, number, number];
  rugosite?: number;
  texture?: string;               // URL (t = "url")
  garder_texture?: boolean;       // t = "embarque"
  teinte?: boolean;               // garder la texture et la teinter
  echelle?: [number, number];     // sc / ech, quand les deux sont connus
  code?: string;
  nom?: string;
};

export type VarianteZones = {
  variant_id: string;
  sku: string | null;
  titre: string | null;
  options: Record<string, string>;
  prix: number | null;
  zones?: Record<string, string> | null;   // exception par variante : zone → code
};

/** Code couleur = dernier mot de la valeur d'option, en majuscules. */
export function codeCouleur(valeur: string | null | undefined): string {
  const mots = String(valeur || "").trim().split(/\s+/);
  return (mots[mots.length - 1] || "").toUpperCase();
}

/** Valeur d'une option, en tolérant les espaces (« Couleur » vs « Couleur  »). */
function valeurOption(options: Record<string, string> | null | undefined, nom: string): string | null {
  if (!options) return null;
  if (options[nom] != null) return options[nom];
  const cible = nom.trim().toLowerCase();
  for (const [k, v] of Object.entries(options)) if (k.trim().toLowerCase() === cible) return v;
  return null;
}

/** Fichier à charger : formes.par_code si le code de la variante y est, sinon la forme. */
export function fichierZones(zones: ZonesConfig | null | undefined, options?: Record<string, string> | null): string | null {
  if (!zones) return null;
  const f = zones.formes;
  if (f?.par_code) {
    const code = codeCouleur(valeurOption(options, f.option));
    if (code && f.par_code[code]) return f.par_code[code];
  }
  return zones.forme || null;
}

/**
 * Consignes de peinture pour une variante.
 * `optionsVariante` = selectedOptions de la variante ; `zonesVariante` =
 * exception portée par la variante (zone → code).
 */
export function peintureZones(
  zones: ZonesConfig | null | undefined,
  palette: Palette | null | undefined,
  optionsVariante?: Record<string, string> | null,
  zonesVariante?: Record<string, string> | null,
): Peinture[] {
  if (!zones?.zones || !palette) return [];
  const marque = (zones.marque || "").toLowerCase();
  const parMarque = palette[marque] || palette[zones.marque || ""] || null;
  if (!parMarque) return [];
  const out: Peinture[] = [];
  for (const [nomZone, z] of Object.entries(zones.zones)) {
    if (!z?.materiaux?.length) continue;
    const code = (zonesVariante?.[nomZone] || codeCouleur(valeurOption(optionsVariante, z.option))).toUpperCase();
    if (!code) continue;
    const e = (parMarque[z.palette] || {})[code];
    if (!e) continue;                       // code inconnu → le modèle garde sa couleur de fichier
    const p: Peinture = { materiaux: z.materiaux, code, nom: e.n };
    if (typeof e.r === "number") p.rugosite = e.r;
    if (z.teinte) { p.teinte = true; if (e.c) p.couleur = e.c; }
    else if (e.t === "embarque") p.garder_texture = true;
    else if (e.t === "url" && e.u) {
      p.texture = e.u;
      if (e.sc && z.ech) p.echelle = [e.sc[0] / z.ech[0], e.sc[1] / z.ech[1]];
      if (e.c) p.couleur = e.c;             // couleur d'attente / repli
    } else if (e.c) p.couleur = e.c;
    out.push(p);
  }
  return out;
}

/** Couleurs proposables pour une fiche : une entrée par code vu sur ses variantes. */
export type ChoixCouleur = { code: string; nom: string; variant_id: string; sku: string | null; prix: number | null; apercu: string | null };
export function couleursDisponibles(zones: ZonesConfig | null | undefined, palette: Palette | null | undefined, variantes: VarianteZones[]): ChoixCouleur[] {
  if (!zones) return [];
  // La zone de référence est celle de la structure, sinon la première déclarée,
  // sinon l'option du jeu de formes (fiches à un fichier par couleur).
  const zs = zones.zones || {};
  const zRef = zs["structure"] || Object.values(zs)[0] || null;
  const option = zRef?.option || zones.formes?.option || null;
  if (!option) return [];
  const marque = (zones.marque || "").toLowerCase();
  const sousPalette = zRef ? (palette?.[marque]?.[zRef.palette] || {}) : {};
  const vus = new Set<string>();
  const out: ChoixCouleur[] = [];
  for (const v of variantes || []) {
    const valeur = valeurOption(v.options, option);
    const code = codeCouleur(valeur);
    if (!code || vus.has(code)) continue;
    vus.add(code);
    out.push({
      code,
      nom: sousPalette[code]?.n || String(valeur || code),
      variant_id: v.variant_id,
      sku: v.sku,
      prix: v.prix,
      apercu: hexDepuisLineaire(sousPalette[code]?.c),
    });
  }
  return out;
}

/** Couleur linéaire → #rrggbb (pastille d'interface seulement). */
export function hexDepuisLineaire(c?: [number, number, number] | null): string | null {
  if (!c || c.length < 3) return null;
  const v = (x: number) => {
    const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, s)) * 255).toString(16).padStart(2, "0");
  };
  return `#${v(c[0])}${v(c[1])}${v(c[2])}`;
}
