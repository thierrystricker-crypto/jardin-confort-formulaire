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
    <div className="bl-page">
      <div className="bl-container">
        <div className="bl-header">
          <div>
            <Link href="/dashboard" className="bl-back">← Dashboard</Link>
            <h1 className="bl-title">🖼️ Logos de marques</h1>
            <p className="bl-subtitle">
              Bibliothèque des logos disponibles dans le formulaire d&apos;offre
            </p>
          </div>
          <div className="bl-count">{logos.length} logo{logos.length !== 1 ? "s" : ""}</div>
        </div>

        {/* Upload form */}
        <form onSubmit={handleUpload} className="bl-card">
          <div className="bl-section-title">Ajouter un logo</div>

          <div className="bl-grid-2">
            <div className="bl-field">
              <label>Nom de la marque *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cane-line"
              />
            </div>
            <div className="bl-field">
              <label>Termes de recherche (CSV, optionnel)</label>
              <input
                type="text"
                value={searchTerms}
                onChange={(e) => setSearchTerms(e.target.value)}
                placeholder="caneline, cane line, danish"
              />
              <span className="bl-hint">
                Le nom et ses variantes (sans tirets) sont ajoutés automatiquement.
              </span>
            </div>
          </div>

          <div className="bl-field bl-mt12">
            <label>Image (PNG/JPG/SVG, max 2 MB) *</label>
            <input
              id="logo-file-input"
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <span className="bl-hint">
              Conseil : préférer un PNG transparent ou un SVG pour un meilleur rendu PDF.
            </span>
          </div>

          {error && <div className="bl-error">{error}</div>}

          <button
            type="submit"
            disabled={uploading || !file || !name.trim()}
            className="bl-btn-primary bl-mt12"
          >
            {uploading ? "Upload en cours..." : "+ Ajouter à la bibliothèque"}
          </button>
        </form>

        {/* Filter */}
        <div className="bl-filter-wrap">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="🔍 Filtrer par nom, slug ou terme de recherche..."
          />
        </div>

        {/* Grid */}
        {loading ? (
          <div className="bl-empty">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="bl-empty">
            {filter ? "Aucun logo ne correspond au filtre" : "Aucun logo dans la bibliothèque"}
          </div>
        ) : (
          <div className="bl-grid-logos">
            {filtered.map((logo) => (
              <div key={logo.id} className="bl-logo-tile">
                <div className="bl-logo-img">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo.image_url} alt={logo.name} />
                </div>
                <div className="bl-logo-name">{logo.name}</div>
                <div className="bl-logo-slug">{logo.slug}</div>
                {logo.search_terms.length > 0 && (
                  <div className="bl-logo-terms">{logo.search_terms.join(", ")}</div>
                )}
                <button
                  onClick={() => handleDelete(logo.id, logo.name)}
                  className="bl-delete-btn"
                  title="Supprimer"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx global>{`
        :root {
          --bg:          #1f2125;
          --card:        #2a2d31;
          --card-2:      #34383d;
          --border:      rgba(255,255,255,0.08);
          --border-2:    rgba(255,255,255,0.12);
          --text:        #f4f4f5;
          --text-muted:  #c8c8d0;
          --text-dim:    #71717a;
          --accent:      #3b82f6;
          --accent-h:    #2563eb;
          --ok:          #4ade80;
          --warn:        #f59e0b;
          --danger:      #f87171;
          --radius-sm:   8px;
          --radius:      12px;
          --radius-xl:   16px;
        }

        html, body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-geist-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 14px;
          line-height: 1.5;
          -webkit-font-smoothing: antialiased;
          min-height: 100vh;
        }

        .bl-page {
          min-height: 100vh;
          background: var(--bg);
          color: var(--text);
          padding: 32px 16px;
        }

        .bl-container {
          max-width: 1400px;
          margin: 0 auto;
        }

        .bl-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 24px;
          flex-wrap: wrap;
        }

        .bl-back {
          font-size: 13px;
          color: var(--accent);
          text-decoration: none;
        }
        .bl-back:hover { text-decoration: underline; }

        .bl-title {
          font-size: 24px;
          font-weight: 800;
          margin: 4px 0 6px;
          color: var(--text);
        }

        .bl-subtitle {
          font-size: 13px;
          color: var(--text-muted);
        }

        .bl-count {
          padding: 6px 14px;
          border-radius: 999px;
          background: var(--card-2);
          border: 1px solid var(--border-2);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-muted);
        }

        .bl-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          padding: 24px;
          margin-bottom: 24px;
        }

        .bl-section-title {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-bottom: 18px;
        }

        .bl-grid-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 700px) {
          .bl-grid-2 { grid-template-columns: 1fr; }
        }

        .bl-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .bl-field label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .bl-field input[type="text"],
        .bl-field input[type="file"] {
          width: 100%;
          background: var(--card-2);
          border: 1px solid var(--border-2);
          border-radius: var(--radius);
          color: var(--text);
          padding: 10px 12px;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          font-size: 14px;
        }

        .bl-field input::placeholder {
          color: var(--text-dim);
          opacity: 0.55;
          font-style: italic;
        }

        .bl-field input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
        }

        .bl-field input[type="file"] {
          padding: 8px 12px;
          cursor: pointer;
        }

        .bl-field input[type="file"]::-webkit-file-upload-button {
          background: var(--card);
          border: 1px solid var(--border-2);
          border-radius: var(--radius-sm);
          color: var(--text);
          padding: 5px 12px;
          font-size: 13px;
          cursor: pointer;
          margin-right: 10px;
          transition: background 0.15s;
        }
        .bl-field input[type="file"]::-webkit-file-upload-button:hover {
          background: var(--card-2);
        }

        .bl-hint {
          font-size: 11px;
          color: var(--text-dim);
          font-style: italic;
        }

        .bl-mt12 { margin-top: 14px; }

        .bl-error {
          margin-top: 14px;
          padding: 10px 14px;
          border-radius: var(--radius);
          background: rgba(248,113,113,0.1);
          border: 1px solid rgba(248,113,113,0.25);
          color: var(--danger);
          font-size: 13px;
        }

        .bl-btn-primary {
          background: var(--accent);
          color: white;
          border: 1px solid var(--accent);
          border-radius: var(--radius-xl);
          padding: 10px 20px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
        }
        .bl-btn-primary:hover:not(:disabled) {
          background: var(--accent-h);
        }
        .bl-btn-primary:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .bl-filter-wrap input {
          width: 100%;
          background: var(--card-2);
          border: 1px solid var(--border-2);
          border-radius: var(--radius);
          color: var(--text);
          padding: 10px 14px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .bl-filter-wrap input::placeholder { color: var(--text-dim); }
        .bl-filter-wrap input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
        }
        .bl-filter-wrap { margin-bottom: 16px; }

        .bl-empty {
          padding: 48px 24px;
          text-align: center;
          color: var(--text-muted);
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          font-style: italic;
        }

        .bl-grid-logos {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 14px;
        }

        .bl-logo-tile {
          position: relative;
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          padding: 16px 12px 12px;
          transition: all 0.15s;
          display: flex;
          flex-direction: column;
          gap: 4px;
          align-items: center;
        }
        .bl-logo-tile:hover {
          border-color: var(--border-2);
          background: var(--card-2);
        }

        .bl-logo-img {
          width: 100%;
          height: 100px;
          background: rgba(255,255,255,0.95);
          border-radius: var(--radius);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px;
          margin-bottom: 8px;
          border: 1px solid var(--border-2);
        }
        .bl-logo-img img {
          max-height: 100%;
          max-width: 100%;
          object-fit: contain;
        }

        .bl-logo-name {
          font-size: 13px;
          font-weight: 700;
          color: var(--text);
          text-align: center;
        }

        .bl-logo-slug {
          font-size: 11px;
          color: var(--text-muted);
          font-family: ui-monospace, monospace;
        }

        .bl-logo-terms {
          font-size: 10px;
          color: var(--text-dim);
          text-align: center;
          line-height: 1.4;
          margin-top: 4px;
          width: 100%;
          word-break: break-word;
        }

        .bl-delete-btn {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(248,113,113,0.1);
          color: var(--danger);
          border: 1px solid rgba(248,113,113,0.2);
          border-radius: var(--radius-sm);
          font-size: 12px;
          cursor: pointer;
          opacity: 0;
          transition: all 0.15s;
        }
        .bl-logo-tile:hover .bl-delete-btn {
          opacity: 1;
        }
        .bl-delete-btn:hover {
          background: rgba(248,113,113,0.25);
        }
      `}</style>
    </div>
  );
}