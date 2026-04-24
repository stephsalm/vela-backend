// ═══════════════════════════════════════════
// VELA BACKEND — Single File Server
// Everything in one file for easy deployment
// ═══════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Anthropic from '@anthropic-ai/sdk';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── CLIENTS ───
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

// ─── MIDDLEWARE ───
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cors({ origin: '*', credentials: true }));

// ─── HELPERS ───
function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'vela-dev-secret', { expiresIn: '30d' });
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided.' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'vela-dev-secret');
    if (supabase) {
      const { data: user, error } = await supabase.from('users').select('id, email, name, tier').eq('id', decoded.userId).single();
      if (error || !user) return res.status(401).json({ error: 'User not found.' });
      req.user = user;
    } else {
      req.user = { id: decoded.userId, email: 'demo@vela.com', name: 'Demo User', tier: 'premier' };
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// ─── HEALTH CHECK ───
app.get('/', (req, res) => {
  res.json({
    status: 'Vela API is running',
    version: '1.0.0',
    supabase: supabase ? 'connected' : 'not configured',
    anthropic: process.env.ANTHROPIC_API_KEY ? 'connected' : 'not configured'
  });
});

// ── AUTH ──
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!supabase) {
      return res.status(201).json({ message: 'Account created!', token: generateToken('demo-id'), user: { id: 'demo-id', name, email, tier: 'explorer' } });
    }
    const { data: existing } = await supabase.from('users').select('id').eq('email', email.toLowerCase()).single();
    if (existing) return res.status(409).json({ error: 'Email already exists.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const { data: user, error } = await supabase.from('users').insert({ name, email: email.toLowerCase(), password_hash: passwordHash, tier: 'explorer' }).select('id, name, email, tier').single();
    if (error) throw error;
    res.status(201).json({ message: 'Welcome to Vela.', token: generateToken(user.id), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
    if (!supabase) {
      return res.json({ message: 'Welcome back.', token: generateToken('demo-id'), user: { id: 'demo-id', name: 'Demo User', email, tier: 'premier' } });
    }
    const { data: user } = await supabase.from('users').select('id, name, email, password_hash, tier').eq('email', email.toLowerCase()).single();
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });
    res.json({ message: 'Welcome back.', token: generateToken(user.id), user: { id: user.id, name: user.name, email: user.email, tier: user.tier } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

// ── AI ──
// Guest access allowed on generate — no login required
app.post('/api/ai/generate', async (req, res) => {
  // Set a default guest user if no auth provided
  if (!req.headers.authorization) {
    req.user = { id: 'guest', email: 'guest@vela.com', name: 'Guest', tier: 'explorer' };
  } else {
    try {
      const token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'vela-dev-secret');
      req.user = { id: decoded.userId, tier: 'premier' };
    } catch(e) {
      req.user = { id: 'guest', tier: 'explorer' };
    }
  }
  try {
    const { dreamDescription, destination, departureDate, returnDate, departureCity, adults = 2, children = 0, budget = '$10,000', tier = 'explorer', vibes = [], accommodationStyle = [], specialRequests = '' } = req.body;
    if (!destination) return res.status(400).json({ error: 'Destination is required.' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const travelers = `${adults} adult${adults > 1 ? 's' : ''}${children > 0 ? `, ${children} child${children > 1 ? 'ren' : ''}` : ''}`;
    const dates = departureDate && returnDate
      ? `${new Date(departureDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} to ${new Date(returnDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
      : 'Dates flexible';

    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: `You are Vela, a world-class AI luxury travel concierge. Create detailed, beautifully written, deeply personalized travel itineraries. Your tone is elevated and inspiring — like a trusted friend who has traveled everywhere. Use real hotel names, real restaurants, real experiences. Be specific. Current client tier: ${req.user.tier || tier}.`,
      messages: [{
        role: 'user',
        content: `Create a detailed travel itinerary:\n\nDESTINATION: ${destination}\nDATES: ${dates}\nTRAVELERS: ${travelers}\nDEPARTURE CITY: ${departureCity || 'Not specified'}\nBUDGET: ${budget}\nINTERESTS: ${vibes.join(', ') || 'Open to suggestions'}\nACCOMMODATION PREFERENCE: ${accommodationStyle.join(', ') || 'Flexible'}\nSPECIAL REQUESTS: ${specialRequests || 'None'}\nCLIENT'S OWN WORDS: "${dreamDescription || 'Create something extraordinary.'}"\n\nWrite a deeply personalized day-by-day itinerary. Include real properties, real restaurants, insider knowledge only someone who has been there would know. Add an evocative opening paragraph and estimated cost breakdown.`
      }]
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });
    stream.on('finalMessage', () => {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });
    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });
  } catch (err) {
    console.error('AI generate error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate itinerary.' });
  }
});

app.post('/api/ai/question', requireAuth, async (req, res) => {
  try {
    const { question, tripContext } = req.body;
    if (!question) return res.status(400).json({ error: 'Question required.' });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: 'You are Vela, a luxury travel concierge AI. Answer travel questions concisely and helpfully. Keep answers under 200 words.',
      messages: [{ role: 'user', content: tripContext ? `Trip context: ${tripContext}\n\nQuestion: ${question}` : question }]
    });
    res.json({ answer: message.content[0].text });
  } catch (err) {
    res.status(500).json({ error: 'Failed to answer question.' });
  }
});


// ── AI SIMPLE (non-streaming for mobile) ──
app.post('/api/ai/generate-simple', async (req, res) => {
  try {
    const { dreamDescription, destination, departureDate, returnDate, departureCity, adults = 2, children = 0, budget = '$10,000', tier = 'explorer', vibes = [], specialRequests = '' } = req.body;
    if (!destination) return res.status(400).json({ error: 'Destination is required.' });

    const travelers = `${adults} adult${adults > 1 ? 's' : ''}${children > 0 ? `, ${children} child${children > 1 ? 'ren' : ''}` : ''}`;
    const dates = departureDate && returnDate
      ? `${departureDate} to ${returnDate}`
      : 'Dates flexible';

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: 'You are Vela, a world-class AI luxury travel concierge. Create detailed, beautifully written, deeply personalized travel itineraries. Use real hotel names, real restaurants, real experiences. Be specific and inspiring.',
      messages: [{
        role: 'user',
        content: `Create a detailed travel itinerary:\n\nDESTINATION: ${destination}\nDATES: ${dates}\nTRAVELERS: ${travelers}\nDEPARTURE CITY: ${departureCity || 'Not specified'}\nBUDGET: ${budget}\nINTERESTS: ${vibes.join(', ') || 'Open to suggestions'}\nSPECIAL REQUESTS: ${specialRequests || 'None'}\nCLIENT DESCRIPTION: "${dreamDescription || 'Create something extraordinary.'}"\n\nWrite a deeply personalized day-by-day itinerary with real properties, real restaurants, and insider knowledge. Include an evocative opening and estimated cost breakdown.`
      }]
    });

    res.json({ itinerary: message.content[0].text });
  } catch (err) {
    console.error('Simple generate error:', err);
    res.status(500).json({ error: 'Failed to generate itinerary. Please try again.' });
  }
});

// ── TRIPS ──
app.get('/api/trips', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.json({ trips: [] });
    const { data: trips, error } = await supabase.from('trips').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ trips });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch trips.' }); }
});

app.post('/api/trips', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(201).json({ message: 'Trip saved.', trip: { id: 'demo-' + Date.now(), ...req.body } });
    const { data: trip, error } = await supabase.from('trips').insert({ user_id: req.user.id, ...req.body, status: 'planning' }).select().single();
    if (error) throw error;
    res.status(201).json({ message: 'Trip created.', trip });
  } catch (err) { res.status(500).json({ error: 'Failed to create trip.' }); }
});

app.get('/api/trips/:id', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.json({ trip: { id: req.params.id } });
    const { data: trip, error } = await supabase.from('trips').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error || !trip) return res.status(404).json({ error: 'Trip not found.' });
    res.json({ trip });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch trip.' }); }
});

app.put('/api/trips/:id', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.json({ message: 'Trip updated.' });
    const { data: trip, error } = await supabase.from('trips').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ message: 'Trip updated.', trip });
  } catch (err) { res.status(500).json({ error: 'Failed to update trip.' }); }
});

app.delete('/api/trips/:id', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.json({ message: 'Trip deleted.' });
    await supabase.from('trips').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ message: 'Trip deleted.' });
  } catch (err) { res.status(500).json({ error: 'Failed to delete trip.' }); }
});

// ── USERS ──
app.get('/api/users/profile', requireAuth, (req, res) => res.json({ user: req.user }));

app.put('/api/users/preferences', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.json({ message: 'Preferences saved.', preferences: req.body });
    await supabase.from('users').update({ preferences: req.body }).eq('id', req.user.id);
    res.json({ message: 'Preferences saved.', preferences: req.body });
  } catch (err) { res.status(500).json({ error: 'Failed to save preferences.' }); }
});

app.get('/api/users/vault', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.json({ items: [] });
    const { data: items } = await supabase.from('vault_items').select('*').eq('user_id', req.user.id);
    res.json({ items: items || [] });
  } catch (err) { res.status(500).json({ error: 'Failed to get vault.' }); }
});

app.post('/api/users/vault', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(201).json({ message: 'Item added.' });
    const { type, label, masked_value, metadata } = req.body;
    const { data: item, error } = await supabase.from('vault_items').insert({ user_id: req.user.id, type, label, masked_value, metadata: metadata || {} }).select().single();
    if (error) throw error;
    res.status(201).json({ message: 'Item added.', item });
  } catch (err) { res.status(500).json({ error: 'Failed to add vault item.' }); }
});

app.delete('/api/users/vault/:id', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.json({ message: 'Item removed.' });
    await supabase.from('vault_items').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ message: 'Item removed.' });
  } catch (err) { res.status(500).json({ error: 'Failed to remove item.' }); }
});

// ── STRIPE ──
app.post('/api/stripe/create-checkout', requireAuth, async (req, res) => {
  try {
    const { tier } = req.body;
    const priceId = process.env[`STRIPE_PRICE_${tier?.toUpperCase()}`];
    if (!priceId) return res.status(400).json({ error: 'Stripe not fully configured yet.' });
    const customer = await stripe.customers.create({ email: req.user.email, name: req.user.name });
    const session = await stripe.checkout.sessions.create({
      customer: customer.id, payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }], mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'https://vela-jet-gamma.vercel.app'}/vela-dashboard.html?subscription=success`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://vela-jet-gamma.vercel.app'}/vela-pricing.html`,
      metadata: { userId: req.user.id, tier }
    });
    res.json({ checkoutUrl: session.url });
  } catch (err) { res.status(500).json({ error: 'Failed to create checkout.' }); }
});

app.post('/api/stripe/webhook', async (req, res) => {
  try {
    const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET || '');
    if (event.type === 'checkout.session.completed' && supabase) {
      const { userId, tier } = event.data.object.metadata || {};
      if (userId && tier) await supabase.from('users').update({ tier, subscription_status: 'active' }).eq('id', userId);
    }
    res.json({ received: true });
  } catch (err) { res.status(400).send(`Webhook Error: ${err.message}`); }
});

app.get('/api/stripe/subscription', requireAuth, (req, res) => {
  res.json({ tier: req.user.tier, subscription: null });
});


// ── WAITLIST ──
const waitlist = []; // In-memory store — replace with Supabase later
app.post('/api/waitlist', async (req, res) => {
  try {
    const { email, name, source } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });
    
    // Save to memory
    waitlist.push({ email, name, source, date: new Date().toISOString() });
    console.log(`New waitlist signup: ${email} (${source})`);
    
    // Save to Supabase if configured
    if (supabase) {
      await supabase.from('waitlist').insert({ email, name, source }).catch(() => {});
    }
    
    res.json({ message: 'Added to waitlist.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add to waitlist.' });
  }
});

// ── GET WAITLIST (admin) ──
app.get('/api/waitlist', async (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized.' });
  if (supabase) {
    const { data } = await supabase.from('waitlist').select('*').order('created_at', { ascending: false });
    return res.json({ waitlist: data || waitlist });
  }
  res.json({ waitlist });
});

// ─── START ───
app.listen(PORT, () => {
  console.log(`✦ Vela API running on port ${PORT}`);
});

export default app;
