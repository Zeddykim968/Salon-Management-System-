"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "salon_theme";

function currentTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

/** Sun/moon toggle for the pink↔purple light/dark themes. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // read the applied theme once mounted (layout sets it before paint)
  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked — theme still applies for this page view */
    }
  }

  return (
    <button
      className="btn btn-ghost btn-sm theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      style={{ padding: "8px 12px", lineHeight: 1 }}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
