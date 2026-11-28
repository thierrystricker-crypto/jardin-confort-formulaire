// lib/traductions-shopify.ts
// ─────────────────────────────────────────────────────────────────────────────
// Sentinelle traductions (28.11.2026) — accès Shopify Admin partagé entre la
// tâche nocturne, le rattrapage et le bouton « Appliquer ».
//
// Droits requis sur l'app Shopify de l'outil (Dev Dashboard « search_motor ») :
//   read_translations  (lecture)   — ajouté le 28.11.2026
//   write_translations (écriture)  — requis pour corriger
//
// Écriture : translationsRegister, avec le digest du français courant. Si le
// français a changé entre la lecture et l'écriture, Shopify refuse (digest
// périmé) : on n'écrase jamais une traduction sur un texte qu'on n'a pas lu.
// ─────────────────────────────────────────────────────────────────────────────

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_CLIENT_ID = process.env.SHOPIFY_ADMIN_CLIENT_ID;
const ADMIN_CLIENT_SECRET = process.env.SHOPIFY_ADMIN_CLIENT_SECRET;
const API = "2026-04";

let jetonCache: string | null = null;
let jetonExpire = 0;

async function jetonAdmin(): Promise<string> {
  if (jetonCache && Date.now() < jetonExpire) return jetonCache;
  if (!SHOP || !ADMIN_CLIENT_ID || !ADMIN_CLIENT_SECRET) {
    throw new Error("Accès Shopify Admin non configuré (SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_CLIENT_ID / SHOPIFY_ADMIN_CLIENT_SECRET)");
  }
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: ADMIN_CLIENT_ID, client_secret: ADMIN_CLIENT_SECRET, grant_type: "client_credentials" }),
    cache: "no-store",
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error(`Jeton Shopify Admin refusé (${res.status})`);
  jetonCache = json.access_token;
  jetonExpire = Date.now() + (json.expires_in || 3600) * 1000 - 60000;
  return jetonCache;
}

export async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let essai = 1; essai <= 4; essai++) {
    const jeton = await jetonAdmin();
    const res = await fetch(`https://${SHOP}/admin/api/${API}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": jeton },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: unknown };
    const erreurs = json.errors ? JSON.stringify(json.errors) : "";
    if ((erreurs.includes("THROTTLED") || res.status === 429) && essai < 4) {
      await new Promise((r) => setTimeout(r, 2000 * essai));
      continue;
    }
    if (!res.ok || json.errors || !json.data) {
      // Ex. « Access denied … Required access: `write_translations` » →
      // ajouter le droit à l'app Shopify (Dev Dashboard).
      throw new Error(`Shopify ${res.status} : ${(erreurs || JSON.stringify(json)).slice(0, 500)}`);
    }
    return json.data;
  }
  throw new Error("Shopify : limite de débit dépassée (4 essais)");
}

export type Locale = "de" | "en";

export type RessourceTraduisible = {
  resourceId: string;
  contenu: Map<string, { value: string; digest: string }>;   // français
  traductions: Record<Locale, Map<string, { value: string; updatedAt: string | null }>>;
};

type Noeud = {
  resourceId: string;
  translatableContent: Array<{ key: string; value: string | null; digest: string | null }>;
  de: Array<{ key: string; value: string | null; updatedAt: string | null }>;
  en: Array<{ key: string; value: string | null; updatedAt: string | null }>;
};

/** Français (avec digest) + traductions DE / EN, par lots de 50 ressources. */
export async function lireRessources(ids: string[]): Promise<RessourceTraduisible[]> {
  const q = `query($ids: [ID!]!) {
    translatableResourcesByIds(first: 50, resourceIds: $ids) {
      nodes {
        resourceId
        translatableContent { key value digest }
        de: translations(locale: "de") { key value updatedAt }
        en: translations(locale: "en") { key value updatedAt }
      }
    }
  }`;
  const out: RessourceTraduisible[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await gql<{ translatableResourcesByIds: { nodes: Noeud[] } }>(q, { ids: ids.slice(i, i + 50) });
    for (const n of data.translatableResourcesByIds.nodes) {
      const contenu = new Map<string, { value: string; digest: string }>();
      for (const c of n.translatableContent) {
        if (c.digest) contenu.set(c.key, { value: c.value ?? "", digest: c.digest });
      }
      const versMap = (l: Noeud["de"]) =>
        new Map(l.filter((t) => t.value).map((t) => [t.key, { value: t.value as string, updatedAt: t.updatedAt }]));
      out.push({ resourceId: n.resourceId, contenu, traductions: { de: versMap(n.de), en: versMap(n.en) } });
    }
  }
  return out;
}

export type TraductionAEcrire = { locale: Locale; key: string; value: string; digest: string };

/** Écrit une ou plusieurs traductions d'une ressource. Lève une erreur si Shopify refuse. */
export async function ecrireTraductions(resourceId: string, items: TraductionAEcrire[]): Promise<void> {
  if (!items.length) return;
  const q = `mutation($id: ID!, $t: [TranslationInput!]!) {
    translationsRegister(resourceId: $id, translations: $t) {
      userErrors { field message }
    }
  }`;
  const data = await gql<{ translationsRegister: { userErrors: Array<{ field: string[] | null; message: string }> } }>(q, {
    id: resourceId,
    t: items.map((i) => ({ locale: i.locale, key: i.key, value: i.value, translatableContentDigest: i.digest })),
  });
  const err = data.translationsRegister.userErrors;
  if (err.length) throw new Error(`translationsRegister : ${err.map((e) => e.message).join(" ; ").slice(0, 300)}`);
}

export type RessourceListee = { id: string; type: "produit" | "collection"; handle: string; marque: string | null };

/** Une page de produits actifs ou de collections (pour le rattrapage, par curseur). */
export async function pageRessources(
  type: RessourceListee["type"], apres: string | null, taille: number, filtre?: string
): Promise<{ ressources: RessourceListee[]; suivant: string | null }> {
  const racine = type === "produit" ? "products" : "collections";
  const champs = type === "produit" ? "id handle vendor" : "id handle";
  const q = `query($q: String, $apres: String, $n: Int!) {
    ${racine}(first: $n, after: $apres, query: $q, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes { ${champs} }
    }
  }`;
  type Page = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ id: string; handle: string; vendor?: string }> };
  const filtreFinal = [type === "produit" ? "status:active" : "", filtre ?? ""].filter(Boolean).join(" AND ") || null;
  const data = await gql<Record<string, Page>>(q, { q: filtreFinal, apres, n: taille });
  const page = data[racine];
  return {
    ressources: page.nodes.map((n) => ({ id: n.id, type, handle: n.handle, marque: n.vendor ?? null })),
    suivant: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,
  };
}

/** Message d'erreur lisible (sans « Error: » empilés). */
export function messageErreur(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
