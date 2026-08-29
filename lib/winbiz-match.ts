// lib/winbiz-match.ts
// ─────────────────────────────────────────────────────────────────────────────
// Chantier « Export Winbiz » — attribution client : module PUR.
// Aucune E/S : la route fournit les candidats (lignes de winbiz_adresses du
// même exercice et du même NPA), ce module décide.
//
// Règles (cadrage §6.2 + acquis du 29.08 sur le fichier réel) :
// - Le fichier d'adresses Winbiz ne porte NI téléphone NI e-mail : le seul
//   match fort est nom + prénom + NPA normalisés ; la rue sert de départage.
// - JAMAIS de choix silencieux entre deux fiches : zéro ou plusieurs candidats
//   non départagés → repli 999 avec la raison consignée (doublons Winbiz
//   documentés, P2-12 : Graz ×7, GRUNINGER ×5…).
// - Cas société sans personne (694 fiches du fichier réel n'ont qu'une
//   société) : match societe + NPA, UNIQUEMENT quand la commande n'a pas de
//   nom de personne — jamais en second choix derrière un nom qui n'a pas
//   matché. À valider à l'usage (décision de session du 29.08).
// - Relevé du fichier réel du 29.08 : 1 823 fiches sur 8 664 SANS code
//   (inutilisables — écartées à l'import), 2 codes portés par deux fiches
//   chacun (35, 1000 — écartés à l'import : un code ambigu ne doit jamais
//   pouvoir être attribué), 19 noms avec espace de tête, 79 NPA étrangers.
// ─────────────────────────────────────────────────────────────────────────────

export type AdresseWinbiz = {
  code: string;
  societe: string | null;
  nom: string | null;
  prenom: string | null;
  rue: string | null;
  npa: string | null;
  ville: string | null;
};

export type ClientCommande = {
  societe: string;
  nom: string;
  prenom: string;
  /** rue + numéro, tels que portés par la commande */
  rue: string;
  npa: string;
};

export type MatchResultat =
  | {
      type: "code";
      code: string;
      source: "nom_prenom_npa" | "nom_prenom_npa_rue" | "societe_npa";
      /** « attribuée à 1234 — DUPONT Jean (nom+prénom+NPA) » */
      libelle: string;
    }
  | {
      type: "repli";
      matchType: "repli_aucun" | "repli_ambigu";
      raison: string;
    };

// ── Normalisations ──
// Même esprit que jc_norm (lower + unaccent) côté SQL, avec en plus l'écrasement
// des espaces/tirets/apostrophes — le matcher travaille en JS sur des candidats
// pré-filtrés par NPA, il est donc seul juge de l'égalité des noms.

export function normCle(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s\-'’.]+/g, " ")
    .trim();
}

export function normNpa(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, "").trim();
}

// ── Préparation du fichier importé ──
// Utilisée par la route d'upload (et par ses tests) : trim, exclusion des
// fiches sans code et des codes portés par plusieurs fiches.

export type LigneFichier = {
  code: string;
  societe: string;
  nom: string;
  prenom: string;
  rue: string;
  npa: string;
  ville: string;
};

export type PreparationResultat = {
  adresses: LigneFichier[];
  /** nb de fiches écartées faute de code adresse */
  sansCode: number;
  /** codes portés par plusieurs fiches — toutes leurs fiches sont écartées */
  codesDupliques: string[];
};

export function preparerAdresses(brutes: Array<Partial<LigneFichier>>): PreparationResultat {
  const nettoyees: LigneFichier[] = brutes.map((b) => ({
    code: (b.code ?? "").trim(),
    societe: (b.societe ?? "").trim(),
    nom: (b.nom ?? "").trim(),
    prenom: (b.prenom ?? "").trim(),
    rue: (b.rue ?? "").trim(),
    npa: normNpa(b.npa),
    ville: (b.ville ?? "").trim(),
  }));

  const sansCode = nettoyees.filter((l) => l.code === "").length;
  const avecCode = nettoyees.filter((l) => l.code !== "");

  const compte = new Map<string, number>();
  for (const l of avecCode) compte.set(l.code, (compte.get(l.code) ?? 0) + 1);
  const codesDupliques = [...compte.entries()].filter(([, n]) => n > 1).map(([c]) => c).sort();
  const dupSet = new Set(codesDupliques);

  return {
    adresses: avecCode.filter((l) => !dupSet.has(l.code)),
    sansCode,
    codesDupliques,
  };
}

// ── Le matcher ──

export function matchClient(client: ClientCommande, candidatsNpa: AdresseWinbiz[]): MatchResultat {
  const npaC = normNpa(client.npa);
  const nomC = normCle(client.nom);
  const prenomC = normCle(client.prenom);
  const societeC = normCle(client.societe);
  const rueC = normCle(client.rue);

  if (!npaC) {
    return { type: "repli", matchType: "repli_aucun", raison: "la commande n'a pas de NPA" };
  }
  if (!nomC && !societeC) {
    return { type: "repli", matchType: "repli_aucun", raison: "la commande n'a ni nom ni société" };
  }

  // Défense en profondeur : refiltrer par NPA même si la route l'a déjà fait.
  const candidats = candidatsNpa.filter((a) => normNpa(a.npa) === npaC && (a.code ?? "").trim() !== "");

  const libellePour = (a: AdresseWinbiz, critere: string): string => {
    const qui = [a.societe, [a.nom, a.prenom].filter(Boolean).join(" ")].filter((s) => (s ?? "").trim()).join(" / ");
    return `attribuée à ${a.code} — ${qui} (${critere})`;
  };

  if (nomC) {
    // Match fort : nom + prénom + NPA. Rien d'autre (pas d'e-mail ni de
    // téléphone dans le fichier — acquis du 29.08, ne pas compter dessus).
    const forts = candidats.filter(
      (a) => normCle(a.nom) === nomC && normCle(a.prenom) === prenomC
    );
    if (forts.length === 1) {
      return { type: "code", code: forts[0]!.code, source: "nom_prenom_npa", libelle: libellePour(forts[0]!, "nom+prénom+NPA") };
    }
    if (forts.length > 1) {
      // Départage par la rue — égalité normalisée stricte, jamais d'à-peu-près.
      const parRue = rueC ? forts.filter((a) => normCle(a.rue) === rueC) : [];
      if (parRue.length === 1) {
        return { type: "code", code: parRue[0]!.code, source: "nom_prenom_npa_rue", libelle: libellePour(parRue[0]!, "nom+prénom+NPA+rue") };
      }
      return {
        type: "repli",
        matchType: "repli_ambigu",
        raison: `${forts.length} fiches Winbiz pour ce nom+prénom+NPA (codes ${forts.map((a) => a.code).join(", ")}) — rue non départageante`,
      };
    }
    // 0 candidat par le nom : pas de rattrapage par la société quand la
    // commande porte un nom de personne — un « second choix » silencieux est
    // exactement ce que la règle interdit.
    return { type: "repli", matchType: "repli_aucun", raison: "aucune fiche Winbiz pour ce nom+prénom+NPA" };
  }

  // Commande sans nom de personne → match société + NPA.
  const societes = candidats.filter((a) => normCle(a.societe) === societeC && societeC !== "");
  if (societes.length === 1) {
    return { type: "code", code: societes[0]!.code, source: "societe_npa", libelle: libellePour(societes[0]!, "société+NPA") };
  }
  if (societes.length > 1) {
    const parRue = rueC ? societes.filter((a) => normCle(a.rue) === rueC) : [];
    if (parRue.length === 1) {
      return { type: "code", code: parRue[0]!.code, source: "societe_npa", libelle: libellePour(parRue[0]!, "société+NPA+rue") };
    }
    return {
      type: "repli",
      matchType: "repli_ambigu",
      raison: `${societes.length} fiches Winbiz pour cette société+NPA (codes ${societes.map((a) => a.code).join(", ")})`,
    };
  }
  return { type: "repli", matchType: "repli_aucun", raison: "aucune fiche Winbiz pour cette société+NPA" };
}
