"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/staff", label: "Team" },
  { href: "/admin/services", label: "Services" },
  { href: "/admin/site", label: "Site & gallery" },
  { href: "/admin/messages", label: "Messages" },
  { href: "/admin/campaigns", label: "Offers" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div>
      <div className="container" style={{ paddingTop: 26 }}>
        <div className="kicker" style={{ color: "var(--pink)", letterSpacing: "0.2em", fontSize: "0.72rem", fontWeight: 850, textTransform: "uppercase" }}>
          Admin console
        </div>
        <div className="tabs" style={{ marginTop: 12 }}>
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`tab${pathname === tab.href ? " active" : ""}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}
