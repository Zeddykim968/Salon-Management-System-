"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { Message } from "@/lib/types";

/**
 * Chat thread with one user. The Django API has no websocket layer, so new
 * messages arrive via light polling while the thread is open.
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
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // load thread
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
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

  // poll for new messages while the thread is open
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const thread = await api<Message[]>(`/messages?user_id=${otherId}`);
        if (alive) setMessages(thread);
      } catch {
        /* transient — keep the last good thread */
      }
    };
    const interval = setInterval(() => void tick(), 8000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [otherId]);

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
        <span className="small muted">in-app chat</span>
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
