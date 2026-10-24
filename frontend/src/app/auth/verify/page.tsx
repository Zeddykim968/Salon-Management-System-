"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";

function VerifyInner() {
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid") || "";
  const token = searchParams.get("token") || "";

  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!uid || !token) {
      setState("error");
      setMessage("This verification link is incomplete — request a new one.");
      return;
    }
    api("/auth/verify-email", { json: { uid, token }, auth: false })
      .then((res) => {
        setMessage((res as { detail?: string })?.detail || "Email verified.");
        setState("ok");
      })
      .catch((e) => {
        setMessage(e instanceof Error ? e.message : "This link is invalid.");
        setState("error");
      });
  }, [uid, token]);

  return (
    <div className="container page" style={{ maxWidth: 480 }}>
      <div className="card" style={{ textAlign: "center", padding: 34 }}>
        <div style={{ fontSize: "3rem" }}>{state === "ok" ? "✅" : state === "error" ? "⚠️" : "…"}</div>
        <h2>
          {state === "working"
            ? "Verifying your email…"
            : state === "ok"
              ? "Email verified"
              : "Couldn't verify"}
        </h2>
        <p className="muted">{message}</p>
        {state === "ok" ? (
          <Link href="/login" className="btn btn-primary">
            Continue to login
          </Link>
        ) : state === "error" ? (
          <Link href="/login" className="btn btn-ghost">
            Back to login
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="loading" style={{ paddingTop: 90 }}><span className="spinner" /></div>}>
      <VerifyInner />
    </Suspense>
  );
}
