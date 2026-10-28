"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api, kes } from "@/lib/api";
import type { Service } from "@/lib/types";

import { Item, Magnetic, Reveal, Stagger } from "@/components/motion";

/** Admin payload: the public Service plus usage counters. */
interface AdminService extends Service {
  bookings: number;
  staff_count: number;
  detail?: string; // present when a "delete" degraded to a hide
}

const BLANK = {
  name: "",
  category: "hair" as "hair" | "nails",
  price: "",
  duration: "",
};

export default function AdminServicesPage() {
  const [services, setServices] = useState<AdminService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [draft, setDraft] = useState(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setServices(await api<AdminService[]>("/admin/services"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load services");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(service: AdminService) {
    setEditingId(service.id);
    setDraft({
      name: service.name,
      category: service.category,
      price: String(service.price_kes),
      duration: String(service.duration_min),
    });
    setFormError(null);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(BLANK);
    setFormError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    const name = draft.name.trim();
    const price = Number(draft.price);
    const duration = Number(draft.duration);
    if (!name) return setFormError("Give the service a name.");
    if (!Number.isInteger(price) || price < 0)
      return setFormError("Price must be a whole number of KSh.");
    if (!Number.isInteger(duration) || duration < 5 || duration > 600)
      return setFormError("Duration must be 5–600 minutes.");

    setSaving(true);
    setFormError(null);
    try {
      const json = {
        name,
        category: draft.category,
        price_kes: price,
        duration_min: duration,
      };
      if (editingId) {
        const updated = await api<AdminService>(`/admin/services/${editingId}`, {
          method: "PATCH",
          json,
        });
        setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setNotice(`Saved “${updated.name}”.`);
        cancelEdit();
      } else {
        const created = await api<AdminService>("/admin/services", { json });
        setServices((prev) => [...prev, created]);
        setNotice(`“${created.name}” added to the menu.`);
        setDraft(BLANK);
      }
    } catch (e) {
      setFormError(e instanceof ApiError || e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(service: AdminService) {
    setBusyId(service.id);
    setNotice(null);
    try {
      const updated = await api<AdminService>(`/admin/services/${service.id}`, {
        method: "PATCH",
        json: { active: !service.active },
      });
      setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setNotice(
        updated.active
          ? `“${updated.name}” is back on the site.`
          : `“${updated.name}” is hidden from the site.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(service: AdminService) {
    setBusyId(service.id);
    setNotice(null);
    setError(null);
    try {
      const result = await api<AdminService | undefined>(`/admin/services/${service.id}`, {
        method: "DELETE",
      });
      if (result?.detail) {
        // had bookings → backend hid it instead of deleting
        setServices((prev) => prev.map((s) => (s.id === result.id ? result : s)));
        setNotice(result.detail);
      } else {
        setServices((prev) => prev.filter((s) => s.id !== service.id));
        setNotice(`“${service.name}” deleted.`);
      }
      setConfirmId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
      setConfirmId(null);
    } finally {
      setBusyId(null);
    }
  }

  const grouped = {
    hair: services.filter((s) => s.category === "hair"),
    nails: services.filter((s) => s.category === "nails"),
  };

  return (
    <div className="container page" style={{ paddingTop: 8 }}>
      <Reveal className="page-head">
        <div>
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>Services</h1>
          <p className="muted">
            The menu customers see — add, price, hide or remove without touching code.
          </p>
        </div>
        <span className="chip">
          {services.filter((s) => s.active).length} live · {services.length} total
        </span>
      </Reveal>

      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      {/* ------------------------------------------------------------ form */}
      <form className="card" onSubmit={submit} style={{ marginBottom: 26 }}>
        <div className="row between">
          <strong style={{ fontSize: "1.05rem" }}>
            {editingId ? "Edit service" : "Add a service"}
          </strong>
          {editingId ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEdit}>
              Cancel edit
            </button>
          ) : null}
        </div>

        {formError ? <div className="alert error">{formError}</div> : null}

        <div className="field-row" style={{ marginTop: 6 }}>
          <div>
            <label className="label" htmlFor="svc-name">
              Name
            </label>
            <input
              id="svc-name"
              className="input"
              placeholder="e.g. Box Braids"
              value={draft.name}
              maxLength={120}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="svc-category">
              Category
            </label>
            <select
              id="svc-category"
              className="select"
              value={draft.category}
              onChange={(e) =>
                setDraft((d) => ({ ...d, category: e.target.value as "hair" | "nails" }))
              }
            >
              <option value="hair">💇 Hair</option>
              <option value="nails">💅 Nails</option>
            </select>
          </div>
        </div>

        <div className="field-row">
          <div>
            <label className="label" htmlFor="svc-price">
              Price (KSh)
            </label>
            <input
              id="svc-price"
              className="input"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="2500"
              value={draft.price}
              onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="svc-duration">
              Duration (minutes)
            </label>
            <input
              id="svc-duration"
              className="input"
              type="number"
              inputMode="numeric"
              min={5}
              max={600}
              step={1}
              placeholder="60"
              value={draft.duration}
              onChange={(e) => setDraft((d) => ({ ...d, duration: e.target.value }))}
            />
          </div>
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <Magnetic strength={0.3}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "+ Add service"}
            </button>
          </Magnetic>
          <span className="small muted">
            {editingId
              ? "Updates everywhere instantly — site, booking pages, staff pickers."
              : "Appears on the home page and booking flow immediately."}
          </span>
        </div>
      </form>

      {/* ------------------------------------------------------------ list */}
      {loading ? (
        <div className="loading">
          <span className="spinner" />
        </div>
      ) : services.length === 0 ? (
        <div className="empty">No services yet — add the first one above. ✂️</div>
      ) : (
        (["hair", "nails"] as const).map((category) =>
          grouped[category].length === 0 ? null : (
            <section key={category} style={{ marginBottom: 26 }}>
              <div className="row between" style={{ marginBottom: 10 }}>
                <h2 style={{ fontSize: "1.3rem", margin: 0 }}>
                  {category === "hair" ? "💇 Hair" : "💅 Nails"}
                </h2>
                <span className={`chip ${category}`}>{grouped[category].length}</span>
              </div>

              <Stagger className="list">
                {grouped[category].map((service) => (
                  <Item key={service.id}>
                    <div
                      className="list-item"
                      style={{ opacity: service.active ? 1 : 0.62 }}
                    >
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row tight">
                          <strong>{service.name}</strong>
                          {!service.active ? <span className="chip">hidden</span> : null}
                        </div>
                        <div className="small muted">
                          {kes(service.price_kes)} · {service.duration_min} min ·{" "}
                          {service.staff_count} stylist
                          {service.staff_count === 1 ? "" : "s"} · {service.bookings}{" "}
                          booking{service.bookings === 1 ? "" : "s"}
                        </div>
                      </div>

                      <div className="row tight" style={{ flexShrink: 0 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={busyId === service.id}
                          onClick={() => void startEdit(service)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={busyId === service.id}
                          onClick={() => void toggleActive(service)}
                        >
                          {busyId === service.id
                            ? "…"
                            : service.active
                              ? "Hide"
                              : "Show"}
                        </button>

                        {confirmId === service.id ? (
                          <>
                            <button
                              className="btn btn-danger btn-sm"
                              disabled={busyId === service.id}
                              onClick={() => void remove(service)}
                            >
                              {busyId === service.id ? "Deleting…" : "Yes, delete"}
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setConfirmId(null)}
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => setConfirmId(service.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </Item>
                ))}
              </Stagger>
            </section>
          )
        )
      )}

      <p className="small muted">
        Services with bookings can’t be hard-deleted — deleting one hides it instead,
        so past appointments keep their history.
      </p>
    </div>
  );
}
