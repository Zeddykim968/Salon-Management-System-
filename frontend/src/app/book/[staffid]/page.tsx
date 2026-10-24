"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import StatusBadge from "@/components/StatusBadge";
import { ApiError, api, kes } from "@/lib/api";
import { hasSession } from "@/lib/auth";
import type { Availability, Booking, Service } from "@/lib/types";

function isoDay(date: Date) {
  const tz = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

function BookInner() {
  const params = useParams<{ staffId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const staffId = params.staffId;
  const preselect = searchParams.get("service");

  const today = useMemo(() => isoDay(new Date()), []);
  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return isoDay(d);
  }, []);

  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState(preselect || "");
  const [day, setDay] = useState(today);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Booking | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  // sign-in check
  useEffect(() => {
    setSignedIn(hasSession());
  }, []);

  // service list
  useEffect(() => {
    let alive = true;
    api<Service[]>("/services")
      .then((all) => {
        if (!alive) return;
        setServices(all);
        setServiceId((current) => current || all[0]?.id || "");
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  // availability
  useEffect(() => {
    if (!serviceId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setSelected(null);
    api<Availability>(
      `/staff/${staffId}/availability?date=${day}&service_id=${serviceId}`
    )
      .then((data) => alive && setAvailability(data))
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load slots");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [staffId, day, serviceId]);

  const service = services.find((s) => s.id === serviceId) ?? null;
  const staff = availability?.staff ?? null;

  async function submit() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const booking = await api<Booking>("/bookings", {
        json: {
          staff_id: staffId,
          service_id: serviceId,
          start: selected,
          notes: notes.trim() || null,
        },
      });
      setSuccess(booking);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setSignedIn(false);
      } else if (e instanceof ApiError && e.status === 409) {
        setError(`${e.message} — refresh to see new times.`);
        // reload slots so the taken one disappears
        try {
          const fresh = await api<Availability>(
            `/staff/${staffId}/availability?date=${day}&service_id=${serviceId}`
          );
          setAvailability(fresh);
          setSelected(null);
        } catch {
          /* keep the error above */
        }
      } else {
        setError(e instanceof Error ? e.message : "Booking failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="container page" style={{ maxWidth: 640 }}>
        <div className="card" style={{ textAlign: "center", padding: 34 }}>
          <div style={{ fontSize: "3rem" }}>🎉</div>
          <h2>Request sent!</h2>
          <p className="muted">
            Your <b>{success.service.name}</b> with{" "}
            <b>{success.staff.full_name}</b> is <b>pending</b> — the slot is
            held for you. The stylist gets a WhatsApp + in-app message and will
            confirm shortly.
          </p>
          <div className="alert info" style={{ textAlign: "left" }}>
            {success.when} · {kes(success.service.price_kes)} ·{" "}
            {success.service.duration_min} min
          </div>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link href="/account" className="btn btn-lime">
              View my bookings
            </Link>
            <Link href="/#services" className="btn btn-ghost">
              Book another style
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (signedIn === false) {
    return (
      <div className="container page" style={{ maxWidth: 560 }}>
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <h2>Log in to book</h2>
          <p className="muted">
            Slots are held for signed-in customers so nobody double-books you.
          </p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link
              href={`/login?next=/book/${staffId}${serviceId ? `?service=${serviceId}` : ""}`}
              className="btn btn-primary"
            >
              Log in / Join
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container page" style={{ maxWidth: 860 }}>
      <Link
        href={serviceId ? `/styles/${serviceId}` : "/#services"}
        className="small muted"
      >
        ← Back to hairstyles
      </Link>

      <div className="page-head" style={{ marginTop: 14 }}>
        <div className="row" style={{ alignItems: "center" }}>
          <span className="avatar lg">
            {staff?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={staff.avatar_url} alt={staff.full_name} />
            ) : (
              (staff?.full_name || "?").slice(0, 1).toUpperCase()
            )}
          </span>
          <div>
            <h1 style={{ fontSize: "clamp(1.6rem, 4vw, 2.4rem)", marginBottom: 4 }}>
              Book with {staff?.full_name || "…"}
            </h1>
            {staff ? <StatusBadge status={staff.status} /> : null}
          </div>
        </div>
      </div>

      {error ? <div className="alert error">{error}</div> : null}

      <div className="card">
        <div className="field-row">
          <div>
            <label className="label" htmlFor="service">
              Service
            </label>
            <select
              id="service"
              className="select"
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
            >
              {services.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} — {kes(item.price_kes)} · {item.duration_min} min
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="day">
              Day
            </label>
            <input
              id="day"
              type="date"
              className="input"
              min={today}
              max={maxDate}
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </div>
        </div>

        <div className="divider" />

        <div className="row between">
          <strong>Open slots</strong>
          <span className="small muted">
            {service ? `${service.duration_min} min appointments` : ""}
            {availability?.hours?.length
              ? ` · hours ${availability.hours.map((h) => `${h.start}–${h.end}`).join(", ")}`
              : ""}
          </span>
        </div>

        {loading ? (
          <div className="loading">
            <span className="spinner" />
          </div>
        ) : availability && availability.slots.length > 0 ? (
          <div className="slots" style={{ marginTop: 14 }}>
            {availability.slots.map((slot) => (
              <button
                key={slot.start}
                className={`slot${selected === slot.start ? " selected" : ""}`}
                onClick={() => setSelected(slot.start)}
              >
                {new Date(slot.start).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </button>
            ))}
          </div>
        ) : (
          <div className="empty" style={{ marginTop: 14 }}>
            No free slots on this day — try another date or a different
            stylist.{" "}
            {availability && availability.booked.length > 0
              ? "The stylist is fully booked here."
              : ""}
          </div>
        )}

        <label className="label" htmlFor="notes">
          Notes for the stylist (optional)
        </label>
        <textarea
          id="notes"
          className="textarea"
          placeholder="e.g. shoulder length, I have a 4pm class after…"
          value={notes}
          maxLength={1000}
          onChange={(event) => setNotes(event.target.value)}
        />

        <div className="row between" style={{ marginTop: 18 }}>
          <div className="small muted">
            {service ? (
              <>
                <b style={{ color: "var(--lime)" }}>{kes(service.price_kes)}</b>{" "}
                · {service.name} · {service.duration_min} min
              </>
            ) : (
              "Pick a service and a slot"
            )}
          </div>
          <button
            className="btn btn-primary"
            disabled={!selected || submitting || !serviceId}
            onClick={() => void submit()}
          >
            {submitting ? "Holding slot…" : "Request this slot"}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          The slot is held as <b>pending</b> the moment you submit — the
          database blocks anyone else from taking it.
        </p>
      </div>
    </div>
  );
}

export default function BookPage() {
  return (
    <Suspense
      fallback={
        <div className="loading" style={{ paddingTop: 90 }}>
          <span className="spinner" />
        </div>
      }
    >
      <BookInner />
    </Suspense>
  );
}
