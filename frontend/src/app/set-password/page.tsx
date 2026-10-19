"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import type { Me } from "@/lib/types";

function homeFor(role: string) {
  if (role === "admin") return "/admin";
  if (role === "salonist" || role === "nail_tech") return "/staff";
  return "/account";
}

export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data }) => setHasSession(Boolean(data.session)))
      .catch(() => setHasSession(false));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (password.length < 8) throw new Error("Password must be at least 8 characters");
      if (password !== confirm) throw new Error("Passwords do not match");
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);

      let destination = "/account";
      try {
        const me = await api<Me>("/me");
        destination = homeFor(me.role);
      } catch {
        /* profile may still be propagating */
      }
      window.location.assign(destination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the password");
      setBusy(false);
    }
  }

  if (hasSession === false) {
    return (
      <div className="container page" style={{ maxWidth: 480 }}>
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <h2>Link expired?</h2>
          <p className="muted">
            We couldn&apos;t verify this link. Request a new one from the login
            page — or ask the admin to re-send your staff invite.
          </p>
          <Link href="/login" className="btn btn-primary">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  if (hasSession === null) {
    return (
      <div className="loading" style={{ paddingTop: 90 }}>
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div className="container page" style={{ maxWidth: 460 }}>
      <h1 style={{ fontSize: "2.2rem" }}>Set your password</h1>
      <p className="muted">
        One last step — this password is stored by Supabase Auth (never by the
        salon app itself).
      </p>

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
          {busy ? "Saving…" : "Save & continue"}
        </button>
      </form>
    </div>
  );
}
