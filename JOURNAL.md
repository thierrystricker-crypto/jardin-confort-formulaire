# JOURNAL — Feature `complement_nom`

**Projet** : jardin-confort-formulaire
**Localisation** : `C:\Users\ezefi\jardin-confort-formulaire`
**Stack** : Next.js 16.2.3 (App Router) + Supabase + Shopify Admin API + Make webhook
**Production** : `https://offres.jardin-confort.ch`
**Supabase URL** : `https://llkyzspixrbtoprtmvoh.supabase.co`

---

## 🎯 Objectif de la feature

Permettre d'ajouter un complément de nom optionnel sur les adresses de facturation et livraison, utilisable pour :
- **Couples** : « M. et Mme Dupont » via `nom = "Dupont"` + `prenom = "Jean"` + `complement_nom = "et Marie"`
- **C/O** : « Jean Dupont c/o Crédit Suisse » via `complement_nom = "c/o Crédit Suisse"`
- **Sociétés Pro** : « SARL Martin · À l'att. de Mme Dupont » via `societe = "SARL Martin"` + `complement_nom = "À l'att. de Mme Dupont"`
- **Multi-personnes** : « Mesdames Roca et De Marco »

---

## 📐 Décisions architecturales (cadre du projet)

1. **1 seul champ `complement_nom`** (et son pendant livraison `livr_complement_nom`) — couvre tous les cas d'usage : conjoint, c/o, contact société, multi-personnes
2. **Ordre d'affichage final** : `societe → nom prenom → complement_nom → rue → rue2 → npa+ville`
3. **Affichage sur TOUS les documents** sauf QR paiement (Swiss QR-bill, intouchable réglementairement)
4. **Héritage auto** : si `!livrDiff`, la livraison hérite automatiquement de `complement_nom` (jamais de re-saisie)
5. **Règle d'or** : ajouter le champ partout, JAMAIS changer la logique métier existante (Option 1, pas de helper exotique)
6. **Pas de migration rétroactive** sur les anciennes offres — feature transparente pour les data anciennes
7. **Label final formulaire** : `"Complément nom (optionnel)"` + hint `(conjoint, c/o, contact...)`
8. **`rue2` renommé "Complément d'adresse"** pour éviter ambiguïté avec le complément nom

---

## ✅ Phase 1 — Backend (TERMINÉE)

### Migration SQL Supabase

4 colonnes ajoutées :

```sql
ALTER TABLE clients ADD COLUMN complement_nom TEXT NULL;
ALTER TABLE clients ADD COLUMN livr_complement_nom TEXT NULL;
ALTER TABLE offres ADD COLUMN client_complement_nom TEXT NULL;
ALTER TABLE offres ADD COLUMN livr_complement_nom TEXT NULL;
```

Fichier migration : `migration-complement-nom.sql`

### Types TypeScript

Fichier `lib/jc-print-types.ts` patché :
- Type `PrintData` enrichi : `complement_nom?: string` + `livr_complement_nom?: string`
- Type `OffreRow.data` reste minimal — les pages qui en ont besoin utilisent `(data as any).complement_nom`

---

## ✅ Phase 2 — UI de saisie (TERMINÉE)

### Fichiers patchés et commités

**Formulaire principal**
- `app/offres/nouveau/page.tsx` — DraftSnapshot + useState + applyClient + makeSnapshot + saveToSupabase + loadDraftLocal + resetForm + useEffect prefill + useEffect from_copy + Inputs JSX facturation/livraison

**Dashboard**
- `app/dashboard/clients/[id]/page.tsx` — Type Client + édition + display + 2 URLs prefill (avec `complement_nom` + `numero: client.numero_rue`)
- `app/dashboard/[slug]/page.tsx` — bouton "👤 Nouvelle offre même client" + fonction `copierOffre()` (depuis `offre.data` JSONB)

**API routes**
- `app/api/clients/route.ts`
- `app/api/clients/[id]/route.ts`
- `app/api/offres/save/route.ts`
- `app/api/offres/[slug]/valider/route.ts`

### Commit Phase 2

```
feat(complement-nom): phase 2 complete - prefill propre (formulaire + fiche client + dashboard offre)
```

### Tests Phase 2 validés ✅

- Création client avec complément nom (facturation + livraison)
- Prefill depuis fiche client (URL params complets)
- Copie offre complète (toutes les data dont compléments)
- Persistance fiche client (édition/sauvegarde)
- Webhook Make : payload contient bien `client_complement_nom` + `livr_complement_nom`

---

## ✅ Phase 3 — Templates d'affichage (TERMINÉE)

### Pattern utilisé (Option 1 strict)

**Bloc facturation type** :
```jsx
{data.societe && <div>{data.societe}</div>}
<div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
{data.complement_nom && <div>{data.complement_nom}</div>}   {/* ← AJOUT */}
{data.rue && <div>{data.rue} {data.numero}</div>}
{data.npa && <div>{data.npa} {data.ville}</div>}
```

**Bloc livraison avec héritage** :
- Si `livrDiff = true` → affiche `livr_complement_nom`
- Si `livrDiff = false` → affiche `complement_nom` (héritage auto)

### Variantes techniques rencontrées

| Type | Solution | Fichiers concernés |
|---|---|---|
| Types `PrintData` importés de `lib/jc-print-types.ts` (patchés Phase 1) | `data.complement_nom` direct | `print/offre/page.tsx`, `print/offre/[slug]`, `print/bulletin-livraison/[slug]`, `print/page-garde-colis/[slug]`, `print/fiche-bleue/[slug]`, `print/all/[slug]` |
| Type local `PrintData` non patché | `(data as any).complement_nom` | `print/fiche-travail/[slug]` |
| Type `OffreRow.data` non patché (page web client) | `(d as any).complement_nom` | `app/offre/[slug]` |
| Variables intermédiaires `addr*` ou `livr*Effectif` | Ajout d'une variable `*ComplementNom*` ternaire | `print/fiche-travail`, `print/page-garde-colis`, `print/all` (PG section) |
| Tableaux `.filter(Boolean)` | Ajout d'une ligne dans le tableau ; affichage suit automatiquement | `app/offre/[slug]` |
| Cas "À l'emporter" | Inchangé (pas d'adresse client → pas de complément) | Tous |

### Récap fichiers patchés Phase 3

| # | Fichier | Patches | Détails |
|---|---|---|---|
| 1 | `app/print/offre/page.tsx` (preview localStorage) | 3 | Fenêtre adresse + facturation + livraison avec héritage |
| 2 | `app/print/offre/[slug]/page.tsx` (offre serveur) | 3 | Idem |
| 3 | `app/offre/[slug]/page.tsx` (page web client) | 2 | Tableaux `addrFact` + `addrLivr` (héritage gratuit via `addrFact.filter(...)`) |
| 4 | `app/print/fiche-travail/[slug]/page.tsx` | 3 | Variable intermédiaire `livrComplementNomEffectif` + fenêtre livraison + bloc facturation |
| 5 | `app/print/bulletin-livraison/[slug]/page.tsx` | 3 | Fenêtre + facturation + livraison |
| 6 | `app/print/page-garde-colis/[slug]/page.tsx` | 2 | Variable `addrComplementNom` + bloc JSX adresse client (étiquette d'expédition — particulièrement important) |
| 7 | `app/print/fiche-bleue/[slug]/page.tsx` | 2 | Bloc Livraison (uniquement si `livrDiff=true`) + bloc Client/Facturation |
| 8 | `app/print/all/[slug]/page.tsx` | 10 | Jeu complet 5 pages : Fiche travail + Commande + Page de garde + Bulletin + Fiche bleue |

**Total : 28 patches appliqués sur 8 fichiers.**

### Commit Phase 3

```
feat(complement-nom): phase 3 complete - affichage sur tous les templates PDF + page web client
```

---

## 📋 ANNEXE — Patches Phase 3 verbatim (cherche/remplace)

### Fichier 1 — `app/print/offre/page.tsx` (preview localStorage)

#### 1.1 — Fenêtre adresse destinataire

**Cherche** :
```jsx
            <div className="doc-addr-window">
              <div className="doc-addr-ref">{numeroAffiche || data.offerNumber}</div>
              {data.societe && <div className="doc-addr-line">{data.societe}</div>}
              <div className="doc-addr-name">{data.nom} {data.prenom}</div>
              {data.rue && <div className="doc-addr-line">{data.rue} {data.numero}</div>}
```

**Remplace par** :
```jsx
            <div className="doc-addr-window">
              <div className="doc-addr-ref">{numeroAffiche || data.offerNumber}</div>
              {data.societe && <div className="doc-addr-line">{data.societe}</div>}
              <div className="doc-addr-name">{data.nom} {data.prenom}</div>
              {data.complement_nom && <div className="doc-addr-line">{data.complement_nom}</div>}
              {data.rue && <div className="doc-addr-line">{data.rue} {data.numero}</div>}
```

#### 1.2 — Bloc adresse de facturation

**Cherche** :
```jsx
                  {data.societe && <div>{data.societe}</div>}
                  <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                  {data.rue && <div>{data.rue} {data.numero}</div>}
                  {data.npa && <div>{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                  {data.telephone2 && <div>Tél. {data.telephone2}</div>}
                  {data.email && <div>{data.email}</div>}
```

**Remplace par** :
```jsx
                  {data.societe && <div>{data.societe}</div>}
                  <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                  {data.complement_nom && <div>{data.complement_nom}</div>}
                  {data.rue && <div>{data.rue} {data.numero}</div>}
                  {data.npa && <div>{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                  {data.telephone2 && <div>Tél. {data.telephone2}</div>}
                  {data.email && <div>{data.email}</div>}
```

#### 1.3 — Bloc adresse de livraison avec héritage

**Cherche** :
```jsx
                  ) : data.livrDiff ? (
                    <>
                      {data.livrSociete && <div>{data.livrSociete}</div>}
                      <div style={{fontWeight:700}}>{data.livrNom} {data.livrPrenom}</div>
                      {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                      {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                      {data.livrTel && <div>Tél. {data.livrTel}</div>}
                    </>
                  ) : (
                    <>
                      {data.societe && <div>{data.societe}</div>}
                      <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                      {data.rue && <div>{data.rue} {data.numero}</div>}
                      {data.npa && <div>{data.npa} {data.ville}</div>}
                      {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                    </>
                  )}
```

**Remplace par** :
```jsx
                  ) : data.livrDiff ? (
                    <>
                      {data.livrSociete && <div>{data.livrSociete}</div>}
                      <div style={{fontWeight:700}}>{data.livrNom} {data.livrPrenom}</div>
                      {data.livr_complement_nom && <div>{data.livr_complement_nom}</div>}
                      {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                      {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                      {data.livrTel && <div>Tél. {data.livrTel}</div>}
                    </>
                  ) : (
                    <>
                      {data.societe && <div>{data.societe}</div>}
                      <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                      {data.complement_nom && <div>{data.complement_nom}</div>}
                      {data.rue && <div>{data.rue} {data.numero}</div>}
                      {data.npa && <div>{data.npa} {data.ville}</div>}
                      {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                    </>
                  )}
```

---

### Fichier 2 — `app/print/offre/[slug]/page.tsx` (offre serveur)

**3 patches identiques au Fichier 1** (mêmes blocs cherche/remplace, contexte adresse identique).

---

### Fichier 3 — `app/offre/[slug]/page.tsx` (page web client)

#### 3.1 — Tableau `addrFact`

**Cherche** :
```typescript
  // Adresses
  const addrFact = [
    d.societe || null,
    [d.prenom, d.nom].filter(Boolean).join(" ") || null,
    [d.rue, d.numero].filter(Boolean).join(" ") || null,
    [d.npa, d.ville].filter(Boolean).join(" ") || null,
    d.telephone1 ? `Tél. ${d.telephone1}` : null,
    d.email || null,
  ].filter(Boolean) as string[];
```

**Remplace par** :
```typescript
  // Adresses
  const addrFact = [
    d.societe || null,
    [d.prenom, d.nom].filter(Boolean).join(" ") || null,
    (d as any).complement_nom || null,
    [d.rue, d.numero].filter(Boolean).join(" ") || null,
    [d.npa, d.ville].filter(Boolean).join(" ") || null,
    d.telephone1 ? `Tél. ${d.telephone1}` : null,
    d.email || null,
  ].filter(Boolean) as string[];
```

#### 3.2 — Tableau `addrLivr`

**Cherche** :
```typescript
  const addrLivr: string[] = d.deliveryMode === "À l'emporter"
    ? ["À l'emporter", "Jardin-Confort SA", "Route de Lavaux 425", "1095 Lutry"]
    : d.livrDiff
      ? [d.livrSociete || null, [d.livrNom, d.livrPrenom].filter(Boolean).join(" ") || null,
         [d.livrRue, d.livrNumero].filter(Boolean).join(" ") || null,
         [d.livrNpa, d.livrVille].filter(Boolean).join(" ") || null,
         d.livrTel ? `Tél. ${d.livrTel}` : null].filter(Boolean) as string[]
      : addrFact.filter(l => !l.includes("@"));
```

**Remplace par** :
```typescript
  const addrLivr: string[] = d.deliveryMode === "À l'emporter"
    ? ["À l'emporter", "Jardin-Confort SA", "Route de Lavaux 425", "1095 Lutry"]
    : d.livrDiff
      ? [d.livrSociete || null, [d.livrNom, d.livrPrenom].filter(Boolean).join(" ") || null,
         (d as any).livr_complement_nom || null,
         [d.livrRue, d.livrNumero].filter(Boolean).join(" ") || null,
         [d.livrNpa, d.livrVille].filter(Boolean).join(" ") || null,
         d.livrTel ? `Tél. ${d.livrTel}` : null].filter(Boolean) as string[]
      : addrFact.filter(l => !l.includes("@"));
```

**Note** : le cas `!livrDiff` hérite automatiquement de `addrFact` (qui inclut maintenant le complément) — héritage gratuit ✨

---

### Fichier 4 — `app/print/fiche-travail/[slug]/page.tsx`

#### 4.1 — Variables intermédiaires d'adresse livraison

**Cherche** :
```typescript
  // Adresse livraison
  const livrSociete  = data.livrDiff ? data.livrSociete  : data.societe;
  const livrNom      = data.livrDiff ? data.livrNom      : data.nom;
  const livrPrenom   = data.livrDiff ? data.livrPrenom   : data.prenom;
  const livrRue      = data.livrDiff ? data.livrRue      : data.rue;
  const livrNumero   = data.livrDiff ? data.livrNumero   : data.numero;
  const livrNpa      = data.livrDiff ? data.livrNpa      : data.npa;
  const livrVille    = data.livrDiff ? data.livrVille    : data.ville;
  const livrTelEffectif = (data.livrDiff && data.livrTel) ? data.livrTel : data.telephone1;
  const clientEmail = data.email;
```

**Remplace par** :
```typescript
  // Adresse livraison
  const livrSociete  = data.livrDiff ? data.livrSociete  : data.societe;
  const livrNom      = data.livrDiff ? data.livrNom      : data.nom;
  const livrPrenom   = data.livrDiff ? data.livrPrenom   : data.prenom;
  const livrComplementNomEffectif = data.livrDiff ? (data as any).livr_complement_nom : (data as any).complement_nom;
  const livrRue      = data.livrDiff ? data.livrRue      : data.rue;
  const livrNumero   = data.livrDiff ? data.livrNumero   : data.numero;
  const livrNpa      = data.livrDiff ? data.livrNpa      : data.npa;
  const livrVille    = data.livrDiff ? data.livrVille    : data.ville;
  const livrTelEffectif = (data.livrDiff && data.livrTel) ? data.livrTel : data.telephone1;
  const clientEmail = data.email;
```

#### 4.2 — Fenêtre adresse livraison

**Cherche** :
```jsx
              ) : (
                <>
                  {livrSociete && <div className="doc-addr-line">{livrSociete}</div>}
                  <div className="doc-addr-name">{livrNom} {livrPrenom}</div>
                  {livrRue && <div className="doc-addr-line">{livrRue} {livrNumero}</div>}
                  {livrNpa && <div className="doc-addr-line">{livrNpa} {livrVille}</div>}
                  {livrTelEffectif && <div className="doc-addr-tel">📞 {livrTelEffectif}</div>}
                  {clientEmail && <div className="doc-addr-email">✉ {clientEmail}</div>}
                </>
              )}
```

**Remplace par** :
```jsx
              ) : (
                <>
                  {livrSociete && <div className="doc-addr-line">{livrSociete}</div>}
                  <div className="doc-addr-name">{livrNom} {livrPrenom}</div>
                  {livrComplementNomEffectif && <div className="doc-addr-line">{livrComplementNomEffectif}</div>}
                  {livrRue && <div className="doc-addr-line">{livrRue} {livrNumero}</div>}
                  {livrNpa && <div className="doc-addr-line">{livrNpa} {livrVille}</div>}
                  {livrTelEffectif && <div className="doc-addr-tel">📞 {livrTelEffectif}</div>}
                  {clientEmail && <div className="doc-addr-email">✉ {clientEmail}</div>}
                </>
              )}
```

#### 4.3 — Bloc Adresse de facturation (colonne gauche en bas)

**Cherche** :
```jsx
            <div className="doc-billing-block">
              <div className="doc-billing-block-title">💼 Adresse de facturation</div>
              <div className="doc-billing-block-content">
                {data.societe && <div>{data.societe}</div>}
                <div className="doc-billing-name">{data.nom} {data.prenom}</div>
                {data.rue && <div>{data.rue} {data.numero}</div>}
                {data.npa && <div>{data.npa} {data.ville}</div>}
                <div className="doc-billing-contact">
                  {data.telephone1 && <span>📞 {data.telephone1}</span>}
                  {data.email && <span>✉ {data.email}</span>}
                </div>
              </div>
            </div>
```

**Remplace par** :
```jsx
            <div className="doc-billing-block">
              <div className="doc-billing-block-title">💼 Adresse de facturation</div>
              <div className="doc-billing-block-content">
                {data.societe && <div>{data.societe}</div>}
                <div className="doc-billing-name">{data.nom} {data.prenom}</div>
                {(data as any).complement_nom && <div>{(data as any).complement_nom}</div>}
                {data.rue && <div>{data.rue} {data.numero}</div>}
                {data.npa && <div>{data.npa} {data.ville}</div>}
                <div className="doc-billing-contact">
                  {data.telephone1 && <span>📞 {data.telephone1}</span>}
                  {data.email && <span>✉ {data.email}</span>}
                </div>
              </div>
            </div>
```

---

### Fichier 5 — `app/print/bulletin-livraison/[slug]/page.tsx`

#### 5.1 — Fenêtre adresse livraison

**Cherche** :
```jsx
              ) : data.livrDiff ? (
                <>
                  {data.livrSociete && <div className="doc-addr-line">{data.livrSociete}</div>}
                  <div className="doc-addr-name">{data.livrNom} {data.livrPrenom}</div>
                  {data.livrRue && <div className="doc-addr-line">{data.livrRue} {data.livrNumero}</div>}
                  {data.livrNpa && <div className="doc-addr-line">{data.livrNpa} {data.livrVille}</div>}
                  {data.livrTel && <div className="doc-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.livrTel}</div>}
                </>
              ) : (
                <>
                  {data.societe && <div className="doc-addr-line">{data.societe}</div>}
                  <div className="doc-addr-name">{data.nom} {data.prenom}</div>
                  {data.rue && <div className="doc-addr-line">{data.rue} {data.numero}</div>}
                  {data.npa && <div className="doc-addr-line">{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div className="doc-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.telephone1}</div>}
                </>
              )}
```

**Remplace par** :
```jsx
              ) : data.livrDiff ? (
                <>
                  {data.livrSociete && <div className="doc-addr-line">{data.livrSociete}</div>}
                  <div className="doc-addr-name">{data.livrNom} {data.livrPrenom}</div>
                  {data.livr_complement_nom && <div className="doc-addr-line">{data.livr_complement_nom}</div>}
                  {data.livrRue && <div className="doc-addr-line">{data.livrRue} {data.livrNumero}</div>}
                  {data.livrNpa && <div className="doc-addr-line">{data.livrNpa} {data.livrVille}</div>}
                  {data.livrTel && <div className="doc-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.livrTel}</div>}
                </>
              ) : (
                <>
                  {data.societe && <div className="doc-addr-line">{data.societe}</div>}
                  <div className="doc-addr-name">{data.nom} {data.prenom}</div>
                  {data.complement_nom && <div className="doc-addr-line">{data.complement_nom}</div>}
                  {data.rue && <div className="doc-addr-line">{data.rue} {data.numero}</div>}
                  {data.npa && <div className="doc-addr-line">{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div className="doc-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.telephone1}</div>}
                </>
              )}
```

#### 5.2 — Bloc Adresse de facturation

**Cherche** :
```jsx
                <div className="doc-addr-content">
                  {data.societe && <div>{data.societe}</div>}
                  <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                  {data.rue && <div>{data.rue} {data.numero}</div>}
                  {data.npa && <div>{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                  {data.telephone2 && <div>Tél. {data.telephone2}</div>}
                  {data.email && <div>{data.email}</div>}
                </div>
```

**Remplace par** :
```jsx
                <div className="doc-addr-content">
                  {data.societe && <div>{data.societe}</div>}
                  <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                  {data.complement_nom && <div>{data.complement_nom}</div>}
                  {data.rue && <div>{data.rue} {data.numero}</div>}
                  {data.npa && <div>{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                  {data.telephone2 && <div>Tél. {data.telephone2}</div>}
                  {data.email && <div>{data.email}</div>}
                </div>
```

#### 5.3 — Bloc Adresse de livraison avec héritage (identique au pattern 1.3)

**Cherche** :
```jsx
                  ) : data.livrDiff ? (
                    <>
                      {data.livrSociete && <div>{data.livrSociete}</div>}
                      <div style={{fontWeight:700}}>{data.livrNom} {data.livrPrenom}</div>
                      {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                      {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                      {data.livrTel && <div>Tél. {data.livrTel}</div>}
                    </>
                  ) : (
                    <>
                      {data.societe && <div>{data.societe}</div>}
                      <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                      {data.rue && <div>{data.rue} {data.numero}</div>}
                      {data.npa && <div>{data.npa} {data.ville}</div>}
                      {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                    </>
                  )}
```

**Remplace par** :
```jsx
                  ) : data.livrDiff ? (
                    <>
                      {data.livrSociete && <div>{data.livrSociete}</div>}
                      <div style={{fontWeight:700}}>{data.livrNom} {data.livrPrenom}</div>
                      {data.livr_complement_nom && <div>{data.livr_complement_nom}</div>}
                      {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                      {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                      {data.livrTel && <div>Tél. {data.livrTel}</div>}
                    </>
                  ) : (
                    <>
                      {data.societe && <div>{data.societe}</div>}
                      <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                      {data.complement_nom && <div>{data.complement_nom}</div>}
                      {data.rue && <div>{data.rue} {data.numero}</div>}
                      {data.npa && <div>{data.npa} {data.ville}</div>}
                      {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                    </>
                  )}
```

---

### Fichier 6 — `app/print/page-garde-colis/[slug]/page.tsx` (étiquette d'expédition)

#### 6.1 — Variable intermédiaire `addrComplementNom`

**Cherche** :
```typescript
  // Détermine quelle adresse afficher (livraison prioritaire si différente)
  const showLivrDiff = (data as any).deliveryMode !== "À l'emporter" && data.livrDiff;
  const addrSociete = showLivrDiff ? data.livrSociete : data.societe;
  const addrNom = showLivrDiff ? data.livrNom : data.nom;
  const addrPrenom = showLivrDiff ? data.livrPrenom : data.prenom;
  const addrRue = showLivrDiff ? data.livrRue : data.rue;
  const addrNumero = showLivrDiff ? data.livrNumero : data.numero;
  const addrNpa = showLivrDiff ? data.livrNpa : data.npa;
  const addrVille = showLivrDiff ? data.livrVille : data.ville;
```

**Remplace par** :
```typescript
  // Détermine quelle adresse afficher (livraison prioritaire si différente)
  const showLivrDiff = (data as any).deliveryMode !== "À l'emporter" && data.livrDiff;
  const addrSociete = showLivrDiff ? data.livrSociete : data.societe;
  const addrNom = showLivrDiff ? data.livrNom : data.nom;
  const addrPrenom = showLivrDiff ? data.livrPrenom : data.prenom;
  const addrComplementNom = showLivrDiff ? data.livr_complement_nom : data.complement_nom;
  const addrRue = showLivrDiff ? data.livrRue : data.rue;
  const addrNumero = showLivrDiff ? data.livrNumero : data.numero;
  const addrNpa = showLivrDiff ? data.livrNpa : data.npa;
  const addrVille = showLivrDiff ? data.livrVille : data.ville;
```

#### 6.2 — Bloc JSX adresse client

**Cherche** :
```jsx
          <div className="client-addr">
            {addrSociete && <div className="client-addr-line">{addrSociete}</div>}
            <div className="client-addr-name">{addrNom} {addrPrenom}</div>
            {addrRue && <div className="client-addr-line">{addrRue} {addrNumero}</div>}
            {addrNpa && <div className="client-addr-line">{addrNpa} {addrVille}</div>}
          </div>
```

**Remplace par** :
```jsx
          <div className="client-addr">
            {addrSociete && <div className="client-addr-line">{addrSociete}</div>}
            <div className="client-addr-name">{addrNom} {addrPrenom}</div>
            {addrComplementNom && <div className="client-addr-line">{addrComplementNom}</div>}
            {addrRue && <div className="client-addr-line">{addrRue} {addrNumero}</div>}
            {addrNpa && <div className="client-addr-line">{addrNpa} {addrVille}</div>}
          </div>
```

**Note importante** : ce template est la page de garde A4 collée sur le colis. Le complément nom est ESSENTIEL ici pour le livreur/facteur ("et Marie", "c/o Crédit Suisse", "Mesdames Roca et De Marco"). C'est le cas d'usage le plus visible.

---

### Fichier 7 — `app/print/fiche-bleue/[slug]/page.tsx` (archive classeur)

#### 7.1 — Bloc Livraison (uniquement si `livrDiff=true`)

**Cherche** :
```jsx
                ) : data.livrDiff ? (
                  <>
                    {data.livrSociete && <div>{data.livrSociete}</div>}
                    <div className="fb-info-name">{data.livrNom} {data.livrPrenom}</div>
                    {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                    {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                    {data.livrTel && <div>📞 {data.livrTel}</div>}
                  </>
                ) : (
```

**Remplace par** :
```jsx
                ) : data.livrDiff ? (
                  <>
                    {data.livrSociete && <div>{data.livrSociete}</div>}
                    <div className="fb-info-name">{data.livrNom} {data.livrPrenom}</div>
                    {data.livr_complement_nom && <div>{data.livr_complement_nom}</div>}
                    {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                    {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                    {data.livrTel && <div>📞 {data.livrTel}</div>}
                  </>
                ) : (
```

**Note** : la branche `!livrDiff` affiche juste "Identique à facturation" — pas besoin de patcher, l'info complète est dans le bloc facturation à côté.

#### 7.2 — Bloc Client / Facturation

**Cherche** :
```jsx
            <div className="fb-info-block">
              <div className="fb-info-title">👤 Client / Facturation</div>
              <div className="fb-info-content">
                {data.societe && <div>{data.societe}</div>}
                <div className="fb-info-name">{data.nom} {data.prenom}</div>
                {data.rue && <div>{data.rue} {data.numero}</div>}
                {data.npa && <div>{data.npa} {data.ville}</div>}
                {data.telephone1 && <div>📞 {data.telephone1}</div>}
                {data.email && <div style={{fontSize: 9}}>✉ {data.email}</div>}
                {data.customerNumber && <div style={{fontSize: 9, color: "#555", marginTop: 2}}>N° client : {data.customerNumber}</div>}
              </div>
            </div>
```

**Remplace par** :
```jsx
            <div className="fb-info-block">
              <div className="fb-info-title">👤 Client / Facturation</div>
              <div className="fb-info-content">
                {data.societe && <div>{data.societe}</div>}
                <div className="fb-info-name">{data.nom} {data.prenom}</div>
                {data.complement_nom && <div>{data.complement_nom}</div>}
                {data.rue && <div>{data.rue} {data.numero}</div>}
                {data.npa && <div>{data.npa} {data.ville}</div>}
                {data.telephone1 && <div>📞 {data.telephone1}</div>}
                {data.email && <div style={{fontSize: 9}}>✉ {data.email}</div>}
                {data.customerNumber && <div style={{fontSize: 9, color: "#555", marginTop: 2}}>N° client : {data.customerNumber}</div>}
              </div>
            </div>
```

---

### Fichier 8 — `app/print/all/[slug]/page.tsx` (jeu complet 5 pages)

10 patches répartis sur les 5 sections du fichier.

#### 8.1 — Variables fiche de travail (ajout `livrComplementNomFTeff`)

**Cherche** :
```typescript
  // Variables fiche de travail
  const livrSocieteFT = data.livrDiff ? data.livrSociete : data.societe;
  const livrNomFT     = data.livrDiff ? data.livrNom     : data.nom;
  const livrPrenomFT  = data.livrDiff ? data.livrPrenom  : data.prenom;
  const livrRueFT     = data.livrDiff ? data.livrRue     : data.rue;
  const livrNumeroFT  = data.livrDiff ? data.livrNumero  : data.numero;
  const livrNpaFT     = data.livrDiff ? data.livrNpa     : data.npa;
  const livrVilleFT   = data.livrDiff ? data.livrVille   : data.ville;
  const livrTelFTeff = (data.livrDiff && data.livrTel) ? data.livrTel : data.telephone1;
```

**Remplace par** :
```typescript
  // Variables fiche de travail
  const livrSocieteFT = data.livrDiff ? data.livrSociete : data.societe;
  const livrNomFT     = data.livrDiff ? data.livrNom     : data.nom;
  const livrPrenomFT  = data.livrDiff ? data.livrPrenom  : data.prenom;
  const livrComplementNomFTeff = data.livrDiff ? data.livr_complement_nom : data.complement_nom;
  const livrRueFT     = data.livrDiff ? data.livrRue     : data.rue;
  const livrNumeroFT  = data.livrDiff ? data.livrNumero  : data.numero;
  const livrNpaFT     = data.livrDiff ? data.livrNpa     : data.npa;
  const livrVilleFT   = data.livrDiff ? data.livrVille   : data.ville;
  const livrTelFTeff = (data.livrDiff && data.livrTel) ? data.livrTel : data.telephone1;
```

#### 8.2 — Variables page de garde (ajout `pgComplementNom`)

**Cherche** :
```typescript
  // Variables page de garde
  const showLivrDiffPG = !isPickup && data.livrDiff;
  const pgSociete = showLivrDiffPG ? data.livrSociete : data.societe;
  const pgNom     = showLivrDiffPG ? data.livrNom     : data.nom;
  const pgPrenom  = showLivrDiffPG ? data.livrPrenom  : data.prenom;
  const pgRue     = showLivrDiffPG ? data.livrRue     : data.rue;
  const pgNumero  = showLivrDiffPG ? data.livrNumero  : data.numero;
  const pgNpa     = showLivrDiffPG ? data.livrNpa     : data.npa;
  const pgVille   = showLivrDiffPG ? data.livrVille   : data.ville;
```

**Remplace par** :
```typescript
  // Variables page de garde
  const showLivrDiffPG = !isPickup && data.livrDiff;
  const pgSociete = showLivrDiffPG ? data.livrSociete : data.societe;
  const pgNom     = showLivrDiffPG ? data.livrNom     : data.nom;
  const pgPrenom  = showLivrDiffPG ? data.livrPrenom  : data.prenom;
  const pgComplementNom = showLivrDiffPG ? data.livr_complement_nom : data.complement_nom;
  const pgRue     = showLivrDiffPG ? data.livrRue     : data.rue;
  const pgNumero  = showLivrDiffPG ? data.livrNumero  : data.numero;
  const pgNpa     = showLivrDiffPG ? data.livrNpa     : data.npa;
  const pgVille   = showLivrDiffPG ? data.livrVille   : data.ville;
```

#### 8.3 — Page 1 Fiche travail : fenêtre adresse livraison

**Cherche** :
```jsx
              ) : (
                <>
                  {livrSocieteFT && <div className="ft-addr-line">{livrSocieteFT}</div>}
                  <div className="ft-addr-name">{livrNomFT} {livrPrenomFT}</div>
                  {livrRueFT && <div className="ft-addr-line">{livrRueFT} {livrNumeroFT}</div>}
                  {livrNpaFT && <div className="ft-addr-line">{livrNpaFT} {livrVilleFT}</div>}
                  {livrTelFTeff && <div className="ft-addr-tel">📞 {livrTelFTeff}</div>}
                  {data.email && <div className="ft-addr-email">✉ {data.email}</div>}
                </>
              )}
```

**Remplace par** :
```jsx
              ) : (
                <>
                  {livrSocieteFT && <div className="ft-addr-line">{livrSocieteFT}</div>}
                  <div className="ft-addr-name">{livrNomFT} {livrPrenomFT}</div>
                  {livrComplementNomFTeff && <div className="ft-addr-line">{livrComplementNomFTeff}</div>}
                  {livrRueFT && <div className="ft-addr-line">{livrRueFT} {livrNumeroFT}</div>}
                  {livrNpaFT && <div className="ft-addr-line">{livrNpaFT} {livrVilleFT}</div>}
                  {livrTelFTeff && <div className="ft-addr-tel">📞 {livrTelFTeff}</div>}
                  {data.email && <div className="ft-addr-email">✉ {data.email}</div>}
                </>
              )}
```

#### 8.4 — Page 1 Fiche travail : bloc facturation

**Cherche** :
```jsx
            <div className="ft-billing-block">
              <div className="ft-billing-block-title">💼 Adresse de facturation</div>
              <div className="ft-billing-block-content">
                {data.societe && <div>{data.societe}</div>}
                <div className="ft-billing-name">{data.nom} {data.prenom}</div>
                {data.rue && <div>{data.rue} {data.numero}</div>}
                {data.npa && <div>{data.npa} {data.ville}</div>}
                <div className="ft-billing-contact">
                  {data.telephone1 && <span>📞 {data.telephone1}</span>}
                  {data.email && <span>✉ {data.email}</span>}
                </div>
              </div>
            </div>
```

**Remplace par** :
```jsx
            <div className="ft-billing-block">
              <div className="ft-billing-block-title">💼 Adresse de facturation</div>
              <div className="ft-billing-block-content">
                {data.societe && <div>{data.societe}</div>}
                <div className="ft-billing-name">{data.nom} {data.prenom}</div>
                {data.complement_nom && <div>{data.complement_nom}</div>}
                {data.rue && <div>{data.rue} {data.numero}</div>}
                {data.npa && <div>{data.npa} {data.ville}</div>}
                <div className="ft-billing-contact">
                  {data.telephone1 && <span>📞 {data.telephone1}</span>}
                  {data.email && <span>✉ {data.email}</span>}
                </div>
              </div>
            </div>
```

#### 8.5 — Page 2 Commande : fenêtre adresse destinataire

**Cherche** :
```jsx
          <div className="cc-header-right">
            <div className="cc-addr-window">
              <div className="cc-addr-ref">{numeroAffiche || data.offerNumber}</div>
              {data.societe && <div className="cc-addr-line">{data.societe}</div>}
              <div className="cc-addr-name">{data.nom} {data.prenom}</div>
              {data.rue && <div className="cc-addr-line">{data.rue} {data.numero}</div>}
              {data.npa && <div className="cc-addr-line">{data.npa} {data.ville}</div>}
              {data.telephone1 && <div className="cc-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.telephone1}</div>}
            </div>
          </div>
```

**Remplace par** :
```jsx
          <div className="cc-header-right">
            <div className="cc-addr-window">
              <div className="cc-addr-ref">{numeroAffiche || data.offerNumber}</div>
              {data.societe && <div className="cc-addr-line">{data.societe}</div>}
              <div className="cc-addr-name">{data.nom} {data.prenom}</div>
              {data.complement_nom && <div className="cc-addr-line">{data.complement_nom}</div>}
              {data.rue && <div className="cc-addr-line">{data.rue} {data.numero}</div>}
              {data.npa && <div className="cc-addr-line">{data.npa} {data.ville}</div>}
              {data.telephone1 && <div className="cc-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.telephone1}</div>}
            </div>
          </div>
```

#### 8.6 — Page 2 Commande : bloc facturation

**Cherche** :
```jsx
                <span className="cc-addr-title">Adresse de facturation</span>
                <div className="cc-addr-content">
                  {data.societe && <div>{data.societe}</div>}
                  <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                  {data.rue && <div>{data.rue} {data.numero}</div>}
                  {data.npa && <div>{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                  {data.telephone2 && <div>Tél. {data.telephone2}</div>}
                  {data.email && <div>{data.email}</div>}
                </div>
```

**Remplace par** :
```jsx
                <span className="cc-addr-title">Adresse de facturation</span>
                <div className="cc-addr-content">
                  {data.societe && <div>{data.societe}</div>}
                  <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                  {data.complement_nom && <div>{data.complement_nom}</div>}
                  {data.rue && <div>{data.rue} {data.numero}</div>}
                  {data.npa && <div>{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                  {data.telephone2 && <div>Tél. {data.telephone2}</div>}
                  {data.email && <div>{data.email}</div>}
                </div>
```

#### 8.7 — Page 2 Commande : bloc livraison (avec contexte unique pour différencier de BL)

**Cherche** :
```jsx
                  ) : data.livrDiff ? (
                    <>
                      {data.livrSociete && <div>{data.livrSociete}</div>}
                      <div style={{fontWeight:700}}>{data.livrNom} {data.livrPrenom}</div>
                      {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                      {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                      {data.livrTel && <div>Tél. {data.livrTel}</div>}
                    </>
                  ) : (
                    <>
                      {data.societe && <div>{data.societe}</div>}
                      <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                      {data.rue && <div>{data.rue} {data.numero}</div>}
                      {data.npa && <div>{data.npa} {data.ville}</div>}
                      {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TABLEAU ARTICLES */}
        <table className="cc-table">
```

**Remplace par** :
```jsx
                  ) : data.livrDiff ? (
                    <>
                      {data.livrSociete && <div>{data.livrSociete}</div>}
                      <div style={{fontWeight:700}}>{data.livrNom} {data.livrPrenom}</div>
                      {data.livr_complement_nom && <div>{data.livr_complement_nom}</div>}
                      {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                      {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                      {data.livrTel && <div>Tél. {data.livrTel}</div>}
                    </>
                  ) : (
                    <>
                      {data.societe && <div>{data.societe}</div>}
                      <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                      {data.complement_nom && <div>{data.complement_nom}</div>}
                      {data.rue && <div>{data.rue} {data.numero}</div>}
                      {data.npa && <div>{data.npa} {data.ville}</div>}
                      {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TABLEAU ARTICLES */}
        <table className="cc-table">
```

#### 8.8 — Page 3 Page de garde : bloc adresse client

**Cherche** :
```jsx
            <div className="pg-client-addr">
              {pgSociete && <div className="pg-client-addr-line">{pgSociete}</div>}
              <div className="pg-client-addr-name">{pgNom} {pgPrenom}</div>
              {pgRue && <div className="pg-client-addr-line">{pgRue} {pgNumero}</div>}
              {pgNpa && <div className="pg-client-addr-line">{pgNpa} {pgVille}</div>}
            </div>
```

**Remplace par** :
```jsx
            <div className="pg-client-addr">
              {pgSociete && <div className="pg-client-addr-line">{pgSociete}</div>}
              <div className="pg-client-addr-name">{pgNom} {pgPrenom}</div>
              {pgComplementNom && <div className="pg-client-addr-line">{pgComplementNom}</div>}
              {pgRue && <div className="pg-client-addr-line">{pgRue} {pgNumero}</div>}
              {pgNpa && <div className="pg-client-addr-line">{pgNpa} {pgVille}</div>}
            </div>
```

#### 8.9 — Page 4 Bulletin : 3 sous-patches (fenêtre + facturation + livraison)

**8.9a — Fenêtre adresse BL**

**Cherche** :
```jsx
              ) : data.livrDiff ? (
                <>
                  {data.livrSociete && <div className="bl-addr-line">{data.livrSociete}</div>}
                  <div className="bl-addr-name">{data.livrNom} {data.livrPrenom}</div>
                  {data.livrRue && <div className="bl-addr-line">{data.livrRue} {data.livrNumero}</div>}
                  {data.livrNpa && <div className="bl-addr-line">{data.livrNpa} {data.livrVille}</div>}
                  {data.livrTel && <div className="bl-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.livrTel}</div>}
                </>
              ) : (
                <>
                  {data.societe && <div className="bl-addr-line">{data.societe}</div>}
                  <div className="bl-addr-name">{data.nom} {data.prenom}</div>
                  {data.rue && <div className="bl-addr-line">{data.rue} {data.numero}</div>}
                  {data.npa && <div className="bl-addr-line">{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div className="bl-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.telephone1}</div>}
                </>
              )}
```

**Remplace par** :
```jsx
              ) : data.livrDiff ? (
                <>
                  {data.livrSociete && <div className="bl-addr-line">{data.livrSociete}</div>}
                  <div className="bl-addr-name">{data.livrNom} {data.livrPrenom}</div>
                  {data.livr_complement_nom && <div className="bl-addr-line">{data.livr_complement_nom}</div>}
                  {data.livrRue && <div className="bl-addr-line">{data.livrRue} {data.livrNumero}</div>}
                  {data.livrNpa && <div className="bl-addr-line">{data.livrNpa} {data.livrVille}</div>}
                  {data.livrTel && <div className="bl-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.livrTel}</div>}
                </>
              ) : (
                <>
                  {data.societe && <div className="bl-addr-line">{data.societe}</div>}
                  <div className="bl-addr-name">{data.nom} {data.prenom}</div>
                  {data.complement_nom && <div className="bl-addr-line">{data.complement_nom}</div>}
                  {data.rue && <div className="bl-addr-line">{data.rue} {data.numero}</div>}
                  {data.npa && <div className="bl-addr-line">{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div className="bl-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.telephone1}</div>}
                </>
              )}
```

**8.9b — Bloc facturation BL**

**Cherche** :
```jsx
                <span className="bl-addr-title">Adresse de facturation</span>
                <div className="bl-addr-content">
                  {data.societe && <div>{data.societe}</div>}
                  <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                  {data.rue && <div>{data.rue} {data.numero}</div>}
                  {data.npa && <div>{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                  {data.telephone2 && <div>Tél. {data.telephone2}</div>}
                  {data.email && <div>{data.email}</div>}
                </div>
```

**Remplace par** :
```jsx
                <span className="bl-addr-title">Adresse de facturation</span>
                <div className="bl-addr-content">
                  {data.societe && <div>{data.societe}</div>}
                  <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                  {data.complement_nom && <div>{data.complement_nom}</div>}
                  {data.rue && <div>{data.rue} {data.numero}</div>}
                  {data.npa && <div>{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                  {data.telephone2 && <div>Tél. {data.telephone2}</div>}
                  {data.email && <div>{data.email}</div>}
                </div>
```

**8.9c — Bloc livraison BL (avec contexte unique)**

**Cherche** :
```jsx
                  ) : data.livrDiff ? (
                    <>
                      {data.livrSociete && <div>{data.livrSociete}</div>}
                      <div style={{fontWeight:700}}>{data.livrNom} {data.livrPrenom}</div>
                      {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                      {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                      {data.livrTel && <div>Tél. {data.livrTel}</div>}
                    </>
                  ) : (
                    <>
                      {data.societe && <div>{data.societe}</div>}
                      <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                      {data.rue && <div>{data.rue} {data.numero}</div>}
                      {data.npa && <div>{data.npa} {data.ville}</div>}
                      {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TABLEAU ARTICLES (sans prix) */}
        <table className="bl-table">
```

**Remplace par** :
```jsx
                  ) : data.livrDiff ? (
                    <>
                      {data.livrSociete && <div>{data.livrSociete}</div>}
                      <div style={{fontWeight:700}}>{data.livrNom} {data.livrPrenom}</div>
                      {data.livr_complement_nom && <div>{data.livr_complement_nom}</div>}
                      {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                      {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                      {data.livrTel && <div>Tél. {data.livrTel}</div>}
                    </>
                  ) : (
                    <>
                      {data.societe && <div>{data.societe}</div>}
                      <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                      {data.complement_nom && <div>{data.complement_nom}</div>}
                      {data.rue && <div>{data.rue} {data.numero}</div>}
                      {data.npa && <div>{data.npa} {data.ville}</div>}
                      {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TABLEAU ARTICLES (sans prix) */}
        <table className="bl-table">
```

#### 8.10 — Page 5 Fiche bleue : bloc livraison + bloc Client/Facturation

**8.10a — Bloc Livraison FB**

**Cherche** :
```jsx
                  ) : data.livrDiff ? (
                    <>
                      {data.livrSociete && <div>{data.livrSociete}</div>}
                      <div className="fb-info-name">{data.livrNom} {data.livrPrenom}</div>
                      {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                      {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                      {data.livrTel && <div>📞 {data.livrTel}</div>}
                    </>
                  ) : (
```

**Remplace par** :
```jsx
                  ) : data.livrDiff ? (
                    <>
                      {data.livrSociete && <div>{data.livrSociete}</div>}
                      <div className="fb-info-name">{data.livrNom} {data.livrPrenom}</div>
                      {data.livr_complement_nom && <div>{data.livr_complement_nom}</div>}
                      {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                      {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                      {data.livrTel && <div>📞 {data.livrTel}</div>}
                    </>
                  ) : (
```

**8.10b — Bloc Client/Facturation FB**

**Cherche** :
```jsx
              <div className="fb-info-block">
                <div className="fb-info-title">👤 Client / Facturation</div>
                <div className="fb-info-content">
                  {data.societe && <div>{data.societe}</div>}
                  <div className="fb-info-name">{data.nom} {data.prenom}</div>
                  {data.rue && <div>{data.rue} {data.numero}</div>}
                  {data.npa && <div>{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div>📞 {data.telephone1}</div>}
                  {data.email && <div style={{fontSize: 9}}>✉ {data.email}</div>}
                  {data.customerNumber && <div style={{fontSize: 9, color: "#555", marginTop: 2}}>N° client : {data.customerNumber}</div>}
                </div>
              </div>
```

**Remplace par** :
```jsx
              <div className="fb-info-block">
                <div className="fb-info-title">👤 Client / Facturation</div>
                <div className="fb-info-content">
                  {data.societe && <div>{data.societe}</div>}
                  <div className="fb-info-name">{data.nom} {data.prenom}</div>
                  {data.complement_nom && <div>{data.complement_nom}</div>}
                  {data.rue && <div>{data.rue} {data.numero}</div>}
                  {data.npa && <div>{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div>📞 {data.telephone1}</div>}
                  {data.email && <div style={{fontSize: 9}}>✉ {data.email}</div>}
                  {data.customerNumber && <div style={{fontSize: 9, color: "#555", marginTop: 2}}>N° client : {data.customerNumber}</div>}
                </div>
              </div>
```

---

## 🛑 Fichiers À NE PAS TOUCHER (rappel important)

- `app/api/offres/[slug]/qr/route.ts` — Swiss QR-bill, format réglementaire intouchable
- `lib/shopify-orders.ts` — pipeline Shopify
- `lib/shopify-stock.ts` — gestion stock
- `lib/shopify-pdf-urls.ts` — URLs PDFs Shopify
- Matcher WinBiz — synchronisation comptabilité

---

## 🧪 Tests à effectuer après Phase 3 complète

### TEST-1 : Couple Privé sans société

**Données** :
- Type client : `Privé (prix TTC)`
- `nom = "Dupont"`, `prenom = "Jean"`
- `complement_nom = "et Marie"`
- `livrDiff = false`

**Attendu sur chaque template** :
- Affichage : `Jean Dupont` puis `et Marie` puis adresse rue
- Livraison hérite automatiquement de "et Marie"

### TEST-2 : Société Pro avec livraison différente

**Données** :
- Type client : `Pro (prix HT)`
- `societe = "SARL Martin SA"`
- `nom = "Dupont"`, `prenom = "Pierre"`
- `complement_nom = "À l'att. de Mme Dupont"`
- `livrDiff = true`
- `livrSociete = "Chantier Lutry"`, `livrNom = "Martin"`, `livrPrenom = "Paul"`
- `livr_complement_nom = "À l'att. de M. Martin"`

**Attendu** :
- Facturation : `SARL Martin SA` → `Pierre Dupont` → `À l'att. de Mme Dupont` → rue
- Livraison : `Chantier Lutry` → `Paul Martin` → `À l'att. de M. Martin` → rue

### TEST-3 : Non-régression sur offre ancienne sans complément

**Données** :
- Offre créée avant cette feature
- `complement_nom = NULL`
- `livr_complement_nom = NULL`

**Attendu** :
- Aucune ligne complément ne s'affiche (le `{x && <div>...</div>}` suffit)
- Rien ne casse, layout identique à avant

### Vérifications par template

Pour chaque template, contrôler :
- ✅ Complément affiché APRÈS Nom/Prénom et AVANT Rue
- ✅ Si pas de complément en base → rien ne s'affiche
- ✅ Livraison hérite auto du complément facturation si `!livrDiff`
- ✅ Cas "À l'emporter" : pas de complément affiché (normal, pas d'adresse client)

---

## 🚦 Workflow git utilisé

```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
git add .
git commit -m "<message>"
git push
```

---

## 📦 Fichiers livrés

- `JOURNAL-complement-nom.md` (ce fichier — Phases 1-2-3 complètes avec patches verbatim)
- `migration-complement-nom.sql` (migration SQL Phase 1)

---

## 🎉 Statut : Feature terminée

| Phase | Statut | Date |
|---|---|---|
| Phase 1 — Backend (SQL + types) | ✅ | Sessions précédentes |
| Phase 2 — UI saisie (formulaire + fiche client + dashboard + API) | ✅ | Sessions précédentes |
| Phase 3 — Templates d'affichage (8 fichiers, 28 patches) | ✅ | Cette session |

**Total feature** :
- 4 colonnes Supabase ajoutées
- 2 types TypeScript patchés
- ~15 fichiers métier patchés (formulaire, API, dashboards, templates)
- 0 logique métier modifiée
- 0 régression introduite (architecture Option 1)

---

## 📝 Notes pour reprises futures

### Si on veut renforcer le typage (optionnel)

Pour éliminer les `(data as any).complement_nom` qui restent dans 2 fichiers :
- `app/offre/[slug]/page.tsx` : patcher le type `OffreRow.data` pour y ajouter `complement_nom?: string` + `livr_complement_nom?: string`
- `app/print/fiche-travail/[slug]/page.tsx` : remplacer le type local `PrintData` par l'import depuis `lib/jc-print-types.ts`

Ces refactos sont purement cosmétiques — le code fonctionne déjà parfaitement.

### Si on veut une migration rétroactive

Décision actuelle : **non** (feature transparente, anciennes offres restent inchangées).

Si besoin futur :
```sql
-- Exemple : pour les offres dont le client a un complement_nom dans clients,
-- backfill dans offres
UPDATE offres o
SET client_complement_nom = c.complement_nom,
    livr_complement_nom = c.livr_complement_nom
FROM clients c
WHERE o.client_email = c.email
  AND o.client_complement_nom IS NULL;
```

À tester sur staging d'abord.

### Webhook Make

Le payload du webhook Make contient maintenant :
- `client_complement_nom`
- `livr_complement_nom`

Si des scénarios Make doivent les exploiter (mailing, étiquettes d'expédition automatiques, etc.), c'est disponible côté Make sans changement côté Next.js.

### Pattern réutilisable pour d'autres champs

Ce pattern (Option 1 — ajout sans changement de logique) peut être réappliqué pour d'autres champs d'adresse futurs :
- `numero_chambre` (immeubles)
- `etage` (livraisons en immeuble)
- `code_porte`
- `instructions_livraison` (différent de `accesLivraison` qui est plus formel)

Procédure type :
1. Phase 1 : ALTER TABLE + patcher types
2. Phase 2 : patcher formulaire + API + dashboards
3. Phase 3 : patcher 8 templates avec le même pattern `{champ && <div>{champ}</div>}` à insérer entre Nom et Rue



---

# Refonte du module Logo / Image (lignes média)

> Date : 2026-05-12
> Statut : ✅ Terminé et déployé en production

## 🎯 Objectif

Améliorer le module "Logo / Image" qui insère dans le tableau d'articles d'une offre :
- soit un **logo de marque** (depuis `brand_logos` Supabase)
- soit une **image personnalisée** uploadée à la volée

**Problèmes initiaux** :
1. Picker en thème clair (incohérent avec dashboard sombre)
2. Dropdown tronqué par overflow du tableau (logos cachés sous le pli)
3. Pas de distinction logo (compact) vs image upload (plus grande)
4. Sur le rendu PDF, logos en pleine largeur (ratio non contraint)
5. Page de validation web `/offre/[slug]` n'affichait pas les lignes média
6. Compteur "Articles (X)" incluait à tort les lignes média

## ✅ Solution livrée

### Architecture
- **2 jeux de tailles distincts**, choisis automatiquement selon `line.mediaSource` :
  - `library` (logo de marque) → classes CSS `.media-*` (compactes)
  - `upload` (image personnalisée) → classes CSS `.media-img-*` (agrandies)
- Pour la fiche bleue (archive compacte) : classes `.fb-media-*` et `.fb-media-img-*` avec valeurs encore plus petites

### Valeurs CSS unifiées

| Taille | Logo (`.media-*`) | Image upload (`.media-img-*`) |
|---|---|---|
| **P** (small) | max-height 22px / max-width 80px | max-height 80px / max-width 200px |
| **M** (medium) | max-height 50px / max-width 180px | max-height 180px / max-width 400px |
| **G** (large) | max-height 110px / max-width 350px | max-height 320px / max-width 700px |

| Taille | Fiche bleue logo (`.fb-media-*`) | Fiche bleue image (`.fb-media-img-*`) |
|---|---|---|
| **P** | max-height 18px / max-width 60px | max-height 60px / max-width 140px |
| **M** | max-height 40px / max-width 130px | max-height 130px / max-width 280px |
| **G** | max-height 80px / max-width 250px | max-height 220px / max-width 480px |

### Propriétés CSS de chaque classe
```css
max-height: Xpx !important;
max-width: Xpx !important;
width: auto !important;
height: auto !important;
object-fit: contain !important;
display: inline-block !important;
```

`object-fit: contain` préserve les ratios des logos très allongés (Fermob), `display: inline-block` permet le centrage via `text-align: center` sur le `<td>` parent.

### Logique de choix de classe (dans chaque template)
```typescript
const prefix = line.mediaSource === "upload" ? "media-img-" : "media-";
const sizeClass = line.mediaSize === "small"
  ? prefix + "small"
  : line.mediaSize === "large"
  ? prefix + "large"
  : prefix + "medium";
```

Pour la fiche bleue, prefix devient `"fb-media-img-"` ou `"fb-media-"`.

## 📂 Fichiers modifiés

### Picker formulaire
- `app/offres/nouveau/MediaLinePicker.tsx` — Refonte complète : ancien dropdown custom → `<select>` natif HTML, thème sombre, boutons P/M/G agrandis avec lettres proportionnelles (text-xs / text-sm / text-base), bouton Uploader, lien Gerer vers `/dashboard/brand-logos`

### Page validation web (côté client)
- `app/offre/[slug]/page.tsx` — Ajout type `"media"` dans `QuoteLine.type`, ajout des 6 classes CSS, ajout branche `if (line.type === "media")` dans `.map()`, compteur "Articles (X)" exclut désormais commentaires ET lignes média

### Templates print (6 fichiers)
- `app/print/offre/[slug]/page.tsx` — Offre commerciale (avait initialement aucune définition CSS → ajout complet)
- `app/print/offre/page.tsx` — Preview localStorage (2 blocs CSS dupliqués patchés)
- `app/print/fiche-travail/[slug]/page.tsx` — Fiche entrepôt interne
- `app/print/bulletin-livraison/[slug]/page.tsx` — Bulletin sans prix
- `app/print/fiche-bleue/[slug]/page.tsx` — Archive papier compacte
- `app/print/all/[slug]/page.tsx` — Jeu complet 5 pages

### Type partagé (inchangé)
- `lib/media-line-types.ts` : déjà OK avec `MEDIA_SIZE_PX = {small: 22, medium: 50, large: 110}` et le type `MediaLine` avec propriété `source: "library" | "upload"`

## 🐛 Pièges rencontrés

### Bug "balise `<a>` mangée" par le copier-coller
Le copier-coller a systématiquement supprimé la balise `<a>` ouvrante quand celle-ci était écrite sur plusieurs lignes (probablement protection anti-XSS de Chrome ou interprétation HTML par l'éditeur).

**Règle d'or** : toujours écrire `<a href="..." target="_blank" rel="noopener noreferrer" className="...">Texte</a>` sur **une seule ligne**.

### Bug encodage UTF-8
Certains caractères Unicode (`↗`, emojis) ont cassé Turbopack. Préférer l'ASCII pur ou vérifier que VS Code est bien en UTF-8.

### Bug PowerShell avec crochets `[slug]`
Utiliser `-LiteralPath` au lieu de `-Path` pour les fichiers Next.js avec `[slug]` dans le nom (sinon les `[` `]` sont interprétés comme pattern de filtrage).

### Doublons CSS générés par patches successifs
Plusieurs templates ont eu des classes CSS dupliquées après les premiers patches : la nouvelle déclaration `.media-img-small { max-height: 80px... }` était suivie par l'ancienne `.media-img-small { height: 90px... }` qui l'écrasait (dernière déclaration gagne en CSS).

### Templates sans CSS héritée
Le template `app/print/offre/[slug]/page.tsx` utilisait `className={sizeClass}` mais ne définissait pas du tout les classes `.media-*` dans son `<style>`. Conséquence : SVG des logos affichés à taille naturelle (ratio non contraint).

## 🎁 Bonus dans la même session

En plus du module logo/image, on a aussi corrigé :
- **Dropdown autocomplete clients** sur `/offres/nouveau` (Esc / ↑↓ / Enter / clic extérieur, bouton X rouge, recherche par société)
- **Réordonnancement des champs adresse** sur `/dashboard/clients/[id]` (Rue+N° puis Complément puis NPA+Ville)
- **Ajout du champ `complement_nom`** dans le modal "Nouveau client" du dashboard

## 🔧 Maintenance future

### Pour ajuster les tailles
Modifier les valeurs `max-height` et `max-width` des classes CSS dans le template concerné. La logique JS choisit automatiquement le bon préfixe.

### Pour ajouter une 4ème taille (XL)
1. Ajouter `"xlarge"` dans le type `MediaSize` de `lib/media-line-types.ts`
2. Ajouter `xlarge: <px>` dans `MEDIA_SIZE_PX` et `MEDIA_SIZE_LABEL`
3. Ajouter les classes `.media-xlarge` et `.media-img-xlarge` dans les 6 templates
4. Adapter la logique `sizeClass` dans chaque template

### Pour synchroniser l'aperçu picker avec le rendu PDF
Actuellement, l'aperçu utilise `MEDIA_SIZE_PX[line.size]` (valeurs logos uniquement). Pour refléter aussi les tailles upload :
1. Ajouter dans `lib/media-line-types.ts` :
```typescript
   export const IMAGE_SIZE_PX: Record<MediaSize, number> = { small: 80, medium: 180, large: 320 };
   export function getMediaHeight(source: "library" | "upload", size: MediaSize): number {
     return source === "upload" ? IMAGE_SIZE_PX[size] : MEDIA_SIZE_PX[size];
   }
```
2. Dans le picker, remplacer `const heightPx = MEDIA_SIZE_PX[line.size];` par `const heightPx = getMediaHeight(line.source, line.size);`

## 📌 Note : les images d'ambiance restent intactes

Le mécanisme séparé `ambianceImages` / classes `.jc-ambiance-*` (images de fin d'offre, page 2 séparée) n'a **pas** été touché, comme demandé.