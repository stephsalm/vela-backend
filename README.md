# Vela Backend — Setup Guide

## What this is
The complete backend API for Vela — AI-powered travel concierge.
Built with: Node.js, Express, Supabase, Anthropic, Stripe.

---

## Prerequisites
- Node.js v18+ installed (you have v22 ✓)
- A Supabase account (free) — supabase.com
- An Anthropic API key — console.anthropic.com
- A Stripe account (free) — stripe.com

---

## Step 1 — Set up Supabase

1. Go to **supabase.com** → Create account → New Project
2. Name it `vela` → set a database password → Create
3. Wait ~2 minutes for it to spin up
4. Go to **Settings → API** — copy:
   - Project URL
   - `anon` public key
   - `service_role` secret key (keep this secret!)
5. Go to **SQL Editor → New Query**
6. Paste the entire contents of `database/schema.sql`
7. Click **Run** — all tables will be created

---

## Step 2 — Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in:
- `SUPABASE_URL` — from Supabase Settings → API
- `SUPABASE_ANON_KEY` — from Supabase Settings → API
- `SUPABASE_SERVICE_KEY` — from Supabase Settings → API (secret!)
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `STRIPE_SECRET_KEY` — from stripe.com → Developers → API Keys
- `JWT_SECRET` — make up a long random string (50+ characters)

---

## Step 3 — Set up Stripe

1. Go to **stripe.com** → Create account
2. Go to **Developers → API Keys** → copy Secret Key → paste in `.env`
3. Go to **Products → Add Product**:
   - Create "Vela Explorer" — $49 one-time → copy Price ID
   - Create "Vela Premier" — $99/month → copy Price ID
   - Create "Vela Elite" — $499/month → copy Price ID
4. Paste all three Price IDs in `.env`
5. For webhooks (local testing):
   ```bash
   npx stripe listen --forward-to localhost:3001/api/stripe/webhook
   ```
   Copy the webhook secret it gives you → paste as `STRIPE_WEBHOOK_SECRET`

---

## Step 4 — Install & run

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# You should see:
# ✦ Vela API running
# Local: http://localhost:3001
```

---

## API Endpoints

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/signup | Create account |
| POST | /api/auth/login | Log in |
| GET | /api/auth/me | Get current user |
| POST | /api/auth/forgot-password | Request password reset |
| POST | /api/auth/reset-password | Reset password |

### Trips
| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/trips | List all trips |
| POST | /api/trips | Create trip |
| GET | /api/trips/:id | Get single trip |
| PUT | /api/trips/:id | Update trip |
| DELETE | /api/trips/:id | Delete trip |
| POST | /api/trips/:id/confirm | Confirm & book (Premier+) |

### AI
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/ai/generate | Generate itinerary (streaming) |
| POST | /api/ai/refine | Refine itinerary |
| POST | /api/ai/question | Ask travel question |

### Users
| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/users/profile | Get profile |
| PUT | /api/users/profile | Update profile |
| PUT | /api/users/preferences | Update preferences |
| GET | /api/users/vault | Get vault items |
| POST | /api/users/vault | Add vault item |
| DELETE | /api/users/vault/:id | Remove vault item |

### Stripe
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/stripe/create-checkout | Start subscription |
| POST | /api/stripe/portal | Open billing portal |
| GET | /api/stripe/subscription | Get current subscription |
| POST | /api/stripe/webhook | Stripe webhook handler |

---

## File Structure
```
vela-backend/
├── server.js              ← Main entry point
├── package.json
├── .env.example           ← Copy to .env and fill in
├── .env                   ← YOUR secrets (never commit this)
├── .gitignore
├── lib/
│   └── supabase.js        ← Database client
├── middleware/
│   └── auth.js            ← JWT verification
├── routes/
│   ├── auth.js            ← Signup, login, password reset
│   ├── trips.js           ← Trip CRUD + booking
│   ├── ai.js              ← Claude AI + streaming
│   ├── stripe.js          ← Payments + webhooks
│   └── users.js           ← Profile + vault
└── database/
    └── schema.sql         ← Run this in Supabase SQL Editor
```

---

## Next steps after setup

1. Connect the frontend HTML files to call these APIs
2. Add flight search via Amadeus API
3. Add hotel search via Booking.com Partner API
4. Add email sending via Resend
5. Deploy backend to Railway or Render (free tier available)

---

## Questions?
Every route is commented. Read the code — it's written to be understood.
