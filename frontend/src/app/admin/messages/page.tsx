"use client";

import { useEffect, useState } from "react";

import Chat from "@/components/Chat";
import { api } from "@/lib/api";
import type { Contact } from "@/lib/types";

export default function AdminMessagesPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<Contact[]>("/messages/contacts")
      .then((data) => {
        if (!alive) return;
        setContacts(data);
        setActive(data[0]?.id ?? null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const current = contacts.find((contact) => contact.id === active) ?? null;

  return (
    <div className="container page" style={{ paddingTop: 8 }}>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>Messages</h1>
          <p className="muted">Live chat with staff and customers (Supabase Realtime).</p>
        </div>
      </div>

      {error ? <div className="alert error">{error}</div> : null}

      {loading ? (
        <div className="loading">
          <span className="spinner" />
        </div>
      ) : contacts.length === 0 ? (
        <div className="empty">No users to chat with yet.</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "minmax(240px, 320px) 1fr" }}>
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
            {current ? (
              <Chat otherId={current.id} otherName={current.full_name} />
            ) : (
              <div className="empty">Pick a conversation</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
