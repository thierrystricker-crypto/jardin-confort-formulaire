// app/offres/nouveau/MediaLinePicker.tsx
"use client";

import { useEffect, useState } from "react";
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
  const [logos, setLogos] = useState<BrandLogo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  // Charger tous les logos au montage du composant
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/brand-logos")
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setLogos(json.logos ?? []);
      })
      .catch(() => {
        if (!cancelled) setLogos([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSelectChange(slug: string) {
    if (!slug) {
      // "Aucun logo" sélectionné : on vide
      onChange({
        ...line,
        image_url: "",
        name: undefined,
        source: "library",
      });
      return;
    }
    const logo = logos.find((l) => l.slug === slug);
    if (!logo) return;
    onChange({
      ...line,
      image_url: logo.image_url,
      name: logo.name,
      source: "library",
    });
  }

  async function handleFileUpload(file: File) {
    setUploadErr(null);
    if (!file.type.startsWith("image/")) {
      setUploadErr("Doit etre une image");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadErr("Max 2 MB");
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
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : "Erreur upload");
    } finally {
      setUploading(false);
    }
  }

  function setSize(size: MediaSize) {
    onChange({ ...line, size });
  }

  const heightPx = MEDIA_SIZE_PX[line.size];
  const hasImage = !!line.image_url;

  // Slug du logo actuellement sélectionné (si depuis bibliothèque)
  const currentSlug = line.source === "library"
    ? logos.find((l) => l.image_url === line.image_url)?.slug ?? ""
    : "";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 flex-wrap">

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

      {/* Badge */}
      <span className="rounded bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-xs font-medium text-purple-300 shrink-0">
        Logo / Image
      </span>

      {/* Menu déroulant natif */}
      <select
        value={currentSlug}
        onChange={(e) => handleSelectChange(e.target.value)}
        disabled={loading || line.source === "upload"}
        className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-400 disabled:opacity-60"
      >
        <option value="">
          {loading ? "Chargement..." : line.source === "upload" ? "Image uploadee" : "-- Choisir un logo --"}
        </option>
        {logos.map((logo) => (
          <option key={logo.id} value={logo.slug}>
            {logo.name}
          </option>
        ))}
      </select>

      {/* Bouton upload */}
      <label className="cursor-pointer shrink-0 rounded-lg border border-white/10 bg-[#34383d] px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-[#40454b] transition">
        {uploading ? "Upload..." : "Uploader"}
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

      {/* Sélecteur de taille */}
      {hasImage && (
        <div className="shrink-0 flex overflow-hidden rounded-lg border border-white/10 bg-[#1f2125]">
          {(Object.keys(MEDIA_SIZE_PX) as MediaSize[]).map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => setSize(size)}
              className={`min-w-[48px] px-5 py-3 font-semibold transition ${
                line.size === size
                  ? "bg-purple-600 text-white"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              } ${
                size === "small" ? "text-xs" :
                size === "medium" ? "text-sm" :
                "text-base"
              }`}
              title={`${MEDIA_SIZE_LABEL[size]} (${MEDIA_SIZE_PX[size]}px)`}
            >
              {MEDIA_SIZE_LABEL[size][0]}
            </button>
          ))}
        </div>
      )}

      {/* Lien gestion logos */}
      <a href="/dashboard/brand-logos" target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs font-medium text-purple-300 hover:bg-purple-500/20 transition">Gerer</a>

      {/* Bouton supprimer ligne */}
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/20 transition"
        title="Supprimer cette ligne"
      >
        Supprimer
      </button>

      {/* Erreur upload (sur toute la largeur) */}
      {uploadErr && (
        <div className="w-full rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
          {uploadErr}
        </div>
      )}
    </div>
  );
}