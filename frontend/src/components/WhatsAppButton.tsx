import { waLink } from "@/lib/api";

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
    <a
      className={`btn ${size === "sm" ? "btn-sm " : ""}btn-ghost ${className}`}
      href={waLink(digits, text)}
      target="_blank"
      rel="noopener noreferrer"
      style={{ borderColor: "rgba(61,220,132,.55)", color: "#6ef0a9" }}
    >
      {label} 💬
    </a>
  );
}
