"use client";
// app/planner/partage/[token]/page.tsx
// Page CLIENT du planner 3D, en lecture seule (route publique, voir proxy.ts).
// Le client tourne la vue, zoome, bascule Plan / 3D et Couleurs / Maquette ;
// il ne peut ni déplacer, ni ajouter, ni supprimer. Pas de catalogue, pas de
// prix internes : seulement les articles du plan avec leur prix webshop
// (« dès » quand la variante n'est pas connue) et la mention légale.
//
// Le jeton est révocable depuis le planner (bouton « Partager » → Révoquer) :
// la page affiche alors « Ce lien n'est plus valable ».

import React, { use, useEffect, useMemo, useRef, useState } from "react";
import PlannerCanvas from "@/components/planner/PlannerCanvas";
import { MENTION_IA, MENTION_LEGALE, type Scene } from "@/lib/planner-types";

const LOGO = "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698";
const BTN = "rounded-xl border px-3 py-1.5 text-xs transition";
const BTN_OFF = `${BTN} border-white/10 bg-[#2a2d31] text-zinc-300 hover:bg-[#34383d]`;
const BTN_ON = `${BTN} border-sky-500/40 bg-sky-500/20 text-sky-200`;

function dateCH(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function chf(n: number): string {
  return `CHF ${new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export default function PagePartage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [scene, setScene] = useState<Scene | null>(null);
  const [erreur, setErreur] = useState("");
  const [vue, setVue] = useState<"plan" | "3d">("3d");
  const [mode, setMode] = useState<"couleurs" | "maquette">("couleurs");
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  // Version figée (export) ou lien vivant : on le dit au client, car le
  // projet peut avoir évolué depuis le document qu'il a en main.
  const [info, setInfo] = useState<{ version: { numero: number; cree_le: string } | null; modifie_depuis?: boolean; url_actuelle?: string | null; updated_at?: string; sans_prix?: boolean; ambiance_url?: string | null }>({ version: null });
  const captureRef = useRef<(() => string | null) | null>(null);
  const recadrerRef = useRef<(() => void) | null>(null);
  const cameraRef = useRef<{ lire: () => import("@/lib/planner-types").VueCamera | null; appliquer: (c: import("@/lib/planner-types").VueCamera) => void } | null>(null);

  useEffect(() => {
    fetch(`/api/planner/partage/${token}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) { setErreur(j.error); return; }
        setScene(j.scene);
        setInfo({ version: j.version || null, modifie_depuis: j.modifie_depuis, url_actuelle: j.url_actuelle, updated_at: j.updated_at, sans_prix: Boolean(j.sans_prix), ambiance_url: j.ambiance_url || null });
        setVue(j.scene.vue === "plan" ? "plan" : "3d");
        setMode(j.scene.mode || "couleurs");
      })
      .catch((e) => setErreur((e as Error).message));
  }, [token]);

  // Recadrer automatiquement une fois la scène chargée (la caméra 3D de
  // départ est calée sur la terrasse par le canvas, mais on s'assure du cadre).
  useEffect(() => {
    if (!scene) return;
    // Même angle que la fiche si le point de vue a été enregistré, sinon cadrage auto.
    const t = setTimeout(() => {
      const c = scene.camera?.[vue];
      if (c && cameraRef.current) cameraRef.current.appliquer(c);
      else recadrerRef.current?.();
    }, 300);
    return () => clearTimeout(t);
  }, [scene, vue]);

  // Une ligne par fiche et variante, avec quantité
  const lignes = useMemo(() => {
    if (!scene) return [];
    const m = new Map<string, { titre: string; image_url?: string | null; sku?: string | null; prix?: number | null; prix_exact?: boolean; qty: number; size_warn: boolean; color_warn: boolean }>();
    for (const it of scene.items) {
      const cle = `${it.product_id}|${it.sku || ""}`;
      const e = m.get(cle);
      if (e) e.qty++;
      else m.set(cle, { titre: it.titre, image_url: it.image_url, sku: it.sku, prix: it.prix, prix_exact: it.prix_exact, qty: 1, size_warn: it.size_warn, color_warn: it.color_warn });
    }
    return [...m.values()];
  }, [scene]);
  const total = lignes.reduce((n, l) => n + (l.prix || 0) * l.qty, 0);
  const totalApprox = lignes.some((l) => l.prix != null && !l.prix_exact);

  if (erreur) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#1f2125] p-6 text-center text-zinc-200">
        <img src={LOGO} alt="Jardin-Confort" className="h-14 rounded bg-white px-3 py-1" />
        <div className="text-lg font-semibold">{erreur}</div>
        <p className="max-w-md text-sm text-zinc-400">Demandez à votre conseiller Jardin-Confort de vous renvoyer un lien vers votre plan 3D.</p>
        <a href="https://www.jardin-confort.ch" className="text-sm text-sky-300 underline">www.jardin-confort.ch</a>
      </main>
    );
  }
  if (!scene) {
    return <main className="flex min-h-screen items-center justify-center bg-[#1f2125] text-sm text-zinc-400">Chargement du plan 3D…</main>;
  }

  return (
    <main className="flex h-screen flex-col bg-[#1f2125] text-zinc-100">
      {/* Barre haute : logo, nom du plan, vues */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <a href="https://www.jardin-confort.ch" className="rounded-lg bg-white px-2 py-1">
          <img src={LOGO} alt="Jardin-Confort" className="h-8" />
        </a>
        <div className="min-w-0 flex-1 truncate px-2 text-sm font-semibold" title={scene.nom}>{scene.nom}</div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setVue("plan")} className={vue === "plan" ? BTN_ON : BTN_OFF} title="Vue de dessus">▦ Plan</button>
          <button type="button" onClick={() => setVue("3d")} className={vue === "3d" ? BTN_ON : BTN_OFF} title="Perspective">◈ 3D</button>
          <button type="button" onClick={() => recadrerRef.current?.()} className={BTN_OFF} title="Recadrer la vue">⛶</button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMode("couleurs")} className={mode === "couleurs" ? BTN_ON : BTN_OFF}>Couleurs</button>
          <button type="button" onClick={() => setMode("maquette")} className={mode === "maquette" ? BTN_ON : BTN_OFF} title="Rendu maquette, sans couleurs">Maquette</button>
        </div>
      </div>

      {/* Bandeau version / mise à jour */}
      <div className={`border-b border-white/10 px-3 py-1.5 text-[11px] ${info.version && info.modifie_depuis ? "bg-amber-500/10 text-amber-100" : "bg-white/5 text-zinc-400"}`}>
        {info.version ? (
          <>
            Version V{info.version.numero} du {dateCH(info.version.cree_le)}, telle qu&apos;imprimée sur votre document.
            {info.modifie_depuis
              ? <> Le projet a été modifié depuis par votre conseiller{info.url_actuelle ? <> — <a href={info.url_actuelle} className="underline">voir la version actuelle</a></> : "."}</>
              : " C'est la version la plus récente du projet."}
          </>
        ) : (
          <>
            Plan mis à jour le {info.updated_at ? dateCH(info.updated_at) : "—"}. Ce lien montre toujours la dernière version du projet : elle peut différer d&apos;un document imprimé ou d&apos;une image reçue précédemment.
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <PlannerCanvas
            items={scene.items}
            terrasse={scene.terrasse}
            sol={scene.sol || "bois"}
            vue={vue}
            mode={mode}
            snap={0}
            selectedUid={null}
            lectureSeule
            onSelect={() => {}}
            onDragStart={() => {}}
            onMove={() => {}}
            onDims={() => {}}
            onError={(u, m) => setErreurs((e) => ({ ...e, [u]: m }))}
            captureRef={captureRef}
            recadrerRef={recadrerRef}
            cameraRef={cameraRef}
          />
          <div className="pointer-events-none absolute bottom-2 left-3 rounded bg-black/50 px-2 py-1 text-[11px] text-zinc-300">
            {MENTION_LEGALE} · {vue === "plan" ? "molette = zoom · glisser = déplacer la vue" : "glisser = tourner · molette = zoom · clic droit = déplacer"}
          </div>
        </div>

        {/* Liste des articles */}
        <aside className="hidden w-[300px] shrink-0 flex-col border-l border-white/10 bg-[#25282c] md:flex">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs">
            <span className="uppercase tracking-wide text-zinc-500">Articles · {scene.items.length}</span>
            {total > 0 && !info.sans_prix && <span className="text-zinc-300">{totalApprox ? "dès " : ""}{chf(total)}</span>}
          </div>
          <div className="flex-1 overflow-y-auto">
            {lignes.map((l, idx) => (
              <div key={idx} className="flex gap-2 border-b border-white/5 px-3 py-2">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white">
                  {l.image_url ? <img src={l.image_url} alt="" className="h-full w-full object-contain" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[12px] leading-tight text-zinc-100">{l.titre}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {l.qty > 1 ? `× ${l.qty}` : ""}{l.qty > 1 && l.prix != null && !info.sans_prix ? " · " : ""}{l.prix != null && !info.sans_prix ? `${l.prix_exact ? "" : "dès "}${chf(l.prix)}` : ""}
                  </div>
                  {(l.size_warn || (l.color_warn && mode === "couleurs")) && (
                    <div className="mt-0.5 text-[10px] text-amber-300">
                      {l.size_warn ? "taille : rendu indicatif" : ""}{l.size_warn && l.color_warn && mode === "couleurs" ? " · " : ""}{l.color_warn && mode === "couleurs" ? "couleur : rendu indicatif" : ""}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {Object.keys(erreurs).length > 0 && (
              <div className="px-3 py-2 text-[11px] text-rose-300">Certains modèles n&apos;ont pas pu être chargés.</div>
            )}
          </div>
          {info.ambiance_url && (
            <div className="border-t border-white/10 p-3">
              <a href={info.ambiance_url} target="_blank" rel="noopener noreferrer" title={MENTION_IA}>
                <img src={info.ambiance_url} alt="" className="w-full rounded-lg border border-white/10" />
              </a>
              <div className="mt-1 text-[10px] text-zinc-500">🎨 {MENTION_IA}.</div>
            </div>
          )}
          <div className="border-t border-white/10 px-3 py-2 text-[10px] leading-relaxed text-zinc-500">
            {info.sans_prix ? "Les prix figurent sur votre offre ou votre commande. " : "Prix TTC indicatifs du webshop, sous réserve d'une offre. "}{MENTION_LEGALE}.<br />
            Jardin-Confort SA · Route de Lavaux 425 · 1095 Lutry · +41 21 791 36 71
          </div>
        </aside>
      </div>
    </main>
  );
}
