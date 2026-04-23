// ─────────────────────────────────────────
// VELA — Trip Routes
// GET    /api/trips          — list user's trips
// POST   /api/trips          — create new trip
// GET    /api/trips/:id      — get single trip
// PUT    /api/trips/:id      — update trip
// DELETE /api/trips/:id      — delete trip
// POST   /api/trips/:id/confirm — confirm & book trip
// ─────────────────────────────────────────
import express from 'express';
import supabase from '../lib/supabase.js';
import { requireAuth, requireTier } from '../middleware/auth.js';

const router = express.Router();

// All trip routes require authentication
router.use(requireAuth);

// ─── LIST TRIPS ───
// GET /api/trips
router.get('/', async (req, res) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;

    let query = supabase
      .from('trips')
      .select(`
        id, title, destination, status, tier,
        departure_date, return_date, total_budget,
        travelers_adults, travelers_children,
        created_at, updated_at
      `)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);

    const { data: trips, error, count } = await query;
    if (error) throw error;

    res.json({ trips, count });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trips.' });
  }
});

// ─── GET SINGLE TRIP ───
// GET /api/trips/:id
router.get('/:id', async (req, res) => {
  try {
    const { data: trip, error } = await supabase
      .from('trips')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id) // Security: users can only see their own trips
      .single();

    if (error || !trip) {
      return res.status(404).json({ error: 'Trip not found.' });
    }

    res.json({ trip });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trip.' });
  }
});

// ─── CREATE TRIP ───
// POST /api/trips
router.post('/', async (req, res) => {
  try {
    const {
      title,
      destination,
      dream_description,
      departure_date,
      return_date,
      departure_city,
      travelers_adults = 1,
      travelers_children = 0,
      total_budget,
      budget_label,
      tier,
      vibes,
      accommodation_style,
      special_requests,
      ai_itinerary // The AI-generated itinerary text
    } = req.body;

    if (!destination) {
      return res.status(400).json({ error: 'Destination is required.' });
    }

    const { data: trip, error } = await supabase
      .from('trips')
      .insert({
        user_id: req.user.id,
        title: title || `${destination} Journey`,
        destination,
        dream_description,
        departure_date: departure_date || null,
        return_date: return_date || null,
        departure_city,
        travelers_adults,
        travelers_children,
        total_budget,
        budget_label,
        tier: tier || req.user.tier || 'explorer',
        vibes: vibes || [],
        accommodation_style: accommodation_style || [],
        special_requests,
        ai_itinerary,
        status: 'planning'
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Trip created successfully.',
      trip
    });

  } catch (err) {
    console.error('Create trip error:', err);
    res.status(500).json({ error: 'Failed to create trip.' });
  }
});

// ─── UPDATE TRIP ───
// PUT /api/trips/:id
router.put('/:id', async (req, res) => {
  try {
    // Verify ownership
    const { data: existing } = await supabase
      .from('trips')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!existing) return res.status(404).json({ error: 'Trip not found.' });

    const allowedFields = [
      'title', 'destination', 'dream_description',
      'departure_date', 'return_date', 'departure_city',
      'travelers_adults', 'travelers_children',
      'total_budget', 'budget_label', 'tier',
      'vibes', 'accommodation_style', 'special_requests',
      'ai_itinerary', 'status', 'notes'
    ];

    const updates = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });
    updates.updated_at = new Date().toISOString();

    const { data: trip, error } = await supabase
      .from('trips')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ message: 'Trip updated.', trip });

  } catch (err) {
    res.status(500).json({ error: 'Failed to update trip.' });
  }
});

// ─── DELETE TRIP ───
// DELETE /api/trips/:id
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('trips')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;

    res.json({ message: 'Trip deleted.' });

  } catch (err) {
    res.status(500).json({ error: 'Failed to delete trip.' });
  }
});

// ─── CONFIRM & BOOK TRIP ───
// POST /api/trips/:id/confirm
// This is where the booking agents would fire
router.post('/:id/confirm', requireTier('premier', 'elite'), async (req, res) => {
  try {
    const { data: trip } = await supabase
      .from('trips')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!trip) return res.status(404).json({ error: 'Trip not found.' });
    if (trip.status === 'booked') {
      return res.status(400).json({ error: 'Trip is already booked.' });
    }

    // Update status to booking_in_progress
    await supabase
      .from('trips')
      .update({ status: 'booking_in_progress', confirmed_at: new Date().toISOString() })
      .eq('id', trip.id);

    // TODO: Fire booking agents
    // - flightAgent.book(trip)
    // - hotelAgent.book(trip)
    // - transferAgent.book(trip)
    // - diningAgent.book(trip)
    // - experienceAgent.book(trip)

    // For now, simulate booking
    await new Promise(r => setTimeout(r, 1500));

    await supabase
      .from('trips')
      .update({ status: 'booked' })
      .eq('id', trip.id);

    res.json({
      message: 'Booking initiated. Agents are working on your trip.',
      tripId: trip.id,
      status: 'booking_in_progress'
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to confirm booking.' });
  }
});

export default router;
