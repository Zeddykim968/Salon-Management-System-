"use client";

import { useCallback, useEffect, useState } from "react";

import { api, apiUpload } from "@/lib/api";
import type { GalleryPhoto } from "@/lib/types";

export default function StaffGalleryPage() {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPhotos(await api<GalleryPhoto[]>("/staff/gallery"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load gallery");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Pick a photo first");
      return;
    }
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("caption", caption);
      await apiUpload("/staff/gallery", form);
      setSuccess("Uploaded — it's live on the public gallery ✓");
      setFile(null);
      setPreview(null);
      setCaption("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function remove(photo: GalleryPhoto) {
    if (!window.confirm("Delete this photo from the site?")) return;
    try {
      await api(`/staff/gallery/${photo.id}`, { method: "DELETE" });
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="kicker" style={{ color: "var(--lime)", letterSpacing: "0.18em", fontSize: "0.75rem", fontWeight: 850, textTransform: "uppercase" }}>
            Studio
          </div>
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>Work gallery</h1>
          <p className="muted">Upload your best results — they appear on your card and the landing page.</p>
        </div>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {success ? <div className="alert success">{success}</div> : null}

      <form className="card" onSubmit={upload} style={{ marginBottom: 26 }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="grow" style={{ minWidth: 220 }}>
            <span className="label">Photo (JPEG/PNG/WebP, max 8 MB)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
              className="input"
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
                setPreview(picked ? URL.createObjectURL(picked) : null);
              }}
            />
          </label>
          <label className="grow" style={{ minWidth: 200 }}>
            <span className="label">Caption (optional)</span>
            <input
              className="input"
              value={caption}
              maxLength={200}
              placeholder="Knotless boho, 4 hours ⏱"
              onChange={(event) => setCaption(event.target.value)}
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={uploading || !file}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
        {preview ? (
          <div style={{ marginTop: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="preview"
              style={{ maxHeight: 220, borderRadius: 14, border: "1px solid var(--line)" }}
            />
          </div>
        ) : null}
      </form>

      {loading ? (
        <div className="loading">
          <span className="spinner" />
        </div>
      ) : photos.length === 0 ? (
        <div className="empty">Nothing here yet — upload your first look ✨</div>
      ) : (
        <div className="masonry">
          {photos.map((photo) => (
            <div key={photo.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.image_url} alt={photo.caption || "work"} />
              <div className="row between" style={{ padding: "8px 10px" }}>
                <span className="small muted">{photo.caption || "—"}</span>
                <button className="btn btn-danger btn-sm" onClick={() => void remove(photo)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
