"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Campaign } from "@/lib/types";

type Channel = "email" | "whatsapp";
type Audience = "all_customers" | "staff";

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [channel, setChannel] = useState<Channel>("email");
  const [audience, setAudience] = useState<Audience>("all_customers");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [links, setLinks] = useState<{ name: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setCampaigns(await api<Campaign[]>("/admin/campaigns"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const verb = channel === "email" ? "Send" : "Prepare";
    if (!window.confirm(`${verb} this offer by ${channel} to ${audience.replace("_", " ")}?`)) return;
    setSending(true);
    setError(null);
    setResult(null);
    setLinks([]);
    try {
      const response = await api<{
        attempted: number;
        sent: number;
        links?: { name: string; url: string }[];
      }>("/admin/campaigns", {
        json: { channel, audience, subject: subject.trim() || null, body },
      });
      if (channel === "email") {
        setResult(
          `Emails sent: ${response.sent}/${response.attempted} (until a Brevo key is set they are logged, not sent).`
        );
      } else {
        const prepared = response.links ?? [];
        setLinks(prepared);
        setResult(
          prepared.length === 0
            ? "Nobody in this audience has a phone number saved."
            : `${prepared.length} WhatsApp chats prepared — tap a name to open WhatsApp with the message already written.`
        );
      }
      setSubject("");
      setBody("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="container page" style={{ paddingTop: 8 }}>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>Offers & campaigns</h1>
          <p className="muted">
            Email goes through Brevo; WhatsApp opens a wa.me chat with the
            message pre-written — nothing is sent from a server. Only marketing
            opt-in customers receive promos.
          </p>
        </div>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {result ? <div className="alert success">{result}</div> : null}

      {links.length > 0 ? (
        <div className="card" style={{ marginBottom: 30 }}>
          <strong>Open these chats</strong>
          <div className="list" style={{ marginTop: 12 }}>
            {links.map((link) => (
              <a
                key={link.url}
                className="list-item wa-link-row"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: "11px 15px" }}
              >
                <span className="grow">{link.name}</span>
                <span className="small" style={{ color: "var(--ok)" }}>
                  Open WhatsApp →
                </span>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <form className="card" onSubmit={send} style={{ marginBottom: 30 }}>
        <div className="field-row">
          <div>
            <span className="label">Channel</span>
            <select className="select" value={channel} onChange={(event) => setChannel(event.target.value as Channel)}>
              <option value="email">Email (Brevo)</option>
              <option value="whatsapp">WhatsApp (wa.me links)</option>
            </select>
          </div>
          <div>
            <span className="label">Audience</span>
            <select className="select" value={audience} onChange={(event) => setAudience(event.target.value as Audience)}>
              <option value="all_customers">All opted-in customers</option>
              <option value="staff">Staff</option>
            </select>
          </div>
        </div>

        <span className="label">Subject (email)</span>
        <input
          className="input"
          value={subject}
          maxLength={200}
          placeholder="Mid-term blowout — 20% off Wednesdays"
          onChange={(event) => setSubject(event.target.value)}
        />

        <span className="label">Message</span>
        <textarea
          className="textarea"
          required
          value={body}
          maxLength={5000}
          placeholder={"Hey! This week only: silk press at KSh 1,500 for students.\nBook on the site — slots go fast 💇‍♀️"}
          onChange={(event) => setBody(event.target.value)}
        />

        <div className="row between" style={{ marginTop: 16 }}>
          <span className="small muted">{body.length}/5000</span>
 <button className="btn btn-primary" type="submit" disabled={sending || !body.trim()}>
            {sending
              ? "Working…"
              : channel === "email"
                ? "Send by email"
                : "Prepare WhatsApp chats"}
          </button>
        </div>
      </form>

      <h2 style={{ fontSize: "1.35rem" }}>Sent campaigns</h2>
      {loading ? (
        <div className="loading">
          <span className="spinner" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="empty">No campaigns sent yet.</div>
      ) : (
        <div className="list" style={{ marginTop: 14 }}>
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="list-item">
              <span className={`chip ${campaign.channel === "email" ? "hair" : "nails"}`}>
                {campaign.channel}
              </span>
              <div className="grow">
                <strong>{campaign.subject || "(no subject)"}</strong>
                <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>
                  {campaign.body.slice(0, 180)}
                  {campaign.body.length > 180 ? "…" : ""}
                </div>
                <div className="small muted">
                  → {campaign.audience.replace("_", " ")} · by{" "}
                  {campaign.created_by_name ?? "admin"}
                </div>
              </div>
              <span className="small muted" style={{ whiteSpace: "nowrap" }}>
                {campaign.sent_at
                  ? new Date(campaign.sent_at).toLocaleString([], {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "draft"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
