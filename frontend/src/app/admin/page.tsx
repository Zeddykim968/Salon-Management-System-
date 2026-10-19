"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { ActivityItem, Booking, Me } from "@/lib/types";

interface Overview {
  customers: number;
  staff: number;
  pending_bookings: number;
  confirmed_bookings: number;
  today_bookings: number;
  total_bookings: number;
}

export default function AdminOverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [pending, setPending] = useState<Booking[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [stats, feed, profile] = await Promise.all([
        api<Overview>("/admin/overview"),
        api<ActivityItem[]>("/admin/activity?limit=40"),
        api<Me>("/me"),
      ]);
      setOverview(stats);
      setActivity(feed);
      setMe(profile);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);

  const stats = [
    { num: overview?.pending_bookings ?? "–", cap: "Pending requests" },
    { num: overview?.today_bookings ?? "–", cap: "Bookings today" },
    { num: overview?.confirmed_bookings ?? "–", cap: "Confirmed" },
    { num: overview?.customers ?? "–", cap: "Customers" },
    { num: overview?.staff ?? "–", cap: "Staff" },
    { num: overview?.total_bookings ?? "–", cap: "All-time bookings" },
  ];

  return (
    <div className="container page" style={{ paddingTop: 8 }}>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>
            Welcome, {me?.full_name?.split(" ")[0] || "admin"}
          </h1>
          <p className="muted">Everything happening in the salon, live.</p>
        </div>
        <Link href="/admin/staff" className="btn btn-primary">
          + Invite staff
        </Link>
      </div>

      {error ? (
        <div className="alert error">
          {error} — role checks and stats need the backend running.
        </div>
      ) : null}

      {loading ? (
        <div className="loading">
          <span className="spinner" />
        </div>
      ) : (
        <>
          <div className="grid grid-4" style={{ marginBottom: 30 }}>
            {stats.map((stat) => (
              <div key={stat.cap} className="stat">
                <div className="num">{stat.num}</div>
                <div className="cap">{stat.cap}</div>
              </div>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
            <section>
              <div className="row between" style={{ marginBottom: 12 }}>
                <h2 style={{ fontSize: "1.35rem", margin: 0 }}>Staff activity</h2>
                <span className="small muted">refreshes every 30s</span>
              </div>
              {activity.length === 0 ? (
                <div className="empty">
                  Nothing yet — actions like booking confirms, uploads and status
                  changes show up here.
                </div>
              ) : (
                <div className="list">
                  {activity.map((item) => (
                    <div key={item.id} className="list-item" style={{ padding: "10px 16px" }}>
                      <span className="chip">{actionIcon(item.action)}</span>
                      <div className="grow small">
                        <strong>{item.actor_name}</strong> · {humanAction(item.action)}
                        {item.meta && Object.keys(item.meta).length > 0 ? (
                          <span className="muted"> — {summariseMeta(item.meta)}</span>
                        ) : null}
                      </div>
                      <span className="small muted" style={{ whiteSpace: "nowrap" }}>
                        {new Date(item.created_at).toLocaleString([], {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function humanAction(action: string) {
  const [group, verb] = action.split(".");
  const groups: Record<string, string> = {
    booking: "Booking",
    gallery: "Gallery",
    status: "Status",
    staff: "Staff",
    site: "Site",
    campaign: "Campaign",
    message: "Message",
  };
  return `${groups[group] ?? group} ${verb ?? ""}`.trim();
}

function actionIcon(action: string) {
  const [group] = action.split(".");
  return (
    {
      booking: "📅",
      gallery: "🖼",
      status: "🚦",
      staff: "👤",
      site: "🎨",
      campaign: "📣",
      message: "💬",
    } as Record<string, string>
  )[group] ?? "•";
}

function summariseMeta(meta: Record<string, unknown>) {
  const interesting = ["service", "email", "role", "channel", "sent", "key", "status", "approved"];
  const parts = interesting
    .filter((key) => meta[key] !== undefined && meta[key] !== null)
    .map((key) => `${key}: ${String(meta[key])}`);
  return parts.slice(0, 3).join(", ") || "—";
}
