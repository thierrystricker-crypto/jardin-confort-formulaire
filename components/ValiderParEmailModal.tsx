"use client";

// Valider une offre acceptée PAR E-MAIL (26.10.2026).
//
// Le client a dit oui par mail, sans passer par la signature en ligne. Plutôt
// que de signer à sa place (une fausse signature sur une preuve), le vendeur
// valide ici : même route que la signature en ligne (/api/offres/[slug]/valider),
// en mode "email". Résultat :
//   • la commande CMD est créée, stock décrémenté, PDF / QR / fiche générés ;
//   • le webhook Make PART : le client reçoit son mail de confirmation + QR ;
//   • aucun tracé : le document porte « Validé par e-mail » sur la ligne de
//     signature, avec la date de l'accord et le nom du client ;
//   • le vendeur qui a validé est enregistré (data.valide_par).
// La route refuse ce mode sans le cookie vendeur (elle est publique).

import React, { useEffect, useState } from "react";

// Même clé que CorrectionConfirmModal et ProlongerOffreModal : le nom saisi une fois est repris.
const LOCALSTORAGE_AUTHOR_KEY = "corrections-author";

type Props = {
  open: boolean;
  slug: string;
  numero: string;
  clientEmail: string | null;
  clientNom: string;
  commercial: string | null;
  dateDocument: string | null;
  onClose: () => void;
  onSuccess: (cmdSlug: string) => void;
};

function isoJour(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Fautes de frappe fréquentes dans les domaines. Ce n'est pas une vérification
// (l'adresse peut exister et ne pas être celle du client), seulement un signal
// pour les erreurs les plus courantes. Le vrai garde-fou reste la case
// « adresse vérifiée ».
const DOMAINES_SUSPECTS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com",
  "gmail.ch": "gmail.com", "gmal.com": "gmail.com", "gnail.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.co": "hotmail.com",
  "outlok.com": "outlook.com", "outllook.com": "outlook.com",
  "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com",
  "bluewin.com": "bluewin.ch", "blewin.ch": "bluewin.ch", "bluwin.ch": "bluewin.ch",
  "sunrise.com": "sunrise.ch", "icloud.ch": "icloud.com",
};

function alerteEmail(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return "Le format de cette adresse est invalide.";
  const domaine = email.split("@")[1].toLowerCase();
  if (DOMAINES_SUSPECTS[domaine]) return `Domaine suspect : « ${domaine} » — vouliez-vous dire « ${DOMAINES_SUSPECTS[domaine]} » ?`;
  if (/\.(con|cmo|chh|cg)$/.test(domaine)) return `Terminaison suspecte : « ${domaine} ».`;
  return null;
}

// Contrôle « fils de discussion » : même source que la carte FilsMailsCard
// de la fiche (/api/fils-mails, index du connecteur jardi-mail). L'accord vient
// du CLIENT : on cherche donc un mail REÇU de cette adresse. Aucun mail reçu
// = douteux (adresse mal saisie, ou accord arrivé par une autre adresse).
type VerifFils =
  | { etat: "chargement" }
  | { etat: "erreur"; message: string }
  | { etat: "ok"; nbMails: number; nbRecus: number; dernierRecu: { date: string | null; sujet: string } | null };

type MessageFil = { date: string | null; sens: "entrant" | "sortant"; sujet?: string };
type FilMail = { sujet: string; messages: MessageFil[] };

function jourCH(iso: string): string {
  const [a, m, j] = iso.split("-");
  return a && m && j ? `${j}.${m}.${a}` : iso;
}

export default function ValiderParEmailModal({
  open, slug, numero, clientEmail, clientNom, commercial, dateDocument, onClose, onSuccess,
}: Props) {
  const aujIso = isoJour(new Date());
  const minIso = dateDocument ? dateDocument.slice(0, 10) : "";

  const [dateAccord, setDateAccord] = useState(aujIso);
  const [validePar, setValidePar] = useState("");
  const [confirme, setConfirme] = useState(false);
  const [adresseVerifiee, setAdresseVerifiee] = useState(false);
  const [verifFils, setVerifFils] = useState<VerifFils>({ etat: "chargement" });
  const [doutAssume, setDoutAssume] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    if (!open) return;
    setErreur(""); setEnvoi(false); setConfirme(false); setAdresseVerifiee(false); setDateAccord(isoJour(new Date()));
    let nom = commercial || "";
    try { const s = localStorage.getItem(LOCALSTORAGE_AUTHOR_KEY); if (s) nom = s; } catch { /* */ }
    setValidePar(nom);
  }, [open, commercial]);

  // Recherche des échanges avec cette adresse, à chaque ouverture.
  useEffect(() => {
    if (!open) return;
    setDoutAssume(false);
    const adr = (clientEmail || "").trim();
    if (!adr || adr.startsWith("sans-email.")) return;
    let actif = true;
    setVerifFils({ etat: "chargement" });
    fetch(`/api/fils-mails?email=${encodeURIComponent(adr)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!actif) return;
        if (!r.ok || j?.erreur) {
          setVerifFils({ etat: "erreur", message: j?.erreur || `connecteur : ${r.status}` });
          return;
        }
        const fils: FilMail[] = Array.isArray(j?.fils) ? j.fils : [];
        const recus = fils
          .flatMap((f) => (f.messages || []).filter((m) => m.sens === "entrant").map((m) => ({ date: m.date, sujet: f.sujet })))
          .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        setVerifFils({
          etat: "ok",
          nbMails: typeof j?.total_mails === "number" ? j.total_mails : fils.reduce((s, f) => s + (f.messages?.length || 0), 0),
          nbRecus: recus.length,
          dernierRecu: recus[0] || null,
        });
      })
      .catch((e) => { if (actif) setVerifFils({ etat: "erreur", message: String(e) }); });
    return () => { actif = false; };
  }, [open, clientEmail]);

  const email = (clientEmail || "").trim();
  const emailPresent = !!email && !email.startsWith("sans-email.");
  const alerte = emailPresent ? alerteEmail(email) : null;
  // Format invalide = bloquant. Domaine suspect = avertissement seulement.
  const emailOk = emailPresent && alerte !== "Le format de cette adresse est invalide.";
  const dateOk = !!dateAccord && dateAccord <= aujIso && (!minIso || dateAccord >= minIso);
  // Douteux = aucun mail reçu de cette adresse, ou vérification impossible.
  // Ce n'est pas bloquant (index en retard, accord reçu sur une autre boîte…),
  // mais il faut l'assumer explicitement.
  const douteux = verifFils.etat === "erreur" || (verifFils.etat === "ok" && verifFils.nbRecus === 0);
  const filsOk = verifFils.etat !== "chargement" && (!douteux || doutAssume);
  const peutValider = emailOk && adresseVerifiee && filsOk && dateOk && validePar.trim().length >= 2 && confirme && !envoi;

  async function valider() {
    if (!peutValider) return;
    setEnvoi(true); setErreur("");
    try {
      try { localStorage.setItem(LOCALSTORAGE_AUTHOR_KEY, validePar.trim()); } catch { /* */ }
      const res = await fetch(`/api/offres/${slug}/valider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "email",
          signataire: clientNom || "Client",
          signature_base64: "",
          date_signature: jourCH(dateAccord),
          date_accord_mail: dateAccord,
          valide_par: validePar.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.cmdSlug) { setErreur(json.error || `Erreur ${res.status}`); setEnvoi(false); return; }
      onSuccess(json.cmdSlug);
    } catch (e) {
      setErreur("Erreur réseau : " + (e as Error).message);
      setEnvoi(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !envoi) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#2a2d31] p-6 text-zinc-100 shadow-2xl">
        <h2 className="text-lg font-semibold">Convertir {numero} + mail au client</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Le client a accepté l&apos;offre par e-mail. La commande est créée et le client reçoit
          le mail de confirmation avec le QR de paiement. Aucune signature n&apos;est apposée :
          le document portera la mention <strong className="text-zinc-200">« Validé par e-mail »</strong>.
        </p>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-zinc-400">Client</span>
            <span className="font-semibold">{clientNom || "—"}</span>
          </div>
        </div>

        {/* ⚠️ Adresse e-mail : un mail parti à la mauvaise adresse ne se
            rattrape pas, et Make ne signale pas le rebond. On l'affiche en
            grand et on exige une vérification explicite. */}
        {emailPresent ? (
          <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-300">
              ⚠️ Le mail de confirmation partira à
            </div>
            <div className="mt-1 break-all font-mono text-base font-semibold text-amber-100">{email}</div>
            {alerte && (
              <div className="mt-2 rounded-lg bg-rose-500/20 p-2 text-sm font-semibold text-rose-200">{alerte}</div>
            )}

            {/* Contrôle par les fils de discussion mail */}
            {verifFils.etat === "chargement" && (
              <div className="mt-2 rounded-lg bg-black/20 p-2 text-sm text-zinc-400">
                Recherche des échanges avec cette adresse…
              </div>
            )}
            {verifFils.etat === "ok" && verifFils.nbRecus > 0 && (
              <div className="mt-2 rounded-lg bg-emerald-500/15 p-2 text-sm text-emerald-200">
                ✓ {verifFils.nbRecus} mail{verifFils.nbRecus > 1 ? "s" : ""} reçu{verifFils.nbRecus > 1 ? "s" : ""} de cette adresse
                {verifFils.dernierRecu && (
                  <div className="mt-0.5 text-xs text-emerald-300/80">
                    Dernier : {verifFils.dernierRecu.date ? new Date(verifFils.dernierRecu.date).toLocaleDateString("fr-CH") : "—"}
                    {" — "}{verifFils.dernierRecu.sujet}
                  </div>
                )}
              </div>
            )}
            {douteux && (
              <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/20 p-2 text-sm text-rose-100">
                <div className="font-semibold">
                  {verifFils.etat === "erreur"
                    ? "⚠️ Impossible de vérifier les échanges mail"
                    : verifFils.etat === "ok" && verifFils.nbMails > 0
                    ? `⚠️ ${verifFils.nbMails} mail${verifFils.nbMails > 1 ? "s" : ""} trouvé${verifFils.nbMails > 1 ? "s" : ""}, tous envoyés par nous — 0 reçu de cette adresse`
                    : "⚠️ Aucun échange mail avec cette adresse — douteux"}
                </div>
                {verifFils.etat === "ok" && verifFils.nbMails > 0 && (
                  <div className="mt-1 text-xs text-rose-200/90">
                    Dans la carte « Fils de discussion mail », le badge « ✓ répondu » signifie seulement que le
                    dernier message est le nôtre : il ne prouve pas que le client a écrit.
                  </div>
                )}
                <div className="mt-1 text-xs text-rose-200/90">
                  {verifFils.etat === "erreur"
                    ? `Connecteur indisponible (${verifFils.message}).`
                    : "Si le client a donné son accord par mail, ce mail devrait apparaître ici. L'adresse est peut-être mal saisie, ou l'accord est arrivé depuis une autre adresse. Un mail reçu il y a très peu de temps peut aussi ne pas être encore indexé."}
                </div>
                <label className="mt-2 flex items-start gap-2 font-semibold">
                  <input type="checkbox" checked={doutAssume} onChange={(e) => setDoutAssume(e.target.checked)}
                    className="mt-1" style={{ width: "auto" }} />
                  J&apos;ai vérifié moi-même : l&apos;accord vient bien de cette adresse.
                </label>
              </div>
            )}
            <p className="mt-2 text-xs text-amber-200/80">
              Compare-la avec l&apos;adresse du mail d&apos;accord du client. Si elle est fausse, annule et
              corrige-la d&apos;abord avec « ✏️ Corriger » : une fois envoyé, le mail ne peut pas être rappelé,
              et personne ne sera averti s&apos;il n&apos;arrive pas.
            </p>
            <label className="mt-2 flex items-start gap-2 text-sm font-semibold text-amber-100">
              <input type="checkbox" checked={adresseVerifiee} disabled={!emailOk}
                onChange={(e) => setAdresseVerifiee(e.target.checked)}
                className="mt-1" style={{ width: "auto" }} />
              J&apos;ai vérifié que cette adresse est bien celle du client.
            </label>
          </div>
        ) : (
          <div className="mt-3 rounded-lg bg-rose-500/15 p-2 text-sm text-rose-300">
            Ce client n&apos;a pas d&apos;adresse e-mail : utilise « Convertir en commande ».
          </div>
        )}

        <div className="mt-4 grid gap-3">
          <label className="text-sm text-zinc-300">
            Date du mail d&apos;accord du client
            <input type="date" value={dateAccord} max={aujIso} min={minIso || undefined}
              onChange={(e) => setDateAccord(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-zinc-100" />
          </label>
          <label className="text-sm text-zinc-300">
            Commercial qui valide
            <input value={validePar} onChange={(e) => setValidePar(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-zinc-100" />
          </label>
          <label className="flex items-start gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={confirme} onChange={(e) => setConfirme(e.target.checked)}
              className="mt-1" style={{ width: "auto" }} />
            J&apos;ai bien reçu l&apos;accord écrit du client par e-mail, et je l&apos;ai classé dans son dossier.
          </label>
        </div>

        {erreur && <div className="mt-3 rounded-lg bg-rose-500/15 p-2 text-sm text-rose-300">{erreur}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={envoi}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5 disabled:opacity-40">Annuler</button>
          <button type="button" onClick={valider} disabled={!peutValider}
            className="rounded-xl border border-teal-500/40 bg-teal-500/20 px-4 py-2 text-sm font-semibold text-teal-200 hover:bg-teal-500/30 disabled:opacity-40">
            {envoi ? "Validation…" : "Valider et envoyer le mail"}
          </button>
        </div>
      </div>
    </div>
  );
}
