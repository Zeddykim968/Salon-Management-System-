"use client";

import { useCallback, useEffect, useState } from "react";

import { api, apiUpload } from "@/lib/api";
import type { GalleryPhoto } from "@/lib/types";

const ASSETS = [
  { key: "hero", label: "Hero image (top of landing page)" },
  { key: "banner_1", label: "Banner 1" },
  { key: "banner_2", label: "Banner 2" },
];

export default function AdminSitePage() {
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [gallery, setGallery] = useState<GalleryPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [siteAssets, photos] = await Promise.all([
        api<Record<string, string>>("/site-assets"),
        api<GalleryPhoto[]>("/admin/gallery"),
      ]);
      setAssets(siteAssets ?? {});
      setGallery(photos);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadAsset(key: string, file: File) {
    setUploadingKey(key);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiUpload<{ image_url: string }>(`/admin/site-assets/${key}`, form, "PUT");
      setAssets((prev) => ({ ...prev, [key]: result.image_url }));
      setNotice(`${key} is live on the site ✓`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingKey(null);
    }
  }

  async function moderate(photo: GalleryPhoto, approved: boolean) {
    try {
      const updated = await api<GalleryPhoto>(`/admin/gallery/${photo.id}`, {
        method: "PATCH",
        json: { approved },
      });
      setGallery((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function remove(photo: GalleryPhoto) {
    if (!window.confirm("Permanently delete this photo (file too)?")) return;
    try {
      await api(`/admin/gallery/${photo.id}`, { method: "DELETE" });
      setGallery((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="container page" style={{ paddingTop: 8 }}>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>Site & gallery</h1>
          <p className="muted">Swap the hero, banners and moderate stylist uploads.</p>
        </div>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      <div className="grid grid-3" style={{ marginBottom: 34 }}>
        {ASSETS.map((asset) => (
          <div key={asset.key} className="card">
            <strong>{asset.label}</strong>
            <div style={{ margin: "12px 0", minHeight: 90, background: "var(--bg-2)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", border: "1px solid var(--line)" }}>
              {assets[asset.key] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assets[asset.key]} alt={asset.key} style={{ maxHeight: 140, width: "100%", objectFit: "cover" }} />
              ) : (
                <span className="small muted">no image set</span>
              )}
            </div>
            <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
              {uploadingKey === asset.key ? "Uploading…" : assets[asset.key] ? "Replace image" : "Upload image"}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={uploadingKey === asset.key}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadAsset(asset.key, file);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: "1.35rem" }}>Stylist gallery ({gallery.length})</h2>
      <p className="muted small">
        Hiding a photo keeps it off the public site without deleting the file.
      </p>

      {gallery.length === 0 ? (
        <div className="empty">No uploads yet — staff add photos from their Gallery page.</div>
      ) : (
        <div className="masonry" style={{ marginTop: 14 }}>
          {gallery.map((photo) => (
            <div key={photo.id} style={{ opacity: photo.approved ? 1 : 0.55 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.image_url} alt={photo.caption || "work"} />
              <div style={{ padding: "8px 10px" }}>
                <div className="row between tight">
                  <span className="small muted">
                    {photo.staff_name || "—"}
                    {photo.caption ? ` · ${photo.caption}` : ""}
                  </span>
                </div>
                <div className="row tight" style={{ marginTop: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => void moderate(photo, !photo.approved)}>
                    {photo.approved ? "Hide" : "Publish"}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => void remove(photo)}>
                    Delete
                  </button>
                  {!photo.approved ? <span className="badge pending">hidden</span> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
