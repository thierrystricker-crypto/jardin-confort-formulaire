// lib/saferpay.ts
// ─────────────────────────────────────────────────────────────────────────────
// Client HTTP minimal pour la JSON API Saferpay (Worldline) — chantier
// « Lien carte Saferpay », 02.11.2026.
//
// On n'utilise QUE la Management API « Secure PayGate Single-Use Payment Link » :
//   POST /rest/customers/{customerId}/terminals/{terminalId}/spg-offers
//   GET  /rest/customers/{customerId}/terminals/{terminalId}/spg-offers/{offerId}
//
// 🔒 RÈGLE PCI, à ne jamais enfreindre : le client saisit sa carte sur la page
// hébergée de Saferpay, JAMAIS chez nous. Pas de Saferpay Fields, pas d'appel
// direct à l'interface de transaction avec des données de carte. C'est ce qui
// maintient Jardin-Confort dans le SAQ le plus léger (niveau 4, e-commerce,
// moins de 20 000 transactions par an — cf. fiche PCI DSS Worldline du 20.10.2026).
//
// Pièges vérifiés en conditions réelles le 02.11.2026 sur le compte de test :
//  - la Management API veut les en-têtes `Saferpay-ApiVersion` et
//    `Saferpay-RequestId` ; elle n'utilise PAS le bloc `RequestHeader` du corps,
//    contrairement à la Payment API ;
//  - l'en-tête `Content-Type: application/json; charset=utf-8` est exigé
//    MÊME SUR LES GET, sinon VALIDATION_FAILED « Content type not supported » ;
//  - `Payer.BillingAddress` est OBLIGATOIRE à la création ;
//  - `ExpirationDate` est obligatoire, au moins 1 h dans le futur et au plus
//    6 mois ;
//  - les paramètres par défaut de Secure PayGate doivent avoir été enregistrés
//    dans le Backoffice, sinon ACTION_NOT_SUPPORTED. À faire en test ET en prod.
//  - Saferpay distingue `Invalid credentials` (mot de passe faux) de
//    `Unable to authenticate request` (verrouillage temporaire après des échecs
//    répétés, qui se lève seul) — utile au diagnostic.
//
// Variables d'environnement Vercel (valeurs SANDBOX en preview, PROD en prod) :
//   SAFERPAY_BASE_URL      https://test.saferpay.com/api  |  https://www.saferpay.com/api
//   SAFERPAY_CUSTOMER_ID   287701 (test) | 382850 (prod)
//   SAFERPAY_TERMINAL_ID   17781241 (test, SPG) | 17788204 (prod, SPG)
//   SAFERPAY_API_USER      API_…
//   SAFERPAY_API_PASSWORD  …
// ─────────────────────────────────────────────────────────────────────────────

const API_VERSION = "1.55";

export type StatutSaferpay = "OPEN" | "PAID" | "EXPIRED" | "DISABLED";

export type AdresseSaferpay = {
  FirstName?: string;
  LastName?: string;
  Company?: string;
  Street: string;
  Zip: string;
  City: string;
  CountryCode: string;
  Email?: string;
};

export type OffreCreee = {
  OfferId: string;
  PaymentLink: string;
};

export type OffreRelue = {
  OfferId: string;
  PaymentLink?: string;
  Status: StatutSaferpay;
  TransactionId?: string;
  CreationDate?: string;
  ExpirationDate?: string;
  Payment?: { OrderId?: string; Description?: string; Amount?: { Value?: string; CurrencyCode?: string } };
};

type Config = {
  baseUrl: string;
  customerId: string;
  terminalId: string;
  user: string;
  password: string;
  environnement: "test" | "production";
};

export function configSaferpay(): Config | null {
  const baseUrl = (process.env.SAFERPAY_BASE_URL || "").replace(/\/+$/, "");
  const customerId = (process.env.SAFERPAY_CUSTOMER_ID || "").trim();
  const terminalId = (process.env.SAFERPAY_TERMINAL_ID || "").trim();
  const user = (process.env.SAFERPAY_API_USER || "").trim();
  const password = process.env.SAFERPAY_API_PASSWORD || "";
  if (!baseUrl || !customerId || !terminalId || !user || !password) return null;
  return {
    baseUrl,
    customerId,
    terminalId,
    user,
    password,
    // Le sandbox est reconnaissable à son hôte : on l'enregistre avec la ligne
    // pour ne jamais confondre une transaction de test avec une vraie.
    environnement: /test\.saferpay\.com/i.test(baseUrl) ? "test" : "production",
  };
}

function enTetes(cfg: Config): HeadersInit {
  const auth = Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "Saferpay-ApiVersion": API_VERSION,
    // Identifiant unique par requête : Saferpay s'en sert pour la déduplication.
    "Saferpay-RequestId": crypto.randomUUID(),
    "Content-Type": "application/json; charset=utf-8",
  };
}

// Les erreurs Saferpay arrivent en JSON { ErrorName, ErrorMessage, ErrorDetail }.
// On les remonte telles quelles : elles sont explicites et c'est ce qu'on veut
// voir dans le message d'erreur du composant plutôt qu'un « Erreur 400 ».
async function erreurLisible(res: Response): Promise<string> {
  const brut = await res.text().catch(() => "");
  try {
    const j = JSON.parse(brut) as { ErrorName?: string; ErrorMessage?: string; ErrorDetail?: string[] };
    const detail = Array.isArray(j.ErrorDetail) ? ` — ${j.ErrorDetail.join(" ")}` : "";
    if (j.ErrorName || j.ErrorMessage) return `Saferpay ${j.ErrorName ?? ""}: ${j.ErrorMessage ?? ""}${detail}`.trim();
  } catch { /* pas du JSON : on rend le texte brut tronqué */ }
  return `Saferpay HTTP ${res.status} ${brut.slice(0, 300)}`.trim();
}

function urlOffres(cfg: Config, offerId?: string): string {
  const base = `${cfg.baseUrl}/rest/customers/${cfg.customerId}/terminals/${cfg.terminalId}/spg-offers`;
  return offerId ? `${base}/${encodeURIComponent(offerId)}` : base;
}

// Montant Saferpay = chaîne en PLUS PETITE UNITÉ (centimes pour le CHF).
export function enCentimes(montantChf: number): string {
  return String(Math.round(montantChf * 100));
}

// ISO 8601 sans millisecondes (le champ est borné à 25 caractères).
export function dateExpiration(joursValidite: number): string {
  const d = new Date(Date.now() + joursValidite * 86_400_000);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function creerLienPaiement(
  cfg: Config,
  params: {
    montantChf: number;
    devise: string;
    orderId: string;
    description: string;
    langue: string;
    adresse: AdresseSaferpay;
    joursValidite: number;
    maxTentatives: 0 | 1 | 3 | 5 | 10;
  }
): Promise<OffreCreee> {
  const corps = {
    Payment: {
      Amount: { Value: enCentimes(params.montantChf), CurrencyCode: params.devise },
      OrderId: params.orderId,
      Description: params.description,
    },
    Payer: {
      LanguageCode: params.langue,
      BillingAddress: params.adresse,
    },
    ExpirationDate: dateExpiration(params.joursValidite),
    MaxPaymentAttempts: params.maxTentatives,
  };

  const res = await fetch(urlOffres(cfg), {
    method: "POST",
    headers: enTetes(cfg),
    body: JSON.stringify(corps),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await erreurLisible(res));
  const j = (await res.json()) as Partial<OffreCreee>;
  if (!j.OfferId || !j.PaymentLink) throw new Error("Saferpay n'a pas rendu OfferId / PaymentLink");
  return { OfferId: j.OfferId, PaymentLink: j.PaymentLink };
}

export async function lireLienPaiement(cfg: Config, offerId: string): Promise<OffreRelue> {
  const res = await fetch(urlOffres(cfg, offerId), {
    method: "GET",
    headers: enTetes(cfg),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await erreurLisible(res));
  return (await res.json()) as OffreRelue;
}
