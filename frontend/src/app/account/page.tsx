"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Chat from "@/components/Chat";
import StatusBadge from "@/components/StatusBadge";
import { ApiError, api, kes } from "@/lib/api";
import type { Booking, Contact, Me } from "@/lib/types";

type Tab = "bookings" | "messages";

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("bookings");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const profile = await api<Me>("/me");
        if (!alive) return;
        setMe(profile);

        if (profile.role === "customer") {
          const mine = await api<Booking[]>("/bookings/mine");
          if (alive) setBookings(mine);
        }
        const threads = await api<Contact[]>("/messages/contacts");
        if (alive) {
          setContacts(threads);
          setActive(threads[0]?.id ?? null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function cancel(booking: Booking) {
    if (!window.confirm(`Cancel your ${booking.service.name} on ${booking.when}?`)) return;
    setBusyId(booking.id);
    setError(null);
    try {
      const updated = await api<Booking>(`/bookings/${booking.id}/cancel`, {
        method: "PATCH",
      });
      setBookings((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Cancel failed");
    } finally {
      setBusyId(null);
    }
  }

  async function refreshBookings() {
    try {
      setBookings(await api<Booking[]>("/bookings/mine"));
    } catch {
      /* keep what we have */
    }
  }

  const isCustomer = me?.role === "customer";
  const activeContact = contacts.find((contact) => contact.id === active) ?? null;

  if (loading) {
    return (
      <div className="loading" style={{ paddingTop: 90 }}>
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="kicker" style={{ color: "var(--lime)", letterSpacing: "0.18em", fontSize: "0.75rem", fontWeight: 850, textTransform: "uppercase" }}>
            My account
          </div>
          <h1 style={{ fontSize: "clamp(1.9rem, 5vw, 2.8rem)" }}>
            Hey {me?.full_name?.split(" ")[0] || "there"} 👋
          </h1>
        </div>
        <Link href="/#services" className="btn btn-lime">
          + Book a style
        </Link>
      </div>

      <div className="tabs">
        {isCustomer ? (
          <button
            className={`tab${tab === "bookings" ? " active" : ""}`}
            onClick={() => setTab("bookings")}
          >
            My bookings ({bookings.filter((b) => b.status === "pending" || b.status === "confirmed").length})
          </button>
        ) : null}
        <button
          className={`tab${tab === "messages" ? " active" : ""}`}
          onClick={() => setTab("messages")}
        >
          Messages
        </button>
      </div>

      {error ? <div className="alert error">{error}</div> : null}

      {tab === "bookings" ? (
        isCustomer ? (
          bookings.length === 0 ? (
            <div className="empty">
              No bookings yet.{" "}
              <Link href="/#services" style={{ color: "var(--pink)" }}>
                Browse styles →
              </Link>
            </div>
          ) : (
            <div className="list">
              {bookings.map((booking) => (
                <div key={booking.id} className="list-item">
                  <div className="grow">
                    <div className="row tight">
                      <strong>{booking.service.name}</strong>
                      <StatusBadge status={booking.status} />
                    </div>
                    <div className="small muted">
                      {booking.when} · with {booking.staff.full_name} ·{" "}
                      {kes(booking.service.price_kes)}
                    </div>
                    {booking.notes ? (
                      <div className="small muted">📝 {booking.notes}</div>
                    ) : null}
                  </div>
                  <div className="row tight">
                    {booking.status === "pending" || booking.status === "confirmed" ? (
                      <button
                        className="btn btn-danger btn-sm"
                        disabled={busyId === booking.id}
                        onClick={() => void cancel(booking)}
                      >
                        {busyId === booking.id ? "…" : "Cancel"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={() => void refreshBookings()}>
                ↻ Refresh
              </button>
            </div>
          )
        ) : (
          <div className="empty">
            Bookings are a customer thing — your schedule lives in{" "}
            <Link href={me?.role === "admin" ? "/admin" : "/staff"} style={{ color: "var(--pink)" }}>
              your workspace
            </Link>
            .
          </div>
        )
      ) : contacts.length === 0 ? (
        <div className="empty">No conversations yet.</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "minmax(230px, 300px) 1fr" }}>
          <div className="card" style={{ padding: 10, maxHeight: "66vh", overflowY: "auto" }}>
            {contacts.map((contact) => (
              <button
                key={contact.id}
                className={`contact-item${active === contact.id ? " active" : ""}`}
                onClick={() => setActive(contact.id)}
              >
                <span className="avatar sm">
                  {contact.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={contact.avatar_url} alt={contact.full_name} />
                  ) : (
                    contact.full_name.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: "0.94rem" }}>
                    {contact.full_name}
                  </strong>
                  <span className="small muted" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {contact.last_message?.body ?? contact.role.replace("_", " ")}
                  </span>
                </span>
                {contact.unread > 0 ? <span className="unread">{contact.unread}</span> : null}
              </button>
            ))}
          </div>
          <div>
            {activeContact ? (
              <Chat otherId={activeContact.id} otherName={activeContact.full_name} />
            ) : (
              <div className="empty">Pick a conversation</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
