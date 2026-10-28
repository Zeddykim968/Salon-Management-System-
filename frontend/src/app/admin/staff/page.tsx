"use client";

import { useCallback, useEffect, useState } from "react";

import StatusBadge from "@/components/StatusBadge";
import { api } from "@/lib/api";
import type { Me, Role, StaffMember } from "@/lib/types";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "salonist", label: "Salonist (hair)" },
  { value: "nail_tech", label: "Nail tech" },
  { value: "admin", label: "Admin" },
];

export default function AdminStaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // signed-in admin, so we never offer to delete our own account
  const [meId, setMeId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("salonist");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    try {
      setStaff(await api<StaffMember[]>("/admin/staff"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load staff");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void api<Me>("/me")
      .then((me) => setMeId(me.id))
      .catch(() => setMeId(null));
  }, [load]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setInviting(true);
    setError(null);
    setNotice(null);
    try {
      const invited = await api<StaffMember>("/admin/staff/invite", {
        json: { email: email.trim(), full_name: fullName.trim(), role },
      });
      setNotice(
        `Invite sent to ${invited.email} — they set their password from the email link.`
      );
      setEmail("");
      setFullName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  }

  async function remove(member: StaffMember) {
    setDeletingId(member.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/admin/staff/${member.id}`, { method: "DELETE" });
      setStaff((prev) => prev.filter((s) => s.id !== member.id));
      setNotice(`${member.full_name || member.email} was deleted with their data.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      await load();
    } finally {
      setDeletingId(null);
      setConfirming(null);
    }
  }

  async function patch(member: StaffMember, changes: Partial<Pick<StaffMember, "role" | "active">>) {
    setError(null);
    try {
      await api(`/admin/staff/${member.id}`, { method: "PATCH", json: changes });
      setStaff((prev) => prev.map((s) => (s.id === member.id ? { ...s, ...changes } : s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      await load();
    }
  }

  return (
    <div className="container page" style={{ paddingTop: 8 }}>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>Team</h1>
          <p className="muted">
            Staff never self-register — you invite them by email and assign the
            role.
          </p>
        </div>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      <form className="card" onSubmit={invite} style={{ marginBottom: 28 }}>
        <strong>Invite a staff member</strong>
        <div className="field-row" style={{ marginTop: 10 }}>
          <div>
            <span className="label">Full name</span>
            <input
              className="input"
              required
              value={fullName}
              placeholder="Jane Otieno"
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>
          <div>
            <span className="label">Email</span>
            <input
              className="input"
              type="email"
              required
              value={email}
              placeholder="stylist@salon.co.ke"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <select className="select" style={{ maxWidth: 260 }} value={role} onChange={(event) => setRole(event.target.value as Role)}>
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit" disabled={inviting}>
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Email sends the invite; the new member lands on
          <b> /set-password</b> and their schedule is seeded Mon–Sat 09:00–18:00
          and they pick which services they offer from their profile.
        </p>
      </form>

      {loading ? (
        <div className="loading">
          <span className="spinner" />
        </div>
      ) : staff.length === 0 ? (
        <div className="empty">No staff yet — send the first invite above.</div>
      ) : (
        <div className="list">
          {staff.map((member) => (
            <div key={member.id} className="list-item">
              <span className="avatar">
                {member.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={member.avatar_url} alt={member.full_name} />
                ) : (
                  (member.full_name || "?").slice(0, 1).toUpperCase()
                )}
              </span>
              <div className="grow" style={{ minWidth: 180 }}>
                <div className="row tight">
                  <strong>{member.full_name || "—"}</strong>
                  {!member.active ? <span className="badge cancelled">disabled</span> : <StatusBadge status={member.status} />}
                </div>
                <div className="small muted">
                  {member.email ?? "—"} · {member.phone ?? "no phone"}
                </div>
              </div>

              <div className="row tight small muted">
                <span title="Bookings">{member.stats.total} bookings</span>
                <span title="Pending">· {member.stats.pending} pending</span>
              </div>

              <select
                className="select"
                style={{ maxWidth: 190, padding: "9px 12px" }}
                value={member.role}
                onChange={(event) => void patch(member, { role: event.target.value as Role })}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <button
                className={`btn btn-sm ${member.active ? "btn-danger" : "btn-lime"}`}
                onClick={() => void patch(member, { active: !member.active })}
              >
                {member.active ? "Disable" : "Enable"}
              </button>

              {meId && member.id === meId ? (
                <span className="badge" title="You cannot delete your own account">
                  that&apos;s you
                </span>
              ) : confirming === member.id ? (
                <span className="row tight">
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={deletingId === member.id}
                    onClick={() => void remove(member)}
                  >
                    {deletingId === member.id ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={deletingId === member.id}
                    onClick={() => setConfirming(null)}
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  className="btn btn-sm btn-ghost"
                  title="Delete this staff member and their data (schedule, bookings, photos)"
                  onClick={() => setConfirming(member.id)}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
