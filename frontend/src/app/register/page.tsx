"use client";

import Link from "next/link";
import { useState } from "react";

import { api } from "@/lib/api";

export default function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signUp(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (password.length < 8) throw new Error("Password must be at least 8 characters");
      await api("/auth/register", {
        json: {
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          phone: phone.trim() || undefined,
        },
        auth: false,
      });
      setConfirming(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="container page" style={{ maxWidth: 520 }}>
        <div className="card" style={{ textAlign: "center", padding: 34 }}>
          <div style={{ fontSize: "3rem" }}>📬</div>
          <h2>Check your inbox</h2>
          <p className="muted">
            We sent a confirmation link to <b>{email}</b>. Click it to activate
            your account, then log in.
          </p>
          <Link href="/login" className="btn btn-primary">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container page" style={{ maxWidth: 520 }}>
      <h1 style={{ fontSize: "2.2rem" }}>Join the salon</h1>
      <p className="muted">
        Students book in under a minute — no calls, no queues.
      </p>

      {error ? <div className="alert error">{error}</div> : null}

      <form className="card" onSubmit={signUp}>
        <div className="field-row">
          <div>
            <label className="label" htmlFor="name">
              Full name
            </label>
            <input
              id="name"
              className="input"
              required
              placeholder="Amina Wanjiku"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="phone">
              Phone (optional)
            </label>
            <input
              id="phone"
              className="input"
              type="tel"
              placeholder="0712 345 678"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
        </div>

        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className="input"
          type="email"
          required
          autoComplete="email"
          placeholder="you@school.ac.ke"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="input"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 22 }}
          disabled={busy}
          type="submit"
        >
          {busy ? "Creating…" : "Create my account"}
        </button>

        <p className="small muted" style={{ marginTop: 14 }}>
          By joining you agree to receive booking updates by email and WhatsApp.
        </p>

        <div className="row between" style={{ marginTop: 6 }}>
          <span className="small muted">Already registered?</span>
          <Link href="/login" className="small" style={{ color: "var(--pink)" }}>
            Log in →
          </Link>
        </div>
      </form>

      <div className="alert info" style={{ marginTop: 18 }}>
        Staff accounts are invite-only — the admin creates those from
        <b> /admin/staff</b>.
      </div>
    </div>
  );
}
