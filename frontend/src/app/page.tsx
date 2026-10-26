"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";


import StatusBadge from "@/components/StatusBadge";
import WhatsAppButton from "@/components/WhatsAppButton";
import {
  CountUp,
  DragRow,
  EASE,
  Float,
  Item,
  Magnetic,
  Reveal,
  Stagger,
  Tilt,
} from "@/components/motion";
import { api, kes } from "@/lib/api";
import type { GalleryPhoto, Service, StaffCard } from "@/lib/types";

interface Stylist extends StaffCard {
  services?: string[];
}

const TICKER = [
  "⚡ Instant slots",
  "💬 WhatsApp first",
  "🎓 Student prices",
  "💅 Nails & braids",
  "📍 Walk-ins welcome",
  "✨ No hidden fees",
];

export default function HomePage() {
  const [services, setServices] = useState<Service[]>([]);
  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [gallery, setGallery] = useState<GalleryPhoto[]>([]);
  const [hero, setHero] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // the hero blob drifts as you scroll, giving the page some depth
  const { scrollY } = useScroll();
  const artY = useTransform(scrollY, [0, 600], [0, 160]);
  const artRotate = useTransform(scrollY, [0, 600], [0, 35]);

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
        <motion.div className="hero-art" style={{ y: artY, rotate: artRotate }} />

        <div className="hero-grid">
          <div style={{ position: "relative", maxWidth: 760 }}>
            <motion.div
              className="kicker"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE }}
            >
              Hair · Nails · Student prices
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.85, delay: 0.08, ease: EASE }}
            >
              Your next look,{" "}
              <span className="wipe">
                <span>booked in 60 seconds.</span>
              </span>
            </motion.h1>

            <motion.p
              className="muted"
              style={{ fontSize: "1.08rem", maxWidth: 560 }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.22, ease: EASE }}
            >
              Real prices. Live availability. Confirm with your stylist right
              here — or take it to WhatsApp. No hidden fees, no waiting around.
            </motion.p>

            <motion.div
              className="row"
              style={{ marginTop: 22 }}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.34, ease: EASE }}
            >
              <Magnetic strength={0.4}>
                <a href="#services" className="btn btn-primary">
                  Browse styles
                </a>
              </Magnetic>
              <Magnetic strength={0.4}>
                <a href="#stylists" className="btn btn-ghost">
                  Meet the stylists
                </a>
              </Magnetic>
            </motion.div>

            {/* count-up numbers — they roll in once the hero has landed */}
            <motion.div
              className="row hero-stats"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.5 }}
            >
              <div className="hero-stat">
                <strong>
                  <CountUp to={services.length} />
                </strong>
                <span>services on the menu</span>
              </div>
              <div className="hero-stat">
                <strong>
                  <CountUp to={stylists.length} />
                </strong>
                <span>stylists on the floor</span>
              </div>
              <div className="hero-stat">
                <strong>
                  <CountUp to={gallery.length} />
                </strong>
                <span>fresh looks in the gallery</span>
              </div>
            </motion.div>
          </div>

          <div className="hero-side">
            <Float distance={16} duration={7}>
              <Tilt max={9} className="hero-photo-wrap">
                {hero ? (
                  <div className="zoomable">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="hero-img" src={hero} alt="Salon styles" />
                  </div>
                ) : (
                  <div className="hero-placeholder">
                    <span>💇‍♀️</span>
                    <span>💅</span>
                    <span>✨</span>
                  </div>
                )}
              </Tilt>
            </Float>

            <Float distance={10} duration={5} delay={0.6}>
              <div className="hero-badge">Open Mon–Sat · 9–6</div>
            </Float>
          </div>
        </div>
      </section>

      {error ? (
        <div className="alert error" style={{ marginTop: 18 }}>
          {error} — start the Django backend (
          <code>python manage.py runserver</code>) to see live data.
        </div>
      ) : null}

      {/* ----------------------------------------------------------- ticker */}
      <div className="marquee ticker-band" aria-hidden="true">
        <div className="marquee-track">
          {[...TICKER, ...TICKER, ...TICKER, ...TICKER].map((item, index) => (
            <span className="chip" key={`${item}-${index}`}>
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------ services */}
      <section className="section" id="services">
        <Reveal className="page-head">
          <div>
            <h2>Styles & prices</h2>
            <p className="muted">What you like is what you pay.</p>
          </div>
          <span className="chip">tap a style to book</span>
        </Reveal>

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

                <Stagger className="grid">
                  {(category === "hair" ? hair : nails).map((service) => (
                    <Item key={service.id}>
                      <Link href={`/styles/${service.id}`} className="card hover service-card">
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
                        <span className="service-go" aria-hidden="true">
                          →
                        </span>
                      </Link>
                    </Item>
                  ))}
                  {category === "hair" && hair.length === 0 ? (
                    <div className="empty">No hair services yet.</div>
                  ) : null}
                  {category === "nails" && nails.length === 0 ? (
                    <div className="empty">No nail services yet.</div>
                  ) : null}
                </Stagger>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ stylists */}
      <section className="section" id="stylists">
        <Reveal className="page-head">
          <div>
            <h2>The crew</h2>
            <p className="muted">
              Availability is realtime — green means they're taking
              bookings today.
            </p>
          </div>
          <span className="chip">drag or swipe →</span>
        </Reveal>

        {!loading && stylists.length === 0 ? (
          <div className="empty">
            No stylists yet — the admin invites the crew from{" "}
            <code>/admin/staff</code>.
          </div>
        ) : (
          <DragRow>
            {stylists.map((stylist) => (
              <div className="crew-card" key={stylist.id}>
                <Tilt max={6}>
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
                          className="crew-thumb zoomable"
                        />
                      ))}
                    </div>
                  ) : null}

                  <div className="row tight" style={{ marginTop: 8 }}>
                    <Magnetic strength={0.3}>
                      <Link
                        href={`/book/${stylist.id}`}
                        className="btn btn-lime btn-sm"
                      >
                        Book {stylist.full_name.split(" ")[0]}
                      </Link>
                    </Magnetic>
                    <WhatsAppButton
                      size="sm"
                      number={stylist.whatsapp}
                      text={`Hi ${stylist.full_name}! I found you on the salon site 👋 I'd like to ask about a slot.`}
                    />
                  </div>
                </Tilt>
              </div>
            ))}
          </DragRow>
        )}
      </section>

      {/* ------------------------------------------------------------- gallery */}
      <section className="section" id="gallery">
        <Reveal className="page-head">
          <div>
            <h2>Fresh from the chair</h2>
            <p className="muted">Real work, uploaded by the stylists.</p>
          </div>
          <span className="chip">throw it sideways →</span>
        </Reveal>

        {loading ? (
          <div className="loading">
            <span className="spinner" />
          </div>
        ) : gallery.length === 0 ? (
          <div className="empty">Gallery photos will appear here.</div>
        ) : (
          <DragRow>
            {gallery.map((photo) => (
              <figure className="gallery-card" key={photo.id}>
                <div className="zoomable">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.image_url} alt={photo.caption || "salon work"} />
                </div>
                {photo.caption || photo.staff_name ? (
                  <figcaption className="photo-cap">
                    {photo.caption}
                    {photo.staff_name ? <> · {photo.staff_name}</> : null}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </DragRow>
        )}
      </section>
    </div>
  );
}
