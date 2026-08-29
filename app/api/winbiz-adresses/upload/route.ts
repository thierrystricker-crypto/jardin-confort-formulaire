// app/api/winbiz-adresses/upload/route.ts
// Chantier « Export Winbiz » — chargement du fichier clients Winbiz.
//
// POST { exercice, adresses: [{code, societe, nom, prenom, rue, npa, ville}] }
//
// Le fichier .xls est parsé CÔTÉ NAVIGATEUR (page /dashboard/winbiz-adresses) :
// l'export Winbiz réel pèse ~15 Mo, au-dessus du plafond de corps Vercel
// (~4,5 Mo, doc 04 §5 ter) — seules les 7 colonnes utiles montent ici (~1 Mo).
//
// Règles d'import (relevé du fichier réel du 29.08.2026) :
// - fiches sans code adresse : écartées (1 823 sur 8 664 — jamais matchables) ;
// - codes portés par plusieurs fiches : TOUTES leurs fiches écartées (codes 35
//   et 1000 dans le fichier réel) — un code ambigu ne doit jamais être
//   attribuable ; les codes écartés sont restitués dans la réponse ;
// - chaque upload REMPLACE l'exercice concerné (delete puis insert par lots).
//
// N'écrit QUE dans winbiz_adresses. Route INTERNE (verrou proxy.ts).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { preparerAdresses, type LigneFichier } from "@/lib/winbiz-match";

const MAX_LIGNES = 30000;
const TAILLE_LOT = 1000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const exercice = Number(body?.exercice);
    const brutes = body?.adresses;

    if (!Number.isInteger(exercice) || exercice < 2014 || exercice > 2100) {
      return NextResponse.json({ error: `Exercice invalide : « ${body?.exercice} »` }, { status: 400 });
    }
    if (!Array.isArray(brutes) || brutes.length === 0) {
      return NextResponse.json({ error: "Aucune adresse reçue" }, { status: 400 });
    }
    if (brutes.length > MAX_LIGNES) {
      return NextResponse.json({ error: `${brutes.length} lignes reçues — plafond ${MAX_LIGNES}` }, { status: 400 });
    }

    // Assainissement champ par champ : on ne stocke jamais le payload tel quel.
    const bornees = (brutes as Array<Record<string, unknown>>).map((b) => ({
      code: texte(b.code, 15),
      societe: texte(b.societe, 200),
      nom: texte(b.nom, 200),
      prenom: texte(b.prenom, 200),
      rue: texte(b.rue, 200),
      npa: texte(b.npa, 20),
      ville: texte(b.ville, 200),
    }));

    // Même logique pure que les tests : trim, sans-code écartés, codes dupliqués écartés.
    const { adresses, sansCode, codesDupliques } = preparerAdresses(bornees);
    if (adresses.length === 0) {
      return NextResponse.json({ error: "Aucune fiche exploitable (toutes sans code ?)" }, { status: 400 });
    }

    // Remplacement de l'exercice : on compte l'existant, on efface, on insère.
    const { count: avant } = await supabaseAdmin
      .from("winbiz_adresses")
      .select("id", { count: "exact", head: true })
      .eq("exercice", exercice);

    const { error: delError } = await supabaseAdmin
      .from("winbiz_adresses")
      .delete()
      .eq("exercice", exercice);
    if (delError) {
      return NextResponse.json({ error: `Effacement de l'exercice ${exercice} : ${delError.message}` }, { status: 500 });
    }

    // Insertion par lots courts — un gros lot sur table indexée rend des
    // statement timeout (57014), leçon des tables mails et factures_winbiz_lignes.
    let inserees = 0;
    for (let i = 0; i < adresses.length; i += TAILLE_LOT) {
      const lot = adresses.slice(i, i + TAILLE_LOT).map((a: LigneFichier) => ({
        exercice,
        code: a.code,
        societe: a.societe || null,
        nom: a.nom || null,
        prenom: a.prenom || null,
        rue: a.rue || null,
        npa: a.npa || null,
        ville: a.ville || null,
        raw: a,
      }));
      const { error: insError } = await supabaseAdmin.from("winbiz_adresses").insert(lot);
      if (insError) {
        // Ne rien maquiller : l'exercice est à moitié chargé, on le dit, et un
        // nouvel upload remplace proprement (delete + insert).
        return NextResponse.json(
          {
            error:
              `Insertion interrompue au lot ${Math.floor(i / TAILLE_LOT) + 1} (${inserees} fiches écrites) : ` +
              `${insError.message}. Recharger le fichier pour repartir propre.`,
          },
          { status: 500 }
        );
      }
      inserees += lot.length;
    }

    return NextResponse.json({
      exercice,
      recues: brutes.length,
      inserees,
      ecartees_sans_code: sansCode,
      codes_dupliques_ecartes: codesDupliques,
      remplacees: avant ?? 0,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function texte(v: unknown, max: number): string {
  return String(v ?? "").slice(0, max);
}
