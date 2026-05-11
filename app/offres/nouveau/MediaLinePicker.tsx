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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
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

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!showDropdown) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowDropdown(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [showDropdown]);

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
      className="relative flex items-start gap-3 rounded-lg border border-purple-500/30 bg-purple-500/5 p-3"
    >
      <div
        className="flex shrink-0 items-center justify-center rounded border border-white/10 bg-[#1f2125]"
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
          <div className="text-xs text-zinc-500">Aucune image</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-xs font-medium text-purple-300">
            Logo / Image
          </span>
          {line.name && (
            <span className="truncate text-sm text-zinc-300">{line.name}</span>
          )}
          {line.source === "upload" && (
            <span className="text-xs text-zinc-500">(upload)</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setShowDropdown(true)}
              placeholder={hasImage ? "Changer le logo..." : "Rechercher (cane, hulsta...)"}
              className="w-full rounded-lg border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-400"
            />

            {showDropdown && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1.5 rounded-xl border border-purple-500/30 bg-[#2a2d31] shadow-2xl shadow-black/40 overflow-hidden">
                <div className="flex items-center justify-between border-b border-white/5 bg-black/20 px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    {searching ? "Recherche..." : `${results.length} logo${results.length !== 1 ? "s" : ""}`}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDropdown(false)}
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300 hover:bg-rose-500/20 transition"
                  >
                    X
                  </button>
                </div>

                <div className="max-h-[420px] overflow-y-auto p-3">
                  {searching && (
                    <div className="py-8 text-center text-sm text-zinc-500">
                      Recherche en cours...
                    </div>
                  )}

                  {!searching && results.length === 0 && (
                    <div className="py-8 text-center text-sm text-zinc-500">
                      Aucun logo trouve. Utilisez Uploader pour ajouter une image personnalisee.
                    </div>
                  )}

                  {!searching && results.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {results.map((logo) => (
                        <button
                          key={logo.id}
                          type="button"
                          onClick={() => pickLogo(logo)}
                          className="group flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-[#1f2125] p-2 text-center transition hover:border-purple-400 hover:bg-purple-500/10"
                        >
                          <div className="flex h-16 w-full items-center justify-center rounded bg-white p-2 transition group-hover:bg-zinc-50">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={logo.image_url}
                              alt={logo.name}
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <div className="w-full min-w-0">
                            <div className="truncate text-xs font-semibold text-zinc-100 group-hover:text-purple-300">
                              {logo.name}
                            </div>
                            <div className="truncate text-[10px] text-zinc-500">{logo.slug}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-white/5 bg-black/20 px-3 py-2 text-[10px] text-zinc-500 text-center">
                  Esc pour fermer
                </div>
              </div>
            )}
          </div>

          <label className="cursor-pointer rounded-lg border border-white/10 bg-[#34383d] px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-[#40454b] transition">
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

          <div className="flex overflow-hidden rounded-lg border border-white/10 bg-[#1f2125]">
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

          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-2 py-2 text-xs text-rose-300 hover:bg-rose-500/20 transition"
          >
            Supprimer
          </button>
        </div>

        {uploadErr && (
          <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
            {uploadErr}
          </div>
        )}
      </div>
    </div>
  );
}