// ─────────────────────────────────────────
// VELA — Stripe Routes
// POST /api/stripe/create-checkout    — start subscription
// POST /api/stripe/portal             — manage subscription
// POST /api/stripe/webhook            — handle Stripe events
// GET  /api/stripe/subscription       — get current subscription
// ─────────────────────────────────────────
import express from 'express';
import Stripe from 'stripe';
import supabase from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Map tier names to Stripe price IDs
const TIER_PRICES = {
  explorer: process.env.STRIPE_PRICE_EXPLORER,
  premier:  process.env.STRIPE_PRICE_PREMIER,
  elite:    process.env.STRIPE_PRICE_ELITE
};

// Map tier names to display labels
const TIER_LABELS = {
  explorer: 'Explorer — $49/trip',
  premier:  'Premier — $99/month',
  elite:    'Elite — $499/month'
};

// ─── CREATE CHECKOUT SESSION ───
// POST /api/stripe/create-checkout
router.post('/create-checkout', requireAuth, async (req, res) => {
  try {
    const { tier } = req.body;

    if (!TIER_PRICES[tier]) {
      return res.status(400).json({ error: 'Invalid tier selected.' });
    }

    // Get or create Stripe customer
    let customerId = req.user.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: req.user.name,
        metadata: { userId: req.user.id }
      });
      customerId = customer.id;

      // Save to database
      await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', req.user.id);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: TIER_PRICES[tier],
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/dashboard?subscription=success&tier=${tier}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?subscription=cancelled`,
      metadata: {
        userId: req.user.id,
        tier
      },
      subscription_data: {
        metadata: {
          userId: req.user.id,
          tier
        }
      }
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });

  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
});

// ─── CUSTOMER PORTAL ───
// POST /api/stripe/portal
router.post('/portal', requireAuth, async (req, res) => {
  try {
    if (!req.user.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription found.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/dashboard`
    });

    res.json({ portalUrl: session.url });

  } catch (err) {
    res.status(500).json({ error: 'Failed to open billing portal.' });
  }
});

// ─── GET SUBSCRIPTION ───
// GET /api/stripe/subscription
router.get('/subscription', requireAuth, async (req, res) => {
  try {
    if (!req.user.stripe_customer_id) {
      return res.json({ subscription: null, tier: 'explorer' });
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: req.user.stripe_customer_id,
      status: 'active',
      limit: 1
    });

    const subscription = subscriptions.data[0] || null;

    res.json({
      subscription: subscription ? {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        tier: subscription.metadata.tier
      } : null,
      tier: req.user.tier
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to get subscription.' });
  }
});

// ─── STRIPE WEBHOOK ───
// POST /api/stripe/webhook
// Handles: checkout.session.completed, customer.subscription.deleted, etc.
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      // ── Subscription created / payment succeeded ──
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { userId, tier } = session.metadata;

        if (userId && tier) {
          await supabase
            .from('users')
            .update({
              tier,
              stripe_subscription_id: session.subscription,
              subscription_status: 'active'
            })
            .eq('id', userId);

          console.log(`✓ User ${userId} upgraded to ${tier}`);
        }
        break;
      }

      // ── Subscription cancelled ──
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const { userId } = subscription.metadata;

        if (userId) {
          await supabase
            .from('users')
            .update({ tier: 'explorer', subscription_status: 'cancelled' })
            .eq('id', userId);

          console.log(`✓ User ${userId} downgraded to explorer`);
        }
        break;
      }

      // ── Payment failed ──
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.log(`Payment failed for customer ${invoice.customer}`);
        // TODO: Send payment failure email
        break;
      }

      default:
        console.log(`Unhandled event: ${event.type}`);
    }

    res.json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).json({ error: 'Webhook handler failed.' });
  }
});

export default router;
