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
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<BrandLogo[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Recherche debounced
  useEffect(() => {
    const t = setTimeout(async () => {
      // Si rien dans la recherche → ne charge pas (on attend que l'user ouvre)
      if (!showDropdown) return;
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
  }, [search, showDropdown]);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function pickLogo(logo: BrandLogo) {
    onChange({
      ...line,
      image_url: logo.image_url,
      name: logo.name,
      source: "library",
    });
    setShowDropdown(false);
    setSearch("");
  }

  async function handleFileUpload(file: File) {
    setUploadErr(null);
    if (!file.type.startsWith("image/")) {
      setUploadErr("Doit être une image");
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
      setShowDropdown(false);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setUploading(false);
    }
  }

  function setSize(size: MediaSize) {
    onChange({ ...line, size });
  }

  const heightPx = MEDIA_SIZE_PX[line.size];
  const hasImage = !!line.image_url;

  return (
    <div
      ref={containerRef}
      className="relative flex items-start gap-3 rounded-lg border-2 border-dashed border-purple-300 bg-purple-50/40 p-3"
    >
      {/* Image preview / placeholder */}
      <div
        className="flex shrink-0 items-center justify-center rounded border bg-white"
        style={{ height: heightPx + 16, minWidth: 80, padding: 8 }}
      >
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={line.image_url}
            alt={line.name ?? "logo"}
            style={{ height: heightPx, width: "auto", objectFit: "contain" }}
          />
        ) : (
          <div className="text-xs text-gray-400">Aucune image</div>
        )}
      </div>

      {/* Controls */}
      <div className="flex-1">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
            🖼️ Logo / Image
          </span>
          {line.name && (
            <span className="truncate text-sm text-gray-700">{line.name}</span>
          )}
          {line.source === "upload" && (
            <span className="text-xs text-gray-500">(upload)</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search input */}
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setShowDropdown(true)}
              placeholder={hasImage ? "Changer le logo..." : "Rechercher (cane, hülsta...)"}
              className="w-full rounded border px-3 py-1.5 text-sm"
            />
            {showDropdown && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded border bg-white shadow-lg">
                {searching && (
                  <div className="p-3 text-center text-xs text-gray-500">
                    Recherche...
                  </div>
                )}
                {!searching && results.length === 0 && (
                  <div className="p-3 text-center text-xs text-gray-500">
                    Aucun logo trouvé. Utilise « Uploader » ci-contre.
                  </div>
                )}
                {!searching &&
                  results.map((logo) => (
                    <button
                      key={logo.id}
                      type="button"
                      onClick={() => pickLogo(logo)}
                      className="flex w-full items-center gap-3 border-b px-3 py-2 text-left transition hover:bg-purple-50"
                    >
                      <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded bg-gray-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={logo.image_url}
                          alt={logo.name}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{logo.name}</div>
                        <div className="truncate text-xs text-gray-500">{logo.slug}</div>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Upload button */}
          <label className="cursor-pointer rounded border bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-50">
            {uploading ? "Upload..." : "📤 Uploader"}
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

          {/* Size selector */}
          <div className="flex rounded border bg-white">
            {(Object.keys(MEDIA_SIZE_PX) as MediaSize[]).map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setSize(size)}
                className={`px-2 py-1.5 text-xs transition ${
                  line.size === size
                    ? "bg-purple-600 text-white"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
                title={`${MEDIA_SIZE_LABEL[size]} (${MEDIA_SIZE_PX[size]}px)`}
              >
                {MEDIA_SIZE_LABEL[size][0]}
              </button>
            ))}
          </div>

          {/* Remove */}
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
            title="Supprimer cette ligne média"
          >
            ✕
          </button>
        </div>

        {uploadErr && (
          <div className="mt-2 text-xs text-red-600">{uploadErr}</div>
        )}
      </div>
    </div>
  );
}