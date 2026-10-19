"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import StatusBadge from "@/components/StatusBadge";
import WhatsAppButton from "@/components/WhatsAppButton";
import { api, kes } from "@/lib/api";
import type { GalleryPhoto, Service, StaffCard } from "@/lib/types";

interface Stylist extends StaffCard {
  services?: string[];
}

export default function HomePage() {
  const [services, setServices] = useState<Service[]>([]);
  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [gallery, setGallery] = useState<GalleryPhoto[]>([]);
  const [hero, setHero] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [svc, sty, gal, assets] = await Promise.all([
          api<Service[]>("/services"),
          api<Stylist[]>("/stylists"),
          api<GalleryPhoto[]>("/gallery?limit=12"),
          api<Record<string, string>>("/site-assets"),
        ]);
        if (!alive) return;
        setServices(svc);
        setStylists(sty);
        setGallery(gal);
        setHero(assets?.hero ?? null);
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

  const hair = services.filter((s) => s.category === "hair");
  const nails = services.filter((s) => s.category === "nails");

  return (
    <div className="container">
      {/* ---------------------------------------------------------------- hero */}
      <section className="hero">
        <div className="hero-art" />
        <div style={{ position: "relative", maxWidth: 760 }}>
          <div className="kicker">Hair · Nails · Student prices</div>
          <h1>
            Your next look, <span>booked in 60 seconds.</span>
          </h1>
          <p className="muted" style={{ fontSize: "1.08rem", maxWidth: 560 }}>
            Real prices. Live availability. Confirm with your stylist right here
            — or take it to WhatsApp. No hidden fees, no waiting around.
          </p>
          <div className="row" style={{ marginTop: 22 }}>
            <a href="#services" className="btn btn-primary">
              Browse styles
            </a>
            <a href="#stylists" className="btn btn-ghost">
              Meet the stylists
            </a>
          </div>
          <div className="row tight" style={{ marginTop: 26 }}>
            <span className="chip">⚡ Instant slots</span>
            <span className="chip">💬 WhatsApp first</span>
            <span className="chip">🎓 Student friendly</span>
          </div>
        </div>
        {hero ? (
          <div style={{ marginTop: 26, position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hero-img" src={hero} alt="Salon styles" />
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="alert error" style={{ marginTop: 18 }}>
          {error} — start the backend (<code>uvicorn app.main:app</code>) and
          Supabase to see live data.
        </div>
      ) : null}

      {/* ------------------------------------------------------------ services */}
      <section className="section" id="services">
        <div className="page-head">
          <div>
            <h2>Styles & prices</h2>
            <p className="muted">What you see is what you pay.</p>
          </div>
        </div>

        {loading ? (
          <div className="loading">
            <span className="spinner" />
          </div>
        ) : (
          <div className="grid grid-2">
            {(["hair", "nails"] as const).map((category) => (
              <div key={category}>
                <div className="row between" style={{ marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>
                    {category === "hair" ? "💇 Hair" : "💅 Nails"}
                  </h3>
                  <span className={`chip ${category}`}>{category}</span>
                </div>
                <div className="grid">
                  {(category === "hair" ? hair : nails).map((service) => (
                    <Link
                      key={service.id}
                      href={`/styles/${service.id}`}
                      className="card hover"
                    >
                      <div className="row between">
                        <div>
                          <strong style={{ fontSize: "1.05rem" }}>
                            {service.name}
                          </strong>
                          <div className="small muted">
                            {service.duration_min} min ·{" "}
                            {service.category === "hair" ? "hair" : "nails"}
                          </div>
                        </div>
                        <div className="price">{kes(service.price_kes)}</div>
                      </div>
                    </Link>
                  ))}
                  {category === "hair" && hair.length === 0 ? (
                    <div className="empty">No hair services yet.</div>
                  ) : null}
                  {category === "nails" && nails.length === 0 ? (
                    <div className="empty">No nail services yet.</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ stylists */}
      <section className="section" id="stylists">
        <div className="page-head">
          <div>
            <h2>The crew</h2>
            <p className="muted">
              Availability is live — green means they&apos;re taking bookings
              today.
            </p>
          </div>
        </div>

        <div className="grid grid-3">
          {stylists.map((stylist) => (
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
                  <strong style={{ fontSize: "1.08rem" }}>
                    {stylist.full_name}
                  </strong>
                  <div className="small muted" style={{ marginBottom: 6 }}>
                    {stylist.role === "nail_tech" ? "Nail tech" : "Stylist"}
                  </div>
                  <StatusBadge status={stylist.status} />
                </div>
              </div>

              {stylist.bio ? (
                <p className="small muted" style={{ marginTop: 12 }}>
                  {stylist.bio.length > 130
                    ? `${stylist.bio.slice(0, 130)}…`
                    : stylist.bio}
                </p>
              ) : null}

              {stylist.services?.length ? (
                <div className="row tight" style={{ margin: "10px 0" }}>
                  {stylist.services.slice(0, 4).map((name) => (
                    <span key={name} className="chip">
                      {name}
                    </span>
                  ))}
                </div>
              ) : null}

              {stylist.photos.length > 0 ? (
                <div className="row tight" style={{ margin: "10px 0" }}>
                  {stylist.photos.slice(0, 3).map((photo, index) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${photo.image_url}-${index}`}
                      src={photo.image_url}
                      alt="work"
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: "cover",
                        borderRadius: 10,
                        border: "1px solid var(--line)",
                      }}
                    />
                  ))}
                </div>
              ) : null}

              <div className="row tight" style={{ marginTop: 8 }}>
                <Link
                  href={`/book/${stylist.id}`}
                  className="btn btn-lime btn-sm"
                >
                  Book {stylist.full_name.split(" ")[0]}
                </Link>
                <WhatsAppButton
                  size="sm"
                  number={stylist.whatsapp}
                  text={`Hi ${stylist.full_name}! I found you on the salon site 👋 I'd like to ask about a slot.`}
                />
              </div>
            </div>
          ))}
          {!loading && stylists.length === 0 ? (
            <div className="empty" style={{ gridColumn: "1 / -1" }}>
              No stylists yet — the admin invites the crew from{" "}
              <code>/admin/staff</code>.
            </div>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------------------------- gallery */}
      <section className="section" id="gallery">
        <div className="page-head">
          <div>
            <h2>Fresh from the chair</h2>
            <p className="muted">Real work, uploaded by the stylists.</p>
          </div>
        </div>
        <div className="masonry">
          {gallery.map((photo) => (
            <div key={photo.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.image_url} alt={photo.caption || "salon work"} />
              {photo.caption || photo.staff_name ? (
                <div className="photo-cap">
                  {photo.caption}
                  {photo.staff_name ? <> · {photo.staff_name}</> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {!loading && gallery.length === 0 ? (
          <div className="empty">Gallery photos will appear here.</div>
        ) : null}
      </section>
    </div>
  );
}
