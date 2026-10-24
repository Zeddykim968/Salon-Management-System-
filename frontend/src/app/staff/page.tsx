"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import StatusBadge from "@/components/StatusBadge";
import WhatsAppButton from "@/components/WhatsAppButton";
import { ApiError, api, kes } from "@/lib/api";
import type { Booking, Me, StaffStatus } from "@/lib/types";

const STATUSES: StaffStatus[] = ["available", "busy", "off"];

export default function StaffHomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [schedule, setSchedule] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState("");

  const load = useCallback(async () => {
    try {
      const profile = await api<Me>("/me");
      setMe(profile);
      setStatusNote(profile.staff_details?.status_note ?? "");
      setSchedule(await api<Booking[]>("/staff/schedule?days=21"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // live updates when the admin/cust changes something — Django has no
  // websocket layer, so poll the schedule while the page is open.
  useEffect(() => {
    if (!me) return;
    const interval = setInterval(() => void load(), 15000);
    return () => clearInterval(interval);
  }, [me, load]);

  async function setStatus(status: StaffStatus) {
    if (!me) return;
    try {
      await api("/staff/status", { method: "PATCH", json: { status, status_note: statusNote } });
      setMe({
        ...me,
        staff_details: { ...(me.staff_details ?? { bio: null, whatsapp: null }), status, status_note: statusNote },
      });
      setNotice(`You're now ${status === "off" ? "off" : status}.`);
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update status");
    }
  }

  async function transition(booking: Booking, action: "confirm" | "decline" | "complete") {
    if (action === "decline" && !window.confirm(`Decline ${booking.customer.full_name}'s booking?`)) return;
    setBusyId(booking.id);
    setError(null);
    try {
      const updated = await api<Booking>(`/bookings/${booking.id}/${action}`, { method: "PATCH" });
      setSchedule((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      const verbs = { confirm: "Confirmed ✓", decline: "Declined", complete: "Marked complete 🎉" };
      setNotice(verbs[action]);
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="loading" style={{ paddingTop: 90 }}>
        <span className="spinner" />
      </div>
    );
  }

  const pending = schedule.filter((b) => b.status === "pending");
  const upcoming = schedule.filter((b) => b.status === "confirmed");
  const history = schedule.filter((b) => ["completed", "declined", "cancelled"].includes(b.status));
  const currentStatus = (me?.staff_details?.status ?? "available") as StaffStatus;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="kicker" style={{ color: "var(--lime)", letterSpacing: "0.18em", fontSize: "0.75rem", fontWeight: 850, textTransform: "uppercase" }}>
            Studio · {me?.role === "nail_tech" ? "Nail tech" : "Stylist"}
          </div>
          <h1 style={{ fontSize: "clamp(1.9rem, 5vw, 2.8rem)" }}>
            {me?.full_name || "Your"}&apos;s schedule
          </h1>
        </div>
        <div className="row tight">
          <Link href="/staff/profile" className="btn btn-ghost btn-sm">Profile</Link>
          <Link href="/staff/gallery" className="btn btn-ghost btn-sm">Gallery</Link>
        </div>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      {/* ------------------------------------------------------ status toggle */}
      <div className="card" style={{ marginBottom: 26 }}>
        <div className="row between">
          <div>
            <strong>Public status</strong>
            <div className="small muted">
              Shown on the site — the slot calendar stays the source of truth.
            </div>
          </div>
          <div className="row tight">
            {STATUSES.map((status) => (
              <button
                key={status}
                className={`btn btn-sm ${currentStatus === status ? "btn-lime" : "btn-ghost"}`}
                onClick={() => void setStatus(status)}
              >
                {status === "available" ? "🟢 Available" : status === "busy" ? "🟡 Busy" : "⚪ Off"}
              </button>
            ))}
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <input
            className="input"
            style={{ maxWidth: 420 }}
            placeholder="Short note, e.g. ‘back after 3pm’"
            value={statusNote}
            maxLength={140}
            onChange={(event) => setStatusNote(event.target.value)}
            onBlur={() => void setStatus(currentStatus)}
          />
          <StatusBadge status={currentStatus} />
        </div>
      </div>

      {/* ------------------------------------------------------------ pending */}
      <section style={{ marginBottom: 30 }}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: "1.35rem", margin: 0 }}>
            Requests to act on ({pending.length})
          </h2>
        </div>
        {pending.length === 0 ? (
          <div className="empty">No pending requests — nice. 🎉</div>
        ) : (
          <div className="list">
            {pending.map((booking) => (
              <div key={booking.id} className="list-item">
                <span className="avatar">
                  {booking.customer.full_name?.slice(0, 1).toUpperCase() || "?"}
                </span>
                <div className="grow">
                  <div className="row tight">
                    <strong>{booking.customer.full_name || "Customer"}</strong>
                    <StatusBadge status={booking.status} />
                  </div>
                  <div className="small muted">
                    {booking.when} · {booking.service.name} ·{" "}
                    {kes(booking.service.price_kes)}
                  </div>
                  {booking.notes ? <div className="small muted">📝 {booking.notes}</div> : null}
                </div>
                <div className="row tight">
                  <WhatsAppButton
                    size="sm"
                    number={booking.customer.phone}
                    text={`Hi ${booking.customer.full_name || "there"}! About your ${booking.service.name} booking on ${booking.when}…`}
                  />
                  <button
                    className="btn btn-lime btn-sm"
                    disabled={busyId === booking.id}
                    onClick={() => void transition(booking, "confirm")}
                  >
                    Confirm
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={busyId === booking.id}
                    onClick={() => void transition(booking, "decline")}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ----------------------------------------------------------- upcoming */}
      <section style={{ marginBottom: 30 }}>
        <h2 style={{ fontSize: "1.35rem" }}>Confirmed ({upcoming.length})</h2>
        {upcoming.length === 0 ? (
          <div className="empty">Nothing confirmed in the next 3 weeks.</div>
        ) : (
          <div className="list">
            {upcoming.map((booking) => (
              <div key={booking.id} className="list-item">
                <span className="avatar">
                  {booking.customer.full_name?.slice(0, 1).toUpperCase() || "?"}
                </span>
                <div className="grow">
                  <div className="row tight">
                    <strong>{booking.service.name}</strong>
                    <StatusBadge status={booking.status} />
                  </div>
                  <div className="small muted">
                    {booking.when} · {booking.customer.full_name} ·{" "}
                    {kes(booking.service.price_kes)}
                  </div>
                </div>
                <div className="row tight">
                  <WhatsAppButton
                    size="sm"
                    number={booking.customer.phone}
                    text={`Hi ${booking.customer.full_name || "there"}! See you for your ${booking.service.name} at ${booking.when} 💇‍♀️`}
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busyId === booking.id}
                    onClick={() => void transition(booking, "complete")}
                  >
                    Mark done
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ----------------------------------------------------------- history */}
      <section>
        <h2 style={{ fontSize: "1.35rem" }}>History</h2>
        {history.length === 0 ? (
          <div className="empty">Past appointments land here.</div>
        ) : (
          <div className="list">
            {history.map((booking) => (
              <div key={booking.id} className="list-item" style={{ opacity: 0.75 }}>
                <div className="grow">
                  <div className="row tight">
                    <strong>{booking.service.name}</strong>
                    <StatusBadge status={booking.status} />
                  </div>
                  <div className="small muted">
                    {booking.when} · {booking.customer.full_name}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
