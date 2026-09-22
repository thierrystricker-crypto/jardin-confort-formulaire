// lib/textures-dedon.ts
// Échantillons de fibre Dedon (collection 2026, fournis par Thierry le
// 22.09.2026, dossier « Dedon Fiber 2026 »), réduits à 600 px dans
// public/textures/dedon/<code>-<nom>.jpg. Clé = code coloris à 3 chiffres,
// tel qu'il figure dans les valeurs d'option Shopify (« Chestnut 151 »,
// « Black Pepper 317 + Pine 180 »).
// Usage : ambiance IA du planner — l'échantillon du coloris posé est envoyé
// à gpt-image comme référence de TEXTURE (pur tressage, aucun meuble dessus :
// rien à « emprunter », contrairement aux photos produit).

export const TEXTURES_DEDON: Record<string, { nom: string; fichier: string }> = {
  "002": { nom: "Natural", fichier: "002-natural.jpg" },
  "018": { nom: "Java", fichier: "018-java.jpg" },
  "040": { nom: "Bronze", fichier: "040-bronze.jpg" },
  "054": { nom: "Coral", fichier: "054-coral.jpg" },
  "056": { nom: "Pearl", fichier: "056-pearl.jpg" },
  "057": { nom: "Sepia Sea", fichier: "057-sepia-sea.jpg" },
  "060": { nom: "Oak", fichier: "060-oak.jpg" },
  "062": { nom: "Oasis", fichier: "062-oasis.jpg" },
  "063": { nom: "Seaside", fichier: "063-seaside.jpg" },
  "064": { nom: "Umber", fichier: "064-umber.jpg" },
  "066": { nom: "Bleach", fichier: "066-bleach.jpg" },
  "083": { nom: "Chalk", fichier: "083-chalk.jpg" },
  "099": { nom: "Vulcano", fichier: "099-vulcano.jpg" },
  "105": { nom: "Elemental", fichier: "105-elemental.jpg" },
  "106": { nom: "White Quartz", fichier: "106-white-quartz.jpg" },
  "108": { nom: "Graphite", fichier: "108-graphite.jpg" },
  "111": { nom: "Accona", fichier: "111-accona.jpg" },
  "113": { nom: "Pepper Bold Touch", fichier: "113-pepper-bold-touch.jpg" },
  "115": { nom: "Pepper", fichier: "115-pepper.jpg" },
  "116": { nom: "Marrone", fichier: "116-marrone.jpg" },
  "117": { nom: "Carrara", fichier: "117-carrara.jpg" },
  "120": { nom: "Alloro", fichier: "120-alloro.jpg" },
  "126": { nom: "Arabica", fichier: "126-arabica.jpg" },
  "127": { nom: "Forest", fichier: "127-forest.jpg" },
  "128": { nom: "Cloud", fichier: "128-cloud.jpg" },
  "129": { nom: "Terra", fichier: "129-terra.jpg" },
  "130": { nom: "Rock", fichier: "130-rock.jpg" },
  "140": { nom: "Sea Salt", fichier: "140-sea-salt.jpg" },
  "141": { nom: "Baltic", fichier: "141-baltic.jpg" },
  "147": { nom: "Alba", fichier: "147-alba.jpg" },
  "148": { nom: "Bosco", fichier: "148-bosco.jpg" },
  "151": { nom: "Chestnut", fichier: "151-chestnut.jpg" },
  "154": { nom: "Silver Beige", fichier: "154-silver-beige.jpg" },
  "162": { nom: "Silt", fichier: "162-silt.jpg" },
  "164": { nom: "Rioja", fichier: "164-rioja.jpg" },
  "165": { nom: "Ubud", fichier: "165-ubud.jpg" },
  "166": { nom: "Cuba", fichier: "166-cuba.jpg" },
  "167": { nom: "Ibiza", fichier: "167-ibiza.jpg" },
  "168": { nom: "Bahamas", fichier: "168-bahamas.jpg" },
  "170": { nom: "Glow Touch", fichier: "170-glow-touch.jpg" },
  "171": { nom: "Ease Touch", fichier: "171-ease-touch.jpg" },
  "173": { nom: "Silica", fichier: "173-silica.jpg" },
  "174": { nom: "Tobacco", fichier: "174-tobacco.jpg" },
  "175": { nom: "Azure", fichier: "175-azure.jpg" },
  "176": { nom: "Savanna", fichier: "176-savanna.jpg" },
  "177": { nom: "Citrine", fichier: "177-citrine.jpg" },
  "178": { nom: "Marl", fichier: "178-marl.jpg" },
  "179": { nom: "Riviera", fichier: "179-riviera.jpg" },
  "187": { nom: "Coffee", fichier: "187-coffee.jpg" },
  "189": { nom: "Cedar", fichier: "189-cedar.jpg" },
  "196": { nom: "Nectar", fichier: "196-nectar.jpg" },
  "198": { nom: "Liana Touch", fichier: "198-liana-touch.jpg" },
  "199": { nom: "Willow Touch", fichier: "199-willow-touch.jpg" },
  "206": { nom: "Shade Touch", fichier: "206-shade-touch.jpg" },
  "210": { nom: "Summit", fichier: "210-summit.jpg" },
  "211": { nom: "Titan", fichier: "211-titan.jpg" },
  "215": { nom: "Line Touch", fichier: "215-line-touch.jpg" },
  "216": { nom: "Mystique Dusk", fichier: "216-mystique-dusk.jpg" },
  "217": { nom: "Bliss Touch", fichier: "217-bliss-touch.jpg" },
  "218": { nom: "Invert Twilight", fichier: "218-invert-twilight.jpg" },
  "219": { nom: "Invert Nightfall", fichier: "219-invert-nightfall.jpg" },
  "221": { nom: "Spring Mist", fichier: "221-spring-mist.jpg" },
  "223": { nom: "Pearl Sand", fichier: "223-pearl-sand.jpg" },
  "227": { nom: "Chestnut Cham", fichier: "227-chestnut-cham.jpg" },
  "230": { nom: "Sundust", fichier: "230-sundust.jpg" },
  "231": { nom: "Sahara", fichier: "231-sahara.jpg" },
  "232": { nom: "Lagoon", fichier: "232-lagoon.jpg" },
  "233": { nom: "Mahagony", fichier: "233-mahagony.jpg" },
  "235": { nom: "Cedar Touch", fichier: "235-cedar-touch.jpg" },
  "236": { nom: "Arpa Touch", fichier: "236-arpa-touch.jpg" },
  "239": { nom: "Kapok", fichier: "239-kapok.jpg" },
  "240": { nom: "Salak", fichier: "240-salak.jpg" },
  "245": { nom: "Myroca", fichier: "245-myroca.jpg" },
  "246": { nom: "Mymara", fichier: "246-mymara.jpg" },
  "248": { nom: "Myemba", fichier: "248-myemba.jpg" },
  "249": { nom: "Myezra", fichier: "249-myezra.jpg" },
  "250": { nom: "Myvera", fichier: "250-myvera.jpg" },
  "730": { nom: "Olive", fichier: "730-olive.jpg" },
};

// Premier code d'option qui correspond à un échantillon connu.
export function textureDedon(valeursOptions: string[]): { code: string; nom: string; fichier: string } | null {
  for (const v of valeursOptions) {
    for (const m of String(v).matchAll(/(?<!\d)(\d{3})(?!\d)/g)) {
      const t = TEXTURES_DEDON[m[1]];
      if (t) return { code: m[1], ...t };
    }
  }
  return null;
}
