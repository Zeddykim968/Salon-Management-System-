# Salon Platform

A booking website and management system for a salon, built to appeal to university students: fast on phones, bold visuals, transparent prices, WhatsApp-first communication.

**Stack:** Next.js (frontend) · FastAPI (backend) · Supabase (Postgres, Auth, Storage, Realtime)

---

## 1. Roles and what each can do

| Role | Sign-up | Can do |
|---|---|---|
| **Customer** | Public registration | Browse styles, see stylist availability, request bookings, chat with staff/admin, view own bookings |
| **Salonist** | Invited by Admin | Edit profile and WhatsApp number, upload work photos, view and manage own schedule, toggle Available/Busy |
| **Nail Tech** | Invited by Admin | Same as Salonist (nail services) |
| **Admin** | First one created manually | Everything above, plus: manage site images, services and staff, monitor staff activity, chat with staff and customers, send offers by email/WhatsApp |

The role is stored in the database (`profiles.role`) and checked on the server for every request. It is never trusted from the browser.

---

## 2. Project structure

```
salon/
├── README.md
├── .env.example
├── supabase/
│   └── schema.sql              # tables, constraints, RLS, signup trigger
├── backend/
│   ├── requirements.txt
│   ├── Dockerfile
│   └── app/
│       ├── main.py             # FastAPI app, CORS, router registration
│       ├── config.py           # env settings
│       ├── auth.py             # JWT verification + require_role()
│       ├── db.py               # Supabase / Postgres client
│       ├── notify.py           # email (Resend) + WhatsApp Cloud API senders
│       └── routers/
│           ├── public.py       # services, staff list, availability, gallery
│           ├── bookings.py     # create / confirm / decline / cancel
│           ├── staff.py        # profile, status, schedule, uploads
│           ├── messages.py     # chat between users
│           └── admin.py        # staff invites, site images, activity, campaigns
└── frontend/
    ├── package.json
    ├── middleware.ts           # route guard by role
    └── src/
        ├── lib/
        │   ├── supabase.ts     # browser/server Supabase clients
        │   └── api.ts          # fetch wrapper that attaches the JWT
        └── app/
            ├── page.tsx                    # landing page
            ├── styles/[id]/page.tsx        # style + stylists + availability
            ├── book/[staffId]/page.tsx     # slot picker + confirm
            ├── login/page.tsx
            ├── register/page.tsx
            ├── account/page.tsx            # customer: bookings + chat
            ├── staff/
            │   ├── page.tsx                # schedule + Available/Busy toggle
            │   ├── profile/page.tsx        # WhatsApp, bio, photo
            │   └── gallery/page.tsx        # upload work photos
            └── admin/
                ├── page.tsx                # overview + staff activity
                ├── staff/page.tsx          # invite / disable staff
                ├── site/page.tsx           # hero, banners, gallery control
                ├── messages/page.tsx       # chat with staff and customers
                └── campaigns/page.tsx      # offers by email / WhatsApp
```

---

## 3. Authentication (real, not mocked)

Supabase Auth handles credentials, password hashing, email verification, password reset and sessions. FastAPI never stores passwords; it only verifies the token.

**Flow**

1. Customer registers at `/register` with email and password (email verification required).
2. A database trigger creates a `profiles` row with `role = 'customer'`.
3. Staff are **never** self-registered. Admin enters their email in `/admin/staff`; the backend calls Supabase `invite_user_by_email` using the service-role key, then sets `profiles.role` to `salonist` or `nail_tech`. The staff member sets their password from the email link.
4. The frontend sends `Authorization: Bearer <access_token>` on every API call.
5. The backend verifies the JWT (using the project's JWKS endpoint, or the legacy JWT secret on older Supabase projects), loads the role from `profiles`, and enforces it:

```python
# backend/app/auth.py (shape)
def require_role(*roles: str):
    def dep(user = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(403, "Forbidden")
        return user
    return dep

# usage
@router.post("/admin/staff/invite")
def invite(body: InviteIn, admin = Depends(require_role("admin"))): ...
```

6. `frontend/middleware.ts` redirects by role (`/staff/*` for staff and admin, `/admin/*` for admin only). This is a convenience; the real protection is the backend check plus Postgres Row Level Security.

**Security checklist**

- Enable email confirmation and a minimum password length in Supabase Auth settings.
- The service-role key lives only in backend environment variables, never in the frontend.
- Turn on RLS for every table. Customers can read only their own bookings and messages; staff only their own schedule.
- Rate-limit login, register and booking endpoints (e.g. `slowapi`).

---

## 4. Booking flow

1. Customer opens the site and picks a **style/service** (price and duration are visible).
2. The page lists stylists who perform that service. Each card shows photo, work gallery, **Available/Busy badge**, and a **WhatsApp button** (`https://wa.me/<number>?text=<prefilled message>`).
3. Customer opens the stylist's availability: free slots are computed as *working hours minus existing pending/confirmed bookings*.
4. Customer picks a slot and submits. A booking is created as **`pending`** and the slot is held, so no one else can take it.
5. The stylist is notified (in-app and WhatsApp). The customer and stylist can agree details on WhatsApp.
6. Stylist taps **Confirm** (or Decline). On confirm, the booking appears in their schedule as `confirmed` and the customer is notified. Declined or expired pending bookings free the slot.
7. Stylist marks the booking `completed` after the appointment.

**Double booking is prevented by the database**, not by application code (see the exclusion constraint in the schema).

Staff status (`available` / `busy` / `off`) is a manual toggle shown on the public site. It is a signal for customers; the slot calendar remains the source of truth for bookable times.

---

## 5. Database schema (`supabase/schema.sql`)

```sql
create extension if not exists btree_gist;

create type user_role      as enum ('customer','salonist','nail_tech','admin');
create type booking_status as enum ('pending','confirmed','declined','cancelled','completed');
create type staff_status   as enum ('available','busy','off');

create table profiles (
  id               uuid primary key references auth.users on delete cascade,
  full_name        text not null default '',
  phone            text,
  role             user_role not null default 'customer',
  avatar_url       text,
  marketing_opt_in boolean not null default true,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table staff_details (
  staff_id    uuid primary key references profiles(id) on delete cascade,
  bio         text,
  whatsapp    text,                       -- E.164, e.g. 2547XXXXXXXX
  status      staff_status not null default 'available',
  status_note text,
  updated_at  timestamptz not null default now()
);

create table services (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text not null check (category in ('hair','nails')),
  price_kes    int  not null,
  duration_min int  not null,
  image_url    text,
  active       boolean not null default true
);

create table staff_services (
  staff_id   uuid references profiles(id) on delete cascade,
  service_id uuid references services(id) on delete cascade,
  primary key (staff_id, service_id)
);

create table working_hours (
  staff_id   uuid references profiles(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time   time not null
);

create table bookings (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id),
  staff_id    uuid not null references profiles(id),
  service_id  uuid not null references services(id),
  during      tstzrange not null,
  status      booking_status not null default 'pending',
  notes       text,
  created_at  timestamptz not null default now(),
  -- no overlapping pending/confirmed bookings for the same staff member
  exclude using gist (staff_id with =, during with &&)
    where (status in ('pending','confirmed'))
);

create table gallery (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid references profiles(id) on delete set null,
  image_url  text not null,
  caption    text,
  approved   boolean not null default true,
  created_at timestamptz not null default now()
);

create table site_assets (               -- hero image, banners, etc.
  key       text primary key,            -- 'hero', 'banner_1', ...
  image_url text not null
);

create table messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references profiles(id),
  recipient_id uuid not null references profiles(id),
  body         text not null,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create table campaigns (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid not null references profiles(id),
  channel    text not null check (channel in ('email','whatsapp')),
  subject    text,
  body       text not null,
  audience   text not null default 'all_customers',
  sent_at    timestamptz
);

create table activity_log (              -- what the Admin monitors
  id         bigserial primary key,
  actor_id   uuid references profiles(id),
  action     text not null,              -- 'booking.confirm', 'gallery.upload', 'status.busy'
  meta       jsonb,
  created_at timestamptz not null default now()
);

-- auto-create a customer profile on signup
create function handle_new_user() returns trigger as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end; $$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- enable RLS on every table, then add policies, e.g.:
alter table bookings enable row level security;
create policy "customer sees own bookings" on bookings
  for select using (customer_id = auth.uid());
create policy "staff sees own schedule" on bookings
  for select using (staff_id = auth.uid());
-- repeat the pattern for messages, staff_details, gallery, profiles
```

---

## 6. API overview

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| GET | `/services` | public | Styles with prices |
| GET | `/services/{id}/staff` | public | Stylists for a style, with status and WhatsApp |
| GET | `/staff/{id}/availability?date=` | public | Free slots for a day |
| GET | `/gallery` | public | Approved work photos |
| POST | `/bookings` | customer | Request a slot (`pending`) |
| GET | `/bookings/mine` | customer | Own bookings |
| PATCH | `/bookings/{id}/cancel` | customer | Cancel own booking |
| GET | `/staff/schedule` | salonist, nail_tech | Own bookings list |
| PATCH | `/bookings/{id}/confirm` · `/decline` · `/complete` | salonist, nail_tech | Manage a booking |
| PATCH | `/staff/status` | salonist, nail_tech | Available / Busy / Off |
| PUT | `/staff/profile` | salonist, nail_tech | Bio, WhatsApp number |
| POST | `/staff/gallery` | salonist, nail_tech | Upload work photo |
| GET/POST | `/messages` | any logged-in | Chat (Realtime for live updates) |
| POST | `/admin/staff/invite` | admin | Invite staff, assign role |
| PATCH | `/admin/staff/{id}` | admin | Change role or deactivate |
| PUT | `/admin/site-assets/{key}` | admin | Replace website images |
| DELETE | `/admin/gallery/{id}` | admin | Remove a work photo |
| GET | `/admin/activity` | admin | Staff activity feed |
| POST | `/admin/campaigns` | admin | Send offers by email/WhatsApp |

Every state-changing action writes a row to `activity_log`.

---

## 7. Messaging and promotions

- **Customer to stylist:** WhatsApp click-to-chat link (`wa.me`) with a prefilled message. No API cost and no approval needed.
- **Admin to staff and customers (in-app):** `messages` table with Supabase Realtime for live chat.
- **Notifications** (new booking, confirmation, reminder): WhatsApp Cloud API template messages, with email as fallback.
- **Promotions:** Admin writes an offer in `/admin/campaigns`, chooses email or WhatsApp, and picks the audience. Only customers with `marketing_opt_in = true` are included. Email goes through Resend. WhatsApp promotions must use pre-approved templates in Meta Business Manager.

---

## 8. Environment variables

`.env.example`

```env
# --- backend ---
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=      # backend only, never expose
SUPABASE_JWT_SECRET=            # only if your project uses the legacy HS256 secret
FRONTEND_ORIGIN=http://localhost:3000
RESEND_API_KEY=
EMAIL_FROM=Salon <hello@yourdomain.com>
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

# --- frontend ---
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## 9. Run locally

```bash
# 1. backend
cd backend
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 2. frontend (new terminal)
cd frontend
npm install
npm run dev                                           # http://localhost:3000
```

`backend/requirements.txt`

```
fastapi
uvicorn[standard]
pydantic-settings
supabase
pyjwt[crypto]
httpx
resend
slowapi
```

---

## 10. Deployment, step by step

### Step 1: Supabase (database, auth, storage)

1. Create a project at supabase.com.
2. SQL Editor: paste and run `supabase/schema.sql`.
3. Storage: create two **public-read** buckets, `gallery` and `site`. Uploads go through the backend, so no public write access.
4. Authentication settings: enable **Confirm email**, set a minimum password length, and set the **Site URL** to your future frontend URL (use `http://localhost:3000` for now).
5. Copy the project URL, anon key and service-role key into your env files.

### Step 2: Create the first Admin

1. Register normally on the site (or in Supabase Auth, Users, Add user).
2. In the SQL Editor run:

```sql
update profiles set role = 'admin' where id = '<your-user-uuid>';
```

3. From now on, create all staff accounts from `/admin/staff`.

### Step 3: Deploy the backend (Railway, Render or Fly.io)

1. Push the repo to GitHub.
2. Create a new service from the repo with root directory `backend`.
3. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Add the backend environment variables from section 8.
5. Set `FRONTEND_ORIGIN` to the frontend domain (you will fill this in after step 4; redeploy once).
6. Check `https://<api-domain>/docs` loads.

### Step 4: Deploy the frontend (Vercel)

1. Import the same GitHub repo in Vercel with root directory `frontend`.
2. Add the three `NEXT_PUBLIC_*` variables, with `NEXT_PUBLIC_API_URL` pointing at the deployed API.
3. Deploy, then copy the production URL.

### Step 5: Connect everything

1. Supabase, Authentication, URL Configuration: set Site URL and add the Vercel URL to Redirect URLs.
2. Update `FRONTEND_ORIGIN` on the backend to the Vercel URL and redeploy.
3. Add your custom domain in Vercel and update both URLs again.

### Step 6: Messaging providers

1. **Email:** create a Resend account, verify your domain, add `RESEND_API_KEY`.
2. **WhatsApp Cloud API:** create a Meta Business app, add a phone number, create and get approval for templates (booking request, confirmation, reminder, promotion), add the token and phone number ID.

### Step 7: Smoke test before launch

- [ ] Register a customer and confirm the email works
- [ ] Admin invites a Salonist and a Nail Tech; both can set passwords and log in
- [ ] Each staff member adds a WhatsApp number, uploads a photo, and toggles Busy/Available
- [ ] Customer picks a style, sees the right stylists and open slots, and requests a booking
- [ ] Staff sees the pending booking, confirms it, and it shows in their schedule
- [ ] A second customer cannot book the same slot
- [ ] A customer cannot open `/staff` or `/admin`; a staff member cannot open `/admin`
- [ ] Admin replaces the hero image and sees it live on the landing page
- [ ] Admin sends a test offer by email and sees staff activity in the feed

---

## 11. Build order

1. Schema, auth, role guard (backend and middleware)
2. Public pages: landing, styles, stylist cards, availability
3. Booking request and staff confirm/decline
4. Staff views: schedule, status toggle, profile, gallery upload
5. Admin views: staff invites, site images, activity feed
6. Messaging and campaigns
7. Polish: animations, PWA install, reminders, M-Pesa deposits

---

## 12. Later upgrades

- M-Pesa (Daraja STK Push) deposits to reduce no-shows
- Student discount verification and referral codes
- Automatic reminders 24 hours and 2 hours before appointments
- No-show prediction and demand forecasting from booking history
