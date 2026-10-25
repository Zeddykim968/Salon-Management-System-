import { waLink } from "@/lib/api";

import { Magnetic } from "./motion";

export default function WhatsAppButton({
  number,
  text,
  label = "Chat on WhatsApp",
  size = "",
  className = "",
}: {
  number: string | null | undefined;
  text: string;
  label?: string;
  size?: "sm" | "";
  className?: string;
}) {
  const digits = (number || "").replace(/\D/g, "");
  if (!digits) return null;
  return (
    <Magnetic strength={0.35} className={className}>
      <a
        className={`btn ${size === "sm" ? "btn-sm " : ""}btn-ghost wa-btn`}
        href={waLink(digits, text)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {label} 💬
      </a>
    </Magnetic>
  );
}
