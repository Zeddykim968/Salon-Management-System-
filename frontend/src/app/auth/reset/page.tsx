"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { api } from "@/lib/api";

function ResetInner() {
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid") || "";
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const hasLink = Boolean(uid && token);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (password.length < 8) throw new Error("Password must be at least 8 characters");
      if (password !== confirm) throw new Error("Passwords do not match");
      await api("/auth/password-reset/confirm", { json: { uid, token, password }, auth: false });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the password");
    } finally {
      setBusy(false);
    }
  }

  if (!hasLink) {
    return (
      <div className="container page" style={{ maxWidth: 480 }}>
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <h2>Link missing</h2>
          <p className="muted">
            Open the reset link from your email, or request a fresh one.
          </p>
          <Link href="/login" className="btn btn-primary">
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="container page" style={{ maxWidth: 480 }}>
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <h2>Password updated ✓</h2>
          <p className="muted">Sign in with your new password.</p>
          <Link href="/login" className="btn btn-primary">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container page" style={{ maxWidth: 460 }}>
      <h1 style={{ fontSize: "2.2rem" }}>Choose a new password</h1>
      <p className="muted">This link is single-use and expires soon.</p>

      {error ? <div className="alert error">{error}</div> : null}

      <form className="card" onSubmit={save}>
        <label className="label" htmlFor="password">
          New password
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

        <label className="label" htmlFor="confirm">
          Confirm password
        </label>
        <input
          id="confirm"
          className="input"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Repeat it"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />

        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 22 }}
          disabled={busy}
          type="submit"
        >
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="loading" style={{ paddingTop: 90 }}><span className="spinner" /></div>}>
      <ResetInner />
    </Suspense>
  );
}
