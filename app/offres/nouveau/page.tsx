"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type FormType = "Offre" | "Commande";
type ClientType = "Privé (prix TTC)" | "Pro (prix HT)";
type PaymentMode = "Paiement d'avance à la commande" | "Acompte de 50% à la commande" | "Paiement à 30 jours";
type OfferStatus = "En cours" | "Envoyée" | "Acceptée" | "Refusée";

type Product = {
  id: string;
  sku: string;
  title: string;
  variant: string;
  image: string;
  price: number;
  stock: number;
};

type QuoteLine = {
  id: string;
  type: "product" | "custom";
  image?: string;
  sku: string;
  title: string;
  unitPrice: number;
  qty: number;
};

type DraftSnapshot = {
  formType: FormType;
  clientType: ClientType;
  paymentMode: PaymentMode;
  offerStatus: OfferStatus;
  date: string;
  commercial: string;
  offerNumber: string;
  societe: string;
  nom: string;
  prenom: string;
  rue: string;
  numero: string;
  npa: string;
  ville: string;
  telephone1: string;
  telephone2: string;
  email: string;
  lines: QuoteLine[];
  discount: string;
  discountPercent: string;
  remarks: string;
  conditionsGenerales: string;
  leadTime: string;
  manualRounding: string;
  enabledServices: Record<string, boolean>;
  servicePrices: Record<string, string>;
  applyTva: boolean;
};

const demoProducts: Product[] = [
  {
    id: "p1",
    sku: "410182",
    title: "Fermob Luxembourg Chaise",
    variant: "Cactus 82",
    image: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=500&q=80",
    price: 245,
    stock: 4,
  },
  {
    id: "p2",
    sku: "B33410",
    title: "Biohort StyleBox 140",
    variant: "Argent métallique",
    image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=500&q=80",
    price: 949,
    stock: 2,
  },
  {
    id: "p3",
    sku: "67073",
    title: "Panier pour coffre",
    variant: "Type D pour StyleBox",
    image: "https://images.unsplash.com/photo-1517705008128-361805f42e86?auto=format&fit=crop&w=500&q=80",
    price: 65,
    stock: 8,
  },
  {
    id: "p4",
    sku: "LFM5169",
    title: "Lafuma Rclip Monochrom Relax",
    variant: "Erdbraun / Titanium",
    image: "https://images.unsplash.com/photo-1491921125492-f0b9c835b699?auto=format&fit=crop&w=500&q=80",
    price: 170,
    stock: 0,
  },
];

const serviceOptions = [
  { code: "montage", label: "Montage / Installation", defaultPrice: 144 },
  { code: "livraison", label: "Livraison à domicile", defaultPrice: 59 },
  { code: "poste", label: "Envoi par colis Poste", defaultPrice: 25 },
];

const TVA_RATE = 0.077; // 7.7% Suisse
const STORAGE_KEY = "jc-offre-v5-draft";

const STATUS_CONFIG: Record<OfferStatus, { color: string; bg: string; icon: string }> = {
  "En cours":  { color: "#f59e0b", bg: "rgba(245,158,11,0.13)",  icon: "✏️" },
  "Envoyée":   { color: "#3da3ff", bg: "rgba(61,163,255,0.13)",  icon: "📤" },
  "Acceptée":  { color: "#4ade80", bg: "rgba(74,222,128,0.13)",  icon: "✅" },
  "Refusée":   { color: "#ef4444", bg: "rgba(239,68,68,0.13)",   icon: "❌" },
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency", currency: "CHF",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

function todayForInput() {
  return new Date().toISOString().slice(0, 10);
}

function generateOfferNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const seq = String(Math.floor(Math.random() * 90000) + 10000);
  return `OFFRE ${yy}${mm}-${seq}-V1`;
}

function generateCustomerNumber(email: string) {
  if (!email.trim()) return "";
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) % 100000;
  }
  return `CL-${String(hash).padStart(5, "0")}`;
}

function normalizeSwissPhone(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  let normalized = digits;
  if (normalized.startsWith("0041")) normalized = "41" + normalized.slice(4);
  else if (normalized.startsWith("0")) normalized = "41" + normalized.slice(1);
  else if (!normalized.startsWith("41")) normalized = "41" + normalized;
  const trimmed = normalized.slice(0, 11);
  const parts = [
    "+" + trimmed.slice(0, 2),
    trimmed.slice(2, 4),
    trimmed.slice(4, 7),
    trimmed.slice(7, 9),
    trimmed.slice(9, 11),
  ];
  return parts.filter(Boolean).join(" ");
}

function sanitizeNpa(value: string) {
  return value.replace(/[^\d]/g, "").slice(0, 4);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function cloneLines(lines: QuoteLine[]) {
  return lines.map((line) => ({ ...line }));
}

export default function JardinConfortV5() {
  const [formType, setFormType] = useState<FormType>("Offre");
  const [clientType, setClientType] = useState<ClientType>("Privé (prix TTC)");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("Paiement d'avance à la commande");
  const [offerStatus, setOfferStatus] = useState<OfferStatus>("En cours");
  const [date, setDate] = useState(todayForInput());
  const [commercial, setCommercial] = useState("Brice Chappé");
  const [offerNumber, setOfferNumber] = useState(() => generateOfferNumber());

  const [societe, setSociete] = useState("");
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [rue, setRue] = useState("");
  const [numero, setNumero] = useState("");
  const [npa, setNpa] = useState("");
  const [ville, setVille] = useState("");
  const [telephone1, setTelephone1] = useState("");
  const [telephone2, setTelephone2] = useState("");
  const [email, setEmail] = useState("");

  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<QuoteLine[]>([
    { id: "line-1", type: "product", image: demoProducts[1].image, sku: "B33410", title: "Biohort StyleBox 140 - Argent métallique", unitPrice: 949, qty: 1 },
    { id: "line-2", type: "product", image: demoProducts[2].image, sku: "67073", title: "Panier pour coffre - Type D pour StyleBox", unitPrice: 65, qty: 1 },
  ]);

  const [customSku, setCustomSku] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [customQty, setCustomQty] = useState("1");
  const [customImage, setCustomImage] = useState("");

  const [discount, setDiscount] = useState("0");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [applyTva, setApplyTva] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [conditionsGenerales, setConditionsGenerales] = useState(
    "Les prix indiqués sont en CHF. Validité de l'offre : 30 jours. Livraison selon disponibilité. Le paiement doit être effectué selon les modalités convenues. Jardin-Confort SA se réserve le droit de modifier les prix en cas de variation des cours."
  );
  const [leadTime, setLeadTime] = useState("25-30 jours");
  const [manualRounding, setManualRounding] = useState("0");
  const [enabledServices, setEnabledServices] = useState<Record<string, boolean>>({ montage: false, livraison: false, poste: false });
  const [servicePrices, setServicePrices] = useState<Record<string, string>>({ montage: "144", livraison: "59", poste: "25" });

  const [undoSnapshot, setUndoSnapshot] = useState<QuoteLine[] | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [draggedLineId, setDraggedLineId] = useState<string | null>(null);
  const [justAddedLineId, setJustAddedLineId] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<"shopify" | "custom">("shopify");

  const customImageInputRef = useRef<HTMLInputElement | null>(null);
  const customerNumber = useMemo(() => generateCustomerNumber(email), [email]);

  const filteredProducts = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return demoProducts;
    return demoProducts.filter((p) =>
      p.sku.toLowerCase().includes(q) ||
      p.title.toLowerCase().includes(q) ||
      p.variant.toLowerCase().includes(q)
    );
  }, [search]);

  const subTotal = useMemo(() => lines.reduce((s, l) => s + l.qty * l.unitPrice, 0), [lines]);

  const discountValue = useMemo(() => {
    const pct = Number(discountPercent || 0);
    if (pct > 0) return Math.round(subTotal * pct) / 100;
    return Number(discount || 0);
  }, [discount, discountPercent, subTotal]);

  const serviceTotal = useMemo(() => serviceOptions.reduce((s, srv) => {
    if (!enabledServices[srv.code]) return s;
    return s + Number(servicePrices[srv.code] || 0);
  }, 0), [enabledServices, servicePrices]);

  const totalAfterDiscount = subTotal - discountValue;
  const totalBeforeTva = totalAfterDiscount + serviceTotal;
  const tvaAmount = applyTva ? totalBeforeTva * TVA_RATE : 0;
  const finalTotalBeforeRounding = totalBeforeTva + tvaAmount;
  const finalTotal = finalTotalBeforeRounding + Number(manualRounding || 0);

  const missingRequired = { nom: !nom.trim(), ville: !ville.trim(), email: !email.trim() };
  const isFormValid = !missingRequired.nom && !missingRequired.ville && !missingRequired.email;
  const statusCfg = STATUS_CONFIG[offerStatus];

  function captureUndo() { setUndoSnapshot(cloneLines(lines)); }
  function highlightAdded(id: string) {
    setJustAddedLineId(id);
    window.setTimeout(() => setJustAddedLineId((c) => (c === id ? null : c)), 1400);
  }

  function addProduct(product: Product) {
    captureUndo();
    const id = `${product.id}-${Date.now()}`;
    setLines((c) => [...c, { id, type: "product", image: product.image, sku: product.sku, title: `${product.title} / ${product.variant}`, unitPrice: product.price, qty: 1 }]);
    highlightAdded(id);
  }

  function addCustomLine() {
    if (!customTitle.trim()) return;
    captureUndo();
    const id = `custom-${Date.now()}`;
    setLines((c) => [...c, { id, type: "custom", image: customImage, sku: customSku.trim(), title: customTitle.trim(), unitPrice: Number(customPrice || 0), qty: Math.max(1, parseInt(customQty || "1", 10)) }]);
    setCustomSku(""); setCustomTitle(""); setCustomPrice(""); setCustomQty("1"); setCustomImage("");
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
    return { formType, clientType, paymentMode, offerStatus, date, commercial, offerNumber, societe, nom, prenom, rue, numero, npa, ville, telephone1, telephone2, email, lines: cloneLines(lines), discount, discountPercent, remarks, conditionsGenerales, leadTime, manualRounding, enabledServices: { ...enabledServices }, servicePrices: { ...servicePrices }, applyTva };
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
    setOfferStatus(s.offerStatus || "En cours"); setDate(s.date); setCommercial(s.commercial);
    setOfferNumber(s.offerNumber); setSociete(s.societe); setNom(s.nom); setPrenom(s.prenom);
    setRue(s.rue); setNumero(s.numero); setNpa(s.npa); setVille(s.ville);
    setTelephone1(s.telephone1); setTelephone2(s.telephone2); setEmail(s.email);
    setLines(cloneLines(s.lines)); setDiscount(s.discount); setDiscountPercent(s.discountPercent || "0");
    setRemarks(s.remarks); setConditionsGenerales(s.conditionsGenerales || "");
    setLeadTime(s.leadTime); setManualRounding(s.manualRounding);
    setEnabledServices({ ...s.enabledServices }); setServicePrices({ ...s.servicePrices });
    setApplyTva(s.applyTva || false);
    setDraftSavedAt(new Date().toLocaleString("fr-CH"));
  }

  function resetForm() {
    setFormType("Offre"); setClientType("Privé (prix TTC)"); setPaymentMode("Paiement d'avance à la commande");
    setOfferStatus("En cours"); setDate(todayForInput()); setOfferNumber(generateOfferNumber());
    setSociete(""); setNom(""); setPrenom(""); setRue(""); setNumero(""); setNpa(""); setVille("");
    setTelephone1(""); setTelephone2(""); setEmail(""); setLines([]); setDiscount("0");
    setDiscountPercent("0"); setRemarks(""); setLeadTime("25-30 jours"); setManualRounding("0");
    setEnabledServices({ montage: false, livraison: false, poste: false }); setApplyTva(false);
    setUndoSnapshot(null); setShowResetConfirm(false);
  }

  async function onCustomImageChange(file?: File | null) {
    if (!file) return;
    setCustomImage(await readFileAsDataUrl(file));
  }
  async function onLineImageChange(id: string, file?: File | null) {
    if (!file) return;
    updateLine(id, { image: await readFileAsDataUrl(file) });
  }
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

  return (
    <div className="page">
      {/* ─── TOP BAR ─── */}
      <div className="screenOnly topbar">
        <div className="topbarLeft">
          <div className="logoArea">
            <span className="logoMark">🌿</span>
            <div>
              <div className="eyebrow">Système de gestion</div>
              <h1>Offre &amp; Commande</h1>
            </div>
          </div>
        </div>
        <div className="toolbar">
          {showResetConfirm ? (
            <>
              <span className="warnText" style={{ fontSize: 13, alignSelf: "center" }}>Effacer tout ?</span>
              <button className="dangerBtn" onClick={resetForm}>Confirmer</button>
              <button className="secondaryBtn" onClick={() => setShowResetConfirm(false)}>Annuler</button>
            </>
          ) : (
            <button className="secondaryBtn" onClick={() => setShowResetConfirm(true)}>🔄 Nouvelle offre</button>
          )}
          <button className="secondaryBtn" onClick={loadDraftLocal}>📂 Charger</button>
          <button className="secondaryBtn" onClick={saveDraftLocal}>💾 Sauvegarder</button>
          <button className="secondaryBtn" disabled={!undoSnapshot} onClick={undoLastChange}>↩ Undo</button>
          <button className="primaryBtn" onClick={() => window.print()}>🖨 Imprimer</button>
        </div>
      </div>

      <div className="sheet">

        {/* ─── HEADER CARD ─── */}
        <section className="headerCard">
          <div className="headerLeft">
            <div className="brandBlock">
              <div className="brand">JARDIN-CONFORT</div>
              <div className="brandSub">Rue de l'Industrie 12 · 1422 Grandson · +41 24 445 00 00</div>
            </div>
            <div className="docMeta">
              <div className="fieldGroup small">
                <label>Type de document</label>
                <select value={formType} onChange={(e) => setFormType(e.target.value as FormType)}>
                  <option>Offre</option>
                  <option>Commande</option>
                </select>
              </div>
              <div className="fieldGroup small">
                <label>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="fieldGroup">
                <label>Numéro</label>
                <input value={offerNumber} onChange={(e) => setOfferNumber(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="headerRight">
            <div className="fieldGroup">
              <label>Commercial</label>
              <select value={commercial} onChange={(e) => setCommercial(e.target.value)}>
                <option>Brice Chappé</option>
                <option>Michel Gédéon</option>
              </select>
            </div>
            <div className="fieldGroup">
              <label>Type de client</label>
              <select value={clientType} onChange={(e) => setClientType(e.target.value as ClientType)}>
                <option>Privé (prix TTC)</option>
                <option>Pro (prix HT)</option>
              </select>
            </div>
            <div className="fieldGroup">
              <label>Mode de paiement</label>
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}>
                <option>Paiement d'avance à la commande</option>
                <option>Acompte de 50% à la commande</option>
                <option>Paiement à 30 jours</option>
              </select>
            </div>
            {/* STATUT — NOUVEAU */}
            <div className="fieldGroup screenOnly">
              <label>Statut de l'offre</label>
              <div className="statusRow">
                {(["En cours","Envoyée","Acceptée","Refusée"] as OfferStatus[]).map((s) => (
                  <button
                    key={s}
                    className={`statusChip ${offerStatus === s ? "statusActive" : ""}`}
                    style={offerStatus === s ? { background: STATUS_CONFIG[s].bg, color: STATUS_CONFIG[s].color, borderColor: STATUS_CONFIG[s].color } : {}}
                    onClick={() => setOfferStatus(s)}
                  >
                    {STATUS_CONFIG[s].icon} {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── COORDONNÉES CLIENT ─── */}
        <section className="card">
          <div className="sectionTitle">👤 Coordonnées client</div>
          <div className="grid grid-1">
            <div className="fieldGroup">
              <label>Société</label>
              <input value={societe} onChange={(e) => setSociete(e.target.value)} placeholder="Nom de l'entreprise (optionnel)" />
            </div>
          </div>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div className="fieldGroup">
              <label>Nom *</label>
              <input className={missingRequired.nom ? "requiredError" : ""} value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Dupont" />
            </div>
            <div className="fieldGroup">
              <label>Prénom</label>
              <input value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Jean" />
            </div>
          </div>
          <div className="grid grid-address" style={{ marginTop: 12 }}>
            <div className="fieldGroup">
              <label>Rue</label>
              <input value={rue} onChange={(e) => setRue(e.target.value)} placeholder="Chemin des Roses" />
            </div>
            <div className="fieldGroup fieldNumber">
              <label>No</label>
              <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="12" />
            </div>
            <div className="fieldGroup fieldNpa">
              <label>NPA</label>
              <input inputMode="numeric" maxLength={4} value={npa} onChange={(e) => setNpa(sanitizeNpa(e.target.value))} placeholder="1000" />
            </div>
            <div className="fieldGroup">
              <label>Ville *</label>
              <input className={missingRequired.ville ? "requiredError" : ""} value={ville} onChange={(e) => setVille(e.target.value)} placeholder="Lausanne" />
            </div>
          </div>
          <div className="grid grid-3" style={{ marginTop: 12 }}>
            <div className="fieldGroup">
              <label>Téléphone principal</label>
              <input placeholder="+41 79 000 00 00" value={telephone1} onChange={(e) => setTelephone1(normalizeSwissPhone(e.target.value))} />
            </div>
            <div className="fieldGroup">
              <label>Téléphone secondaire</label>
              <input placeholder="+41 79 000 00 00" value={telephone2} onChange={(e) => setTelephone2(normalizeSwissPhone(e.target.value))} />
            </div>
            <div className="fieldGroup">
              <label>Email *</label>
              <input className={missingRequired.email ? "requiredError" : ""} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jean.dupont@exemple.ch" />
            </div>
          </div>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div className="fieldGroup">
              <label>N° client (auto via email)</label>
              <input value={customerNumber} readOnly style={{ opacity: 0.7 }} />
            </div>
            <div className="fieldGroup">
              <label>Délai de livraison</label>
              <input value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
            </div>
          </div>
          <div className="validationRow">
            <span className={isFormValid ? "okText" : "warnText"}>
              {isFormValid ? "✅ Champs obligatoires remplis." : "⚠️ Champs manquants : Nom, Ville, Email."}
            </span>
            {draftSavedAt && <span className="draftInfo">💾 Brouillon : {draftSavedAt}</span>}
          </div>
        </section>

        {/* ─── RECHERCHE / AJOUT D'ARTICLES ─── */}
        <section className="card">
          <div className="sectionTitle">🛒 Ajouter des articles</div>
          <div className="tabRow screenOnly">
            <button className={`tabBtn ${activeTab === "shopify" ? "tabActive" : ""}`} onClick={() => setActiveTab("shopify")}>
              🏪 Catalogue Shopify
            </button>
            <button className={`tabBtn ${activeTab === "custom" ? "tabActive" : ""}`} onClick={() => setActiveTab("custom")}>
              ✏️ Article à la volée
            </button>
          </div>

          {activeTab === "shopify" && (
            <>
              <div className="searchBar">
                <input placeholder="🔍 Rechercher par SKU, titre ou variante…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="productGrid">
                {filteredProducts.map((product) => (
                  <div key={product.id} className="productTile">
                    <img src={product.image} alt={product.title} />
                    <div className="productTileBody">
                      <div className="productSku">SKU {product.sku}</div>
                      <div className="productTitle">{product.title}</div>
                      <div className="productVariant">{product.variant}</div>
                      <div className="productMeta stackedMeta">
                        <span className="priceTag">{formatMoney(product.price)}</span>
                        <span className={product.stock > 0 ? "stockOk" : "stockLow"}>
                          {product.stock > 0 ? `✓ Stock : ${product.stock}` : "✗ Hors stock"}
                        </span>
                      </div>
                    </div>
                    <button className="addBtn" onClick={() => addProduct(product)}>+ Ajouter</button>
                  </div>
                ))}
                {filteredProducts.length === 0 && (
                  <div className="emptySearch">Aucun article trouvé pour « {search} »</div>
                )}
              </div>
            </>
          )}

          {activeTab === "custom" && (
            <div>
              <div className="grid grid-custom-v2">
                <div className="fieldGroup fieldSkuShort">
                  <label>SKU libre</label>
                  <input value={customSku} onChange={(e) => setCustomSku(e.target.value)} placeholder="ART-001" />
                </div>
                <div className="fieldGroup fieldTitleLarge">
                  <label>Titre / Description *</label>
                  <input value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="Ex: Parasol Sunbrella Ø 3m Taupe…" />
                </div>
                <div className="fieldGroup">
                  <label>Prix unitaire (CHF)</label>
                  <input className="noSpinner" type="number" step="0.01" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder="0.00" />
                </div>
                <div className="fieldGroup">
                  <label>Qté</label>
                  <input type="number" min="1" step="1" value={customQty} onChange={(e) => setCustomQty(String(Math.max(1, parseInt(e.target.value || "1", 10))))} />
                </div>
                <div className="fieldGroup">
                  <label>Image (fichier ou URL)</label>
                  <input ref={customImageInputRef} type="file" accept="image/*" onChange={(e) => onCustomImageChange(e.target.files?.[0])} />
                </div>
                <div className="fieldGroup alignEnd">
                  <button className="primaryBtn wide" onClick={addCustomLine}>+ Ajouter la ligne</button>
                </div>
              </div>
              {customImage && (
                <div className="customPreview">
                  <img src={customImage} alt="Aperçu" />
                  <button className="trashBtn" onClick={() => { setCustomImage(""); if (customImageInputRef.current) customImageInputRef.current.value = ""; }}>🗑</button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ─── TABLEAU DES LIGNES ─── */}
        <section className="card">
          <div className="sectionTitleRow">
            <div className="sectionTitle">📋 Lignes de l'offre</div>
            <span className="lineCount screenOnly">{lines.length} article{lines.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="dragHint screenOnly">⬆⬇ Glisser-déposer pour réordonner les lignes</div>
          <div className="tableWrap">
            <table className="quoteTable">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th style={{ width: 80 }}>Img</th>
                  <th style={{ width: 60 }}>Qté</th>
                  <th className="skuCol">SKU</th>
                  <th className="titleCol">Désignation</th>
                  <th className="unitCol">Prix/pce</th>
                  <th className="totalCol">Total</th>
                  <th className="actionCol screenOnly"></th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={8} className="emptyTable">Aucun article ajouté. Utilisez la section ci-dessus.</td>
                  </tr>
                )}
                {lines.map((line, index) => (
                  <tr
                    key={line.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", line.id); setDraggedLineId(line.id); }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                    onDrop={(e) => { e.preventDefault(); const fromId = e.dataTransfer.getData("text/plain") || draggedLineId; if (fromId) reorderLines(fromId, line.id); setDraggedLineId(null); }}
                    onDragEnd={() => setDraggedLineId(null)}
                    className={`${index % 2 === 0 ? "rowDark" : "rowLight"} ${draggedLineId === line.id ? "draggingRow" : ""} ${justAddedLineId === line.id ? "justAddedRow" : ""}`}
                  >
                    <td className="lineNum">{index + 1}</td>
                    <td className="imageCell">
                      <div className="lineImageBox" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onLineImageDrop(line.id, e)}>
                        {line.image ? <img src={line.image} alt={line.title} /> : <span>📷</span>}
                      </div>
                      <input className="screenOnly lineImageInput" type="file" accept="image/*" onChange={(e) => onLineImageChange(line.id, e.target.files?.[0])} />
                    </td>
                    <td>
                      <input className="qtyInput" type="number" min="1" step="1" value={line.qty} onChange={(e) => updateLine(line.id, { qty: Math.max(1, parseInt(e.target.value || "1", 10)) })} />
                    </td>
                    <td className="skuCol">
                      <input className="cellInput" value={line.sku} onChange={(e) => updateLine(line.id, { sku: e.target.value })} />
                    </td>
                    <td className="titleCol">
                      <input className="cellInput titleInput" value={line.title} onChange={(e) => updateLine(line.id, { title: e.target.value })} />
                    </td>
                    <td className="unitCol">
                      <input className="cellInput number noSpinner unitPriceInput" type="number" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(line.id, { unitPrice: Number(e.target.value || 0) })} />
                    </td>
                    <td className="money totalCol">{formatMoney(line.qty * line.unitPrice)}</td>
                    <td className="actionCol screenOnly">
                      <button className="trashBtn" onClick={() => removeLine(line.id)} title="Supprimer">🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ─── TOTAUX + INFOS COMPLÉMENTAIRES ─── */}
        <section className="grid totalsGrid">
          {/* Infos + Services */}
          <div className="card">
            <div className="sectionTitle">📝 Informations complémentaires</div>
            <div className="fieldGroup">
              <label>Remarques (visibles sur le document)</label>
              <textarea rows={4} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Notes pour le client, conditions spéciales, commentaires…" />
            </div>

            <div className="sectionTitle smallTop">🔧 Services optionnels</div>
            <div className="serviceList">
              {serviceOptions.map((service) => (
                <div className="serviceRow" key={service.code}>
                  <label className="checkRow">
                    <input type="checkbox" checked={enabledServices[service.code]} onChange={(e) => setEnabledServices((c) => ({ ...c, [service.code]: e.target.checked }))} />
                    <span>{service.label}</span>
                  </label>
                  <div className="servicePriceWrap">
                    <input
                      className="servicePrice noSpinner"
                      type="number" step="0.01"
                      value={servicePrices[service.code]}
                      onChange={(e) => setServicePrices((c) => ({ ...c, [service.code]: e.target.value }))}
                      disabled={!enabledServices[service.code]}
                    />
                    <span className="currency">CHF</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="sectionTitle smallTop">📄 Conditions générales</div>
            <div className="fieldGroup">
              <textarea rows={4} value={conditionsGenerales} onChange={(e) => setConditionsGenerales(e.target.value)} />
            </div>
          </div>

          {/* Totaux */}
          <div className="card totalCard">
            <div className="sectionTitle">💰 Récapitulatif</div>

            <div className="totalRow">
              <span>Sous-total articles</span>
              <strong>{formatMoney(subTotal)}</strong>
            </div>

            <div className="totalRow discountRow">
              <span>Rabais (CHF)</span>
              <input className="discountInput noSpinner" type="number" step="0.01" value={discount}
                onChange={(e) => { setDiscount(e.target.value); setDiscountPercent("0"); }} />
            </div>
            <div className="totalRow discountRow">
              <span>Rabais (%)</span>
              <input className="discountInput noSpinner" type="number" step="0.5" min="0" max="100" value={discountPercent}
                onChange={(e) => { setDiscountPercent(e.target.value); setDiscount("0"); }} />
            </div>
            {discountValue > 0 && (
              <div className="totalRow">
                <span>Montant du rabais</span>
                <strong className="discountAmt">- {formatMoney(discountValue)}</strong>
              </div>
            )}

            <div className="totalRow">
              <span>Total après rabais</span>
              <strong>{formatMoney(totalAfterDiscount)}</strong>
            </div>

            {serviceTotal > 0 && (
              <div className="totalRow">
                <span>Services</span>
                <strong>{formatMoney(serviceTotal)}</strong>
              </div>
            )}

            {/* TVA — NOUVEAU */}
            <div className="totalRow tvaRow">
              <label className="checkRow">
                <input type="checkbox" checked={applyTva} onChange={(e) => setApplyTva(e.target.checked)} />
                <span>TVA 7.7% (CHF)</span>
              </label>
              {applyTva && <strong>{formatMoney(tvaAmount)}</strong>}
            </div>

            <div className="totalRow">
              <span>Arrondi manuel</span>
              <input className="discountInput noSpinner" type="number" step="0.05" value={manualRounding}
                onChange={(e) => setManualRounding(e.target.value)} />
            </div>

            <div className="grandTotal">
              <span>TOTAL {clientType === "Privé (prix TTC)" ? "TTC" : "HT"}</span>
              <strong>{formatMoney(finalTotal)}</strong>
            </div>

            <div className="paymentBadge">
              <span>💳 {paymentMode}</span>
            </div>
            <div className="leadBadge">
              <span>🚚 Délai : {leadTime}</span>
            </div>
          </div>
        </section>

        {/* ─── SIGNATURE PRINT (caché à l'écran) ─── */}
        <section className="card printOnly signatureBlock">
          <div className="signatureGrid">
            <div>
              <div className="signLabel">Jardin-Confort — {commercial}</div>
              <div className="signLine"></div>
              <div className="signSub">Signature &amp; tampon</div>
            </div>
            <div>
              <div className="signLabel">Client — {nom} {prenom}</div>
              <div className="signLine"></div>
              <div className="signSub">Signature &amp; date</div>
            </div>
          </div>
          {conditionsGenerales && (
            <div className="cgsBlock">
              <strong>Conditions générales :</strong> {conditionsGenerales}
            </div>
          )}
        </section>

      </div>

      <style jsx global>{`
        :root {
          --bg: #0f1318;
          --panel: #161c24;
          --panel-2: #1b2230;
          --border: #28344a;
          --text: #e8edf5;
          --muted: #8a97ad;
          --accent: #2f9e52;
          --accent-hover: #27874a;
          --accent-light: rgba(47,158,82,0.12);
          --accent-2: #1a6b37;
          --ok: #4ade80;
          --warn: #f59e0b;
          --danger: #ef4444;
          --sheet-text: #111827;
          --radius: 14px;
        }
        * { box-sizing: border-box; }
        html, body { margin:0; padding:0; background: #0d1117; color: var(--text); font-family: 'DM Sans', 'Segoe UI', Arial, sans-serif; }
        body { min-height: 100vh; }
        .page { padding: 20px; }

        /* TOP BAR */
        .topbar { display:flex; justify-content:space-between; align-items:center; gap:20px; margin-bottom:22px; flex-wrap:wrap; }
        .topbarLeft { display:flex; align-items:center; gap:16px; }
        .logoArea { display:flex; align-items:center; gap:14px; }
        .logoMark { font-size:32px; }
        .eyebrow { color:var(--accent); font-size:11px; text-transform:uppercase; letter-spacing:.1em; font-weight:700; }
        h1 { margin:2px 0 0 0; font-size:26px; font-weight:800; line-height:1.1; }
        .toolbar { display:flex; gap:8px; flex-wrap:wrap; }

        /* SHEET */
        .sheet { display:flex; flex-direction:column; gap:16px; max-width:1560px; margin:0 auto; }

        /* CARDS */
        .card, .headerCard {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 20px 22px;
          box-shadow: 0 4px 24px rgba(0,0,0,.25);
        }
        .headerCard { display:grid; grid-template-columns:1.2fr 1fr; gap:20px; }
        .headerLeft, .headerRight { display:flex; flex-direction:column; gap:14px; }
        .brandBlock { }
        .brand { font-size:26px; font-weight:900; letter-spacing:.04em; color:white; }
        .brandSub { font-size:12px; color:var(--muted); margin-top:3px; }
        .docMeta { display:grid; grid-template-columns:200px 180px 1fr; gap:12px; }

        /* SECTION TITLE */
        .sectionTitle { font-size:16px; font-weight:800; margin-bottom:14px; display:flex; align-items:center; gap:6px; }
        .sectionTitle.smallTop { margin-top:20px; }
        .sectionTitleRow { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
        .lineCount { font-size:13px; color:var(--muted); background:var(--panel-2); border-radius:20px; padding:3px 12px; }

        /* STATUS CHIPS */
        .statusRow { display:flex; gap:8px; flex-wrap:wrap; }
        .statusChip { border:1px solid var(--border); background:transparent; color:var(--muted); border-radius:30px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer; transition:all .18s; }
        .statusChip:hover { border-color:var(--accent); color:var(--accent); }
        .statusActive { font-weight:800 !important; }

        /* TABS */
        .tabRow { display:flex; gap:0; margin-bottom:18px; border-radius:12px; overflow:hidden; border:1px solid var(--border); width:fit-content; }
        .tabBtn { border:0; background:transparent; color:var(--muted); padding:10px 20px; font-size:14px; font-weight:600; cursor:pointer; transition:all .15s; }
        .tabActive { background:var(--accent-light); color:var(--accent); }

        /* GRIDS */
        .grid { display:grid; gap:12px; }
        .grid-1 { grid-template-columns:1fr; }
        .grid-2 { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .grid-3 { grid-template-columns:repeat(3,minmax(0,1fr)); }
        .grid-address { grid-template-columns:1.6fr .5fr .5fr 1fr; }
        .grid-custom-v2 { grid-template-columns:130px 2fr 150px 90px 220px 180px; align-items:end; }

        /* FIELDS */
        .fieldGroup { display:flex; flex-direction:column; gap:6px; }
        .fieldGroup.small { max-width:240px; }
        .fieldGroup label { font-size:12px; color:var(--muted); font-weight:600; padding-left:2px; text-transform:uppercase; letter-spacing:.05em; }
        input, select, textarea, button { font:inherit; }
        input, select, textarea {
          width:100%; border-radius:10px; border:1px solid var(--border);
          background:var(--panel-2); color:var(--text);
          padding:11px 14px; outline:none; transition:border-color .15s, box-shadow .15s;
        }
        input:focus, select:focus, textarea:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(47,158,82,.14); }
        textarea { resize:vertical; }
        input[readonly] { opacity:.6; cursor:default; }
        .noSpinner::-webkit-outer-spin-button, .noSpinner::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
        .noSpinner { -moz-appearance:textfield; }
        .requiredError { border-color:rgba(239,68,68,.9) !important; box-shadow:0 0 0 3px rgba(239,68,68,.12) !important; }
        .validationRow { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-top:12px; padding-top:12px; border-top:1px solid var(--border); }
        .okText { color:var(--ok); font-size:13px; font-weight:700; }
        .warnText { color:var(--warn); font-size:13px; font-weight:700; }
        .draftInfo { color:var(--muted); font-size:13px; }
        .alignEnd { justify-content:flex-end; }

        /* BUTTONS */
        .primaryBtn, .secondaryBtn, .trashBtn, .addBtn, .dangerBtn {
          border:0; border-radius:10px; padding:11px 16px; cursor:pointer;
          transition:transform .12s ease, opacity .15s ease, box-shadow .15s;
          font-weight:700; font-size:14px;
        }
        .primaryBtn:hover, .secondaryBtn:hover, .addBtn:hover { transform:translateY(-1px); }
        .primaryBtn { background:linear-gradient(160deg,var(--accent),var(--accent-2)); color:#fff; }
        .secondaryBtn { background:#1f2a38; color:var(--text); border:1px solid var(--border); }
        .secondaryBtn:disabled { opacity:.4; cursor:not-allowed; transform:none; }
        .dangerBtn { background:rgba(239,68,68,.18); color:#fca5a5; border:1px solid rgba(239,68,68,.3); }
        .trashBtn { width:38px; height:38px; padding:0; display:inline-flex; align-items:center; justify-content:center; background:rgba(239,68,68,.12); color:#fca5a5; font-size:15px; border-radius:9px; }
        .addBtn { background:var(--accent-light); color:var(--accent); border:1px solid rgba(47,158,82,.3); width:100%; }
        .wide { width:100%; }

        /* SEARCH */
        .searchBar { margin-bottom:14px; }
        .searchBar input { font-size:16px; padding:14px 16px; }

        /* PRODUCT GRID */
        .productGrid { display:grid; gap:14px; grid-template-columns:repeat(4,minmax(0,1fr)); }
        .productTile { display:flex; flex-direction:column; gap:10px; border:1px solid var(--border); background:var(--panel-2); border-radius:14px; padding:12px; transition:border-color .15s; }
        .productTile:hover { border-color:rgba(47,158,82,.4); }
        .productTile img { width:100%; aspect-ratio:1.3/1; object-fit:cover; border-radius:10px; border:1px solid rgba(255,255,255,.07); }
        .productTileBody { display:flex; flex-direction:column; gap:5px; flex:1; }
        .productSku { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
        .productTitle { font-size:14px; font-weight:700; line-height:1.3; }
        .productVariant { color:var(--muted); font-size:13px; }
        .productMeta { display:flex; flex-direction:column; gap:3px; font-size:13px; margin-top:auto; padding-top:6px; }
        .priceTag { font-weight:800; color:white; font-size:15px; }
        .stockOk { color:var(--ok); font-weight:700; font-size:12px; }
        .stockLow { color:var(--warn); font-weight:700; font-size:12px; }
        .emptySearch { color:var(--muted); padding:20px; text-align:center; grid-column:1/-1; }

        /* CUSTOM PREVIEW */
        .customPreview { display:flex; align-items:center; gap:12px; margin-top:14px; }
        .customPreview img { width:100px; height:100px; object-fit:cover; border-radius:12px; border:1px solid var(--border); }

        /* TABLE */
        .dragHint { color:var(--muted); font-size:12px; margin-bottom:10px; }
        .tableWrap { overflow-x:auto; }
        .quoteTable { width:100%; border-collapse:separate; border-spacing:0 6px; min-width:1100px; table-layout:fixed; }
        .quoteTable th { text-align:left; font-size:11px; color:var(--muted); font-weight:700; padding:0 8px 6px; text-transform:uppercase; letter-spacing:.06em; }
        .quoteTable td { padding:9px 8px; vertical-align:middle; border-top:1px solid rgba(255,255,255,.06); border-bottom:1px solid rgba(255,255,255,.06); }
        .quoteTable tr td:first-child { border-left:1px solid rgba(255,255,255,.06); border-top-left-radius:10px; border-bottom-left-radius:10px; }
        .quoteTable tr td:last-child { border-right:1px solid rgba(255,255,255,.06); border-top-right-radius:10px; border-bottom-right-radius:10px; }
        .quoteTable tbody tr { cursor:grab; }
        .draggingRow td { opacity:.4; }
        .justAddedRow td { animation:addedPulse 1.2s ease; }
        @keyframes addedPulse {
          0% { box-shadow:inset 0 0 0 9999px rgba(47,158,82,.25); }
          100% { box-shadow:inset 0 0 0 9999px rgba(47,158,82,0); }
        }
        .rowDark td { background:rgba(255,255,255,.02); }
        .rowLight td { background:rgba(255,255,255,.04); }
        .lineNum { color:var(--muted); font-size:12px; text-align:center; font-weight:700; }
        .lineImageBox { width:64px; height:64px; border-radius:10px; border:1px dashed rgba(255,255,255,.14); display:flex; align-items:center; justify-content:center; overflow:hidden; background:rgba(255,255,255,.02); color:var(--muted); font-size:18px; }
        .lineImageBox img { width:100%; height:100%; object-fit:cover; }
        .lineImageInput { margin-top:6px; font-size:11px; padding:6px; max-width:150px; }
        .cellInput, .qtyInput { border-radius:8px; padding:9px 10px; background:rgba(255,255,255,.03); }
        .qtyInput { width:70px; }
        .skuCol { width:110px; }
        .titleCol { width:34%; }
        .titleInput { width:100%; }
        .unitCol { width:110px; }
        .unitPriceInput { width:90px; margin-left:auto; }
        .totalCol { width:140px; text-align:right; white-space:nowrap; }
        .actionCol { width:50px; text-align:center; }
        .number, .money { text-align:right; }
        .emptyTable { text-align:center; color:var(--muted); padding:28px; font-style:italic; }
        .imageCell { width:110px; }

        /* TOTALS */
        .totalsGrid { grid-template-columns:1.2fr .8fr; align-items:start; }
        .serviceList { display:flex; flex-direction:column; gap:10px; }
        .serviceRow { display:grid; grid-template-columns:1fr 160px; gap:12px; align-items:center; }
        .servicePriceWrap { display:flex; align-items:center; gap:6px; }
        .servicePriceWrap .currency { font-size:12px; color:var(--muted); white-space:nowrap; }
        .servicePrice { text-align:right; }
        .checkRow { display:flex; align-items:center; gap:10px; color:var(--text); cursor:pointer; }
        .checkRow input { width:16px; height:16px; }
        .discountInput { text-align:right; width:120px; }
        .totalCard { position:sticky; top:12px; }
        .totalRow, .grandTotal { display:flex; justify-content:space-between; align-items:center; gap:14px; padding:9px 0; border-bottom:1px solid rgba(255,255,255,.07); }
        .discountRow input { width:110px; }
        .discountAmt { color:var(--ok); }
        .tvaRow label { cursor:pointer; }
        .grandTotal { margin-top:6px; padding-top:14px; font-size:20px; font-weight:900; border-bottom:0; color:white; }
        .paymentBadge, .leadBadge { margin-top:10px; padding:10px 14px; border-radius:10px; background:rgba(255,255,255,.04); border:1px solid var(--border); font-size:13px; color:var(--muted); }

        /* SIGNATURE BLOCK */
        .signatureBlock { margin-top:8px; }
        .signatureGrid { display:grid; grid-template-columns:1fr 1fr; gap:40px; }
        .signLabel { font-size:13px; font-weight:700; color:#374151; margin-bottom:40px; }
        .signLine { border-bottom:1.5px solid #9ca3af; margin-bottom:6px; }
        .signSub { font-size:11px; color:#9ca3af; }
        .cgsBlock { margin-top:20px; padding-top:14px; border-top:1px solid #e5e7eb; font-size:11px; color:#6b7280; line-height:1.6; }

        /* PRINT */
        .printOnly { display:none; }
        @media print {
          body { background:white; color:var(--sheet-text); }
          .page { padding:0; }
          .screenOnly { display:none !important; }
          .printOnly { display:block; }
          .sheet { max-width:none; gap:6px; }
          .card, .headerCard {
            background:white; color:var(--sheet-text);
            border:1px solid #d1d5db; box-shadow:none; border-radius:0; break-inside:avoid;
          }
          input, select, textarea { color:var(--sheet-text); background:transparent; border:1px solid #d1d5db; box-shadow:none !important; }
          .quoteTable { border-spacing:0; }
          .quoteTable td, .quoteTable th { color:var(--sheet-text) !important; border:1px solid #d1d5db !important; background:white !important; border-radius:0 !important; }
          .lineImageBox { border:1px solid #d1d5db; background:white; }
          .money, .number { white-space:nowrap; }
          .signatureBlock { display:block !important; }
          @page { size:A4 portrait; margin:10mm; }
        }

        /* RESPONSIVE */
        @media (max-width:1400px) { .productGrid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @media (max-width:1100px) {
          .headerCard, .totalsGrid, .docMeta, .grid-3, .grid-address, .grid-custom-v2 { grid-template-columns:1fr; }
          .topbar { flex-direction:column; align-items:flex-start; }
          .productGrid { grid-template-columns:1fr; }
          .totalCard { position:static; }
        }
      `}</style>
    </div>
  );
}
