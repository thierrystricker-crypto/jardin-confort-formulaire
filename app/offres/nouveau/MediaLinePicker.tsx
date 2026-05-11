// app/offres/nouveau/MediaLinePicker.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import {
  type BrandLogo,
  type MediaLine,
  type MediaSize,
  MEDIA_SIZE_LABEL,
  MEDIA_SIZE_PX,
} from "@/lib/media-line-types";

type Props = {
  line: MediaLine;
  onChange: (line: MediaLine) => void;
  onRemove: () => void;
};

export default function MediaLinePicker({ line, onChange, onRemove }: Props) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<BrandLogo[]>([]);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const hasImage = !!line.image_url;
  const heightPx = MEDIA_SIZE_PX[line.size];

  // Charger les logos quand le modal s'ouvre
  useEffect(() => {
    if (!isModalOpen) return;

    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const url = search.trim()
          ? `/api/brand-logos?q=${encodeURIComponent(search.trim())}`
          : `/api/brand-logos`;
        const res = await fetch(url);
        const json = await res.json();
        setResults(json.logos ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => clearTimeout(t);
  }, [search, isModalOpen]);

  // Focus automatique sur le champ recherche quand le modal s'ouvre
  useEffect(() => {
    if (isModalOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isModalOpen]);

  // Touche Escape ferme le modal
  useEffect(() => {
    if (!isModalOpen) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setIsModalOpen(false);
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isModalOpen]);

  // Bloquer le scroll de la page quand le modal est ouvert
  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [isModalOpen]);

  function openModal() {
    setSearch("");
    setIsModalOpen(true);
  }

  function pickLogo(logo: BrandLogo) {
    onChange({
      ...line,
      image_url: logo.image_url,
      name: logo.name,
      source: "library",
    });
    setIsModalOpen(false);
  }

  async function handleFileUpload(file: File) {
    setUploadErr(null);
    if (!file.type.startsWith("image/")) {
      setUploadErr("Le fichier doit etre une image");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadErr("Taille maximum : 2 MB");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", "ephemeral");
      const res = await fetch("/api/brand-logos/upload", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setUploadErr(json.error ?? "Erreur upload");
        return;
      }
      onChange({
        ...line,
        image_url: json.image_url,
        name: file.name,
        source: "upload",
      });
      setIsModalOpen(false);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : "Erreur upload");
    } finally {
      setUploading(false);
    }
  }

  function setSize(size: MediaSize) {
    onChange({ ...line, size });
  }

  return (
    <>
      {/* LIGNE DANS LE TABLEAU (compact) */}
      <div className="flex items-center gap-3 rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">

        {/* Aperçu image actuelle ou placeholder */}
        <div
          className="flex shrink-0 items-center justify-center rounded border border-white/10 bg-white"
          style={{ height: heightPx + 16, minWidth: 80, padding: 6 }}
        >
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={line.image_url}
              alt={line.name ?? "logo"}
              style={{ maxHeight: heightPx, width: "auto", objectFit: "contain" }}
            />
          ) : (
            <div className="text-[10px] text-zinc-400 text-center px-1">Pas de logo</div>
          )}
        </div>

        {/* Nom + bouton choisir */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="rounded bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-xs font-medium text-purple-300 shrink-0">
            Logo / Image
          </span>
          {hasImage && line.name && (
            <span className="truncate text-sm text-zinc-200">{line.name}</span>
          )}
          {hasImage && line.source === "upload" && (
            <span className="text-xs text-zinc-500 shrink-0">(upload)</span>
          )}
          {!hasImage && (
            <span className="text-sm text-zinc-400 italic">Aucun logo selectionne</span>
          )}
        </div>

        {/* Bouton choisir / changer */}
        <button
          type="button"
          onClick={openModal}
          className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500 transition"
        >
          {hasImage ? "Changer" : "Choisir un logo"}
        </button>

        {/* Sélecteur de taille (visible seulement si logo choisi) */}
        {hasImage && (
          <div className="shrink-0 flex overflow-hidden rounded-lg border border-white/10 bg-[#1f2125]">
            {(Object.keys(MEDIA_SIZE_PX) as MediaSize[]).map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setSize(size)}
                className={`px-2.5 py-2 text-xs font-semibold transition ${
                  line.size === size
                    ? "bg-purple-600 text-white"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                }`}
                title={`${MEDIA_SIZE_LABEL[size]} (${MEDIA_SIZE_PX[size]}px)`}
              >
                {MEDIA_SIZE_LABEL[size][0]}
              </button>
            ))}
          </div>
        )}

        {/* Bouton supprimer ligne */}
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/20 transition"
          title="Supprimer cette ligne"
        >
          Supprimer
        </button>
      </div>

      {/* MODAL CENTRE - rendu uniquement si ouvert */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-purple-500/30 bg-[#2a2d31] shadow-2xl shadow-black/50 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >

            {/* Header modal */}
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/20 px-5 py-3">
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">Choisir un logo</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {searching ? "Recherche en cours..." : `${results.length} logo${results.length !== 1 ? "s" : ""} disponible${results.length !== 1 ? "s" : ""}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 transition"
                title="Fermer (Esc)"
              >
                X
              </button>
            </div>

            {/* Barre de recherche */}
            <div className="border-b border-white/10 bg-black/10 px-5 py-3">
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un logo (fermob, cane, hulsta...)"
                className="w-full rounded-lg border border-white/10 bg-[#1f2125] px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-purple-400"
              />
            </div>

            {/* Grille de logos (zone scrollable) */}
            <div className="flex-1 overflow-y-auto p-5">
              {searching && results.length === 0 && (
                <div className="py-12 text-center text-sm text-zinc-500">
                  Chargement des logos...
                </div>
              )}

              {!searching && results.length === 0 && (
                <div className="py-12 text-center">
                  <div className="text-sm text-zinc-400 mb-2">
                    Aucun logo trouve{search.trim() ? ` pour "${search.trim()}"` : ""}
                  </div>
                  <div className="text-xs text-zinc-500">
                    Essayez un autre terme ou uploadez une image personnalisee ci-dessous
                  </div>
                </div>
              )}

              {results.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {results.map((logo) => (
                    <button
                      key={logo.id}
                      type="button"
                      onClick={() => pickLogo(logo)}
                      className="group flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-[#1f2125] p-3 transition hover:border-purple-400 hover:bg-purple-500/10 hover:scale-[1.02]"
                      title={logo.name}
                    >
                      <div className="flex h-20 w-full items-center justify-center rounded-lg bg-white p-2 transition">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={logo.image_url}
                          alt={logo.name}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div className="w-full min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-100 group-hover:text-purple-300 text-center">
                          {logo.name}
                        </div>
                        <div className="truncate text-[10px] text-zinc-500 text-center">
                          {logo.slug}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Footer modal : upload + gestion logos */}
            <div className="border-t border-white/10 bg-black/20 px-5 py-3">
              {uploadErr && (
                <div className="mb-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {uploadErr}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap">

                {/* Bouton uploader */}
                <label className="cursor-pointer rounded-lg border border-white/10 bg-[#34383d] px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-[#40454b] transition inline-flex items-center gap-2">
                  {uploading ? "Upload en cours..." : "Uploader une image personnalisee"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f);
                      e.target.value = "";
                    }}
                  />
                </label>

                {/* Lien vers la page de gestion */}
                
                  <a href="/dashboard/brand-logos" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm font-medium text-purple-300 hover:bg-purple-500/20 transition">Gerer les logos</a>
              </div>

              <p className="mt-2 text-[10px] text-zinc-500 text-center">
                Esc ou clic exterieur pour fermer
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}