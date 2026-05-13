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


---

## Session du 13.05.2026 — Debug du compactage à l'impression `/print/all`

### Symptôme
Le template `/print/all/[slug]` (jeu complet 5 pages) s'imprimait compacté à ~74% à l'écran d'aperçu d'impression : les pages ne remplissaient pas la feuille A4, alors que les templates individuels (`/print/offre`, `/print/fiche-travail`, etc.) s'imprimaient correctement à pleine taille.

### Cause racine identifiée (par test de dichotomie)
Le **`min-height: 265mm`** sur `.fb-page-wrap` (fiche bleue, page 5) combiné aux marges `@page` faisait dépasser le contenu de la zone imprimable A4. Chrome déclenchait alors un **shrink-to-fit automatique** qui rescalait **tout le document** (les 5 pages) à ~74% pour faire rentrer la fiche bleue dans la feuille.

**Méthode de diagnostic** : désactivation temporaire de chaque page via `{false && (...)}` (test par dichotomie). En désactivant la fiche bleue, les 4 autres pages s'imprimaient à pleine taille. → Coupable identifié.

### Fausses pistes éliminées en cours de route
1. **Erreur React #418 (hydratation)** : présente sur TOUS les templates print, donc non bloquante. À ignorer.
2. **Largeur excessive `.fb-page-wrap`** : ajouts `width: 794px`/`width: 178mm` → faisaient EMPIRER les choses (forçaient un body à 673px = précisément la valeur de compactage).
3. **Erreur d'hydratation #418** : tentatives de SSR off via `dynamic({ssr: false})` → aucun effet sur le compactage.
4. **Adresse longue débordante** sur page de garde colis (MAISON DE GROUPE VICTORIA MIGNARD / LINDENMAIER) : ajout `word-break: break-word` sur `.pg-client-addr*` a résolu le débordement visuel mais PAS le compactage.

### Solution finale appliquée
1. **Suppression du `min-height: 265mm` problématique** sur `.fb-page-wrap` puis remise à `277mm` après ajustement des marges `@page`.
2. **Réduction des marges `@page`** de `14mm 16mm 14mm 14mm` à `8mm 10mm 8mm 10mm` → toutes les pages gagnent de l'espace utile (zone imprimable passe de 180×269mm à 190×281mm).
3. **Wrap forcé sur les adresses longues** : ajout `word-break: break-word; overflow-wrap: break-word; max-width: 100%` sur `.pg-client-addr`, `.pg-client-addr-line`, `.pg-client-addr-name` pour éviter le débordement quand un nom de société est très long.

### Compromis accepté
La fiche bleue dans `print/all` garde **8mm de blanc autour** de son fond bleu (vs `@page { margin: 0 }` dans le template standalone `/print/fiche-bleue/[slug]` qui touche les bords physiques du papier).
Tentative de marges négatives `margin: -14mm -16mm -14mm -14mm` pour compenser → faisait déborder la fiche bleue sur 2 pages. **Abandonnée.**
Pour avoir un fond bleu pleine page jusqu'aux bords physiques, utiliser uniquement le template standalone `/print/fiche-bleue/[slug]`.

### Pièges à retenir pour le futur
- **Chrome shrink-to-fit** : si un élément dépasse la zone imprimable A4 (largeur OU hauteur), Chrome rescale tout le document pour faire rentrer. Pas que la page fautive — **tout**.
- **Test par dichotomie** : pour identifier un élément coupable parmi plusieurs sur une page d'impression complexe, désactiver via `{false && (...)}` et tester à l'impression. Méthode super efficace.
- **Erreur React #418** : non corrélée au compactage. Présente sur tous les templates print mais bénigne.
- **`@page` global** : impossible de définir des @page différentes par page dans un même document HTML. Les marges `@page` s'appliquent à toutes les pages du document.
- **Diagnostic via console F12** : `document.body.offsetWidth` et `document.querySelector('.X').offsetWidth` avec "Emulate CSS media type = print" activé dans Rendering. Comparer entre template qui marche vs cassé.
- **Largeur en `mm`** : préférer les unités physiques pour le print plutôt que les pixels. Mais attention, ne pas forcer une largeur plus petite que nécessaire (j'ai introduit moi-même un bug avec `width: 178mm` qui forçait le body à 673px).

### Fichiers modifiés
- `app/print/all/[slug]/page.tsx` : modifications principales (marges `@page`, `.fb-page-wrap` min-height, `.pg-client-addr*` word-break)

### Commits référence
- `fix(print-all): supprimer min-height fiche bleue qui forcait rescale Chrome`
- `fix(print-all): forcer wrap multiligne adresse longue page de garde`
- `feat(print-all): reduire marges @page de 14mm a 8mm pour gagner de l'espace`


---

## Session du 14.05.2026 — Verrouillage lignes Shopify + filet de sécurité « Stock à vérifier »

> Date : 2026-05-14
> Statut : ✅ Terminé et déployé en production
> Architecture : Option 1 (prévention + filet de sécurité, sans changement de logique métier)

### 🎯 Problème initial

Quand un article Shopify importé via le picker était modifié à la volée (titre + SKU pour créer une « fausse variante »), le **niveau de stock du produit d'origine restait affiché** sur tous les documents dynamiques (offre, commande, fiche de travail, etc.) — alors que le SKU custom n'existait plus côté Shopify.

**Pourquoi c'était dangereux** :
- Le client voyait « ✓ En stock (5 pces) » sur une offre commerciale, alors que ce SKU n'existait nulle part
- L'entrepôt voyait « 5 en stock » sur la fiche de travail → erreur de picking garantie
- WinBiz et Make recevaient un payload incohérent (SKU custom + niveau stock fantôme)

**Localisation exacte du bug** : `app/api/offres/[slug]/route.ts`, fonction `refreshStock`, ligne ~120 :

```typescript
return lines.map((line) => {
  if (line.type === "comment" || !line.sku) return line;
  const fresh = skuMap.get(line.sku as string);
  if (!fresh) return line;  // ← BUG : garde silencieusement le stock snapshot obsolète
  // ...
});
```

Quand Shopify ne trouvait pas le SKU (parce qu'il avait été modifié), `fresh` était `undefined` → `return line` → la ligne gardait son `stock` initial figé au moment de l'import. Le commentaire vert « 🔄 Stock en temps réel » devenait donc partiellement mensonger.

### 📐 Décisions architecturales

1. **Prévention dans le formulaire** (workflow correct dès la création) :
   - Nouveau flag `shopifyLocked?: boolean` sur le type `QuoteLine`
   - SKU + titre des lignes Shopify : **readonly avec cadenas visuel** (fond violet pâle)
   - **Prix reste éditable** (flexibilité commerciale pour ajuster une remise client)
   - Stock affiché en lecture seule via `<span>` (jamais éditable côté Shopify)
   - Qté et remise ligne (toggle %−) : éditables comme avant
   - Bouton 📋 **« Dupliquer comme modèle »** visible uniquement sur lignes Shopify :
     - Crée une ligne `type: "custom"` (sans lock)
     - Garde titre, prix, image, qté, remise
     - **Efface** SKU et stock (à saisir manuellement)

2. **Filet de sécurité côté serveur** :
   - Si `refreshStock` ne trouve pas le SKU côté Shopify ET la ligne était locked → `stock: null` au lieu de garder l'ancien
   - Les lignes custom (sans lock) ne sont pas affectées (stock manuel conservé)

3. **Filet de sécurité côté templates** :
   - Quand `isLocked && stock === null` → badge orange `⚠ Stock à vérifier` (ou abrégé sur fiche bleue)
   - Sur tous les templates qui affichent du stock

4. **Fallback rétroactif** sans migration SQL :
   - Détection via `line.id?.startsWith("shopify-")` en plus du flag explicite
   - Les anciennes offres créées avant l'ajout du flag sont automatiquement protégées

5. **Hors périmètre** (décision pragmatique) :
   - Offres `Acceptée`/`Convertie` : stock figé par design (immutabilité offre signée ↔ commande liée)
   - Commandes : stock figé J0 par design (audit, fiches de travail générées au moment de la commande)
   - Pas de migration de données : la feature est transparente pour le passé

### ✅ Phase 1 — Type & flag

**Fichier** : `app/offres/nouveau/page.tsx`

```typescript
type QuoteLine = {
  // ... champs existants
  shopifyLocked?: boolean;  // ← NOUVEAU
};
```

Dans `addShopifyItem()` :
```typescript
setLines((c) => [...c, {
  // ... champs existants
  shopifyLocked: true,  // ← Article Shopify : SKU+titre+stock verrouillés
}]);
```

### ✅ Phase 2 — UI formulaire

**Fichier** : `app/offres/nouveau/page.tsx`

**Détection dans la boucle `.map()`** :
```typescript
const isLocked = line.shopifyLocked === true || line.id?.startsWith("shopify-");
```

**Champs readonly** :
- SKU : `readOnly={isLocked}` + classe `jc-locked-input` + tooltip
- Titre : `readOnly={isLocked}` + classe `jc-locked-input` + tooltip
- Prix : **resté éditable** (changement de plan en cours de session — flexibilité commerciale)

**Bouton 📋 « Dupliquer comme modèle »** (visible uniquement si `isLocked`) :
```jsx
{isLocked && (
  <button className="jc-template-btn" onClick={() => {
    const template: QuoteLine = {
      id: `custom-${Date.now()}`,
      type: "custom",
      image: line.image,
      sku: "",        // ← à saisir
      title: line.title,
      unitPrice: line.unitPrice,
      qty: line.qty,
      stock: null,    // ← à saisir
      lineDiscount: line.lineDiscount,
      // PAS de shopifyLocked → ligne libre
    };
    // ... insertion à idx + 1
  }}>📋</button>
)}
```

**Bonus** : bug « stock one-shot » corrigé sur les lignes custom
- **Avant** : l'input stock devenait un `<span>` dès qu'on tapait une valeur → plus modifiable
- **Après** : input persistant pour les lignes non-locked, `<span>` figé pour les lignes Shopify
- Patch ciblé : la cellule `td-stock` est désormais conditionnelle sur `isLocked`

**CSS ajouté** :
- `.jc-template-btn` (bouton violet 📋)
- `.jc-locked-input` (fond violet pâle, curseur not-allowed, readonly)

### ✅ Phase 3 — Filet de sécurité côté API

**Fichier** : `app/api/offres/[slug]/route.ts`, fonction `refreshStock`

**Changement** : le `return line` silencieux qui gardait le stock obsolète devient une invalidation conditionnelle :

```typescript
if (!fresh) {
  const lineWithLock = line as { shopifyLocked?: boolean; id?: string };
  const wasShopify = lineWithLock.shopifyLocked === true || lineWithLock.id?.startsWith("shopify-");
  if (wasShopify) {
    return { ...line, stock: null, delaiLivraison: undefined };
  }
  return line;  // ligne custom : on garde le stock manuel
}
```

**Important** : ce changement ne touche QUE la branche `refreshStock` (offres en cours). Les branches `isCommande` et `isOffreConvertie` (stock figé) restent inchangées par design.

### ✅ Phase 4 — Templates d'affichage

Le badge « Stock à vérifier » est ajouté **en cas prioritaire** dans la cascade de détection du stock, sans toucher au comportement existant. Pattern uniforme :

```typescript
const lineLock = line as { shopifyLocked?: boolean; id?: string };
const isLocked = lineLock.shopifyLocked === true || lineLock.id?.startsWith("shopify-");

if (isLocked && sn === null && line.stock !== "sur_commande") {
  return <div style={{ color: "#ea580c", ... }}>⚠ Stock à vérifier</div>;
}
// ... cascade existante (isSC, isPartial, isOk)
```

### 📋 Récap fichiers patchés

| # | Fichier | Type de patch | Détails |
|---|---|---|---|
| 1 | `app/offres/nouveau/page.tsx` | Type + UI + CSS | 7 patches : type, addShopifyItem, boucle .map(), SKU readonly, titre readonly, bouton 📋, CSS, bug one-shot stock custom |
| 2 | `app/api/offres/[slug]/route.ts` | API logique | 1 patch : refreshStock invalide `stock: null` si SKU introuvable + ligne locked |
| 3 | `app/offre/[slug]/page.tsx` | Page web client | 1 patch : cas prioritaire `isUnknown` en début de cascade ternaire |
| 4 | `app/print/offre/[slug]/page.tsx` | Template print offre | 1 patch : cas prioritaire dans l'IIFE de calcul du badge stock |
| 5 | `app/print/all/[slug]/page.tsx` | Template jeu complet | 3 patches sur 3 sous-templates : Page 1 (ft-), Page 2 (cc-), Page 5 (fb-) |
| 6 | `app/print/fiche-travail/[slug]/page.tsx` | Template standalone | 1 patch : `<span>—</span>` → badge orange si locked |
| 7 | `app/print/fiche-bleue/[slug]/page.tsx` | Template standalone | 1 patch : idem avec « vérif » abrégé (colonne 60px) |

**Total : ~15 patches sur 7 fichiers**

### 📊 Couverture finale

| Endroit | Status | Comportement si SKU introuvable |
|---|---|---|
| Formulaire `/offres/nouveau` | ✅ | Prévention : impossible de modifier SKU |
| API `/api/offres/[slug]` | ✅ | Renvoie `stock: null` pour lignes locked |
| Page web client `/offre/[slug]` | ✅ | Badge orange `⚠ Stock à vérifier` |
| Print `/print/offre/[slug]` | ✅ | Badge orange `⚠ Stock à vérifier` |
| Print `/print/all/[slug]` Page 1 (Fiche travail) | ✅ | Badge orange `⚠ À vérifier` |
| Print `/print/all/[slug]` Page 2 (Commande) | ✅ | Badge orange `⚠ Stock à vérifier` |
| Print `/print/all/[slug]` Page 3 (Page garde colis) | N/A | Pas de stock affiché |
| Print `/print/all/[slug]` Page 4 (Bulletin livraison) | N/A | Pas de stock affiché |
| Print `/print/all/[slug]` Page 5 (Fiche bleue) | ✅ | Badge orange `⚠ vérif` abrégé |
| Print `/print/fiche-travail/[slug]` standalone | ✅ | Badge orange `⚠ À vérifier` |
| Print `/print/bulletin-livraison/[slug]` standalone | N/A | Pas de stock affiché |
| Print `/print/page-garde-colis/[slug]` standalone | N/A | Pas de stock affiché |
| Print `/print/fiche-bleue/[slug]` standalone | ✅ | Badge orange `⚠ vérif` abrégé |

### 🐛 Pièges rencontrés

#### Modification du plan en cours de session
Initialement on avait verrouillé **aussi le prix** (option 1 stricte). En cours d'application, choix de **laisser le prix éditable** pour permettre les ajustements commerciaux ponctuels (remise client négociée). Le SKU reste la clé technique (liaison Shopify), le titre la cohérence de présentation, mais le prix est un paramètre commercial qui change souvent — le verrouiller obligerait à passer par « Dupliquer comme modèle » à chaque négo, trop lourd.

#### Bug « one-shot » sur stock des lignes custom (préexistant)
Cellule `td-stock` avait une condition `{line.stock === null ? <input/> : <span/>}`. Dès qu'on tapait une valeur, l'input devenait un span, plus modifiable. Corrigé dans le même commit en rendant l'input persistant pour les lignes non-locked.

#### Anciennes offres avec SKU modifié et statut signé
Le filet de sécurité ne couvre QUE les offres en cours (branche `refreshStock`). Les offres `Acceptée`/`Convertie` et les `Commande` gardent leur stock figé par design métier (immutabilité audit + cohérence offre signée ↔ commande liée). Décision pragmatique : on n'a pas patché ces branches, les très rares cas problématiques d'anciennes offres restent en l'état (« c'est l'histoire »).

#### Templates `all` vs standalone
Le fichier `print/all/[slug]` contient en réalité **5 sous-templates fusionnés** (préfixes `ft-`, `cc-`, `pg-`, `bl-`, `fb-`). On a patché chaque sous-template séparément, puis les fichiers standalone équivalents (`/print/fiche-travail/[slug]` et `/print/fiche-bleue/[slug]`). Cohérence visuelle garantie : même couleur orange `#ea580c` partout.

#### Largeur de colonne fiche bleue
Sur la fiche bleue (`.fb-td-stock-bleue { width: 60px }`), le texte « À vérifier » débordait. Utilisé « vérif » abrégé à la place. Si plus tard tu veux changer ce libellé, garde l'abréviation ou élargis la colonne d'abord.

### 🔧 Maintenance future

#### Pour ajouter un nouveau verrouillage de champ
Suivre le même pattern : ajouter `readOnly={isLocked}` + classe `jc-locked-input` + tooltip explicatif. La détection `isLocked` est déjà disponible dans la boucle `.map()`.

#### Pour étendre le filet « Stock à vérifier » à un nouveau template
1. Copier le pattern de détection :
```typescript
   const lineLock = line as { shopifyLocked?: boolean; id?: string };
   const isLocked = lineLock.shopifyLocked === true || lineLock.id?.startsWith("shopify-");
```
2. Ajouter le cas prioritaire **en début de cascade** :
```typescript
   if (isLocked && stockNull && line.stock !== "sur_commande") {
     return <badge orange "⚠ Stock à vérifier">;
   }
```
3. Garder le reste de la cascade intact

#### Si on veut renforcer le typage (cosmétique)
Pour éliminer les `(line as any).shopifyLocked` qui restent dans les templates standalone (`fiche-travail/[slug]`, `fiche-bleue/[slug]`) :
- Patcher leur type `QuoteLine` local pour ajouter `shopifyLocked?: boolean`
- Le code fonctionne déjà, c'est juste pour la propreté

#### Si on veut couvrir les anciennes offres signées (NON recommandé)
Cela demanderait de modifier les branches `isCommande` et `isOffreConvertie` dans `refreshStock`, ce qui casserait le principe d'immutabilité des offres signées. Plutôt : corriger manuellement en SQL les rares cas problématiques :
```sql
UPDATE offres SET data = jsonb_set(data, '{lines,N,stock}', 'null'::jsonb)
WHERE slug = 'dev-2025-XXX' AND ...;
```

#### Pattern réutilisable pour d'autres champs verrouillables
Ce pattern (Option 1 — prévention + filet) peut être réappliqué pour d'autres champs futurs :
- `image` Shopify verrouillée
- `mediaUrl` lignes média locked
- N'importe quel champ qui doit refléter une source de vérité externe (Shopify, Make, WinBiz)

### 🚦 Commits référence



markdown## Session du 13.05.2026 (suite) — Recherche par numéro de document, affichage compteurs, anti-autofill, page de garde client

> Date : 2026-05-13
> Statut : ✅ Déployé en production
> Architecture : ajouts non destructifs sur pages clients (Option 1 strict — pas de migration SQL nécessaire, les tables `factures_winbiz` et `commandes_shopify` existaient déjà avec les bonnes colonnes)

### 🎯 Objectifs de la session

1. Pouvoir retrouver un client depuis un numéro de facture WinBiz, un numéro de commande Shopify, un DEV-XXXX ou CMD-XXXXX
2. Afficher directement dans la liste clients les numéros de documents liés pour identification visuelle rapide
3. Mettre en évidence les lignes qui matchent une recherche par numéro de document
4. Fix UX : dropdown autocomplete `/dashboard/clients` (modal nouveau client) impossible à fermer
5. Fix UX : Chrome propose l'autofill (adresse perso du commercial) sur la page d'édition de fiche client
6. Ajouter un bouton "Page de garde adresse" pour imprimer une A4 avec adresse client sans passer par une commande
7. Ajouter un bouton "Copier adresse" sur la fiche client (facturation + livraison séparées)

### 📐 Décisions architecturales

1. **2 barres de recherche séparées** sur `/dashboard/clients` plutôt qu'une barre unique :
   - **Barre client** (bleue) : nom, prénom, société, email, NPA, ville, téléphone, n° client
   - **Barre document** (violette) : n° facture WinBiz, n° commande Shopify (#1234), DEV-XXX, CMD-XXX
   - **Raison** : éviter la collision `1800` (NPA Vevey vs n° facture 1800 vs commande Shopify #1800). Tous les NPA suisses étant des nombres à 4 chiffres, une recherche unique générait du bruit ingérable.

2. **Paramètre `mode=document` côté API** pour bascule sans ambiguïté côté serveur. Si `mode === "document"` : on cherche UNIQUEMENT dans `factures_winbiz.numero_facture`, `commandes_shopify.shopify_order_name`/`shopify_order_number`, et `offres.numero_offre`/`numero_commande`. Pas de fallback sur la table `clients`.

3. **Affichage des numéros de documents dans 2 colonnes du tableau** :
   - 📄 **Offres / 🛒 Commandes** (internes Jardin-Confort) : badges ambre + emerald
   - 📊 **WinBiz / 🛍️ Shopify** (externes) : badges violet + orange
   - Max 3 numéros visibles par catégorie, bouton "+N" pour étendre, bouton "réduire" pour replier
   - Le numéro qui matche la recherche est highlighté (ring coloré + bg renforcé)
   - Tri front : les lignes avec match remontent en premier (filet de sécurité côté JS)
   - **Toute la ligne** prend un fond violet pâle + bordure gauche violette épaisse + badge "🎯 MATCH" qui pulse à gauche du n° client

4. **Composant `PrintAddressButton` réutilisable** (`components/PrintAddressButton.tsx`) :
   - Variante `compact` pour la liste clients, normale pour la fiche
   - Si pas d'adresse de livraison → ouvre directement la page facturation
   - Si adresse de livraison existe → popup avec 2 choix (Facturation / Livraison)

5. **Template `print/page-garde-client/[id]`** : copie design exacte de `/print/page-garde-colis/[slug]` mais charge un client par ID au lieu d'une offre par slug
   - Query param `?addr=facturation|livraison`
   - Toggle visible à l'écran (caché à l'impression) pour basculer Facturation/Livraison
   - Pas de bloc "infos commande" en bas (puisqu'il n'y a pas de commande)
   - Mention discrète "Adresse de facturation · Client CL-22094" en pied de page

### ✅ Phase 1 — Recherche par numéro de document (API)

**Fichier** : `app/api/clients/route.ts`

Bonne surprise : la fonction `searchByDocumentNumber()` existait déjà dans le code (elle gérait `DEV-`, `CMD-`, et les numéros purs). Il ne manquait que la **branche `mode=document`** qui court-circuite la cascade existante.

**Patch ajouté** au début de la fonction `GET`, avant la logique existante :

```typescript
const mode = request.nextUrl.searchParams.get("mode") || "client"

if (mode === "document") {
  const docResults = await searchByDocumentNumber(q, limit)
  const { count } = await supabaseAdmin
    .from("clients")
    .select("*", { count: "exact", head: true })

  if (docResults && docResults.length > 0) {
    const enriched = await enrichWithCounts(docResults)
    return NextResponse.json({ clients: enriched, total: count || 0, matchedBy: "document" })
  }
  return NextResponse.json({ clients: [], total: count || 0, matchedBy: "document" })
}
```

### ✅ Phase 2 — Affichage numéros de documents dans la liste

**Fichier** : `app/api/clients/route.ts` (extension `enrichWithCounts`)

#### 2a — Type `ClientWithCounts` étendu

Ajout de 4 tableaux `nums_*` (max 10 par catégorie) à côté des compteurs `nb_*` existants :

```typescript
type DocRef = { num: string; date?: string | null }

type ClientWithCounts = Client & {
  nb_offres: number
  nb_commandes_internes: number
  nb_commandes_shopify: number
  nb_factures_winbiz: number
  nums_offres: DocRef[]
  nums_commandes_internes: DocRef[]
  nums_shopify: DocRef[]
  nums_factures_winbiz: DocRef[]
}
```

#### 2b — Fonction `fetchClientIdCountsByIn` refactorisée

Retourne maintenant `{ counts, nums }` au lieu d'un simple `counts`. Ajout d'`.order(dateField, { ascending: false })` pour garder les numéros les plus récents en premier.

**Index Postgres optionnels** suggérés pour performance future :
```sql
CREATE INDEX IF NOT EXISTS factures_winbiz_client_date_idx ON factures_winbiz(client_id, date_facture DESC);
CREATE INDEX IF NOT EXISTS commandes_shopify_client_date_idx ON commandes_shopify(client_id, created_at_shopify DESC);
```
(Non créés pour l'instant — à faire seulement si la liste devient lente sur ~18 911 clients)

#### 2c — Type `OffreRow` et `tallyOffre` étendus

Ajout des champs `numero_affiche`, `numero_offre`, `numero_commande`, `date_document` dans le SELECT et dans la map des offres :

```typescript
function tallyOffre(map, clientId, o) {
  const entry = map.get(clientId) || { offres: 0, commandes: 0, numsOffres: [], numsCommandes: [] }
  const isCmd = o.type_document === "Commande" || o.statut === "Acceptée" || o.statut === "Convertie"
  const num = o.numero_affiche || o.numero_commande || o.numero_offre || ""
  // ... stocke dans entry.numsOffres ou entry.numsCommandes
}
```

3 occurrences du `.select("client_numero_client, client_email, ...")` mises à jour pour inclure les 4 nouveaux champs.

### ✅ Phase 3 — UI 2 barres + highlight lignes match

**Fichier** : `app/dashboard/clients/page.tsx`

#### 3a — States ajoutés
```typescript
const [searchDoc, setSearchDoc] = useState("")
const [activeSearch, setActiveSearch] = useState("client")
```

#### 3b — `fetchClients` accepte un paramètre `mode`
```typescript
const fetchClients = useCallback(async (q: string, mode: "client" | "document" = "client") => {
  const url = mode === "document"
    ? `/api/clients?q=${encodeURIComponent(q)}&limit=100&mode=document`
    : `/api/clients?q=${encodeURIComponent(q)}&limit=100`
  // ...
}, [])
```

#### 3c — useEffect réagit aux 2 barres
La barre active (`activeSearch`) détermine quel mode est utilisé. Quand on tape dans une barre, l'autre se vide automatiquement.

#### 3d — Nouveaux composants
- `DocNum` : badge unitaire avec highlight si match
- `DocsCellInternes` : cellule Offres+Commandes avec tri match-en-premier et "voir +N"
- `DocsCellExternes` : cellule WinBiz+Shopify, même logique
- `clientHasDocumentMatch()` : helper pour détecter si une ligne contient un match (utilisé pour le tri front + le surlignage de toute la ligne)

#### 3e — Mise en évidence des lignes match
Quand `activeSearch === "document"` ET la ligne contient un document qui matche :
- Fond `bg-violet-500/15` + ring violet
- Bordure gauche violette épaisse (4px) via `boxShadow: "inset 4px 0 0 0 rgb(167 139 250)"`
- Badge "🎯 MATCH" qui pulse à gauche du n° client
- Lignes match triées en premier dans la liste

### 🐛 Pièges rencontrés Phase 1-3

#### Build cassé sur `activeSearch` indéfini
Application des patches dans le mauvais ordre — les composants `DocsCellInternes/Externes` ont été ajoutés avant les states `searchDoc/activeSearch`. **Fix** : appliquer **dans l'ordre** : (1) états & types, (2) fonctions de fetch, (3) composants, (4) JSX qui les utilise.

#### Signature `fetchClients` non mise à jour
`fetchClients(searchDoc, "document")` appelé alors que la fonction n'acceptait qu'un argument. **Fix** : étendre la signature à `(q: string, mode: "client" | "document" = "client")` avant d'appeler avec 2 paramètres.

#### Confusion PowerShell vs SQL Editor Supabase
Une requête SQL exécutée par erreur dans PowerShell → `Le mot clé « from » n'est pas pris en charge`. Rappel : SQL → **Supabase Dashboard → SQL Editor**, jamais PowerShell.

### ✅ Phase 4 — Fix UX dropdown autocomplete sur modal "Nouveau client"

**Fichier** : `app/dashboard/clients/page.tsx`

Le dropdown qui suggère les clients existants (sur les champs Nom, Email, Tél du modal "Nouveau client") n'avait **aucun moyen de fermeture fiable** :
- Le `onBlur={closeClientDropdown}` avec `setTimeout(200)` était capricieux
- Le bouton "Créer quand même" était la seule sortie évidente

**Solution** (cohérente avec ce qui a été fait sur `/offres/nouveau` il y a quelques sessions) :

1. **Touche Esc** au clavier → `useEffect` qui écoute `keydown` global quand des suggestions sont affichées
2. **Clic extérieur** → `useEffect` qui écoute `mousedown` avec délai de 50ms pour ne pas intercepter le clic qui a ouvert le dropdown
3. **Bouton ❌ rouge** en haut-droite du dropdown (`absolute -top-2 -right-2`)
4. **Vidange auto du champ** → si le champ devient vide, `closeClientDropdown()` immédiat

`closeClientDropdown()` simplifié à `setClientSuggestions([])` + `setClientSuggestIndex(-1)` (sans setTimeout).

Ref `clientDropdownRef` ajoutée sur les 3 dropdowns (Nom, Tél, Email) pour détecter le clic extérieur.

### ✅ Phase 5 — Fix anti-autofill sur édition fiche client

**Fichier** : `app/dashboard/clients/[id]/page.tsx`

Chrome (et tous les navigateurs modernes) propose en autofill l'adresse personnelle enregistrée du commercial sur les champs Rue/NPA/Ville/Email/Tél de l'édition de fiche client. Très gênant en pratique.

**Astuce technique** (combinaison qui marche partout) :

1. **Piège anti-autofill** au début du bloc d'édition :
```jsx

  
  

```
Le navigateur remplit ces 2 champs cachés (qu'il considère prioritaires pour des identifiants login/password) au lieu des vrais champs adresse.

2. **3 attributs sur chaque input** d'édition (21 inputs au total — facturation + livraison + notes) :
```jsx
autoComplete="new-password"
name="f-XXX"  // nom imprévisible non standard
data-form-type="other"
```

`autoComplete="new-password"` est l'astuce clé : c'est le seul mode où Chrome refuse systématiquement d'autofill (sinon il propose toujours malgré `autoComplete="off"` depuis 2020+).

### 🐛 Pièges rencontrés Phase 5

#### Patches déjà partiellement appliqués
Le piège anti-autofill et le champ Nom avaient déjà reçu les attributs. Solution : patcher les 20 autres champs **un par un** avec cherche/remplace exact pour chacun, car chaque champ a des indentations différentes (2-spaces vs 4-spaces vs nested grids).

#### Confusion sur le fichier
Premier patch tenté sur `app/page.tsx` (homepage Next.js !) au lieu de `app/dashboard/clients/[id]/page.tsx`. Rappel : l'URL `/dashboard/clients/22094` correspond au pattern `app/dashboard/clients/[id]/page.tsx`.

### ✅ Phase 6 — Bouton "Page de garde adresse" + nouveau template print

**Fichiers créés** :

#### 6a — `components/PrintAddressButton.tsx`

Composant React réutilisable avec 2 variantes :
- **Normal** (sur fiche client) : bouton violet large `📦 Page garde`
- **Compact** (sur liste clients) : bouton violet petit

Logique :
- Si client a une `livr_rue` → popup avec 2 choix : 📍 Facturation / 📦 Livraison
- Sinon → ouvre directement `?addr=facturation`
- Overlay fixed pour fermer au clic extérieur

#### 6b — `app/print/page-garde-client/[id]/page.tsx`

Template print **copie quasi exacte** de `app/print/page-garde-colis/[slug]/page.tsx` avec ces différences :

| Aspect | Original `/page-garde-colis/[slug]` | Nouveau `/page-garde-client/[id]` |
|---|---|---|
| Source data | `/api/offres/${slug}` (offre) | `/api/clients/${id}` (client) |
| Sélection adresse | `data.livrDiff` (auto) | Query param `?addr=facturation\|livraison` |
| Bloc bas | N° commande, date, expédition, commercial, accès | Mention discrète "Adresse X · Client CL-22094" |
| Toggle écran | N/A | Boutons "📍 Facturation / 📦 Livraison" en haut-gauche (cachés à l'impression via `@media print`) |
| Design | Logo Jardin-Confort vertical + adresse client format enveloppe + barre bleue | **Identique** |

#### 6c — Intégrations

**Liste clients** (`app/dashboard/clients/page.tsx`) :
- Import du composant
- `<PrintAddressButton client={c} compact />` dans la colonne Actions, avant le bouton "+ Offre"

**Fiche client** (`app/dashboard/clients/[id]/page.tsx`) :
- Import du composant
- `<PrintAddressButton client={client} />` après "+ Nouvelle offre" dans la barre de navigation du header

### ✅ Phase 7 — Bouton "Copier adresse" sur fiche client

**Fichier** : `app/dashboard/clients/[id]/page.tsx`

Demande utilisateur : pouvoir copier l'adresse dans le presse-papier en 1 clic pour la coller dans un email, un GPS, une étiquette, etc.

**State ajouté** :
```typescript
const [addrCopied, setAddrCopied] = useState(null)
```

**Fonction `copyAddress()`** : construit un tableau de lignes à partir des champs, filtre les vides avec un type guard `(l): l is string`, joint avec `\n`, copie via `navigator.clipboard.writeText()`, met le feedback "✓ Copiée" 2 secondes.

Format produit :
Société (si présente)
Nom Prénom
Complément nom (si présent)
Rue Numéro
Complément d'adresse (rue2, si présent)
NPA Ville

**Boutons ajoutés dans le bloc Coordonnées** :
- `📋 Copier adresse` (toujours visible)
- `📦 Copier livraison` (visible seulement si `client.livr_rue` est renseigné)

### 🐛 Piège ergonomique Phase 7

**Premier essai** : 3 boutons sur la même ligne que le titre `Coordonnées` (Copier + Livraison + Modifier). Sur la colonne 400px, le texte "📋 Copier adresse" passait sur 2 lignes et chevauchait le titre.

**Faux fix tenté** : `whitespace-nowrap` pour forcer sur 1 ligne. → Pire encore, les boutons larges débordaient la colonne.

**Vrai fix appliqué** : sortir les boutons sur une **ligne séparée** sous le titre :

```jsx
<div className="mb-4">
  <div className="flex items-center justify-between gap-3">
    <h2>Coordonnées</h2>
    {editing && (<boutons Enregistrer/Annuler à droite/>)}
  </div>
  {!editing && (
    <div className="mt-3 flex flex-wrap gap-2">
      <button>📋 Copier adresse</button>
      {client.livr_rue && <button>📦 Copier livraison</button>}
      <button>✏️ Modifier</button>
    </div>
  )}
</div>
```

Le titre `Coordonnées` reste tranquille sur sa ligne, les 3 boutons s'alignent dessous avec assez de place pour tenir. Sur mobile, ils wrappent naturellement.

Les boutons Enregistrer/Annuler restent à droite du titre pendant l'édition car ils sont courts.

### 📋 Récap fichiers patchés cette session

| # | Fichier | Type | Détails |
|---|---|---|---|
| 1 | `app/api/clients/route.ts` | Backend | Ajout `mode=document` + extension `enrichWithCounts` avec numéros de documents |
| 2 | `app/dashboard/clients/page.tsx` | Frontend | 2 barres de recherche, composants `DocNum`/`DocsCellInternes`/`DocsCellExternes`, surlignage lignes match, fix dropdown autocomplete (Esc + clic ext + bouton ❌), intégration `PrintAddressButton` |
| 3 | `app/dashboard/clients/[id]/page.tsx` | Frontend | Anti-autofill sur 21 inputs édition, intégration `PrintAddressButton`, boutons Copier adresse/Livraison |
| 4 | `components/PrintAddressButton.tsx` | Nouveau | Composant réutilisable (compact + normal) |
| 5 | `app/print/page-garde-client/[id]/page.tsx` | Nouveau | Template print A4 page de garde client sans commande |

### 🎉 Statut

| Phase | Statut |
|---|---|
| Phase 1 — Backend recherche document | ✅ |
| Phase 2 — Affichage numéros documents | ✅ |
| Phase 3 — UI 2 barres + highlight match | ✅ |
| Phase 4 — Fix dropdown autocomplete | ✅ |
| Phase 5 — Anti-autofill édition fiche | ✅ |
| Phase 6 — Page de garde client | ✅ |
| Phase 7 — Copier adresse | ✅ |

### 🔧 Maintenance future

#### Performance liste clients
Sur 18 911 clients, l'enrichissement avec compteurs + numéros pour 100 clients affichés tient en < 2s (mesuré). Si ça ralentit :
1. Créer les index suggérés (`factures_winbiz_client_date_idx` et `commandes_shopify_client_date_idx`)
2. Ou retirer `.order(dateField, { ascending: false })` dans `fetchClientIdCountsByIn` (ordre arbitraire, mais c'est OK puisqu'on prend juste les 10 premiers)

#### À ne pas oublier
**Le piège anti-autofill (`<input name="username" />` + `<input name="password" />` cachés au début du bloc)** doit être placé **dans le bloc d'édition uniquement**, pas dans le bloc display. Sinon Chrome essaie de remplir des champs invisibles à chaque chargement de page.

#### Pattern réutilisable
Pour ajouter un nouveau type de document recherchable (ex : factures Shopify si on en stocke un jour) :
1. Ajouter la table dans `fetchClientIdCountsByIn` (élargir le type union `table`)
2. Ajouter une branche dans `searchByDocumentNumber` qui détecte le préfixe et match dans la nouvelle table
3. Ajouter le tableau `nums_xxx` dans `ClientWithCounts` et dans l'assemblage final
4. Ajouter le badge color dans `DocsCellExternes` (ou créer une 3ème cellule)

### 🚦 Commits référence
feat(clients): 2 barres recherche separees client vs document + mode API
feat(clients): affichage numeros documents par categorie + highlight match recherche
feat(clients): mise en evidence visible des lignes qui matchent recherche document
fix(clients/new): dropdown suggestions fermable avec Esc, clic exterieur et bouton X
fix(client/edit): autocomplete=new-password sur tous les champs (anti autofill Chrome)
feat(clients): bouton page garde adresse + template print client sans commande
feat(client): bouton copier adresse facturation et livraison sur fiche
fix(client): boutons coordonnees sur ligne separee pour eviter chevauchement


