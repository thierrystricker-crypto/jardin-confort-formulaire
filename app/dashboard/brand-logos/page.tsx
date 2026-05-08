// app/dashboard/brand-logos/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BrandLogo } from "@/lib/media-line-types";

export default function BrandLogosAdminPage() {
  const [logos, setLogos] = useState<BrandLogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [searchTerms, setSearchTerms] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  async function loadLogos() {
    setLoading(true);
    try {
      const res = await fetch("/api/brand-logos");
      const json = await res.json();
      setLogos(json.logos ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogos();
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file || !name.trim()) {
      setError("Nom et fichier requis");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", "library");
      fd.append("name", name.trim());
      fd.append("search_terms", searchTerms);

      const res = await fetch("/api/brand-logos/upload", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Erreur upload");
        return;
      }
      setName("");
      setSearchTerms("");
      setFile(null);
      // reset file input
      const fileInput = document.getElementById("logo-file-input") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      await loadLogos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Supprimer le logo "${name}" ?`)) return;
    const res = await fetch(`/api/brand-logos/upload?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      await loadLogos();
    } else {
      const json = await res.json().catch(() => ({}));
      alert(`Erreur : ${json.error ?? res.status}`);
    }
  }

  const filtered = logos.filter((l) => {
    if (!filter.trim()) return true;
    const f = filter.toLowerCase();
    return (
      l.name.toLowerCase().includes(f) ||
      l.slug.toLowerCase().includes(f) ||
      (l.search_terms ?? []).some((t) => t.toLowerCase().includes(f))
    );
  });

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="mx-auto max-w-5xl px-4">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
              ← Dashboard
            </Link>
            <h1 className="mt-1 text-2xl font-bold">Logos de marques</h1>
            <p className="text-sm text-gray-600">
              Bibliothèque des logos disponibles dans le formulaire d'offre
            </p>
          </div>
          <div className="text-sm text-gray-500">{logos.length} logos</div>
        </div>

        {/* Upload form */}
        <form onSubmit={handleUpload} className="mb-8 rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Ajouter un logo</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Nom de la marque *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cane-line"
                className="w-full rounded border px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Termes de recherche (CSV, optionnel)
              </label>
              <input
                type="text"
                value={searchTerms}
                onChange={(e) => setSearchTerms(e.target.value)}
                placeholder="caneline, cane line, danish"
                className="w-full rounded border px-3 py-2"
              />
              <p className="mt-1 text-xs text-gray-500">
                Le nom et ses variantes (sans tirets) sont ajoutés automatiquement.
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium">Image (PNG/JPG/SVG, max 2 MB) *</label>
              <input
                id="logo-file-input"
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full rounded border px-3 py-2"
              />
              <p className="mt-1 text-xs text-gray-500">
                Conseil : préférer un PNG transparent ou un SVG pour un meilleur rendu PDF.
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <button
            type="submit"
            disabled={uploading || !file || !name.trim()}
            className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:bg-gray-300"
          >
            {uploading ? "Upload en cours..." : "Ajouter à la bibliothèque"}
          </button>
        </form>

        {/* Filter */}
        <div className="mb-4">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer..."
            className="w-full rounded border px-3 py-2"
          />
        </div>

        {/* Grid */}
        {loading ? (
          <div className="text-center text-gray-500">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
            {filter ? "Aucun logo ne correspond au filtre" : "Aucun logo dans la bibliothèque"}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {filtered.map((logo) => (
              <div
                key={logo.id}
                className="group relative rounded-lg border bg-white p-4 shadow-sm transition hover:shadow"
              >
                <div className="flex h-24 items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logo.image_url}
                    alt={logo.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="mt-2 text-center text-sm font-medium">{logo.name}</div>
                <div className="text-center text-xs text-gray-500">{logo.slug}</div>
                {logo.search_terms.length > 0 && (
                  <div className="mt-1 line-clamp-1 text-center text-[10px] text-gray-400">
                    {logo.search_terms.join(", ")}
                  </div>
                )}
                <button
                  onClick={() => handleDelete(logo.id, logo.name)}
                  className="absolute right-2 top-2 rounded bg-red-100 px-2 py-1 text-xs text-red-700 opacity-0 transition group-hover:opacity-100"
                >
                  Supprimer
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}