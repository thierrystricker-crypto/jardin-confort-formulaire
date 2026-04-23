"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type FormType = "Offre" | "Commande";
type ClientType = "Privé (prix TTC)" | "Pro (prix HT)";
type PaymentMode =
  | "Paiement d'avance à la commande"
  | "Acompte de 50% à la commande"
  | "Paiement à 30 jours";
type DeliveryMode = "Livraison à domicile" | "À l'emporter";
type OfferStatus = "En cours" | "Envoyée" | "Acceptée" | "Refusée";

// Type retourné par l'API /api/shopify-search
type ShopifyItem = {
  id: string;
  sku: string;
  variant: string;
  price: string;
  compareAtPrice: string | null;
  stock: number | null;
  productUrl: string;
  variantImage: string;
  image1: string;
  image2: string;
  image3: string;
  delaiLivraison?: string;
};

type QuoteLine = {
  id: string;
  type: "product" | "custom" | "comment"; // comment = ligne de texte sans prix
  image?: string;
  sku: string;
  title: string;
  unitPrice: number;
  qty: number;
  stock?: number | null | "sur_commande";
  lineDiscount?: number; // remise en CHF sur cette ligne uniquement
};

type DraftSnapshot = {
  formType: FormType;
  clientType: ClientType;
  paymentMode: PaymentMode;
  deliveryMode: DeliveryMode;
  offerStatus: OfferStatus;
  date: string;
  commercial: string;
  offerNumber: string;
  reference: string;
  societe: string;
  nom: string;
  prenom: string;
  rue: string;
  rue2: string;
  numero: string;
  npa: string;
  ville: string;
  telephone1: string;
  telephone2: string;
  email: string;
  livrDiff: boolean;
  livrSociete: string;
  livrNom: string;
  livrPrenom: string;
  livrTel: string;
  livrRue: string;
  livrRue2: string;
  livrNumero: string;
  livrNpa: string;
  livrVille: string;
  lines: QuoteLine[];
  discount: string;
  discountPercent: string;
  remarks: string;
  notesInternes: string;
  leadTime: string;
  manualRounding: string; // stocké pour compatibilité
  enabledServices: Record<string, boolean>;
  servicePrices: Record<string, string>;
};

// ── Services selon le document Jardin-Confort ──
const serviceOptions = [
  { code: "montage",       label: "Frais de montage",                                    defaultPrice: "" as unknown as number  },
  { code: "poste",         label: "Livraison des colis par La Poste",                    defaultPrice: "" as unknown as number  },
  { code: "trottoir",      label: "Livraison colis franco trottoir par transporteur",    defaultPrice: 60  },
  { code: "etage",         label: "Livraison « à l'étage » et déballage des articles",  defaultPrice: 80  },
  { code: "etage_montage", label: "Livraison « à l'étage », déballage et montage",      defaultPrice: 120 },
  { code: "reprise",       label: "Reprise et recyclage des anciens meubles",            defaultPrice: 60  },
];

// TVA Suisse 2024 : 8.1%
const TVA_RATE = 0.081;
const STORAGE_KEY = "jc-offre-v15-draft";

const STATUS_CONFIG: Record<OfferStatus, { color: string; bg: string; border: string }> = {
  "En cours": { color: "#f59e0b", bg: "rgba(245,158,11,0.15)",  border: "rgba(245,158,11,0.4)"  },
  "Envoyée":  { color: "#60a5fa", bg: "rgba(96,165,250,0.15)",  border: "rgba(96,165,250,0.4)"  },
  "Acceptée": { color: "#4ade80", bg: "rgba(74,222,128,0.15)",  border: "rgba(74,222,128,0.4)"  },
  "Refusée":  { color: "#f87171", bg: "rgba(248,113,113,0.15)", border: "rgba(248,113,113,0.4)" },
};

function formatMoney(value: number) {
  // Format suisse avec points : CHF 1'234.90
  const formatted = new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
  return `CHF ${formatted}`;
}

function todayForInput() { return new Date().toISOString().slice(0, 10); }

function generateOfferNumber() {
  // Le vrai numéro DEV-2026-XXX est généré par Supabase au moment de l'enregistrement
  // On retourne une chaîne vide — le numéro s'affiche après "Enregistrer & URL"
  return "";
}

function generateCustomerNumber(email: string) {
  if (!email.trim()) return "";
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) % 100000;
  return `CL-${String(hash).padStart(5, "0")}`;
}

function normalizeSwissPhone(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  let n = digits;
  if (n.startsWith("0041")) n = "41" + n.slice(4);
  else if (n.startsWith("0")) n = "41" + n.slice(1);
  else if (!n.startsWith("41")) n = "41" + n;
  const t = n.slice(0, 11);
  return ["+" + t.slice(0, 2), t.slice(2, 4), t.slice(4, 7), t.slice(7, 9), t.slice(9, 11)].filter(Boolean).join(" ");
}

function sanitizeNpa(v: string) { return v.replace(/[^\d]/g, "").slice(0, 4); }

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function cloneLines(lines: QuoteLine[]) { return lines.map((l) => ({ ...l })); }

const initialEnabledServices = Object.fromEntries(serviceOptions.map((s) => [s.code, false]));
const initialServicePrices   = Object.fromEntries(serviceOptions.map((s) => [s.code, String(s.defaultPrice)]));

type PlaceSuggestion = {
  placeId: string;
  label: string;
  road?: string;
  houseNumber?: string;
  postcode?: string;
  city?: string;
};

export default function JardinConfortV7() {
  const [formType, setFormType]       = useState<FormType>("Offre");
  const [clientType, setClientType]   = useState<ClientType>("Privé (prix TTC)");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("Paiement d'avance à la commande");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("Livraison à domicile");
  const [offerStatus, setOfferStatus] = useState<OfferStatus>("En cours");
  const [date, setDate]               = useState(todayForInput());
  const [commercial, setCommercial]   = useState("");
  const [offerNumber, setOfferNumber] = useState(() => generateOfferNumber());

  const [societe, setSociete]         = useState("");
  const [nom, setNom]                 = useState("");
  const [prenom, setPrenom]           = useState("");
  const [rue, setRue]                 = useState("");
  const [numero, setNumero]           = useState("");
  const [rue2, setRue2]               = useState("");
  const [npa, setNpa]                 = useState("");
  const [ville, setVille]             = useState("");
  const [telephone1, setTelephone1]   = useState("");
  const [telephone2, setTelephone2]   = useState("");
  const [email, setEmail]             = useState("");

  // Adresse de livraison (si différente)
  const [livrDiff, setLivrDiff]       = useState(false);
  const [livrSociete, setLivrSociete] = useState("");
  const [livrNom, setLivrNom]         = useState("");
  const [livrPrenom, setLivrPrenom]   = useState("");
  const [livrTel, setLivrTel]         = useState("");
  const [livrRue, setLivrRue]         = useState("");
  const [livrRue2, setLivrRue2]       = useState("");
  const [livrNumero, setLivrNumero]   = useState("");
  const [livrNpa, setLivrNpa]         = useState("");
  const [livrVille, setLivrVille]     = useState("");

  // Référence commande
  const [reference, setReference]     = useState("");

  const [search, setSearch]           = useState("");
  // ── Moteur de recherche Shopify réel ──
  const [shopifyItems, setShopifyItems]     = useState<ShopifyItem[]>([]);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyError, setShopifyError]     = useState("");

  const [lines, setLines]             = useState<QuoteLine[]>([]);

  const [customSku, setCustomSku]       = useState("");
  const [customTitle, setCustomTitle]   = useState("");
  const [customPrice, setCustomPrice]   = useState("");
  const [customQty, setCustomQty]       = useState("1");
  const [customStock, setCustomStock]   = useState("");
  const [customImage, setCustomImage]   = useState("");
  const [discount, setDiscount]         = useState("0");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [remarks, setRemarks]           = useState("");
  const [notesInternes, setNotesInternes] = useState("");
  const [ambianceImages, setAmbianceImages] = useState<{id: string; dataUrl: string; legende: string}[]>([]);
  const [leadTime, setLeadTime]         = useState("25-30 jours");
  // arrondi : toujours stocké comme string, toujours <= 0
  const [roundingStr, setRoundingStr]   = useState("");
  // Autocomplétion adresse — Google Places
  const [enabledServices, setEnabledServices] = useState<Record<string, boolean>>(initialEnabledServices);
  const [servicePrices, setServicePrices]     = useState<Record<string, string>>(initialServicePrices);

  const [undoSnapshot, setUndoSnapshot]     = useState<QuoteLine[] | null>(null);
  const [draftSavedAt, setDraftSavedAt]     = useState("");
  const [draggedLineId, setDraggedLineId]   = useState<string | null>(null);
  const [justAddedLineId, setJustAddedLineId] = useState<string | null>(null);
  const [flashProductId, setFlashProductId] = useState<string | null>(null);
  const [draggedAmbianceId, setDraggedAmbianceId] = useState<string | null>(null);
  const [openDiscountLines, setOpenDiscountLines] = useState<Set<string>>(new Set());
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [activeTab, setActiveTab]           = useState<"shopify" | "custom">("shopify");
  const [darkMode, setDarkMode]             = useState(true);
  const [wideMode, setWideMode]             = useState(true);
  const [filterInStock, setFilterInStock]   = useState(false);

  // ── Supabase — sauvegarde en base ──
  const [publicUrl, setPublicUrl]           = useState("");
  const [isSaving, setIsSaving]             = useState(false);
  const [saveError, setSaveError]           = useState("");
  const [showUrlBanner, setShowUrlBanner]   = useState(false);

  const customImageInputRef = useRef<HTMLInputElement | null>(null);
  const remarksEditorRef = useRef<HTMLDivElement | null>(null);
  const addrDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livrDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clientSuggestions, setClientSuggestions] = useState<{
    id: number; numero_client: string; nom: string; prenom: string | null;
    societe: string | null; email: string | null; tel1: string | null; tel2: string | null;
    rue: string | null; rue2: string | null; numero_rue: string | null;
    npa: string | null; ville: string | null;
  }[]>([]);
  const [clientSearchField, setClientSearchField] = useState<"nom"|"email"|"tel"|null>(null)
  const [selectedClientId, setSelectedClientId] = useState<number|null>(null)

  async function searchClients(q: string, field: "nom"|"email"|"tel") {
    if (q.length < 2) { setClientSuggestions([]); return }
    try {
      // Pour le tel, chercher aussi avec les chiffres bruts
      let searchQ = q
      if (field === "tel") {
        let digits = q.replace(/[^\d]/g, "")
        // Normaliser : enlever le préfixe 0041 ou 41
        if (digits.startsWith("0041")) digits = digits.slice(4)
        else if (digits.startsWith("41") && digits.length > 8) digits = digits.slice(2)
        else if (digits.startsWith("0")) digits = digits.slice(1)
        searchQ = digits.length >= 2 ? digits : q
      }
      const res = await fetch(`/api/clients?q=${encodeURIComponent(searchQ)}&limit=5`)
      const json = await res.json()
      setClientSuggestions(json.clients || [])
      setClientSearchField(field)
    } catch { setClientSuggestions([]) }
  }

  function applyClient(c: typeof clientSuggestions[0]) {
    setNom(c.nom || "")
    setPrenom(c.prenom || "")
    setSociete(c.societe || "")
    setEmail(c.email || "")
    setTelephone1(c.tel1 || "")
    setTelephone2(c.tel2 || "")
    const rueComplete = [c.rue, c.numero_rue].filter(Boolean).join(" ")
    setRue(rueComplete)
    setRue2(c.rue2 || "")
    setNpa(c.npa || "")
    setVille(c.ville || "")
    setSelectedClientId(c.id)
    setClientSuggestions([])
  }

  function onClientFieldChange(val: string, field: "nom"|"email"|"tel", setter: (v:string)=>void) {
    setter(val)
    setSelectedClientId(null)
    if (clientSearchRef.current) clearTimeout(clientSearchRef.current)
    clientSearchRef.current = setTimeout(() => searchClients(val, field), 300)
  }

  function closeClientDropdown() {
    setTimeout(() => setClientSuggestions([]), 200)
  }

  // ── Google Places Autocomplete ──
  // State pour les deux champs d'adresse
  const [addrSuggestions, setAddrSuggestions]         = useState<PlaceSuggestion[]>([]);
  const [livrAddrSuggestions, setLivrAddrSuggestions] = useState<PlaceSuggestion[]>([]);

  // Charger le script Google Maps — non nécessaire avec le proxy /api/places

  async function fetchGoogleSuggestions(query: string): Promise<PlaceSuggestion[]> {
    if (query.length < 3) return [];
    try {
      const res = await fetch(`/api/places?type=autocomplete&q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (json.status !== "OK" && json.status !== "ZERO_RESULTS") return [];
      return (json.predictions || []).map((p: {place_id: string; description: string}) => ({
        placeId: p.place_id,
        label: p.description.replace(", Suisse", "").replace(", Switzerland", ""),
      }));
    } catch { return []; }
  }

  async function fetchPlaceDetails(placeId: string): Promise<PlaceSuggestion | null> {
    try {
      const res = await fetch(`/api/places?type=details&place_id=${encodeURIComponent(placeId)}`);
      const json = await res.json();
      if (json.status !== "OK") return null;
      const comps: {types: string[]; long_name: string; short_name: string}[] = json.result?.address_components || [];
      const get = (type: string) => comps.find(c => c.types.includes(type))?.long_name || "";
      const getShort = (type: string) => comps.find(c => c.types.includes(type))?.short_name || "";
      return {
        placeId,
        label: "",
        road: get("route"),
        houseNumber: get("street_number"),
        postcode: getShort("postal_code").slice(0, 4),
        city: get("locality") || get("administrative_area_level_2"),
      };
    } catch { return null; }
  }

  // Adresse facturation
  function onRueChange(val: string) {
    setRue(val);
    if (addrDebounceRef.current) clearTimeout(addrDebounceRef.current);
    addrDebounceRef.current = setTimeout(async () => {
      const suggestions = await fetchGoogleSuggestions(val);
      setAddrSuggestions(suggestions);
    }, 400);
  }

  async function applyAddrSuggestion(s: PlaceSuggestion) {
    setAddrSuggestions([]);
    const details = await fetchPlaceDetails(s.placeId);
    if (details) {
      if (details.road) setRue(details.road);
      if (details.houseNumber) setNumero(details.houseNumber); else setNumero("");
      if (details.postcode) setNpa(details.postcode);
      if (details.city) setVille(details.city);
    } else {
      // Fallback : afficher le label brut
      setRue(s.label);
    }
  }

  // Adresse livraison
  function onLivrRueChange(val: string) {
    setLivrRue(val);
    if (livrDebounceRef.current) clearTimeout(livrDebounceRef.current);
    livrDebounceRef.current = setTimeout(async () => {
      const suggestions = await fetchGoogleSuggestions(val);
      setLivrAddrSuggestions(suggestions);
    }, 400);
  }

  async function applyLivrSuggestion(s: PlaceSuggestion) {
    setLivrAddrSuggestions([]);
    const details = await fetchPlaceDetails(s.placeId);
    if (details) {
      if (details.road) setLivrRue(details.road);
      if (details.houseNumber) setLivrNumero(details.houseNumber); else setLivrNumero("");
      if (details.postcode) setLivrNpa(details.postcode);
      if (details.city) setLivrVille(details.city);
    } else {
      setLivrRue(s.label);
    }
  }
  const customerNumber = useMemo(() => generateCustomerNumber(email), [email]);

  // ── Recherche Shopify avec debounce 250ms + AbortController ──
  useEffect(() => {
    const trimmed = search.trim();
    if (!trimmed) {
      setShopifyItems([]);
      setShopifyError("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setShopifyLoading(true);
        setShopifyError("");
        const res = await fetch(`/api/shopify-search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Erreur de recherche");
        setShopifyItems(json.items || []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setShopifyError((err as Error).message || "Erreur inconnue");
          setShopifyItems([]);
        }
      } finally {
        setShopifyLoading(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search]);

  const subTotal = useMemo(() =>
    lines.reduce((s, l) => {
      if (l.type === "comment") return s;
      const lineTotal = l.qty * l.unitPrice - (l.lineDiscount || 0);
      return s + lineTotal;
    }, 0),
    [lines]
  );

  const discountValue = useMemo(() => {
    const pct = Number(discountPercent || 0);
    if (pct > 0) return Math.round(subTotal * pct) / 100;
    return Number(discount || 0);
  }, [discount, discountPercent, subTotal]);

  const serviceTotal = useMemo(() => {
    const fixed = serviceOptions.reduce((s, srv) => {
      if (!enabledServices[srv.code]) return s;
      return s + Number(servicePrices[srv.code] || 0);
    }, 0);
    const custom = enabledServices["custom"] ? Number(servicePrices["custom"] || 0) : 0;
    return fixed + custom;
  }, [enabledServices, servicePrices]);

  const totalAfterDiscount = subTotal - discountValue;
  const totalPlusServices  = totalAfterDiscount + serviceTotal;

  // Arrondi : toujours négatif ou zéro
  const roundingValue = Math.min(0, Number(roundingStr) || 0);
  const totalAfterRounding = totalPlusServices + roundingValue;

  // ── TVA calculée DEPUIS LE TOTAL FINAL (après arrondi) ──
  const isPrivateTTC = clientType === "Privé (prix TTC)";

  // Privé TTC  : TVA incluse dans le prix → extraction
  // Pro HT     : TVA à ajouter
  const tvaAmount = isPrivateTTC
    ? totalAfterRounding - totalAfterRounding / (1 + TVA_RATE)
    : totalAfterRounding * TVA_RATE;

  const finalTotal = isPrivateTTC
    ? totalAfterRounding               // TTC déjà inclus
    : totalAfterRounding + tvaAmount;  // HT + TVA

  const missingRequired = { nom: !nom.trim(), ville: !ville.trim(), email: !email.trim(), commercial: !commercial.trim() };
  const isFormValid = !missingRequired.nom && !missingRequired.ville && !missingRequired.email && !missingRequired.commercial;

  // ── helpers ──
  function captureUndo() { setUndoSnapshot(cloneLines(lines)); }
  function highlightAdded(id: string) {
    setJustAddedLineId(id);
    window.setTimeout(() => setJustAddedLineId((c) => (c === id ? null : c)), 1400);
  }

  function addShopifyItem(item: ShopifyItem) {
    captureUndo();
    const id = `shopify-${Date.now()}`;
    const stockVal: QuoteLine["stock"] = item.stock === null ? null : item.stock === 0 ? "sur_commande" : item.stock;
    const price = parseFloat(item.price) || 0
    const compareAt = item.compareAtPrice ? parseFloat(item.compareAtPrice) : 0
    const hasPromo = compareAt > price
    setLines((c) => [...c, {
      id,
      type: "product",
      image: item.variantImage,
      sku: item.sku,
      title: item.variant,
      unitPrice: hasPromo ? compareAt : price,
      qty: 1,
      stock: stockVal,
      lineDiscount: hasPromo ? Math.round((compareAt - price) * 100) / 100 : 0,
    }]);
    highlightAdded(id);
    setFlashProductId(item.id);
    window.setTimeout(() => setFlashProductId((c) => c === item.id ? null : c), 900);
  }

  function addCustomLine() {
    captureUndo();
    const id = `custom-${Date.now()}`;
    const stockParsed = customStock.trim() === "" ? null : parseInt(customStock, 10);
    setLines((c) => [...c, { id, type: "custom", image: customImage, sku: customSku.trim(), title: customTitle.trim(), unitPrice: Number(customPrice || 0), qty: Math.max(1, parseInt(customQty || "1", 10)), stock: isNaN(stockParsed as number) ? null : stockParsed }]);
    setCustomSku(""); setCustomTitle(""); setCustomPrice(""); setCustomQty("1"); setCustomStock(""); setCustomImage("");
    if (customImageInputRef.current) customImageInputRef.current.value = "";
    highlightAdded(id);
  }

  function updateLine(id: string, patch: Partial<QuoteLine>) {
    setLines((c) => c.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLine(id: string) { captureUndo(); setLines((c) => c.filter((l) => l.id !== id)); }
  function undoLastChange() { if (!undoSnapshot) return; setLines(cloneLines(undoSnapshot)); setUndoSnapshot(null); }

  function reorderLines(fromId: string, toId: string) {
    if (fromId === toId) return;
    captureUndo();
    setLines((c) => {
      const fi = c.findIndex((l) => l.id === fromId);
      const ti = c.findIndex((l) => l.id === toId);
      if (fi < 0 || ti < 0) return c;
      const clone = [...c];
      const [moved] = clone.splice(fi, 1);
      clone.splice(ti, 0, moved);
      return clone;
    });
  }

  function makeSnapshot(): DraftSnapshot {
    return { formType, clientType, paymentMode, deliveryMode, offerStatus, date, commercial, offerNumber, reference, societe, nom, prenom, rue, rue2, numero, npa, ville, telephone1, telephone2, email, livrDiff, livrSociete, livrNom, livrPrenom, livrTel, livrRue, livrRue2, livrNumero, livrNpa, livrVille, lines: cloneLines(lines), discount, discountPercent, remarks, notesInternes, leadTime, manualRounding: roundingStr, enabledServices: { ...enabledServices }, servicePrices: { ...servicePrices } };
  }

  // ── Sauvegarder dans Supabase + générer numéro + URL publique ──
  async function saveToSupabase() {
    if (!commercial.trim()) { setSaveError("Commercial requis"); return; }
    if (!nom.trim()) { setSaveError("Le nom du client est obligatoire."); return; }
    if (!email.trim()) { setSaveError("L'email du client est obligatoire."); return; }
    if (!ville.trim()) { setSaveError("La ville du client est obligatoire."); return; }
    setIsSaving(true); setSaveError("");
    try {
      const snap = { ...makeSnapshot(), ambianceImages };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
      setDraftSavedAt(new Date().toLocaleString("fr-CH"));

      const res = await fetch("/api/offres/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: snap }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur serveur");

      // Mettre à jour le numéro affiché avec le vrai numéro DEV/CMD
      if (json.numeroAffiche) {
        setOfferNumber(json.numeroAffiche);
        // Sauvegarder aussi en local avec le bon numéro
        const snapWithNum = { ...snap, offerNumber: json.numeroAffiche };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapWithNum));
      }

      setPublicUrl(json.publicUrl);
      setShowUrlBanner(true);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  // ── Ouvrir le template d'impression dans un nouvel onglet ──
  function openPrint() {
    const snap = { ...makeSnapshot(), ambianceImages };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    window.open("/print/offre", "_blank");
  }

  function saveDraftLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(makeSnapshot()));
    setDraftSavedAt(new Date().toLocaleString("fr-CH"));
  }

  function loadDraftLocal() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s: DraftSnapshot = JSON.parse(raw);
    setFormType(s.formType); setClientType(s.clientType); setPaymentMode(s.paymentMode);
    setDeliveryMode((s as any).deliveryMode || "Livraison à domicile");
    setOfferStatus(s.offerStatus || "En cours"); setDate(s.date); setCommercial(s.commercial);
    setOfferNumber(s.offerNumber); setReference(s.reference || "");
    setSociete(s.societe); setNom(s.nom); setPrenom(s.prenom);
    setRue(s.rue); setRue2((s as any).rue2 || ""); setNumero(s.numero); setNpa(s.npa); setVille(s.ville);
    setTelephone1(s.telephone1); setTelephone2(s.telephone2); setEmail(s.email);
    setLivrDiff(s.livrDiff || false); setLivrSociete(s.livrSociete || "");
    setLivrNom(s.livrNom || ""); setLivrPrenom(s.livrPrenom || "");
    setLivrTel(s.livrTel || ""); setLivrRue(s.livrRue || ""); setLivrRue2((s as any).livrRue2 || "");
    setLivrNumero(s.livrNumero || ""); setLivrNpa(s.livrNpa || ""); setLivrVille(s.livrVille || "");
    setLines(cloneLines(s.lines)); setDiscount(s.discount); setDiscountPercent(s.discountPercent || "0");
    setRemarks(s.remarks); setNotesInternes(s.notesInternes || "");
    setLeadTime(s.leadTime); setRoundingStr(s.manualRounding || "");
    setEnabledServices({ ...initialEnabledServices, ...s.enabledServices });
    setServicePrices({ ...initialServicePrices, ...s.servicePrices });
    setDraftSavedAt(new Date().toLocaleString("fr-CH"));
  }

  function resetForm() {
    setFormType("Offre"); setClientType("Privé (prix TTC)"); setPaymentMode("Paiement d'avance à la commande");
    setOfferStatus("En cours"); setDate(todayForInput()); setOfferNumber(generateOfferNumber());
    setReference(""); setSociete(""); setNom(""); setPrenom(""); setRue(""); setRue2(""); setNumero(""); setNpa(""); setVille("");
    setTelephone1(""); setTelephone2(""); setEmail(""); setDeliveryMode("Livraison à domicile");
    setLivrDiff(false); setLivrSociete(""); setLivrNom(""); setLivrPrenom("");
    setLivrTel(""); setLivrRue(""); setLivrRue2(""); setLivrNumero(""); setLivrNpa(""); setLivrVille("");
    setLines([]); setDiscount("0");
    setDiscountPercent("0"); setRemarks(""); setNotesInternes(""); setAmbianceImages([]);
    setLeadTime("25-30 jours"); setRoundingStr("");
    setEnabledServices({ ...initialEnabledServices }); setServicePrices({ ...initialServicePrices });
    setUndoSnapshot(null); setShowResetConfirm(false);
  }

  async function onCustomImageChange(file?: File | null) { if (!file) return; setCustomImage(await readFileAsDataUrl(file)); }
  async function onLineImageChange(id: string, file?: File | null) { if (!file) return; updateLine(id, { image: await readFileAsDataUrl(file) }); }
  async function onLineImageDrop(id: string, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) await onLineImageChange(id, file);
  }

  useEffect(() => {
    document.title = `Jardin-Confort | ${formType} ${offerNumber}`;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) setDraftSavedAt("Brouillon local trouvé");
  }, [formType, offerNumber]);

  // ── Préfill depuis URL ?prefill=... (venant du dashboard) ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);

    // Copie complète depuis dashboard (localStorage)
    if (params.get("from_copy") === "1") {
      const copyRaw = localStorage.getItem("jc-offre-copy")
      localStorage.removeItem("jc-offre-copy")
      if (copyRaw) {
        try {
          const p = JSON.parse(copyRaw)
          if (p.nom) setNom(p.nom); if (p.prenom) setPrenom(p.prenom)
          if (p.societe) setSociete(p.societe); if (p.email) setEmail(p.email)
          if (p.telephone1) setTelephone1(p.telephone1); if (p.rue) setRue(p.rue)
          if (p.npa) setNpa(p.npa); if (p.ville) setVille(p.ville)
          if (p.commercial) setCommercial(p.commercial)
          if (p.lines) setLines(p.lines.map((l: QuoteLine) => ({...l, id:`copy-${Date.now()}-${Math.random()}`})))
          if (p.discount) setDiscount(p.discount)
          if (p.discountPercent) setDiscountPercent(p.discountPercent)
          if (p.enabledServices) setEnabledServices({...initialEnabledServices, ...p.enabledServices})
          if (p.servicePrices) setServicePrices({...initialServicePrices, ...p.servicePrices})
          if (p.leadTime) setLeadTime(p.leadTime)
          if (p.paymentMode) setPaymentMode(p.paymentMode)
          if (p.deliveryMode) setDeliveryMode(p.deliveryMode as DeliveryMode)
          if (p.remarks) setRemarks(p.remarks)
        } catch { /* ignore */ }
      }
      return
    }

    const prefillRaw = params.get("prefill");
    if (!prefillRaw) return;
    try {
      const p = JSON.parse(decodeURIComponent(prefillRaw));
      if (p.nom) setNom(p.nom);
      if (p.prenom) setPrenom(p.prenom);
      if (p.societe) setSociete(p.societe);
      if (p.email) setEmail(p.email);
      if (p.telephone1) setTelephone1(p.telephone1);
      if (p.rue) setRue(p.rue);
      if (p.npa) setNpa(p.npa);
      if (p.ville) setVille(p.ville);
      if (p.commercial) setCommercial(p.commercial);
    } catch { /* ignore */ }
  }, []);

  // ── Auto-resize toutes les textareas titre au rendu ──
  useEffect(() => {
    document.querySelectorAll<HTMLTextAreaElement>("textarea.jc-title-input").forEach((ta) => {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    });
  }, [lines]);

  // ── Forcer LTR sur l'éditeur contentEditable — useLayoutEffect + MutationObserver ──
  useLayoutEffect(() => {
    const el = remarksEditorRef.current;
    if (!el) return;
    const forceLTR = () => {
      el.style.setProperty("direction", "ltr", "important");
      el.style.setProperty("text-align", "left", "important");
      el.style.setProperty("unicode-bidi", "embed", "important");
      el.setAttribute("dir", "ltr");
    };
    forceLTR();
    const obs = new MutationObserver(forceLTR);
    obs.observe(el, { attributes: true, attributeFilter: ["style", "dir"] });
    return () => obs.disconnect();
  }, []);

  return (
    <div className={`jc-page${darkMode ? "" : " light-mode"}`}>

      {/* ── TOP BAR ── */}
      <header className="jc-topbar screenOnly">
        <div className="jc-topbar-left">
          {/* Logo Jardin-Confort avec coins arrondis comme le dashboard */}
          <div className="jc-logo-wrap">
            <img
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/picto_jardin_confort_apple_low.png?v=1775944940"
              alt="Jardin-Confort"
              className="jc-logo-img"
            />
          </div>
          <div>
            <div className="jc-eyebrow">Jardin-Confort · Formulaire</div>
            <h1 className="jc-title">Nouvelle {formType}</h1>
          </div>
        </div>
        <div className="jc-toolbar">
          <a href="/dashboard" target="_blank" rel="noopener noreferrer" className="jc-btn jc-btn-ghost">📊 Dashboard</a>
          <button className="jc-btn jc-btn-ghost" onClick={() => setDarkMode((d) => !d)}>
            {darkMode ? "☀️ Mode clair" : "🌙 Mode sombre"}
          </button>
          <button className="jc-btn jc-btn-ghost" onClick={() => setWideMode((w) => !w)} title="Mode grand écran — recherche à droite">
            {wideMode ? "◧ Mode normal" : "⬛ Grand écran"}
          </button>
          {showResetConfirm ? (
            <>
              <span className="jc-warn-inline">Effacer tout ?</span>
              <button className="jc-btn jc-btn-danger" onClick={resetForm}>Confirmer</button>
              <button className="jc-btn jc-btn-ghost" onClick={() => setShowResetConfirm(false)}>Annuler</button>
            </>
          ) : (
            <button className="jc-btn jc-btn-ghost" onClick={() => setShowResetConfirm(true)}>🔄 Nouvelle offre</button>
          )}
          <button className="jc-btn jc-btn-ghost" onClick={loadDraftLocal}>📂 Charger</button>
          <button className="jc-btn jc-btn-ghost" onClick={saveDraftLocal}>💾 Brouillon</button>
          <button className="jc-btn jc-btn-ghost" disabled={!undoSnapshot} onClick={undoLastChange}>↩ Undo</button>
          <button
            className="jc-btn jc-btn-save-cloud"
            onClick={saveToSupabase}
            disabled={isSaving}
            title="Enregistrer dans la base de données et générer une URL publique"
          >
            {isSaving ? "⏳ Enregistrement…" : "☁️ Enregistrer & URL"}
          </button>
          <button className="jc-btn jc-btn-primary" onClick={openPrint}>👁 Aperçu</button>
        </div>
      </header>

      {/* ── BANNIÈRE URL PUBLIQUE ── */}
      {showUrlBanner && publicUrl && (
        <div className="jc-url-banner screenOnly">
          <div className="jc-url-banner-content">
            <span className="jc-url-banner-label">✅ Offre enregistrée · URL publique :</span>
            <a className="jc-url-banner-link" href={publicUrl} target="_blank" rel="noopener noreferrer">
              {publicUrl}
            </a>
            <button
              className="jc-url-copy-btn"
              onClick={() => { navigator.clipboard.writeText(publicUrl); }}
              title="Copier l'URL"
            >📋 Copier</button>
            <button className="jc-url-close-btn" onClick={() => setShowUrlBanner(false)}>✕</button>
          </div>
          {saveError && <div className="jc-url-error">{saveError}</div>}
        </div>
      )}
      {saveError && !showUrlBanner && (
        <div className="jc-url-banner jc-url-banner-error screenOnly">
          <span>❌ {saveError}</span>
          <button onClick={() => setSaveError("")}>✕</button>
        </div>
      )}

      {/* ── BOUTONS NAVIGATION FLOTTANTS ── */}
      <div className="jc-scroll-btns screenOnly">
        <button className="jc-scroll-btn" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} title="Haut de page">⬆</button>
        <button className="jc-scroll-btn" onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })} title="Bas de page">⬇</button>
      </div>

      <div className="jc-sheet">

        {/* ── HEADER CARD ── */}
        <section className="jc-card jc-header-card">
          <div className="jc-header-left">
            <div>
              <div className="jc-brand">JARDIN-CONFORT</div>
              <div className="jc-brand-sub">Route de Lavaux 425 · 1095 Lutry · +41 21 791 36 71</div>
            </div>
            <div className="jc-doc-meta">
              <div className="jc-field">
                <label>Type de document</label>
                <select value={formType} onChange={(e) => setFormType(e.target.value as FormType)}>
                  <option>Offre</option>
                  <option>Commande</option>
                </select>
              </div>
              <div className="jc-field">
                <label>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="jc-field jc-field-grow">
                <label>Numéro</label>
                <input
                  value={offerNumber}
                  onChange={(e) => setOfferNumber(e.target.value)}
                  placeholder={formType === "Offre" ? "DEV-2026-001 (auto)" : "CMD-80500 (auto)"}
                  readOnly={!!offerNumber && (offerNumber.startsWith("DEV-") || offerNumber.startsWith("CMD-"))}
                  style={offerNumber && (offerNumber.startsWith("DEV-") || offerNumber.startsWith("CMD-"))
                    ? {opacity:1, fontWeight:700, color:"var(--accent)", cursor:"default"}
                    : {}}
                />
              </div>
              <div className="jc-field jc-field-grow">
                <label>Référence client</label>
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex: Terrasse côté sud" />
              </div>
            </div>
          </div>

          <div className="jc-header-right">
            <div className="jc-field">
              <label>Commercial *</label>
              <select
                className={missingRequired.commercial ? "jc-error" : ""}
                value={commercial}
                onChange={(e) => setCommercial(e.target.value)}
              >
                <option value="">— Choisir un commercial —</option>
                <option>Brice Chappé</option>
                <option>Alejandro Gallegos</option>
                <option>Fabian Coquoz</option>
                <option>Michel Gédéon</option>
                <option>Sabrina Striberni</option>
                <option>Thierry Stricker</option>
              </select>
            </div>
            <div className="jc-field">
              <label>Type de client</label>
              <select value={clientType} onChange={(e) => setClientType(e.target.value as ClientType)}>
                <option>Privé (prix TTC)</option>
                <option>Pro (prix HT)</option>
              </select>
            </div>
            <div className="jc-field">
              <label>Mode de paiement</label>
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}>
                <option>Paiement d'avance à la commande</option>
                <option>Acompte de 50% à la commande</option>
                <option>Paiement à 30 jours</option>
              </select>
            </div>
            <div className="jc-field">
              <label>Mode de livraison</label>
              <select value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)}>
                <option>Livraison à domicile</option>
                <option>À l'emporter</option>
              </select>
            </div>
            
          </div>
        </section>

        {/* ── COORDONNÉES ── */}
        <section className="jc-card">
          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14}}>
            <div className="jc-section-title" style={{marginBottom:0}}>Adresse de facturation</div>
            <button className="jc-btn jc-btn-ghost" style={{fontSize:11, padding:"4px 10px"}}
              onClick={() => { setNom(""); setPrenom(""); setSociete(""); setEmail(""); setTelephone1(""); setTelephone2(""); setRue(""); setRue2(""); setNumero(""); setNpa(""); setVille(""); setSelectedClientId(null); setClientSuggestions([]); }}>
              🗑 Effacer coordonnées
            </button>
          </div>
          <div className="jc-grid jc-g1">
            <div className="jc-field">
              <label>Société</label>
              <input autoComplete="new-password" value={societe} onChange={(e) => setSociete(e.target.value)} placeholder="Nom de l'entreprise (optionnel)" />
            </div>
          </div>
          <div className="jc-grid jc-g2 mt12">
            <div className="jc-field" style={{position:"relative"}}>
              <label>Nom *</label>
              <input className={missingRequired.nom ? "jc-error" : ""} autoComplete="new-password" value={nom}
                onChange={(e) => onClientFieldChange(e.target.value, "nom", setNom)}
              onBlur={closeClientDropdown}
              placeholder="Dupont" />
              {clientSuggestions.length > 0 && clientSearchField === "nom" && (
                <div className="jc-client-dropdown">
                  {clientSuggestions.map(c => (
                    <div key={c.id} className="jc-client-item" onClick={() => applyClient(c)}>
                      <div className="jc-client-item-name">{c.nom} {c.prenom} {c.societe && <span className="jc-client-item-soc">· {c.societe}</span>}</div>
                      <div className="jc-client-item-detail">{[c.rue, c.npa, c.ville, c.email, c.tel1].filter(Boolean).join(" · ")}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="jc-field">
              <label>Prénom</label>
              <input autoComplete="new-password" value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Jean" />
            </div>
          </div>
          <div className="jc-grid jc-g-addr mt12">
            <div className="jc-field" style={{position:"relative"}}>
              <label>Rue</label>
              <input value={rue} onChange={(e) => onRueChange(e.target.value)} placeholder="Commencez à taper…" autoComplete="new-password" />
              {addrSuggestions.length > 0 && (
                <div className="jc-addr-dropdown">
                  {addrSuggestions.map((s, i) => (
                    <div key={i} className="jc-addr-item" onClick={() => applyAddrSuggestion(s)}>{s.label}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="jc-field">
              <label>No</label>
              <input autoComplete="new-password" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="12" />
            </div>
            <div className="jc-field">
              <label>NPA</label>
              <input inputMode="numeric" maxLength={4} autoComplete="new-password" value={npa} onChange={(e) => setNpa(sanitizeNpa(e.target.value))} placeholder="1000" />
            </div>
            <div className="jc-field">
              <label>Ville *</label>
              <input autoComplete="new-password" className={missingRequired.ville ? "jc-error" : ""} value={ville} onChange={(e) => setVille(e.target.value)} placeholder="Lausanne" />
            </div>
          </div>
          <div className="jc-grid jc-g1 mt12">
            <div className="jc-field">
              <label>Complément d&apos;adresse</label>
              <input autoComplete="new-password" value={rue2} onChange={(e) => setRue2(e.target.value)} placeholder="Bâtiment, case postale, lieu-dit…" />
            </div>
          </div>
          <div className="jc-grid jc-g3 mt12">
            <div className="jc-field" style={{position:"relative"}}>
              <label>Téléphone 1</label>
              <input autoComplete="new-password" placeholder="+41 79 000 00 00" value={telephone1}
                onChange={(e) => onClientFieldChange(e.target.value, "tel", setTelephone1)}
              onBlur={(e) => { setTelephone1(normalizeSwissPhone(e.target.value)); closeClientDropdown(); }} />
              {clientSuggestions.length > 0 && clientSearchField === "tel" && (
                <div className="jc-client-dropdown">
                  {clientSuggestions.map(c => (
                    <div key={c.id} className="jc-client-item" onClick={() => applyClient(c)}>
                      <div className="jc-client-item-name">{c.nom} {c.prenom} {c.societe && <span className="jc-client-item-soc">· {c.societe}</span>}</div>
                      <div className="jc-client-item-detail">{[c.rue, c.npa, c.ville, c.email, c.tel1].filter(Boolean).join(" · ")}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="jc-field">
              <label>Téléphone 2</label>
              <input autoComplete="new-password" placeholder="+41 79 000 00 00" value={telephone2} onChange={(e) => setTelephone2(normalizeSwissPhone(e.target.value))} />
            </div>
            <div className="jc-field" style={{position:"relative"}}>
              <label>Email *</label>
              <input autoComplete="new-password" className={missingRequired.email ? "jc-error" : ""} type="email" value={email}
                onChange={(e) => onClientFieldChange(e.target.value, "email", setEmail)}
              onBlur={closeClientDropdown}
              placeholder="jean@exemple.ch" />
              {clientSuggestions.length > 0 && clientSearchField === "email" && (
                <div className="jc-client-dropdown">
                  {clientSuggestions.map(c => (
                    <div key={c.id} className="jc-client-item" onClick={() => applyClient(c)}>
                      <div className="jc-client-item-name">{c.nom} {c.prenom} {c.societe && <span className="jc-client-item-soc">· {c.societe}</span>}</div>
                      <div className="jc-client-item-detail">{[c.rue, c.npa, c.ville, c.email, c.tel1].filter(Boolean).join(" · ")}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {selectedClientId && (
            <div className="mt12" style={{display:"flex", alignItems:"center", gap:10, padding:"8px 14px", borderRadius:10, background:"rgba(74,222,128,0.08)", border:"1px solid rgba(74,222,128,0.25)"}}>
              <span style={{fontSize:13, color:"#4ade80", fontWeight:600}}>👤 Client existant sélectionné</span>
              <a href={`/dashboard/clients/${selectedClientId}`} target="_blank" rel="noopener noreferrer"
                style={{fontSize:12, color:"#60a5fa", textDecoration:"underline"}}>Voir la fiche →</a>
              <button onClick={() => setSelectedClientId(null)}
                style={{marginLeft:"auto", background:"transparent", border:0, color:"#71717a", cursor:"pointer", fontSize:13}}>✕</button>
            </div>
          )}
          <div className="jc-grid jc-g2 mt12">
            <div className="jc-field">
              <label>N° client (auto via email)</label>
              <input value={customerNumber} readOnly />
            </div>
            <div className="jc-field">
              <label>Délai de livraison</label>
              <input value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
            </div>
          </div>

          {/* Adresse de livraison */}
          <div className="jc-section-title smallTop screenOnly" style={{marginTop:20}}>Adresse de livraison</div>
          <div className="jc-livr-toggle screenOnly">
            <label className="jc-check-label">
              <input type="checkbox" checked={livrDiff} onChange={(e) => {
                setLivrDiff(e.target.checked);
                if (e.target.checked) {
                  setLivrNom(nom); setLivrPrenom(prenom);
                  setLivrSociete(""); setLivrTel(""); setLivrRue("");
                  setLivrNumero(""); setLivrNpa(""); setLivrVille(""); setLivrRue2("");
                }
              }} />
              <span>Adresse de livraison différente de l'adresse de facturation</span>
            </label>
          </div>
          {livrDiff && (
            <div className="mt12">
              <div className="jc-livr-header">
                <span className="jc-muted-sm">📦 Adresse de livraison</span>
                <button className="jc-btn jc-btn-ghost" style={{fontSize:11, padding:"4px 10px"}}
                  onClick={() => {
                    setLivrSociete(societe); setLivrNom(nom); setLivrPrenom(prenom);
                    setLivrTel(telephone1); setLivrRue(rue); setLivrNumero(numero);
                    setLivrNpa(npa); setLivrVille(ville);
                  }}>
                  📋 Copier adresse facturation
                </button>
              </div>
              <div className="jc-grid jc-g1 mt12">
                <div className="jc-field">
                  <label>Société livraison</label>
                  <input autoComplete="new-password" value={livrSociete} onChange={(e) => setLivrSociete(e.target.value)} placeholder="Société (optionnel)" />
                </div>
              </div>
              <div className="jc-grid jc-g2 mt12">
                <div className="jc-field">
                  <label>Nom livraison</label>
                  <input autoComplete="new-password" value={livrNom} onChange={(e) => setLivrNom(e.target.value)} placeholder="Dupont" />
                </div>
                <div className="jc-field">
                  <label>Prénom</label>
                  <input autoComplete="new-password" value={livrPrenom} onChange={(e) => setLivrPrenom(e.target.value)} placeholder="Jean" />
                </div>
              </div>
              <div className="jc-grid jc-g-addr mt12">
                <div className="jc-field" style={{position:"relative"}}>
                  <label>Rue livraison</label>
                  <input value={livrRue} onChange={(e) => onLivrRueChange(e.target.value)} placeholder="Commencez à taper…" autoComplete="new-password"/>
                  {livrAddrSuggestions.length > 0 && (
                    <div className="jc-addr-dropdown">
                      {livrAddrSuggestions.map((s, i) => (
                        <div key={i} className="jc-addr-item" onClick={() => applyLivrSuggestion(s)}>{s.label}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="jc-field">
                  <label>No</label>
                  <input value={livrNumero} onChange={(e) => setLivrNumero(e.target.value)} placeholder="12" />
                </div>
                <div className="jc-field">
                  <label>NPA</label>
                  <input inputMode="numeric" maxLength={4} value={livrNpa} onChange={(e) => setLivrNpa(sanitizeNpa(e.target.value))} placeholder="1000" />
                </div>
                <div className="jc-field">
                  <label>Ville livraison</label>
                  <input value={livrVille} onChange={(e) => setLivrVille(e.target.value)} placeholder="Genève" />
                </div>
              </div>
              <div className="jc-grid jc-g1 mt12">
                <div className="jc-field">
                  <label>Complément d&apos;adresse livraison</label>
                  <input autoComplete="new-password" value={livrRue2} onChange={(e) => setLivrRue2(e.target.value)} placeholder="Complément livraison…" />
                </div>
              </div>
              <div className="jc-grid jc-g2 mt12">
                <div className="jc-field">
                  <label>Téléphone livraison</label>
                  <input autoComplete="new-password" placeholder="+41 79 000 00 00" value={livrTel} onChange={(e) => setLivrTel(normalizeSwissPhone(e.target.value))} />
                </div>
              </div>
            </div>
          )}

          <div className="jc-validation-row">
            <span className={isFormValid ? "jc-ok" : "jc-warn"}>
              {isFormValid ? "✓ Champs obligatoires remplis" : `⚠ Manquants : ${[missingRequired.commercial && "Commercial", missingRequired.nom && "Nom", missingRequired.ville && "Ville", missingRequired.email && "Email"].filter(Boolean).join(", ")}`}
            </span>
            {draftSavedAt && <span className="jc-muted-sm">💾 {draftSavedAt}</span>}
          </div>
        </section>

        {/* ── AJOUT ARTICLES ── */}
        {/* En mode wideMode, cette section est extraite du flux normal via le wide-layout ci-dessous */}
        {!wideMode && (
        <section className="jc-card">
          <div className="jc-section-title">Ajouter des articles</div>
          <div className="jc-tabs screenOnly">
            <button className={`jc-tab ${activeTab === "shopify" ? "jc-tab-active" : ""}`} onClick={() => setActiveTab("shopify")}>Catalogue Shopify</button>
            <button className={`jc-tab ${activeTab === "custom" ? "jc-tab-active" : ""}`} onClick={() => setActiveTab("custom")}>Article à la volée</button>
          </div>

          {activeTab === "shopify" && (
            <>
              <div className="jc-shopify-search-bar">
                <input
                  className="jc-search-input"
                  placeholder="🔍 Rechercher par SKU, titre ou variante sur Shopify…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoComplete="new-password"
                />
                {search && (
                  <button className="jc-btn jc-btn-ghost jc-search-clear" onClick={() => { setSearch(""); setShopifyItems([]); }}>✕</button>
                )}
                {/* Filtre en stock */}
                <label className="jc-filter-stock-label">
                  <input
                    type="checkbox"
                    checked={filterInStock}
                    onChange={(e) => setFilterInStock(e.target.checked)}
                  />
                  <span>En stock uniquement</span>
                </label>
              </div>

              {/* État vide / loading / erreur */}
              {!search.trim() && (
                <div className="jc-shopify-hint">Tapez un SKU, un nom de produit ou une variante pour chercher dans Jardin-Confort.ch</div>
              )}
              {shopifyLoading && (
                <div className="jc-shopify-loading">
                  <div className="jc-spinner" /> Recherche en cours sur Shopify…
                </div>
              )}
              {shopifyError && (
                <div className="jc-shopify-error">⚠ {shopifyError}</div>
              )}

              {/* Résultats — grille responsive 4/2/1 */}
              {(() => {
                const filtered = filterInStock
                  ? shopifyItems.filter((item) => item.stock !== null && item.stock > 0)
                  : shopifyItems;

                if (!shopifyLoading && search.trim() && filtered.length === 0 && !shopifyError) {
                  return <div className="jc-shopify-hint">Aucun résultat{filterInStock ? " en stock" : ""} pour « {search} »</div>;
                }

                return (
                  <div className="jc-shopify-grid">
                    {filtered.map((item) => {
                      const isFlash = flashProductId === item.id;
                      const stockOk = item.stock !== null && item.stock > 2;
                      const stockLow = item.stock !== null && item.stock > 0 && item.stock <= 2;
                      const stockZero = item.stock !== null && item.stock < 1;

                      return (
                        <div key={item.id} className={`jc-shopify-tile${isFlash ? " jc-product-flash" : ""}`} style={{position:"relative"}}>
                          {/* Flash vert sur toute la tuile */}
                          {isFlash && (
                            <div className="jc-product-flash-overlay">✓</div>
                          )}
                          {/* Images ×4 carrées */}
                          <div className="jc-shopify-imgs">
                            {[item.variantImage, item.image1, item.image2, item.image3].map((src, i) => (
                              src ? (
                                <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="jc-shopify-img-link">
                                  <div className="jc-shopify-img-box">
                                    <img src={src} alt="" />
                                  </div>
                                </a>
                              ) : (
                                <div key={i} className="jc-shopify-img-box jc-shopify-img-empty" />
                              )
                            ))}
                          </div>

                          {/* Infos */}
                          <div className="jc-shopify-meta">
                            <div className="jc-shopify-variant">{item.variant}</div>
                            <div className="jc-shopify-row">
                              <span className="jc-shopify-label">SKU</span>
                              <span className="jc-shopify-val">{item.sku || "—"}</span>
                            </div>
                            <div className="jc-shopify-row">
                              <span className="jc-shopify-label">Prix</span>
                              <span>
                                {item.compareAtPrice && Number(item.compareAtPrice) > Number(item.price) && (
                                  <span style={{textDecoration:"line-through", color:"#9CA3AF", fontSize:12, marginRight:6}}>
                                    CHF {item.compareAtPrice}
                                  </span>
                                )}
                                <span className="jc-shopify-price" style={item.compareAtPrice && Number(item.compareAtPrice) > Number(item.price) ? {color:"#dc2626"} : {}}>
                                  CHF {item.price}
                                </span>
                              </span>
                            </div>
                            <div className="jc-shopify-row">
                              <span className="jc-shopify-label">Stock</span>
                              {item.stock === null ? (
                                <a href={item.productUrl} target="_blank" rel="noopener noreferrer" className="jc-shopify-stock-link">Vérifier ↗</a>
                              ) : stockZero ? (
                                <span className="jc-stock-cmd">Sur commande</span>
                              ) : (
                                <span className={stockOk ? "jc-stock-ok" : "jc-stock-low"}>
                                  {item.stock} pce{item.stock > 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                            <a href={item.productUrl} target="_blank" rel="noopener noreferrer" className="jc-shopify-open-link">Ouvrir sur la boutique ↗</a>
                            {/* Délai de livraison basé sur les tags */}
                            {item.stock !== null && item.stock < 1 && item.delaiLivraison && (
                              <div className="jc-shopify-delai">{item.delaiLivraison}</div>
                            )}
                          </div>

                          {/* Bouton ajouter */}
                          <button className="jc-add-btn" onClick={() => addShopifyItem(item)}>+ Ajouter</button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </>
          )}

          {activeTab === "custom" && (
            <div>
              <div className="jc-grid jc-g-custom mt12">
                <div className="jc-field">
                  <label>SKU libre</label>
                  <input value={customSku} onChange={(e) => setCustomSku(e.target.value)} placeholder="ART-001" />
                </div>
                <div className="jc-field">
                  <label>Titre / Description *</label>
                  <input value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="Ex: Parasol Sunbrella Ø 3m…" />
                </div>
                <div className="jc-field">
                  <label>Prix unitaire CHF</label>
                  <input className="no-spin" type="number" step="0.01" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder="0.00" />
                </div>
                <div className="jc-field">
                  <label>Qté</label>
                  <input type="number" min="1" step="1" value={customQty} onChange={(e) => setCustomQty(String(Math.max(1, parseInt(e.target.value || "1", 10))))} />
                </div>
                <div className="jc-field">
                  <label>Stock</label>
                  <input className="no-spin" type="number" min="0" step="1" value={customStock} onChange={(e) => setCustomStock(e.target.value)} placeholder="—" />
                </div>
                <div className="jc-field">
                  <label>Image</label>
                  <input ref={customImageInputRef} type="file" accept="image/*" onChange={(e) => onCustomImageChange(e.target.files?.[0])} />
                </div>
                <div className="jc-field jc-align-end">
                  <button className="jc-btn jc-btn-primary jc-btn-wide" onClick={addCustomLine}>+ Ajouter</button>
                </div>
              </div>
              {customImage && (
                <div className="jc-custom-preview">
                  <img src={customImage} alt="Aperçu" />
                  <button className="jc-trash-btn" onClick={() => { setCustomImage(""); if (customImageInputRef.current) customImageInputRef.current.value = ""; }}>🗑</button>
                </div>
              )}
            </div>
          )}
        </section>
        )} {/* fin !wideMode */}

        {/* ── LAYOUT WIDE : tableau+totaux à gauche, recherche à droite ── */}
        {/* En mode normal les sections s'affichent simplement en flux */}
        {/* ── WIDE MODE GRID WRAPPER ── */}
        <div className={wideMode ? "jc-wide-grid" : ""}>

        <div className={wideMode ? "jc-wide-left" : ""}>

        {/* ── TABLEAU ── */}
        <section className="jc-card jc-lines-card">
          <div className="jc-section-title-row">
            <div className="jc-section-title">Lignes de l'offre</div>
            <div style={{display:"flex", gap:8, alignItems:"center"}}>
              <button
                className="jc-btn jc-btn-ghost screenOnly"
                style={{fontSize:12, padding:"5px 12px"}}
                onClick={() => {
                  captureUndo();
                  const id = `comment-${Date.now()}`;
                  setLines((c) => [...c, { id, type: "comment", sku: "", title: "", unitPrice: 0, qty: 1 }]);
                  highlightAdded(id);
                }}
              >💬 Ligne commentaire</button>
              <span className="jc-badge screenOnly">{lines.filter(l => l.type !== "comment").length} article{lines.filter(l => l.type !== "comment").length !== 1 ? "s" : ""}</span>
            </div>
          </div>
          <p className="jc-drag-hint screenOnly">⬆⬇ Glisser-déposer pour réordonner</p>
          <div className="jc-table-wrap">
            <table className="jc-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th style={{ width: 82 }}>Img</th>
                  <th style={{ width: 72 }}>Qté</th>
                  <th style={{ width: 130 }}>SKU</th>
                  <th style={{ maxWidth: 280 }}>Désignation</th>
                  <th style={{ width: 130 }}>Prix/pce</th>
                  <th style={{ width: 110 }}>Total</th>
                  <th style={{ width: 80 }}>Stock</th>
                  <th style={{ width: 90 }} className="screenOnly"></th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr><td colSpan={9} className="jc-empty-row">Aucun article — utilisez la section ci-dessus</td></tr>
                )}
                {lines.map((line, idx) => {
                  const isComment = line.type === "comment";
                  const lineTotal = isComment ? 0 : line.qty * line.unitPrice - (line.lineDiscount || 0);

                  return (
                    <tr
                      key={line.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", line.id); setDraggedLineId(line.id); }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); const from = e.dataTransfer.getData("text/plain") || draggedLineId; if (from) reorderLines(from, line.id); setDraggedLineId(null); }}
                      onDragEnd={() => setDraggedLineId(null)}
                      className={[
                        isComment ? "tr-comment" : idx % 2 === 0 ? "tr-even" : "tr-odd",
                        draggedLineId === line.id ? "tr-dragging" : "",
                        justAddedLineId === line.id ? "tr-added" : "",
                      ].join(" ")}
                    >
                      <td className="td-num">{isComment ? "💬" : idx + 1}</td>

                      {isComment ? (
                        /* ── Ligne commentaire : s'étend sur toute la largeur ── */
                        <td colSpan={7} className="td-comment-cell">
                          <input
                            className="jc-cell-input jc-comment-input"
                            value={line.title}
                            placeholder="Commentaire, note ou texte libre…"
                            onChange={(e) => updateLine(line.id, { title: e.target.value })}
                          />
                        </td>
                      ) : (
                        <>
                          <td className="td-img-cell">
                            <label className="jc-line-img-label screenOnly" title="Changer l'image">
                              <div className="jc-line-img" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onLineImageDrop(line.id, e)}>
                                {line.image ? <img src={line.image} alt="" /> : <span className="jc-line-img-placeholder">📷</span>}
                                <div className="jc-line-img-overlay">✎</div>
                              </div>
                              <input type="file" accept="image/*" style={{display:"none"}} onChange={(e) => onLineImageChange(line.id, e.target.files?.[0])} />
                            </label>
                            {/* Croix pour supprimer l'image */}
                            {line.image && (
                              <button
                                className="jc-img-clear-btn screenOnly"
                                title="Supprimer l'image"
                                onClick={(e) => { e.stopPropagation(); updateLine(line.id, { image: "" }); }}
                              >✕</button>
                            )}
                            <div className="printOnly jc-line-img">
                              {line.image ? <img src={line.image} alt="" /> : null}
                            </div>
                          </td>
                          <td style={{ paddingRight: 16 }}>
                            <input className="jc-qty-input no-spin" type="number" min="1" value={line.qty} onChange={(e) => updateLine(line.id, { qty: Math.max(1, parseInt(e.target.value || "1", 10)) })} />
                          </td>
                          <td style={{ paddingLeft: 12 }}>
                            <input className="jc-cell-input jc-sku-input" value={line.sku} onChange={(e) => updateLine(line.id, { sku: e.target.value })} />
                          </td>
                          <td>
                            <textarea
                              className="jc-cell-input jc-title-input"
                              value={line.title}
                              onChange={(e) => {
                                updateLine(line.id, { title: e.target.value });
                                e.target.style.height = "auto";
                                e.target.style.height = e.target.scrollHeight + "px";
                              }}
                              onFocus={(e) => {
                                e.target.style.height = "auto";
                                e.target.style.height = e.target.scrollHeight + "px";
                              }}
                              rows={1}
                            />
                          </td>
                          <td>
                            <div className="jc-price-cell">
                              <div className="jc-price-row">
                                <input
                                  className="jc-cell-input jc-price-input no-spin"
                                  type="number" step="0.01"
                                  placeholder="0"
                                  value={line.unitPrice === 0 ? "" : line.unitPrice}
                                  onFocus={(e) => { if (line.unitPrice === 0) updateLine(line.id, { unitPrice: 0 }); }}
                                  onBlur={(e) => { if (e.target.value === "") updateLine(line.id, { unitPrice: 0 }); }}
                                  onChange={(e) => updateLine(line.id, { unitPrice: e.target.value === "" ? 0 : Number(e.target.value) })}
                                />
                                <button
                                  className={`jc-discount-toggle${openDiscountLines.has(line.id) ? " active" : ""}${(line.lineDiscount || 0) > 0 ? " has-value" : ""}`}
                                  title="Remise sur cette ligne"
                                  onClick={() => setOpenDiscountLines((s) => { const n = new Set(s); n.has(line.id) ? n.delete(line.id) : n.add(line.id); return n; })}
                                >%−</button>
                              </div>
                              {openDiscountLines.has(line.id) && (
                                <input
                                  className="jc-cell-input jc-line-discount-input no-spin"
                                  type="number" step="0.01" min="0"
                                  placeholder="Remise CHF"
                                  value={line.lineDiscount || ""}
                                  autoFocus
                                  onChange={(e) => updateLine(line.id, { lineDiscount: e.target.value === "" ? 0 : Number(e.target.value) })}
                                />
                              )}
                            </div>
                          </td>
                          <td className="td-money">
                            {formatMoney(lineTotal)}
                            {(line.lineDiscount || 0) > 0 && (
                              <div className="jc-line-discount-shown">− {formatMoney(line.lineDiscount || 0)}</div>
                            )}
                          </td>
                          {/* Colonne stock */}
                          <td className="td-stock">
                            {line.stock === undefined || line.stock === null ? (
                              <input className="jc-cell-input jc-stock-input no-spin" type="number" min="0" placeholder="—"
                                onChange={(e) => updateLine(line.id, { stock: e.target.value === "" ? null : parseInt(e.target.value) })} />
                            ) : line.stock === "sur_commande" ? (
                              <span className="jc-stock-cmd">Sur commande</span>
                            ) : (
                              <span className={line.stock > 2 ? "jc-stock-ok" : line.stock > 0 ? "jc-stock-low" : "jc-stock-cmd"}>
                                {line.stock === 0 ? "Sur commande" : `${line.stock} pce${line.stock > 1 ? "s" : ""}`}
                              </span>
                            )}
                          </td>
                        </>
                      )}

                      <td className="screenOnly">
                        <div className="jc-action-btns">
                          <button
                            className="jc-dup-btn" title="Dupliquer"
                            onClick={() => {
                              captureUndo();
                              const newId = `dup-${Date.now()}`;
                              setLines((c) => {
                                const idx2 = c.findIndex((l) => l.id === line.id);
                                const clone2 = [...c];
                                clone2.splice(idx2 + 1, 0, { ...line, id: newId });
                                return clone2;
                              });
                              highlightAdded(newId);
                            }}
                          >⧉</button>
                          <button className="jc-trash-btn" onClick={() => removeLine(line.id)}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── TOTAUX + INFOS ── */}
        <section className="jc-grid jc-totals-grid">

          {/* Colonne gauche : infos + services */}
          <div className="jc-card">
            <div className="jc-section-title">Informations complémentaires</div>
            <div className="jc-field">
              <label>Remarques <span className="jc-label-hint">(visibles sur le document)</span></label>
              <textarea
                rows={5}
                dir="ltr"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Notes pour le client, conditions spéciales…"
              />
              <div className="printOnly jc-remarks-print">{remarks}</div>
            </div>

            {/* Notes internes — screenOnly, jamais imprimées */}
            <div className="jc-field mt12 screenOnly">
              <label>
                <span className="jc-internal-badge">🔒 Interne</span>
                Notes internes <span className="jc-label-hint">(non visibles par le client, non imprimées)</span>
              </label>
              <textarea
                className="jc-internal-textarea"
                rows={3}
                value={notesInternes}
                onChange={(e) => setNotesInternes(e.target.value)}
                placeholder="Remarques internes, suivi, rappels pour l'équipe…"
              />
            </div>

            <div className="jc-section-title mt20">Services optionnels</div>
            <div className="jc-service-list">
              {serviceOptions.map((srv) => (
                <div
                  className="jc-service-row"
                  key={srv.code}
                >
                  <label className="jc-check-label jc-check-label-full" htmlFor={`srv-${srv.code}`}>
                    <input
                      id={`srv-${srv.code}`}
                      type="checkbox"
                      checked={enabledServices[srv.code]}
                      onChange={(e) => setEnabledServices((c) => ({ ...c, [srv.code]: e.target.checked }))}
                    />
                    <span>{srv.label}</span>
                  </label>
                  <div className="jc-service-price-wrap" onClick={(e) => e.stopPropagation()}>
                    <span className="jc-muted-sm">CHF</span>
                    <input
                      className="jc-service-price no-spin"
                      type="number"
                      step="1"
                      placeholder="0"
                      value={servicePrices[srv.code]}
                      disabled={!enabledServices[srv.code]}
                      onChange={(e) => setServicePrices((c) => ({ ...c, [srv.code]: e.target.value }))}
                    />
                  </div>
                </div>
              ))}
              {/* Service vierge à la volée */}
              <div className="jc-service-row jc-service-custom-row">
                <div className="jc-check-label">
                  <input
                    type="checkbox"
                    checked={enabledServices["custom"] || false}
                    onChange={(e) => setEnabledServices((c) => ({ ...c, custom: e.target.checked }))}
                  />
                  <input
                    className="jc-service-custom-label"
                    placeholder="Service personnalisé…"
                    value={servicePrices["custom_label"] || ""}
                    onChange={(e) => setServicePrices((c) => ({ ...c, custom_label: e.target.value }))}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="jc-service-price-wrap" onClick={(e) => e.stopPropagation()}>
                  <span className="jc-muted-sm">CHF</span>
                  <input
                    className="jc-service-price no-spin"
                    type="number" step="1" placeholder="0"
                    value={servicePrices["custom"] || ""}
                    disabled={!enabledServices["custom"]}
                    onChange={(e) => setServicePrices((c) => ({ ...c, custom: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Colonne droite : totaux */}
          <div className="jc-card jc-total-card">
            <div className="jc-section-title">Récapitulatif</div>

            {/* Badge type client */}
            <div
              className="jc-client-badge"
              style={{
                background:   isPrivateTTC ? "rgba(96,165,250,0.1)"   : "rgba(74,222,128,0.1)",
                borderColor:  isPrivateTTC ? "rgba(96,165,250,0.25)"  : "rgba(74,222,128,0.25)",
                color:        isPrivateTTC ? "#60a5fa"                 : "#4ade80",
              }}
            >
              {isPrivateTTC ? "🏠 Client Privé — Prix TTC (TVA incluse)" : "🏢 Client Pro — Prix HT (TVA à ajouter)"}
            </div>

            <div className="jc-total-row">
              <span>Sous-total articles</span>
              <strong>{formatMoney(subTotal)}</strong>
            </div>

            <div className="jc-total-row">
              <span>Rabais CHF</span>
              <input
                className="jc-discount-input no-spin"
                type="number" step="0.01"
                placeholder="0"
                value={discount === "0" ? "" : discount}
                onFocus={(e) => { if (discount === "0") setDiscount(""); }}
                onBlur={(e) => { if (!e.target.value) { setDiscount("0"); } }}
                onChange={(e) => { setDiscount(e.target.value || "0"); setDiscountPercent("0"); }}
              />
            </div>
            <div className="jc-total-row">
              <span>Rabais %</span>
              <input
                className="jc-discount-input no-spin"
                type="number" step="0.5" min="0" max="100"
                placeholder="0"
                value={discountPercent === "0" ? "" : discountPercent}
                onFocus={(e) => { if (discountPercent === "0") setDiscountPercent(""); }}
                onBlur={(e) => { if (!e.target.value) { setDiscountPercent("0"); } }}
                onChange={(e) => { setDiscountPercent(e.target.value || "0"); setDiscount("0"); }}
              />
            </div>
            {discountValue > 0 && (
              <div className="jc-total-row">
                <span>Montant rabais</span>
                <strong className="jc-discount-amt">− {formatMoney(discountValue)}</strong>
              </div>
            )}

            <div className="jc-total-row">
              <span>Total après rabais</span>
              <strong>{formatMoney(totalAfterDiscount)}</strong>
            </div>

            {serviceTotal > 0 && (
              <div className="jc-total-row">
                <span>Services</span>
                <strong>{formatMoney(serviceTotal)}</strong>
              </div>
            )}

            {/* Arrondi : valeur libre, peut être négative */}
            <div className="jc-total-row">
              <div>
                <span>Arrondi</span>
                <div className="jc-arrondi-hint">soustrait du total</div>
              </div>
              <input
                className="jc-discount-input no-spin"
                type="number"
                step="0.05"
                placeholder="0"
                value={roundingStr}
                onChange={(e) => {
                  const raw = e.target.value;
                  // Forcer toujours négatif ou vide
                  if (raw === "" || raw === "-") { setRoundingStr(raw); return; }
                  const n = parseFloat(raw);
                  if (isNaN(n)) { setRoundingStr(""); return; }
                  setRoundingStr(n > 0 ? String(-n) : raw);
                }}
              />
            </div>

            {roundingValue !== 0 && (
              <div className="jc-total-row">
                <span>Sous-total arrondi</span>
                <strong>{formatMoney(totalAfterRounding)}</strong>
              </div>
            )}

            {/* TVA calculée depuis totalAfterRounding */}
            {isPrivateTTC ? (
              <div className="jc-total-row jc-tva-row">
                <span className="jc-tva-label">TVA 8.1% incluse</span>
                <span className="jc-tva-incl">{formatMoney(tvaAmount)}</span>
              </div>
            ) : (
              <div className="jc-total-row jc-tva-row jc-tva-add">
                <span className="jc-tva-label">+ TVA 8.1%</span>
                <strong className="jc-tva-add-amt">{formatMoney(tvaAmount)}</strong>
              </div>
            )}

            <div className="jc-grand-total">
              <span>TOTAL {isPrivateTTC ? "TTC" : "HT + TVA"}</span>
              <strong>{formatMoney(finalTotal)}</strong>
            </div>

            <div className="jc-info-badge">💳 {paymentMode}</div>
            <div className="jc-info-badge">🚚 {deliveryMode} · Délai : {leadTime}</div>
          </div>
        </section>

        </div> {/* fin jc-wide-left */}

        {/* Colonne droite wide mode — recherche articles sticky */}
        {wideMode && (
          <div style={{ position: "sticky", top: 20, maxHeight: "calc(100vh - 100px)", overflowY: "auto" }}>
            <section className="jc-card">
              <div className="jc-section-title">Ajouter des articles</div>
              <div className="jc-tabs screenOnly">
                <button className={`jc-tab ${activeTab === "shopify" ? "jc-tab-active" : ""}`} onClick={() => setActiveTab("shopify")}>Catalogue Shopify</button>
                <button className={`jc-tab ${activeTab === "custom" ? "jc-tab-active" : ""}`} onClick={() => setActiveTab("custom")}>Article à la volée</button>
              </div>

              {activeTab === "shopify" && (
                <>
                  <div className="jc-shopify-search-bar">
                    <input className="jc-search-input" placeholder="🔍 SKU, titre ou variante…" value={search}
                      onChange={(e) => setSearch(e.target.value)} autoComplete="new-password" style={{ width: "100%" }} />
                    {search && <button className="jc-btn jc-btn-ghost jc-search-clear" onClick={() => { setSearch(""); setShopifyItems([]); }}>✕</button>}
                    <label className="jc-filter-stock-label">
                      <input type="checkbox" checked={filterInStock} onChange={(e) => setFilterInStock(e.target.checked)} />
                      <span>En stock uniquement</span>
                    </label>
                  </div>
                  {!search.trim() && <div className="jc-shopify-hint">Tapez un SKU ou nom de produit…</div>}
                  {shopifyLoading && <div className="jc-shopify-loading"><div className="jc-spinner" /> Recherche…</div>}
                  {shopifyError && <div className="jc-shopify-error">⚠ {shopifyError}</div>}
                  {(() => {
                    const filtered = filterInStock ? shopifyItems.filter(i => i.stock !== null && i.stock > 0) : shopifyItems;
                    if (!shopifyLoading && search.trim() && filtered.length === 0 && !shopifyError)
                      return <div className="jc-shopify-hint">Aucun résultat pour « {search} »</div>;
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                        {filtered.map((item) => {
                          const isFlash = flashProductId === item.id;
                          return (
                            <div key={item.id} onClick={() => addShopifyItem(item)}
                              style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 12, cursor: "pointer", border: "1px solid var(--border)", background: "var(--card)", position: "relative" }}
                              className={isFlash ? "jc-product-flash" : ""}>
                              {isFlash && <div className="jc-product-flash-overlay">✓</div>}
                              {item.variantImage && <img src={item.variantImage} alt="" style={{ width: 52, height: 52, objectFit: "contain", borderRadius: 6, flexShrink: 0 }} />}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, wordBreak: "break-word", whiteSpace: "normal" }}>{item.variant}</div>
                                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{item.sku}</div>
                                <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                                  <span style={{ display:"flex", alignItems:"center", gap:6 }}>
                                    {item.compareAtPrice && Number(item.compareAtPrice) > Number(item.price) && (
                                      <span style={{textDecoration:"line-through", color:"#9CA3AF", fontSize:11}}>CHF {item.compareAtPrice}</span>
                                    )}
                                    <span style={{ fontSize: 13, fontWeight: 700, color: item.compareAtPrice && Number(item.compareAtPrice) > Number(item.price) ? "#dc2626" : "inherit" }}>CHF {item.price}</span>
                                  </span>
                                  <span style={{ fontSize: 11, fontWeight: 600, color: (item.stock !== null && item.stock > 2) ? "#2C7E3F" : (item.stock !== null && item.stock > 0 && item.stock <= 2) ? "#E67E22" : (item.stock !== null && item.stock < 1) ? "#dc2626" : "#888" }}>
                                    {item.stock === null ? "N/A" : item.stock > 2 ? `✓ ${item.stock}` : item.stock > 0 ? `⚠ ${item.stock}` : "Rupture"}
                                  </span>
                                </div>
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); addShopifyItem(item); }}
                                style={{ flexShrink: 0, background: "var(--accent)", color: "white", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 18, cursor: "pointer" }}>+</button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              )}

              {activeTab === "custom" && (
                <div className="jc-grid jc-g2">
                  <div className="jc-field" style={{ gridColumn: "1/-1" }}>
                    <label>Désignation</label>
                    <input value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="Ex: Table en teck 180cm" />
                  </div>
                  <div className="jc-field">
                    <label>SKU</label>
                    <input value={customSku} onChange={(e) => setCustomSku(e.target.value)} placeholder="REF-001" />
                  </div>
                  <div className="jc-field">
                    <label>Prix CHF</label>
                    <input type="number" min="0" step="0.05" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} />
                  </div>
                  <div className="jc-field">
                    <label>Qté</label>
                    <input type="number" min="1" value={customQty} onChange={(e) => setCustomQty(String(Math.max(1, parseInt(e.target.value || "1", 10))))} />
                  </div>
                  <div className="jc-field">
                    <label>Stock</label>
                    <input className="no-spin" type="number" min="0" value={customStock} onChange={(e) => setCustomStock(e.target.value)} placeholder="—" />
                  </div>
                  <div className="jc-field jc-align-end" style={{ gridColumn: "1/-1" }}>
                    <button className="jc-btn jc-btn-primary jc-btn-wide" onClick={addCustomLine}>+ Ajouter</button>
                  </div>
                </div>
              )}
            </section>
        </div>
        )} {/* fin colonne droite wideMode */}

        </div> {/* fin jc-wide-grid */}

        {/* ── IMAGES D'AMBIANCE ── */}
        <section className="jc-card">
          <div className="jc-section-title-row">
            <div className="jc-section-title">🖼 Images d'ambiance <span className="jc-label-hint" style={{textTransform:"none", letterSpacing:0}}>(page 2 de l'offre)</span></div>
            <label className="jc-btn jc-btn-ghost screenOnly" style={{cursor:"pointer"}}>
              + Ajouter une image
              <input
                type="file"
                accept="image/*"
                multiple
                style={{display:"none"}}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  const newImgs = await Promise.all(files.map(async (f) => ({
                    id: `amb-${Date.now()}-${Math.random()}`,
                    dataUrl: await readFileAsDataUrl(f),
                    legende: "",
                  })));
                  setAmbianceImages((c) => [...c, ...newImgs]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {ambianceImages.length === 0 && (
            <label className="jc-ambiance-empty screenOnly" style={{cursor:"pointer"}}>
              <input type="file" accept="image/*" multiple style={{display:"none"}}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  const newImgs = await Promise.all(files.map(async (f) => ({
                    id: `amb-${Date.now()}-${Math.random()}`,
                    dataUrl: await readFileAsDataUrl(f),
                    legende: "",
                  })));
                  setAmbianceImages((c) => [...c, ...newImgs]);
                  e.target.value = "";
                }}
              />
              📁 Aucune image — cliquez ici ou sur « + Ajouter une image » pour illustrer l'offre
            </label>
          )}

          <div className="jc-ambiance-grid">
            {ambianceImages.map((img) => (
              <div
                key={img.id}
                className={`jc-ambiance-tile${draggedAmbianceId === img.id ? " jc-ambiance-dragging" : ""}`}
                draggable
                onDragStart={() => setDraggedAmbianceId(img.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!draggedAmbianceId || draggedAmbianceId === img.id) { setDraggedAmbianceId(null); return; }
                  setAmbianceImages((c) => {
                    const fi = c.findIndex((i) => i.id === draggedAmbianceId);
                    const ti = c.findIndex((i) => i.id === img.id);
                    if (fi < 0 || ti < 0) return c;
                    const clone = [...c];
                    const [moved] = clone.splice(fi, 1);
                    clone.splice(ti, 0, moved);
                    return clone;
                  });
                  setDraggedAmbianceId(null);
                }}
                onDragEnd={() => setDraggedAmbianceId(null)}
              >
                <div className="jc-ambiance-img-wrap">
                  <img src={img.dataUrl} alt={img.legende || "Ambiance"} />
                  <button
                    className="jc-ambiance-remove screenOnly"
                    onClick={() => setAmbianceImages((c) => c.filter((i) => i.id !== img.id))}
                    title="Supprimer"
                  >✕</button>
                  <div className="jc-ambiance-drag-hint screenOnly">⠿</div>
                </div>
                <input
                  className="jc-ambiance-legende"
                  placeholder="Légende (optionnel)…"
                  value={img.legende}
                  onChange={(e) => setAmbianceImages((c) => c.map((i) => i.id === img.id ? { ...i, legende: e.target.value.slice(0, 25) } : i))}
                />
              </div>
            ))}
          </div>
        </section>

        {/* ── SIGNATURE print only ── */}
        <section className="jc-card printOnly jc-sign-block">
          <div className="jc-sign-grid">
            <div>
              <div className="jc-sign-label">Jardin-Confort — {commercial}</div>
              <div className="jc-sign-line"></div>
              <div className="jc-sign-sub">Signature &amp; tampon</div>
            </div>
            <div>
              <div className="jc-sign-label">Client — {nom} {prenom}</div>
              <div className="jc-sign-line"></div>
              <div className="jc-sign-sub">Signature &amp; date</div>
            </div>
          </div>
        </section>

      </div>{/* end sheet */}

      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg:          #1f2125;
          --card:        #2a2d31;
          --card-2:      #34383d;
          --border:      rgba(255,255,255,0.08);
          --border-2:    rgba(255,255,255,0.12);
          --text:        #f4f4f5;
          --text-muted:  #c8c8d0;
          --text-dim:    #71717a;
          --accent:      #3b82f6;
          --accent-h:    #2563eb;
          --ok:          #4ade80;
          --warn:        #f59e0b;
          --danger:      #f87171;
          --radius-sm:   8px;
          --radius:      12px;
          --radius-xl:   16px;
        }

        html, body {
          background: var(--bg);
          color: var(--text);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 14px;
          line-height: 1.5;
          -webkit-font-smoothing: antialiased;
          min-height: 100vh;
        }

        .jc-page {
          padding: 24px;
          background: var(--bg);
          min-height: 100vh;
          transition: background 0.25s, color 0.25s;
        }

        /* ── MODE CLAIR — tons adoucis, pas de blanc pur ── */
        .light-mode {
          --bg:         #e8eaed;
          --card:       #f2f3f5;
          --card-2:     #e8eaed;
          --border:     rgba(0,0,0,0.1);
          --border-2:   rgba(0,0,0,0.16);
          --text:       #1a1d23;
          --text-muted: #52576b;
          --text-dim:   #8a90a0;
        }
        /* Forcer la couleur de TOUS les textes en mode clair */
        .light-mode,
        .light-mode .jc-card,
        .light-mode .jc-total-card,
        .light-mode .jc-total-row,
        .light-mode .jc-total-row span,
        .light-mode .jc-total-row strong,
        .light-mode .jc-grand-total,
        .light-mode .jc-grand-total span,
        .light-mode .jc-grand-total strong,
        .light-mode .jc-section-title,
        .light-mode .jc-check-label,
        .light-mode .jc-check-label span,
        .light-mode .jc-tva-label,
        .light-mode .jc-brand,
        .light-mode .jc-product-title,
        .light-mode .td-money,
        .light-mode .jc-price-tag { color: #111827; }
        .light-mode .jc-brand-sub,
        .light-mode .jc-product-sku,
        .light-mode .jc-product-variant,
        .light-mode .jc-tva-incl,
        .light-mode .jc-arrondi-hint,
        .light-mode .jc-drag-hint,
        .light-mode .jc-section-title { color: #6b7280; }
        .light-mode .jc-discount-amt { color: #16a34a; }
        .light-mode .jc-tva-add-amt  { color: #d97706; }
        .light-mode input, .light-mode select, .light-mode textarea {
          background: #f9fafb !important;
          color: #111827 !important;
          border-color: rgba(0,0,0,0.15) !important;
        }
        .light-mode input:focus, .light-mode select:focus, .light-mode textarea:focus {
          border-color: var(--accent) !important;
        }
        .light-mode .jc-btn-ghost { background: #e5e7eb; color: #111827; border-color: rgba(0,0,0,0.12); }
        .light-mode .jc-btn-ghost:hover { background: #d1d5db; }
        .light-mode .tr-even td { background: rgba(0,0,0,0.02); }
        .light-mode .tr-odd  td { background: rgba(0,0,0,0.04); }
        .light-mode .jc-table td,
        .light-mode .jc-table tr td:first-child,
        .light-mode .jc-table tr td:last-child { border-color: rgba(0,0,0,0.07); }
        .light-mode .jc-product-tile { background: #f9fafb; border-color: rgba(0,0,0,0.08); }
        .light-mode .jc-service-row  { background: rgba(0,0,0,0.025); border-color: rgba(0,0,0,0.08); }
        .light-mode .jc-total-row { border-color: rgba(0,0,0,0.07); }
        .light-mode .jc-info-badge { background: #f3f4f6; border-color: rgba(0,0,0,0.1); color: #6b7280; }
        .light-mode .jc-cell-input { background: rgba(0,0,0,0.04) !important; color: #111827 !important; }
        .light-mode .jc-line-img { background: #f3f4f6; border-color: rgba(0,0,0,0.12); }
        .light-mode .jc-badge { background: #e5e7eb; color: #6b7280; }
        .light-mode .jc-add-btn { background: rgba(59,130,246,0.08); color: #2563eb; }
        .light-mode .jc-trash-btn { background: rgba(239,68,68,0.08); color: #dc2626; }
        .light-mode .jc-tabs { border-color: rgba(0,0,0,0.1); }
        .light-mode .jc-tab { color: #6b7280; }
        .light-mode .jc-tab:hover { color: #111827; }
        .light-mode .jc-status-chip { color: #6b7280; border-color: rgba(0,0,0,0.12); }
        .light-mode .jc-validation-row { border-color: rgba(0,0,0,0.08); }
        .light-mode .td-num { color: #9ca3af; }

        /* ── TOP BAR ── */
        .jc-topbar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px; flex-wrap: wrap; margin-bottom: 24px;
        }
        .jc-topbar-left { display: flex; align-items: center; gap: 14px; }

        /* Logo avec coins arrondis identique au dashboard */
        .jc-logo-wrap {
          width: 48px; height: 48px;
          border-radius: 12px;
          overflow: hidden;
          background: var(--card-2);
          border: 1px solid var(--border-2);
          flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .jc-logo-img { width: 100%; height: 100%; object-fit: cover; display: block; }

        .jc-eyebrow { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }
        h1.jc-title { font-size: 22px; font-weight: 700; color: var(--text); }
        .jc-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .jc-warn-inline { font-size: 13px; color: var(--warn); }

        /* ── BUTTONS — style dashboard ── */
        .jc-btn {
          display: inline-flex; align-items: center; gap: 6px;
          border: 1px solid var(--border-2);
          border-radius: var(--radius-xl);
          padding: 8px 14px;
          font-size: 13px; font-weight: 600;
          cursor: pointer; transition: all 0.15s; white-space: nowrap;
        }
        .jc-btn-ghost { background: var(--card-2); color: var(--text); }
        .jc-btn-ghost:hover { background: #3d4147; }
        .jc-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
        .jc-btn-primary { background: var(--accent); color: white; border-color: var(--accent); border-radius: var(--radius-xl); }
        .jc-btn-primary:hover { background: var(--accent-h); }
        .jc-btn-save-cloud {
          background: linear-gradient(135deg, #10b981, #059669);
          color: white; border-color: #059669;
          border-radius: var(--radius-xl);
        }
        .jc-btn-save-cloud:hover { background: linear-gradient(135deg, #059669, #047857); }
        .jc-btn-save-cloud:disabled { opacity: 0.6; cursor: not-allowed; }

        /* ── BANNIÈRE URL PUBLIQUE ── */
        .jc-url-banner {
          background: rgba(16,185,129,0.12);
          border: 1px solid rgba(16,185,129,0.3);
          border-radius: var(--radius);
          padding: 10px 16px;
          margin: 0 0 12px 0;
          display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
        }
        .jc-url-banner-error { background: rgba(248,113,113,0.1); border-color: rgba(248,113,113,0.3); }
        .jc-url-banner-content { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: 1; }
        .jc-url-banner-label { font-size: 13px; font-weight: 600; color: #10b981; white-space: nowrap; }
        .jc-url-banner-link { font-size: 13px; color: var(--accent); text-decoration: underline; word-break: break-all; }
        .jc-url-copy-btn { background: rgba(59,130,246,0.1); color: var(--accent); border: 1px solid rgba(59,130,246,0.2); border-radius: var(--radius-sm); padding: 4px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; }
        .jc-url-copy-btn:hover { background: rgba(59,130,246,0.2); }
        .jc-url-close-btn { background: transparent; border: 0; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 2px 6px; }
        .jc-url-error { font-size: 12px; color: var(--danger); width: 100%; }
        .jc-btn-danger { background: rgba(248,113,113,0.15); color: var(--danger); border-color: rgba(248,113,113,0.3); }
        .jc-btn-wide { width: 100%; justify-content: center; }

        /* ── SHEET ── */
        .jc-sheet { display: flex; flex-direction: column; gap: 16px; max-width: 1600px; margin: 0 auto; }

        /* ── CARDS ── */
        .jc-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          padding: 20px 24px;
        }

        /* ── HEADER CARD ── */
        .jc-header-card { display: grid; grid-template-columns: 1.3fr 1fr; gap: 24px; }
        .jc-header-left, .jc-header-right { display: flex; flex-direction: column; gap: 16px; }
        .jc-brand { font-size: 24px; font-weight: 900; letter-spacing: 0.02em; color: var(--text); font-family: 'Arial Black', 'Arial Bold', Arial, sans-serif; }
        .jc-brand-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
        .jc-doc-meta { display: grid; grid-template-columns: 160px 150px 1fr 1fr; gap: 10px; }
        .jc-field-grow { flex: 1; }

        /* ── STATUS CHIPS ── */
        .jc-status-row { display: flex; gap: 6px; flex-wrap: wrap; }
        .jc-status-chip {
          border: 1px solid var(--border-2); background: transparent; color: var(--text-muted);
          border-radius: 20px; padding: 5px 12px; font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all 0.15s;
        }
        .jc-status-chip:hover { color: var(--text); }
        .jc-status-chip.active { font-weight: 700; }

        /* ── SECTION TITLES ── */
        .jc-section-title {
          font-size: 12px; font-weight: 700; color: var(--text-muted);
          text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 14px;
        }
        .jc-section-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .jc-badge {
          font-size: 12px; color: var(--text-muted);
          background: var(--card-2); border: 1px solid var(--border);
          border-radius: 20px; padding: 2px 10px;
        }
        .mt12 { margin-top: 12px; }
        .mt20 { margin-top: 20px; }

        /* ── GRIDS ── */
        .jc-grid { display: grid; gap: 10px; }
        .jc-g1 { grid-template-columns: 1fr; }
        .jc-g2 { grid-template-columns: 1fr 1fr; }
        .jc-g3 { grid-template-columns: 1fr 1fr 1fr; }
        .jc-g-addr { grid-template-columns: 1.8fr 0.5fr 0.5fr 1fr; }
        .jc-g-custom { grid-template-columns: 120px 2fr 120px 70px 80px 1fr 150px; align-items: end; }
        .jc-totals-grid { grid-template-columns: 1.3fr 0.7fr; align-items: start; }

        /* ── WIDE MODE ── */
        .jc-wide-grid { display: grid; grid-template-columns: 1fr 400px; gap: 20px; align-items: start; }
        .jc-wide-left { display: flex; flex-direction: column; gap: 20px; min-width: 0; }

        /* ── FIELDS ── */
        .jc-field { display: flex; flex-direction: column; gap: 5px; }
        .jc-field label {
          font-size: 11px; font-weight: 600; color: var(--text-muted);
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        input, select, textarea, button { font: inherit; }
        input, select, textarea {
          width: 100%; background: var(--card-2);
          border: 1px solid var(--border-2);
          border-radius: var(--radius);
          color: var(--text); padding: 9px 12px;
          outline: none;
          -webkit-tap-highlight-color: transparent;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        /* Placeholder plus visible mais clairement pas une vraie valeur */
        input::placeholder, textarea::placeholder {
          color: var(--text-dim);
          opacity: 0.55;
          font-style: italic;
        }
        /* Empêcher le flash blanc des selects sur Chrome/Edge */
        select { color-scheme: dark; }
        .light-mode select { color-scheme: light; }
        .light-mode input::placeholder, .light-mode textarea::placeholder {
          color: #6b7280;
          opacity: 0.75;
        }
        input:focus, select:focus, textarea:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
        }
        input[readonly] { opacity: 0.55; cursor: default; }
        textarea { resize: vertical; }
        .no-spin::-webkit-outer-spin-button,
        .no-spin::-webkit-inner-spin-button { -webkit-appearance: none; }
        .no-spin { -moz-appearance: textfield; }
        .jc-error { border-color: rgba(248,113,113,0.8) !important; box-shadow: 0 0 0 3px rgba(248,113,113,0.12) !important; }

        /* ── VALIDATION ── */
        .jc-validation-row {
          display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;
          margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border);
        }
        .jc-ok   { font-size: 13px; font-weight: 600; color: var(--ok); }
        .jc-warn { font-size: 13px; font-weight: 600; color: var(--warn); }
        .jc-muted-sm { font-size: 12px; color: var(--text-muted); }

        /* ── TABS ── */
        .jc-tabs { display: flex; border-bottom: 1px solid var(--border); margin-bottom: 18px; }
        .jc-tab {
          background: transparent; border: 0;
          border-bottom: 2px solid transparent; color: var(--text-muted);
          padding: 8px 18px; font-size: 13px; font-weight: 600;
          cursor: pointer; margin-bottom: -1px; transition: all 0.15s;
        }
        .jc-tab:hover { color: var(--text); }
        .jc-tab-active { color: var(--accent) !important; border-bottom-color: var(--accent) !important; }

        /* ── SEARCH ── */
        .jc-search-input { width: 100%; font-size: 14px; padding: 11px 14px; margin-bottom: 16px; border-radius: var(--radius); }

        /* ── PRODUCT GRID — images carrées ── */
        .jc-product-grid { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .jc-product-tile {
          display: flex; flex-direction: column; gap: 10px;
          background: var(--card-2); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 10px; transition: border-color 0.15s;
        }
        .jc-product-tile:hover { border-color: var(--border-2); }
        .jc-product-img-wrap {
          width: 100%; aspect-ratio: 1/1;
          border-radius: var(--radius-sm); overflow: hidden;
          background: var(--card); border: 1px solid var(--border); flex-shrink: 0;
        }
        .jc-product-img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .jc-product-body { display: flex; flex-direction: column; gap: 4px; flex: 1; }
        .jc-product-sku { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.07em; }
        .jc-product-title { font-size: 13px; font-weight: 700; line-height: 1.3; }
        .jc-product-variant { font-size: 12px; color: var(--text-muted); }
        .jc-product-footer { display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 6px; }
        .jc-price-tag { font-weight: 800; font-size: 14px; }
        .jc-stock-ok  { font-size: 11px; font-weight: 600; color: var(--ok); }
        .jc-stock-low { font-size: 11px; font-weight: 600; color: var(--warn); }
        .jc-add-btn {
          width: 100%;
          background: rgba(59,130,246,0.1); color: var(--accent);
          border: 1px solid rgba(59,130,246,0.2);
          border-radius: var(--radius-sm);
          padding: 8px; font-size: 13px; font-weight: 700;
          cursor: pointer; transition: all 0.15s;
        }
        .jc-add-btn:hover { background: rgba(59,130,246,0.2); }
        .jc-empty-search { color: var(--text-muted); padding: 24px; text-align: center; grid-column: 1/-1; font-style: italic; }
        .jc-custom-preview { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
        .jc-custom-preview img { width: 90px; height: 90px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border); }
        .jc-align-end { justify-content: flex-end; }

        /* ── TABLE ── */
        .jc-drag-hint { font-size: 12px; color: var(--text-dim); margin-bottom: 10px; }
        .jc-table-wrap { overflow-x: auto; }
        .jc-table { width: 100%; border-collapse: separate; border-spacing: 0 5px; min-width: 900px; table-layout: fixed; }
        .jc-table thead th {
          text-align: left; font-size: 11px; font-weight: 700; color: var(--text-muted);
          text-transform: uppercase; letter-spacing: 0.06em; padding: 0 8px 8px;
        }
        .jc-table td {
          padding: 8px; vertical-align: middle;
          border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
        }
        .jc-table tr td:first-child { border-left: 1px solid var(--border); border-top-left-radius: var(--radius-sm); border-bottom-left-radius: var(--radius-sm); }
        .jc-table tr td:last-child  { border-right: 1px solid var(--border); border-top-right-radius: var(--radius-sm); border-bottom-right-radius: var(--radius-sm); }
        .jc-table tbody tr { cursor: grab; }
        .tr-even td { background: rgba(255,255,255,0.02); }
        .tr-odd  td { background: rgba(255,255,255,0.04); }
        /* Ligne en cours de drag : très visible en bleu */
        .tr-dragging td {
          background: rgba(59,130,246,0.25) !important;
          border-color: rgba(59,130,246,0.6) !important;
          opacity: 1 !important;
          box-shadow: inset 0 0 0 2px rgba(59,130,246,0.5);
        }
        .tr-added td { animation: rowAdded 1.2s ease; }
        @keyframes rowAdded {
          0%   { box-shadow: inset 0 0 0 9999px rgba(59,130,246,0.2); }
          100% { box-shadow: inset 0 0 0 9999px rgba(59,130,246,0); }
        }
        .td-num   { color: var(--text-dim); font-size: 12px; text-align: center; font-weight: 700; }
        .td-money { text-align: right; font-weight: 700; font-size: 13px; white-space: nowrap; }
        .jc-line-img {
          width: 58px; height: 58px; border-radius: var(--radius-sm);
          border: 1px dashed var(--border-2); overflow: hidden;
          display: flex; align-items: center; justify-content: center;
          background: var(--card-2); color: var(--text-dim);
        }
        .jc-line-img img { width: 100%; height: 100%; object-fit: cover; }
        .jc-img-file-input { font-size: 11px; padding: 4px; margin-top: 4px; max-width: 140px; }
        .jc-qty-input { width: 64px; text-align: center; }
        .jc-cell-input { border-radius: 6px; padding: 8px; background: rgba(255,255,255,0.03); }
        .jc-table tbody td { vertical-align: top; padding-top: 10px; }
        .jc-title-input { width: 100%; resize: none; overflow: hidden; min-height: 32px; line-height: 1.4; padding-top: 6px; padding-bottom: 6px; }
        .jc-price-input { width: 90px; text-align: right; }
        .jc-empty-row { text-align: center; color: var(--text-dim); padding: 24px; font-style: italic; }

        /* ── SERVICES ── */
        .jc-service-list { display: flex; flex-direction: column; gap: 10px; }
        .jc-service-row {
          display: grid; grid-template-columns: 1fr auto;
          gap: 12px; align-items: center;
          padding: 10px 14px;
          border-radius: var(--radius-sm);
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--border);
          transition: border-color 0.15s, background 0.15s;
          cursor: pointer;
        }
        .jc-service-row:hover { background: rgba(59,130,246,0.05); border-color: rgba(59,130,246,0.25); }
        .jc-service-row:has(input[type="checkbox"]:checked) {
          border-color: rgba(59,130,246,0.35);
          background: rgba(59,130,246,0.05);
        }
        .jc-service-price-wrap { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
        .jc-service-price { width: 80px; text-align: right; }
        .jc-service-free { font-size: 12px; color: var(--text-dim); font-style: italic; }
        .jc-check-label { display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; }
        .jc-check-label-full { width: 100%; padding: 2px 0; }
        .jc-check-label input { width: 15px; height: 15px; flex-shrink: 0; cursor: pointer; }

        /* ── TOTALS ── */
        .jc-total-card { position: sticky; top: 12px; }
        .jc-client-badge {
          display: block; font-size: 12px; font-weight: 700;
          padding: 8px 12px; border-radius: var(--radius-sm);
          border: 1px solid; margin-bottom: 14px;
        }
        .jc-total-row {
          display: flex; justify-content: space-between; align-items: center;
          gap: 10px; padding: 8px 0;
          border-bottom: 1px solid var(--border); font-size: 13px;
        }
        .jc-discount-input { width: 100px; text-align: right; }
        .jc-discount-amt { color: var(--ok); }
        .jc-arrondi-hint { font-size: 10px; color: var(--text-dim); margin-top: 2px; }
        .jc-tva-row { padding: 8px 6px; border-radius: 4px; background: rgba(255,255,255,0.02); }
        .jc-tva-label { font-size: 12px; font-weight: 700; }
        .jc-tva-incl { font-size: 12px; color: var(--text-muted); font-style: italic; }
        .jc-tva-add-amt { color: var(--warn); }
        .jc-grand-total {
          display: flex; justify-content: space-between; align-items: center;
          padding: 14px 0 8px; font-size: 20px; font-weight: 900; color: var(--text);
        }
        .jc-info-badge {
          margin-top: 8px; padding: 8px 12px;
          border-radius: var(--radius-sm);
          background: var(--card-2); border: 1px solid var(--border);
          font-size: 12px; color: var(--text-muted);
        }

        /* ── TRASH ── */
        .jc-trash-btn {
          width: 34px; height: 34px;
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(248,113,113,0.1); color: var(--danger);
          border: 1px solid rgba(248,113,113,0.2);
          border-radius: var(--radius-sm); font-size: 14px; cursor: pointer; transition: all 0.15s;
        }
        .jc-trash-btn:hover { background: rgba(248,113,113,0.2); }

        /* ── SIGNATURE ── */
        .jc-sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; }
        .jc-sign-label { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 44px; }
        .jc-sign-line { border-bottom: 1.5px solid #9ca3af; margin-bottom: 6px; }
        .jc-sign-sub { font-size: 11px; color: #9ca3af; }
        .jc-cgs { margin-top: 18px; padding-top: 14px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; line-height: 1.6; }

        /* ── NOTES INTERNES ── */
        .jc-label-hint { font-size: 10px; color: var(--text-dim); font-weight: 400; text-transform: none; letter-spacing: 0; margin-left: 4px; }
        .jc-internal-badge {
          display: inline-block;
          font-size: 10px; font-weight: 700;
          background: rgba(245,158,11,0.15);
          color: #f59e0b;
          border: 1px solid rgba(245,158,11,0.3);
          border-radius: 4px;
          padding: 1px 6px;
          margin-right: 6px;
        }
        .jc-internal-textarea {
          border-color: rgba(245,158,11,0.25) !important;
          background: rgba(245,158,11,0.04) !important;
        }
        .jc-internal-textarea:focus {
          border-color: rgba(245,158,11,0.6) !important;
          box-shadow: 0 0 0 3px rgba(245,158,11,0.1) !important;
        }

        /* ── IMAGES D'AMBIANCE ── */
        .jc-ambiance-empty {
          display: block;
          color: var(--text-dim); font-style: italic; font-size: 13px;
          padding: 28px; text-align: center;
          border: 2px dashed var(--border-2);
          border-radius: var(--radius);
          transition: border-color 0.15s, background 0.15s;
          width: 100%;
        }
        .jc-ambiance-empty:hover {
          border-color: var(--accent);
          background: rgba(59,130,246,0.04);
          color: var(--accent);
        }
        .jc-ambiance-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
          margin-top: 14px;
        }
        .jc-ambiance-tile {
          display: flex; flex-direction: column; gap: 8px;
        }
        .jc-ambiance-img-wrap {
          position: relative;
          width: 100%;
          aspect-ratio: 4/3;
          border-radius: var(--radius);
          overflow: hidden;
          border: 1px solid var(--border-2);
          background: var(--card-2);
        }
        .jc-ambiance-img-wrap img {
          width: 100%; height: 100%;
          object-fit: cover; display: block;
        }
        .jc-ambiance-remove {
          position: absolute; top: 8px; right: 8px;
          width: 28px; height: 28px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.6); color: white;
          border: 0; border-radius: 50%;
          font-size: 13px; cursor: pointer;
          transition: background 0.15s;
        }
        .jc-ambiance-remove:hover { background: rgba(239,68,68,0.85); }
        .jc-ambiance-legende {
          font-size: 12px !important;
          padding: 7px 10px !important;
          border-radius: var(--radius-sm) !important;
          text-align: center;
        }

        /* ── MOTEUR SHOPIFY ── */
        .jc-shopify-search-bar { display: flex; gap: 8px; margin-bottom: 14px; align-items: center; flex-wrap: wrap; }
        .jc-search-clear { padding: 8px 12px !important; flex-shrink: 0; }
        .jc-filter-stock-label {
          display: flex; align-items: center; gap: 7px;
          font-size: 13px; font-weight: 600; color: var(--text-muted);
          cursor: pointer; white-space: nowrap;
          padding: 8px 12px;
          border: 1px solid var(--border-2);
          border-radius: var(--radius-xl);
          background: var(--card-2);
          transition: all 0.15s;
        }
        .jc-filter-stock-label:has(input:checked) {
          border-color: var(--ok);
          color: var(--ok);
          background: rgba(74,222,128,0.08);
        }
        .jc-filter-stock-label input { width: 14px; height: 14px; }
        .jc-shopify-hint { color: var(--text-dim); font-style: italic; font-size: 13px; padding: 16px 0; }
        .jc-shopify-loading {
          display: flex; align-items: center; gap: 10px;
          color: var(--text-muted); font-size: 13px; padding: 12px 0;
        }
        .jc-spinner {
          width: 16px; height: 16px;
          border: 2px solid var(--border-2);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          flex-shrink: 0;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .jc-shopify-error {
          padding: 10px 14px; border-radius: var(--radius-sm);
          background: rgba(248,113,113,0.1);
          border: 1px solid rgba(248,113,113,0.25);
          color: var(--danger); font-size: 13px; margin-bottom: 12px;
        }

        /* Grille résultats responsive : 4 cols grand écran, 2 medium, 1 petit */
        .jc-shopify-grid {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        @media (max-width: 1400px) { .jc-shopify-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 700px)  { .jc-shopify-grid { grid-template-columns: 1fr; } }

        .jc-shopify-tile {
          display: flex;
          flex-direction: column;
          gap: 10px;
          background: var(--card-2);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 12px;
          transition: border-color 0.15s, box-shadow 0.2s;
        }
        .jc-shopify-tile:hover { border-color: var(--border-2); }
        .jc-product-flash { border-color: #4ade80 !important; box-shadow: 0 0 0 2px rgba(74,222,128,0.3) !important; }

        /* 4 images carrées */
        .jc-shopify-imgs {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 5px;
        }
        .jc-shopify-img-link { display: block; }
        .jc-shopify-img-box {
          position: relative;
          width: 100%;
          aspect-ratio: 1/1;
          border-radius: var(--radius-sm);
          overflow: hidden;
          border: 1px solid var(--border);
          background: var(--card);
        }
        .jc-shopify-img-box img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .jc-shopify-img-empty { opacity: 0.25; }

        /* Infos */
        .jc-shopify-meta { display: flex; flex-direction: column; gap: 5px; min-width: 0; flex: 1; }
        .jc-shopify-variant { font-size: 13px; font-weight: 700; line-height: 1.3; margin-bottom: 4px; }
        .jc-shopify-row { display: grid; grid-template-columns: 48px 1fr; gap: 8px; font-size: 12px; align-items: center; }
        .jc-shopify-label { color: var(--text-muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
        .jc-shopify-val { color: var(--text); }
        .jc-shopify-price { font-weight: 800; font-size: 14px; }
        .jc-shopify-stock-link { color: var(--accent); font-size: 12px; font-weight: 700; text-decoration: underline; }
        .jc-shopify-open-link { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .jc-shopify-open-link:hover { color: var(--accent); }
        .jc-shopify-delai {
          margin-top: 4px;
          font-size: 11px; font-weight: 700;
          color: #f59e0b;
          background: rgba(245,158,11,0.1);
          border: 1px solid rgba(245,158,11,0.25);
          border-radius: 4px;
          padding: 3px 6px;
        }

        /* Adresse livraison */
        .jc-livr-toggle { padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: rgba(255,255,255,0.02); }
        .jc-livr-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }

        /* ── AUTOCOMPLÉTION ADRESSE ── */
        .jc-addr-dropdown {
          position: absolute; top: 100%; left: 0; right: 0; z-index: 50;
          background: var(--card); border: 1px solid var(--border-2);
          border-radius: var(--radius-sm); box-shadow: 0 8px 24px rgba(0,0,0,0.3);
          max-height: 220px; overflow-y: auto; margin-top: 2px;
        }
        .jc-addr-item {
          padding: 9px 12px; font-size: 13px; cursor: pointer;
          border-bottom: 1px solid var(--border);
          transition: background 0.1s;
        }
        .jc-addr-item:last-child { border-bottom: 0; }
        .jc-addr-item:hover { background: rgba(59,130,246,0.1); color: var(--accent); }

        /* ── SERVICE VIERGE ── */
        .jc-service-custom-row { border-style: dashed !important; }
        .jc-service-custom-label {
          width: 100% !important;
          background: transparent !important;
          border: 0 !important;
          border-bottom: 1px solid var(--border-2) !important;
          border-radius: 0 !important;
          padding: 4px 0 !important;
          font-size: 13px;
          color: var(--text);
          outline: none !important;
          box-shadow: none !important;
        }
        .jc-service-custom-label:focus { border-color: var(--accent) !important; }
        .jc-stock-zero { color: var(--danger); font-weight: 700; font-size: 12px; }
        .jc-stock-cmd { color: #f59e0b; font-weight: 700; font-size: 12px; }

        /* Colonne stock dans le tableau */
        .td-stock { text-align: center; vertical-align: middle; }
        .jc-stock-input { width: 70px; text-align: center; }

        /* ── ÉDITEUR REMARQUES — forcer LTR absolu ── */
        .jc-editor-content {
          min-height: 90px;
          padding: 10px 12px;
          background: var(--card-2);
          color: var(--text);
          font-size: 14px;
          line-height: 1.6;
          outline: none;
          direction: ltr !important;
          text-align: left !important;
          unicode-bidi: embed !important;
          writing-mode: horizontal-tb !important;
        }
        .jc-editor-content:empty::before {
          content: "Notes pour le client, conditions spéciales…";
          color: var(--text-muted);
          opacity: 0.6;
          font-style: italic;
          pointer-events: none;
        }
        .jc-remarks-print { font-size: 13px; line-height: 1.6; padding: 8px 0; color: #111; }
        .light-mode .jc-editor-content { color: #111827; }
        .light-mode .jc-editor-toolbar { background: #e8eaed; border-color: rgba(0,0,0,0.1); }
        .light-mode .jc-editor-btn { color: #52576b; }
        .light-mode .jc-editor-btn:hover { background: rgba(0,0,0,0.08); color: #111827; }

        /* ── LIGNE COMMENTAIRE ── */
        .tr-comment td {
          background: rgba(96,165,250,0.06) !important;
          border-color: rgba(96,165,250,0.15) !important;
        }
        .td-comment-cell { padding: 8px 10px; }
        .jc-comment-input {
          width: 100%;
          font-style: italic;
          color: var(--text-muted) !important;
          background: transparent !important;
          border: 1px dashed rgba(96,165,250,0.3) !important;
        }
        .jc-comment-input:focus {
          color: var(--text) !important;
          font-style: normal;
          border-color: var(--accent) !important;
        }

        /* ── REMISE PAR LIGNE — toggle ── */
        .jc-price-cell { display: flex; flex-direction: column; gap: 3px; }
        .jc-price-row { display: flex; align-items: center; gap: 4px; }
        .jc-discount-toggle {
          flex-shrink: 0;
          width: 28px; height: 28px;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 800;
          background: rgba(255,255,255,0.04);
          color: var(--text-dim);
          border: 1px solid var(--border);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .jc-discount-toggle:hover { background: rgba(74,222,128,0.1); color: var(--ok); border-color: rgba(74,222,128,0.3); }
        .jc-discount-toggle.active { background: rgba(74,222,128,0.12); color: var(--ok); border-color: rgba(74,222,128,0.4); }
        .jc-discount-toggle.has-value { color: var(--ok); border-color: rgba(74,222,128,0.4); }
        .jc-line-discount-input {
          width: 100% !important;
          font-size: 12px !important;
          padding: 5px 8px !important;
          background: rgba(74,222,128,0.05) !important;
          border-color: rgba(74,222,128,0.25) !important;
          color: var(--ok) !important;
        }
        .jc-line-discount-input::placeholder { color: var(--ok); opacity: 0.4; }
        .jc-line-discount-shown {
          font-size: 11px; color: var(--ok); text-align: right; margin-top: 1px;
        }

        /* ── COLONNE STOCK RÉDUITE ── */
        .td-stock { text-align: center; vertical-align: middle; white-space: nowrap; }
        .jc-stock-input { width: 58px !important; text-align: center; font-size: 12px !important; padding: 6px 4px !important; }

        /* ── REMARQUES — textarea simple LTR garanti ── */
        .jc-remarks-textarea {
          direction: ltr !important;
          text-align: left !important;
          unicode-bidi: normal !important;
          resize: vertical;
          width: 100%;
          font-family: inherit;
        }
        .jc-remarks-print { font-size: 13px; line-height: 1.6; padding: 8px 0; color: #111; white-space: pre-wrap; }

        /* ── FOND ET BORDURE NÉON SECTION TABLEAU ── */
        .jc-card.jc-lines-card {
          background: rgba(59, 130, 246, 0.04);
          border: 1.5px solid rgba(59, 130, 246, 0.35);
          box-shadow: 0 0 0 1px rgba(59,130,246,0.10), 0 4px 24px rgba(59,130,246,0.08);
        }
        .light-mode .jc-card.jc-lines-card {
          background: rgba(219, 234, 254, 0.55);
          border: 1.5px solid rgba(59, 130, 246, 0.4);
          box-shadow: 0 0 0 1px rgba(59,130,246,0.15), 0 4px 16px rgba(59,130,246,0.1);
        }

        /* ── CROIX SUPPRESSION IMAGE LIGNE ── */
        .td-img-cell { width: 82px; vertical-align: middle; position: relative; }
        .jc-img-clear-btn {
          display: block;
          width: 72px;
          margin-top: 3px;
          padding: 2px 0;
          font-size: 10px;
          text-align: center;
          background: rgba(248,113,113,0.1);
          color: var(--danger);
          border: 1px solid rgba(248,113,113,0.2);
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .jc-img-clear-btn:hover { background: rgba(248,113,113,0.25); }

        /* ── BOUTONS NAVIGATION FLOTTANTS ── */
        .jc-scroll-btns {
          position: fixed;
          right: 18px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          flex-direction: column;
          gap: 8px;
          z-index: 100;
        }
        .jc-scroll-btn {
          width: 40px; height: 40px;
          border-radius: 50%;
          border: 1px solid var(--border-2);
          background: var(--card-2);
          color: var(--text);
          font-size: 16px;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 2px 12px rgba(0,0,0,0.3);
          transition: all 0.15s;
        }
        .jc-scroll-btn:hover { background: var(--accent); color: white; border-color: var(--accent); }

        /* ── BOUTON DUPLIQUER ── */
        .jc-action-btns { display: flex; gap: 6px; align-items: center; }
        .jc-dup-btn {
          width: 34px; height: 34px;
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(96,165,250,0.1);
          color: #60a5fa;
          border: 1px solid rgba(96,165,250,0.25);
          border-radius: var(--radius-sm);
          font-size: 16px; cursor: pointer;
          transition: all 0.15s;
        }
        .jc-dup-btn:hover { background: rgba(96,165,250,0.22); }

        /* ── SKU ÉLARGI ── */
        .jc-sku-input { min-width: 100%; }

        /* ── MINI-ÉDITEUR REMARQUES ── */
        .jc-editor-wrap {
          border: 1px solid var(--border-2);
          border-radius: var(--radius);
          overflow: hidden;
        }
        .jc-editor-toolbar {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 6px 8px;
          background: var(--card-2);
          border-bottom: 1px solid var(--border);
        }
        .jc-editor-btn {
          background: transparent;
          border: 1px solid transparent;
          border-radius: 6px;
          color: var(--text-muted);
          padding: 4px 8px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.12s;
          width: auto;
          min-width: 30px;
        }
        .jc-editor-btn:hover { background: var(--border); color: var(--text); border-color: var(--border-2); }
        .jc-editor-sep { width: 1px; height: 18px; background: var(--border-2); margin: 0 4px; }
        .light-mode .jc-editor-content { color: #111827; }
        .light-mode .jc-editor-toolbar { background: #e8eaed; border-color: rgba(0,0,0,0.1); }
        .light-mode .jc-editor-btn { color: #52576b; }
        .light-mode .jc-editor-btn:hover { background: rgba(0,0,0,0.08); color: #111827; }

        /* ── VIGNETTE IMAGE LIGNE — améliorée ── */
        .td-img-cell { width: 82px; vertical-align: middle; }
        .jc-line-img-label { display: block; cursor: pointer; position: relative; }
        .jc-line-img {
          width: 72px; height: 72px; border-radius: var(--radius-sm);
          border: 1px solid var(--border-2); overflow: hidden;
          display: flex; align-items: center; justify-content: center;
          background: var(--card-2); position: relative;
        }
        .jc-line-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .jc-line-img-placeholder { font-size: 22px; color: var(--text-dim); }
        .jc-line-img-overlay {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0.45);
          color: white; font-size: 18px;
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: opacity 0.15s;
        }
        .jc-line-img-label:hover .jc-line-img-overlay { opacity: 1; }

        /* ── FLASH PRODUIT SHOPIFY ── */
        .jc-product-tile { transition: border-color 0.15s, box-shadow 0.2s; }
        .jc-product-flash { border-color: #4ade80 !important; box-shadow: 0 0 0 2px rgba(74,222,128,0.3) !important; }
        .jc-product-img-wrap { position: relative; }
        .jc-product-flash-overlay {
          position: absolute; inset: 0;
          background: rgba(74,222,128,0.5);
          display: flex; align-items: center; justify-content: center;
          font-size: 36px; font-weight: 900; color: white;
          animation: flashFade 0.9s ease forwards;
          z-index: 10;
        }
        @keyframes flashFade {
          0%   { opacity: 1; }
          70%  { opacity: 1; }
          100% { opacity: 0; }
        }

        /* ── IMAGES AMBIANCE DRAG ── */
        .jc-ambiance-tile { cursor: grab; }
        .jc-ambiance-dragging { opacity: 0.4; }
        .jc-ambiance-drag-hint {
          position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
          background: rgba(0,0,0,0.55); color: white; border-radius: 4px;
          font-size: 16px; padding: 2px 8px; letter-spacing: 2px;
          pointer-events: none;
        }

/* ── RECHERCHE CLIENT LIVE ── */
        .jc-client-dropdown {
          position: absolute; top: 100%; left: 0; right: 0; z-index: 60;
          background: var(--card); border: 1px solid rgba(59,130,246,0.4);
          border-radius: var(--radius-sm); box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          margin-top: 2px; overflow: hidden;
        }
        .jc-client-item {
          padding: 10px 14px; cursor: pointer;
          border-bottom: 1px solid var(--border);
          transition: background 0.1s;
        }
        .jc-client-item:last-child { border-bottom: 0; }
        .jc-client-item:hover { background: rgba(59,130,246,0.1); }
        .jc-client-item-name { font-size: 13px; font-weight: 700; color: var(--text); }
        .jc-client-item-soc { font-weight: 400; color: var(--text-muted); }
        .jc-client-item-detail { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

        /* ── PRINT ── */
        .printOnly { display: none; }
        @media print {
          body { background: white; color: #111; -webkit-font-smoothing: auto; }
          .jc-page { padding: 0; }
          .screenOnly { display: none !important; }
          .printOnly { display: block !important; }
          .jc-sheet { gap: 6px; max-width: none; }
          .jc-card { background: white; color: #111; border: 1px solid #d1d5db; box-shadow: none; border-radius: 0; break-inside: avoid; }
          input, select, textarea { color: #111; background: transparent; border: 1px solid #d1d5db; }
          .jc-table td, .jc-table th { color: #111 !important; border: 1px solid #d1d5db !important; background: white !important; border-radius: 0 !important; }
          .jc-table { border-spacing: 0; }
          .jc-line-img { border: 1px solid #d1d5db; background: white; }
          .jc-sign-block { display: block !important; }
          /* Images d'ambiance : page 2, grille 2 colonnes */
          .jc-ambiance-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
          .jc-ambiance-img-wrap { aspect-ratio: 4/3; border: 1px solid #d1d5db; }
          .jc-ambiance-legende { font-size: 11px !important; text-align: center; border: 0 !important; background: transparent !important; color: #6b7280 !important; }
          @page { size: A4 portrait; margin: 10mm; }
        }

        /* ── RESPONSIVE ── */
        @media (max-width: 1300px) { .jc-product-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 1000px) {
          .jc-header-card, .jc-totals-grid, .jc-doc-meta,
          .jc-g3, .jc-g-addr, .jc-g-custom { grid-template-columns: 1fr; }
          .jc-topbar { flex-direction: column; align-items: flex-start; }
          .jc-product-grid { grid-template-columns: 1fr 1fr; }
          .jc-total-card { position: static; }
          .jc-g2 { grid-template-columns: 1fr; }
        }
        @media (max-width: 600px) { .jc-product-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

