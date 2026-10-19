"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import StatusBadge from "@/components/StatusBadge";
import WhatsAppButton from "@/components/WhatsAppButton";
import { api, kes } from "@/lib/api";
import type { Service, StaffCard } from "@/lib/types";

export default function StylePage() {
  const params = useParams<{ id: string }>();
  const serviceId = params.id;

  const [service, setService] = useState<Service | null>(null);
  const [staff, setStaff] = useState<StaffCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [services, stylists] = await Promise.all([
          api<Service[]>("/services"),
          api<StaffCard[]>(`/services/${serviceId}/staff`),
        ]);
        if (!alive) return;
        setService(services.find((s) => s.id === serviceId) ?? null);
        setStaff(stylists);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [serviceId]);

  return (
    <div className="container page">
      <Link href="/#services" className="small muted">
        ← All styles
      </Link>

      <div className="page-head" style={{ marginTop: 14 }}>
        <div>
          <div className="row tight">
            {service ? (
              <span className={`chip ${service.category}`}>{service.category}</span>
            ) : null}
          </div>
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.2rem)", marginTop: 10 }}>
            {loading ? "…" : service?.name ?? "Style not found"}
          </h1>
          {service ? (
            <div className="row">
              <span className="price">{kes(service.price_kes)}</span>
              <span className="muted">· {service.duration_min} minutes</span>
            </div>
          ) : null}
        </div>
        {service ? (
          <Link
            href={`/book/${staff[0]?.id ?? ""}?service=${service.id}`}
            className="btn btn-primary"
            style={staff.length === 0 ? { pointerEvents: "none", opacity: 0.5 } : undefined}
          >
            Book this style →
          </Link>
        ) : null}
      </div>

      {error ? <div className="alert error">{error}</div> : null}

      <h2 style={{ fontSize: "1.4rem" }}>
        Who does {service?.name ?? "this style"}?
      </h2>
      <p className="muted">
        Pick a stylist to see their open slots. Availability is computed live
        from working hours minus confirmed bookings.
      </p>

      <div className="grid grid-3" style={{ marginTop: 18 }}>
        {staff.map((stylist) => (
          <div key={stylist.id} className="card hover">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <span className="avatar lg">
                {stylist.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={stylist.avatar_url} alt={stylist.full_name} />
                ) : (
                  (stylist.full_name || "?").slice(0, 1).toUpperCase()
                )}
              </span>
              <div className="grow">
                <strong style={{ fontSize: "1.08rem" }}>{stylist.full_name}</strong>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  {stylist.role === "nail_tech" ? "Nail tech" : "Stylist"}
                </div>
                <StatusBadge status={stylist.status} />
                {stylist.status_note ? (
                  <div className="small muted">“{stylist.status_note}”</div>
                ) : null}
              </div>
            </div>

            {stylist.bio ? (
              <p className="small muted" style={{ marginTop: 12 }}>
                {stylist.bio}
              </p>
            ) : null}

            {stylist.photos.length > 0 ? (
              <div className="row tight" style={{ margin: "12px 0" }}>
                {stylist.photos.slice(0, 3).map((photo, index) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${photo.image_url}-${index}`}
                    src={photo.image_url}
                    alt="work"
                    style={{
                      width: 70,
                      height: 70,
                      objectFit: "cover",
                      borderRadius: 10,
                      border: "1px solid var(--line)",
                    }}
                  />
                ))}
              </div>
            ) : null}

            <div className="row tight" style={{ marginTop: 10 }}>
              <Link
                href={`/book/${stylist.id}?service=${serviceId}`}
                className="btn btn-lime btn-sm"
              >
                View availability
              </Link>
              <WhatsAppButton
                size="sm"
                number={stylist.whatsapp}
                text={`Hi ${stylist.full_name}! I want to book ${service?.name ?? "a service"} (${
                  service ? kes(service.price_kes) : ""
                }) — any slots open?`}
              />
            </div>
          </div>
        ))}
      </div>

      {!loading && staff.length === 0 && !error ? (
        <div className="empty" style={{ marginTop: 16 }}>
          No stylists offer this style yet — check back soon or message us on
          WhatsApp from the home page.
        </div>
      ) : null}

      {loading ? (
        <div className="loading">
          <span className="spinner" />
        </div>
      ) : null}
    </div>
  );
}
