"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import type { Message } from "@/lib/types";

/**
 * Live chat thread with one user. Incoming messages arrive through Supabase
 * Realtime (postgres_changes filtered to the signed-in recipient).
 */
export default function Chat({
  otherId,
  otherName,
}: {
  otherId: string;
  otherName: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // load thread + my id
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        if (alive) setMyId(data.session?.user.id ?? null);
        const thread = await api<Message[]>(`/messages?user_id=${otherId}`);
        if (alive) setMessages(thread);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load chat");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [otherId]);

  // realtime: new messages addressed to me
  useEffect(() => {
    if (!myId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`messages-${myId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `recipient_id=eq.${myId}`,
        },
        (payload) => {
          const row = payload.new as Message;
          if (row.sender_id !== otherId && row.recipient_id !== otherId) return;
          setMessages((prev) =>
            prev.some((m) => m.id === row.id) ? prev : [...prev, { ...row, from_me: false }]
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [myId, otherId]);

  // keep the view pinned to the newest message
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const created = await api<Message>("/messages", {
        json: { recipient_id: otherId, body: text },
      });
      setMessages((prev) =>
        prev.some((m) => m.id === created.id) ? prev : [...prev, created]
      );
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card chat" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="row between"
        style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}
      >
        <strong>{otherName}</strong>
        <span className="small muted">live · Supabase Realtime</span>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {loading ? (
          <div className="loading">
            <span className="spinner" />
          </div>
        ) : messages.length === 0 ? (
          <div className="empty">
            Say hi to {otherName} 👋 — messages stay in the app, details get
            sorted on WhatsApp.
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`msg ${message.from_me ? "mine" : "theirs"}`}
            >
              <div>{message.body}</div>
              <div className="msg-time">
                {new Date(message.created_at).toLocaleString([], {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          ))
        )}
        {error ? <div className="alert error">{error}</div> : null}
      </div>

      <div className="chat-input">
        <input
          className="input"
          placeholder={`Message ${otherName}…`}
          value={draft}
          maxLength={2000}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn btn-primary" onClick={() => void send()} disabled={sending || !draft.trim()}>
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
