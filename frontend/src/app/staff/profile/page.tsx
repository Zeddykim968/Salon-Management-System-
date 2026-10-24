"use client";

import { useEffect, useState } from "react";

import { api, apiUpload } from "@/lib/api";
import type { Me, Service } from "@/lib/types";

interface StaffProfile extends Me {
  bio: string | null;
  whatsapp: string | null;
  status: string;
  avatar_url: string | null;
  services: (Service & { assigned: boolean })[];
}

export default function StaffProfilePage() {
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [bio, setBio] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<StaffProfile>("/staff/profile")
      .then((data) => {
        if (!alive) return;
        setProfile(data);
        setFullName(data.full_name ?? "");
        setPhone(data.phone ?? "");
        setBio(data.bio ?? "");
        setWhatsapp(data.whatsapp ?? "");
        setAssigned(new Set(data.services.filter((s) => s.assigned).map((s) => s.id)));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  function toggle(serviceId: string) {
    setAssigned((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api("/staff/profile", {
        method: "PUT",
        json: {
          full_name: fullName,
          phone,
          bio,
          whatsapp,
          service_ids: [...assigned],
        },
      });
      setSuccess("Profile saved ✓ — your WhatsApp button on the site is updated too.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setUploadingAvatar(true);
    setError(null);
    setSuccess(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiUpload<{ avatar_url: string }>("/staff/avatar", form);
      setProfile((prev) => (prev ? { ...prev, avatar_url: result.avatar_url } : prev));
      setSuccess("Avatar updated ✓");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingAvatar(false);
    }
  }

  if (loading) {
    return (
      <div className="loading" style={{ paddingTop: 90 }}>
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div className="container page" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <div className="kicker" style={{ color: "var(--lime)", letterSpacing: "0.18em", fontSize: "0.75rem", fontWeight: 850, textTransform: "uppercase" }}>
            Studio
          </div>
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>Your profile</h1>
          <p className="muted">This is what customers see on your stylist card.</p>
        </div>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {success ? <div className="alert success">{success}</div> : null}

      <form className="card" onSubmit={save}>
        <div className="row" style={{ alignItems: "center" }}>
          <span className="avatar lg">
            {profile?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="You" />
            ) : (
              (fullName || "?").slice(0, 1).toUpperCase()
            )}
          </span>
          <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
            {uploadingAvatar ? "Uploading…" : "Change photo"}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={uploadingAvatar}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAvatar(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <div className="field-row">
          <div>
            <label className="label">Full name</label>
            <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="label">Phone (for customer callbacks)</label>
            <input className="input" value={phone} placeholder="0712 345 678" onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>

        <label className="label">WhatsApp number (E.164, e.g. 254712345678)</label>
        <input
          className="input"
          value={whatsapp}
          placeholder="254712345678"
          onChange={(e) => setWhatsapp(e.target.value)}
        />
        <p className="small muted" style={{ marginTop: 6 }}>
          💬 The public “WhatsApp” button on your card opens a chat with this
          number. Include your country code.
        </p>

        <label className="label">Bio</label>
        <textarea
          className="textarea"
          value={bio}
          maxLength={1000}
          placeholder="Specialities, vibe, years on the chair…"
          onChange={(e) => setBio(e.target.value)}
        />

        <div className="divider" />
        <strong>Services you offer</strong>
        <div className="row tight" style={{ marginTop: 10 }}>
          {(profile?.services ?? []).map((service) => (
            <button
              type="button"
              key={service.id}
              className={`tab${assigned.has(service.id) ? " active" : ""}`}
              onClick={() => toggle(service.id)}
            >
              {service.name} · {service.duration_min}m
            </button>
          ))}
          {(profile?.services ?? []).length === 0 ? (
            <span className="small muted">No services defined yet.</span>
          ) : null}
        </div>

        <button className="btn btn-primary btn-block" style={{ marginTop: 24 }} disabled={saving} type="submit">
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>
    </div>
  );
}
