# The Prince Beauty Parlour (Gataka) — booking site + management system

A full-stack salon app for **The Prince Beauty Parlour in Gataka**: customers
browse styles, see live availability and book; stylists manage a schedule and
chat; admins run the team, gallery and campaigns.

- **Backend:** Django 5.2 + Django REST Framework + SimpleJWT (`backend/`)
- **Frontend:** Next.js 15 (App Router) + React 19 + TypeScript (`frontend/`)
- **Database:** PostgreSQL (Render free Postgres in production, local Postgres in dev)
- **Images:** Cloudinary (optional — falls back to local `backend/media`)
- **Email:** Brevo SMTP API (optional — logs to the console locally)
- **WhatsApp:** `wa.me` click-to-chat links — no API key, no Meta approval
- **Motion:** framer-motion — draggable carousels, magnetic buttons, scroll reveals
- **Theme:** bright pink + purple, with a matching dark mode (toggle in the nav)

Everything is configured by **one `.env` file at the repo root.**

---

## 1. What you need

- Python 3.11+
- Node.js 18+ (20+ recommended)
- PostgreSQL 14+ (or a Render Postgres instance)

---

## 2. The single `.env` file

One file at the repo root configures **both** apps and is what you paste into Render:

- Django reads it directly (`backend/config/settings.py` loads `../.env`).
- Next.js reads it too (`frontend/next.config.ts` loads `../.env` and exposes
  `NEXT_API_URL` to the browser bundle).

There is deliberately **no** `.env.example` — copy the `.env` you already have
(keep it out of git; it is ignored) and edit the values below.

The values that matter to get running:

| Key | What it is | Local default |
|-----|------------|---------------|
| `DEBUG` | `True` in dev, `False` on Render | `True` |
| `DJANGO_SECRET_KEY` | Django secret (any random string in dev) | dev placeholder |
| `DATABASE_URL` | Postgres connection string | `postgresql://salon:salon@localhost:5432/salon` |
| `FRONTEND_ORIGIN` | Next.js origin, used in emailed links + CORS | `http://localhost:3000` |
| `NEXT_API_URL` | What the browser uses to reach the API | `http://localhost:8000` |
| `ALLOWED_HOSTS` | Comma-separated **hostnames** (no `https://`, no port) | `localhost,127.0.0.1` |
| `CORS_ALLOWED_ORIGINS` | Extra browser origins allowed to call the API | `https://your-app.vercel.app` |
| `CSRF_TRUSTED_ORIGINS` | Comma-separated origins | `http://localhost:3000` |

`ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS` are **merged
with safe defaults** (`localhost`, `.onrender.com`) in `settings.py`, so local dev
keeps working no matter what the file says.

Optional integrations (`BREVO_API_KEY`, `NEXT_PUBLIC_WHATSAPP_PHONE`, `CLOUDINARY_URL`, …)
can stay empty locally — each one **logs instead of sending** until you add a key,
so nothing breaks while you wire them up.

---

## 3. Run locally

### 3.1 Start Postgres

Any PostgreSQL works. With Docker:

```bash
docker run --name salon-pg -e POSTGRES_USER=salon -e POSTGRES_PASSWORD=salon \
  -e POSTGRES_DB=salon -p 5432:5432 -d postgres:16
```

Your `.env`'s `DATABASE_URL` already points at `localhost:5432/salon`. If you use a
different host/user/password, edit that one line.

> **Render note:** the `postgresql://…` External Database URL from the Render
> dashboard drops straight into `DATABASE_URL`. If it uses `postgres://` instead of
> `postgresql://`, that's fine — Django accepts both.

### 3.2 Backend (Django)

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt

python manage.py migrate          # create tables
python manage.py seed_salon       # seed services + default working hours
python manage.py runserver        # http://localhost:8000
```

Create an admin account (so you can log into `/admin`):

```bash
python manage.py seed_salon --admin-email you@example.com --admin-password 'ChangeMe!123'
```

The API lives at the root (no `/api` prefix): `/health`, `/services`, `/stylists`,
`/bookings`, `/auth/login`, `/admin/overview`, … The frontend already calls these
exact paths, so don't change the prefix.

### 3.3 Frontend (Next.js)
   
In a second terminal:

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

Open **http://localhost:3000**. Register a customer account, then confirm the
email. Locally the verification link is **printed in the Django server console**
(no Brevo key needed) — open it to activate the account, then log in.

---

## 4. How auth works

- **Customers** sign up at `/register` → confirm the emailed link → log in.
- **Staff (stylists / nail techs) and admins** are invited by an admin from
  `/admin/staff`; they receive a link to set their password.
- Sessions are **JWTs** (SimpleJWT). The access token lives 30 min, the refresh
  token 14 days; the frontend refreshes transparently. `middleware.ts` guards the
  `/account`, `/staff` and `/admin` routes by reading the token cookie and asking
  the backend for the role.

---

## 5. Deploy to Render

### 5.1 Database

1. Create a free **Postgres** instance on Render.
2. Copy its **External Database URL** into `DATABASE_URL`.

### 5.2 Backend (Web Service)

- **Root directory:** `backend`
- **Build command:** `pip install -r requirements.txt && python manage.py migrate`
- **Start command:** `gunicorn config.wsgi:application`
- **Environment:** paste the values from your `.env`, with production values:
  - `DEBUG=False`
  - `DJANGO_SECRET_KEY=<a long random string>`
  - `DATABASE_URL=<your Render Postgres URL>`
  - `ALLOWED_HOSTS=<your-app.onrender.com>`  ← hostname only, **never** `https://…`
  - `FRONTEND_ORIGIN=https://<your-frontend>.vercel.app`
  - `CORS_ALLOWED_ORIGINS=https://<your-frontend>.vercel.app`
  - `CSRF_TRUSTED_ORIGINS=https://<your-app>.onrender.com,https://<your-frontend>.vercel.app`

> **This is the CORS error.** `FRONTEND_ORIGIN` is the *frontend* (Vercel) origin,
> not the API's own host — if it points at Render, the browser's preflight gets no
> `Access-Control-Allow-Origin` header and every login fails.

After the first deploy, seed the admin once (Render Shell or a one-off command):

```bash
python manage.py seed_salon --admin-email you@example.com --admin-password '<strong-password>'
```

A `backend/Dockerfile` is included if you prefer a Docker web service.

### 5.3 Frontend (Vercel)

- **Root directory:** `frontend`
- **Build command:** `npm install && npm run build`
- **Environment:** set `NEXT_API_URL=https://<your-backend>.onrender.com`

`next.config.ts` reads the root `.env` at build time, but on Vercel it's cleanest
to set `NEXT_API_URL` in *Project → Settings → Environment Variables* (a real env
var wins over the file). **Set it before you build** — the value is inlined into
the bundle, so after changing it you must redeploy. If it's missing the browser
falls back to `http://localhost:8000`, which is exactly the mixed-content/CORS
error you see in the console.

---

## 6. Common commands

| Task | Command |
|------|---------|
| Create/apply migrations | `python manage.py makemigrations && python manage.py migrate` |
| Seed data + admin | `python manage.py seed_salon --admin-email … --admin-password …` |
| Django admin panel | `http://localhost:8000/backoffice/` |
| Frontend typecheck | `cd frontend && npm run typecheck` |
| Frontend production build | `cd frontend && npm run build` |

---

## 7. Theme (pink / purple + dark mode)

The site ships in a **bright pink + purple** light theme by default. The 🌙/☀️
button in the top nav toggles a **dark mode** that keeps the same pink/purple
identity on deeper surfaces. The choice is saved in `localStorage`
(`salon_theme`) and applied before first paint, so there's no flash.

All colors are CSS variables in `frontend/src/app/globals.css` — the light theme
lives in `:root`, the dark overrides in `[data-theme="dark"]`. Tweak those two
blocks to re-skin the whole app.

---

## 8. Project layout

```
.
├── .env                 # the ONE config file (both apps read it)
├── backend/             # Django + DRF + SimpleJWT
│   ├── config/          # settings, urls, wsgi/asgi
│   ├── core/            # models, serializers, views, migrations, seed
│   ├── requirements.txt
│   └── Dockerfile
└── frontend/            # Next.js App Router
    ├── src/app/         # pages (public, book, account, staff, admin, auth)
    ├── src/components/  # Nav, Chat, ThemeToggle, …
    └── src/lib/         # api client, auth (JWT), types
```
