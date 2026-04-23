-- ─────────────────────────────────────────
-- VELA — Supabase Database Schema
-- Run this in your Supabase SQL Editor
-- Dashboard → SQL Editor → New Query → Paste → Run
-- ─────────────────────────────────────────

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
-- USERS TABLE
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT NOT NULL,
  email                 TEXT UNIQUE NOT NULL,
  password_hash         TEXT NOT NULL,
  tier                  TEXT NOT NULL DEFAULT 'explorer' CHECK (tier IN ('explorer', 'premier', 'elite')),
  
  -- Stripe
  stripe_customer_id    TEXT UNIQUE,
  stripe_subscription_id TEXT,
  subscription_status   TEXT DEFAULT 'inactive',
  
  -- Password reset
  reset_token           TEXT,
  reset_token_expires   TIMESTAMPTZ,
  
  -- Preferences (stored as JSON)
  preferences           JSONB DEFAULT '{
    "preferredCabinClass": "economy",
    "hotelTier": "any",
    "diningReservations": true,
    "privateAviation": false,
    "autonomousBooking": false,
    "emailNotifications": true,
    "smsAlerts": false
  }'::jsonb,
  
  -- Timestamps
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  last_login            TIMESTAMPTZ
);

-- ─────────────────────────────────────────
-- TRIPS TABLE
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Basic info
  title                 TEXT NOT NULL,
  destination           TEXT NOT NULL,
  dream_description     TEXT,
  departure_city        TEXT,
  
  -- Dates
  departure_date        DATE,
  return_date           DATE,
  
  -- Travelers
  travelers_adults      INTEGER DEFAULT 1,
  travelers_children    INTEGER DEFAULT 0,
  
  -- Budget
  total_budget          TEXT,
  budget_label          TEXT,
  
  -- Tier & preferences
  tier                  TEXT DEFAULT 'explorer',
  vibes                 TEXT[] DEFAULT '{}',
  accommodation_style   TEXT[] DEFAULT '{}',
  special_requests      TEXT,
  
  -- AI Output
  ai_itinerary          TEXT,
  
  -- Status
  status                TEXT DEFAULT 'planning' CHECK (status IN (
    'planning', 'itinerary_ready', 'booking_in_progress', 'booked', 'completed', 'cancelled'
  )),
  
  -- Booking confirmation
  confirmed_at          TIMESTAMPTZ,
  notes                 TEXT,
  
  -- Timestamps
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- VAULT ITEMS TABLE
-- Stores metadata only — NOT raw sensitive data
-- Raw card numbers stored via Stripe
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vault_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  type                  TEXT NOT NULL CHECK (type IN (
    'passport', 'payment_card', 'frequent_flyer', 'hotel_loyalty', 'visa'
  )),
  label                 TEXT NOT NULL,        -- e.g. "US Passport", "Visa Infinite"
  masked_value          TEXT NOT NULL,        -- e.g. "••• 7842", "•••• 4421"
  metadata              JSONB DEFAULT '{}',  -- Non-sensitive extras (expiry, airline name etc.)
  
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- BOOKINGS TABLE
-- Individual bookings within a trip
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id               UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  type                  TEXT NOT NULL CHECK (type IN (
    'flight', 'hotel', 'transfer', 'dining', 'experience', 'other'
  )),
  
  title                 TEXT NOT NULL,        -- e.g. "American Airlines AA169"
  description           TEXT,
  provider              TEXT,                 -- e.g. "American Airlines"
  confirmation_ref      TEXT,                 -- Booking reference
  
  -- Dates
  start_date            TIMESTAMPTZ,
  end_date              TIMESTAMPTZ,
  
  -- Cost
  cost                  DECIMAL(10,2),
  currency              TEXT DEFAULT 'USD',
  
  -- Status
  status                TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'cancelled', 'completed'
  )),
  
  -- Raw API response from booking provider
  provider_data         JSONB DEFAULT '{}',
  
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- AGENT ACTIVITY LOG
-- Every action taken by AI agents
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_logs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id               UUID REFERENCES trips(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  agent                 TEXT NOT NULL,        -- 'flight', 'hotel', 'transfer', etc.
  action                TEXT NOT NULL,        -- What the agent did
  status                TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'success', 'failed'
  )),
  result                TEXT,                 -- Human-readable outcome
  data                  JSONB DEFAULT '{}',  -- Full data
  
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- INDEXES (for performance)
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_trips_user_id ON trips(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_bookings_trip_id ON bookings(trip_id);
CREATE INDEX IF NOT EXISTS idx_vault_user_id ON vault_items(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_trip_id ON agent_logs(trip_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY (RLS)
-- Users can only access their own data
-- ─────────────────────────────────────────
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips         ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs    ENABLE ROW LEVEL SECURITY;

-- Note: RLS policies are enforced at the Supabase level
-- Our backend uses the service key which bypasses RLS
-- This is correct — our server enforces auth, not Supabase directly

-- ─────────────────────────────────────────
-- DONE
-- ─────────────────────────────────────────
-- Tables created:
-- ✓ users
-- ✓ trips
-- ✓ vault_items
-- ✓ bookings
-- ✓ agent_logs
