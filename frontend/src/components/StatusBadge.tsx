import type { BookingStatus, StaffStatus } from "@/lib/types";

export default function StatusBadge({
  status,
}: {
  status: StaffStatus | BookingStatus;
}) {
  const labels: Record<string, string> = {
    available: "Available",
    busy: "Busy",
    off: "Off today",
    pending: "Pending",
    confirmed: "Confirmed",
    completed: "Completed",
    declined: "Declined",
    cancelled: "Cancelled",
  };
  return (
    <span className={`badge ${status}`} style={{ textTransform: "none" }}>
      {labels[status] ?? status}
    </span>
  );
}
