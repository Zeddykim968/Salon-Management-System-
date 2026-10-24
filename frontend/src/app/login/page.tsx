"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { api } from "@/lib/api";
import { saveTokens } from "@/lib/auth";
import type { Me } from "@/lib/types";

function homeFor(role: string) {
  if (role === "admin") return "/admin";
  if (role === "salonist" || role === "nail_tech") return "/staff";
  return "/account";
}

function LoginInner() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetMode, setResetMode] = useState(false);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const data = await api<{ access: string; refresh: string; role: string }>(
        "/auth/login",
        { json: { email: email.trim(), password }, auth: false }
      );
      if (!data?.access) throw new Error("No session returned");
      saveTokens({ access: data.access, refresh: data.refresh });

      // route by role — the backend is the authority
      let destination = next || "/account";
      if (!next) {
        try {
          const me = await api<Me>("/me");
          destination = homeFor(me.role);
        } catch {
          destination = "/account";
        }
      }
      window.location.assign(destination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      setBusy(false);
    }
  }

  async function sendReset(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await api("/auth/password-reset", { json: { email: email.trim() }, auth: false });
      setInfo("Check your inbox — we sent a password reset link.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the reset email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container page" style={{ maxWidth: 460 }}>
      <h1 style={{ fontSize: "2.2rem" }}>
        {resetMode ? "Reset password" : "Welcome back"}
      </h1>
      <p className="muted">
        {resetMode
          ? "We'll email you a secure link to set a new password."
          : "Log in to book, chat and manage your appointments."}
      </p>

      {error ? <div className="alert error">{error}</div> : null}
      {info ? <div className="alert success">{info}</div> : null}

      <form className="card" onSubmit={resetMode ? sendReset : signIn}>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className="input"
          type="email"
          autoComplete="email"
          required
          placeholder="you@school.ac.ke"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        {!resetMode ? (
          <>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </>
        ) : null}

        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 20 }}
          disabled={busy}
          type="submit"
        >
          {busy ? "…" : resetMode ? "Send reset link" : "Log in"}
        </button>

        <div className="row between" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setResetMode((mode) => !mode);
              setError(null);
              setInfo(null);
            }}
          >
            {resetMode ? "← Back to login" : "Forgot password?"}
          </button>
          {!resetMode ? (
            <Link href="/register" className="small" style={{ color: "var(--pink)" }}>
              Create account →
            </Link>
          ) : null}
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="loading" style={{ paddingTop: 90 }}><span className="spinner" /></div>}>
      <LoginInner />
    </Suspense>
  );
}
