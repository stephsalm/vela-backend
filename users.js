// ─────────────────────────────────────────
// VELA — User Routes
// GET  /api/users/profile         — get profile
// PUT  /api/users/profile         — update profile
// PUT  /api/users/preferences     — update preferences
// GET  /api/users/vault           — get vault items
// POST /api/users/vault           — add vault item
// DELETE /api/users/vault/:id     — remove vault item
// ─────────────────────────────────────────
import express from 'express';
import supabase from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// ─── GET PROFILE ───
router.get('/profile', async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, tier, preferences, created_at, last_login')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;
    res.json({ user });

  } catch (err) {
    res.status(500).json({ error: 'Failed to get profile.' });
  }
});

// ─── UPDATE PROFILE ───
router.put('/profile', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required.' });

    const { data: user, error } = await supabase
      .from('users')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', req.user.id)
      .select('id, name, email, tier')
      .single();

    if (error) throw error;
    res.json({ message: 'Profile updated.', user });

  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ─── UPDATE PREFERENCES ───
router.put('/preferences', async (req, res) => {
  try {
    const {
      preferredCabinClass,
      hotelTier,
      diningReservations,
      privateAviation,
      autonomousBooking,
      emailNotifications,
      smsAlerts
    } = req.body;

    const preferences = {
      preferredCabinClass: preferredCabinClass || 'economy',
      hotelTier: hotelTier || 'any',
      diningReservations: diningReservations ?? true,
      privateAviation: privateAviation ?? false,
      autonomousBooking: autonomousBooking ?? false,
      emailNotifications: emailNotifications ?? true,
      smsAlerts: smsAlerts ?? false
    };

    const { error } = await supabase
      .from('users')
      .update({ preferences })
      .eq('id', req.user.id);

    if (error) throw error;
    res.json({ message: 'Preferences saved.', preferences });

  } catch (err) {
    res.status(500).json({ error: 'Failed to save preferences.' });
  }
});

// ─── GET VAULT ITEMS ───
// Note: We store only metadata, never raw card numbers or passport numbers
// Actual sensitive data is tokenized via Stripe or encrypted separately
router.get('/vault', async (req, res) => {
  try {
    const { data: items, error } = await supabase
      .from('vault_items')
      .select('id, type, label, masked_value, metadata, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ items });

  } catch (err) {
    res.status(500).json({ error: 'Failed to get vault.' });
  }
});

// ─── ADD VAULT ITEM ───
router.post('/vault', async (req, res) => {
  try {
    const { type, label, masked_value, metadata } = req.body;

    // Allowed vault item types
    const allowedTypes = ['passport', 'payment_card', 'frequent_flyer', 'hotel_loyalty', 'visa'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid vault item type.' });
    }

    if (!label || !masked_value) {
      return res.status(400).json({ error: 'Label and masked value are required.' });
    }

    const { data: item, error } = await supabase
      .from('vault_items')
      .insert({
        user_id: req.user.id,
        type,
        label,
        masked_value, // e.g. "•••• 4421" — never the real number
        metadata: metadata || {} // non-sensitive metadata only
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ message: 'Item added to vault.', item });

  } catch (err) {
    res.status(500).json({ error: 'Failed to add vault item.' });
  }
});

// ─── DELETE VAULT ITEM ───
router.delete('/vault/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('vault_items')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ message: 'Item removed from vault.' });

  } catch (err) {
    res.status(500).json({ error: 'Failed to remove vault item.' });
  }
});

export default router;
