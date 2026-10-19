export type Role = "customer" | "salonist" | "nail_tech" | "admin";
export type StaffStatus = "available" | "busy" | "off";
export type BookingStatus =
  | "pending"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "completed";

export interface Service {
  id: string;
  name: string;
  category: "hair" | "nails";
  price_kes: number;
  duration_min: number;
  image_url: string | null;
  active: boolean;
}

export interface StaffCard {
  id: string;
  full_name: string;
  role: Role;
  avatar_url: string | null;
  bio: string | null;
  whatsapp: string | null;
  status: StaffStatus;
  status_note: string | null;
  photos: { image_url: string; caption?: string | null }[];
}

export interface AvailabilitySlot {
  start: string;
  end: string;
  label: string;
}

export interface BookedBlock {
  start: string;
  end: string;
  status: BookingStatus;
  id: string;
}

export interface Availability {
  date: string;
  duration_min: number;
  hours: { start: string; end: string }[];
  slots: AvailabilitySlot[];
  booked: BookedBlock[];
  staff: {
    id: string;
    full_name: string;
    avatar_url: string | null;
    role: Role;
    bio: string | null;
    whatsapp: string | null;
    status: StaffStatus;
    status_note: string | null;
  } | null;
  service: {
    id: string;
    name: string;
    price_kes: number;
    duration_min: number;
    category: string;
  } | null;
}

export interface Booking {
  id: string;
  status: BookingStatus;
  start: string;
  end: string;
  when: string;
  notes: string | null;
  created_at: string;
  customer: {
    id: string;
    full_name: string;
    phone: string | null;
    avatar_url: string | null;
  };
  staff: { id: string; full_name: string; avatar_url: string | null };
  service: {
    id: string;
    name: string;
    price_kes: number | null;
    duration_min: number | null;
    category?: string;
  };
}

export interface Me {
  id: string;
  email: string | null;
  full_name: string;
  phone: string | null;
  role: Role;
  staff_details: {
    bio: string | null;
    whatsapp: string | null;
    status: StaffStatus;
    status_note: string | null;
  } | null;
}

export interface Contact {
  id: string;
  full_name: string;
  role: Role;
  avatar_url: string | null;
  phone: string | null;
  last_message: { body: string; created_at: string; from_me: boolean } | null;
  unread: number;
}

export interface Message {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  from_me?: boolean;
}

export interface StaffMember {
  id: string;
  full_name: string;
  email: string | null;
  role: Role;
  active: boolean;
  phone: string | null;
  avatar_url: string | null;
  status: StaffStatus;
  whatsapp: string | null;
  stats: { total: number; pending: number; confirmed: number };
}

export interface ActivityItem {
  id: number;
  action: string;
  meta: Record<string, unknown> | null;
  created_at: string;
  actor_name: string;
}

export interface GalleryPhoto {
  id: string;
  staff_id: string | null;
  image_url: string;
  caption: string | null;
  approved: boolean;
  created_at: string;
  staff_name?: string;
}

export interface Campaign {
  id: string;
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
  audience: string;
  sent_at: string | null;
  created_at: string;
  created_by_name?: string;
}
