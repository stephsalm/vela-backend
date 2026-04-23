// ─────────────────────────────────────────
// VELA — AI Routes
// POST /api/ai/generate    — generate itinerary (streaming)
// POST /api/ai/refine      — refine existing itinerary
// POST /api/ai/question    — ask a question about a trip
// ─────────────────────────────────────────
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// All AI routes require auth
router.use(requireAuth);

// ─── BUILD SYSTEM PROMPT ───
function buildSystemPrompt(tier) {
  return `You are Vela, a world-class AI luxury travel concierge. You create detailed, 
beautifully written, highly personalized travel itineraries.

Your tone is elevated, inspiring, and knowledgeable — like a trusted friend who has 
traveled everywhere and knows exactly what each destination has to offer.

You use real hotel names, real restaurant names, real experiences. You include 
practical details like check-in times, reservation tips, and local knowledge.

Tier context:
- Explorer: Focus on value, smart choices, hidden gems
- Premier: Business class travel, 4-5 star hotels, curated dining
- Elite: Private aviation, ultra-luxury properties, exclusive access

Always structure your response with:
1. A brief evocative opening (2-3 sentences)
2. Day-by-day itinerary with morning/afternoon/evening
3. Accommodation recommendations
4. Dining highlights
5. Practical tips
6. Estimated cost breakdown

Current tier: ${tier}`;
}

// ─── BUILD USER PROMPT ───
function buildUserPrompt(data) {
  const {
    dreamDescription, destination, departureDate, returnDate,
    departureCity, adults, children, budget, tier,
    vibes, accommodationStyle, specialRequests
  } = data;

  const travelers = `${adults} adult${adults > 1 ? 's' : ''}${children > 0 ? `, ${children} child${children > 1 ? 'ren' : ''}` : ''}`;
  const dates = departureDate && returnDate
    ? `${new Date(departureDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} to ${new Date(returnDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
    : 'Dates flexible';

  return `Please create a detailed travel itinerary based on this client request:

DESTINATION: ${destination}
DATES: ${dates}
TRAVELERS: ${travelers}
DEPARTURE CITY: ${departureCity || 'Not specified'}
BUDGET: ${budget}
TIER: ${tier}
INTERESTS: ${vibes?.join(', ') || 'Open to suggestions'}
ACCOMMODATION PREFERENCE: ${accommodationStyle?.join(', ') || 'Flexible'}
SPECIAL REQUESTS: ${specialRequests || 'None'}

CLIENT'S OWN WORDS:
"${dreamDescription || 'Create something extraordinary.'}"

Please craft a deeply personalized itinerary that brings this vision to life.`;
}

// ─── GENERATE ITINERARY (STREAMING) ───
// POST /api/ai/generate
router.post('/generate', async (req, res) => {
  try {
    const {
      dreamDescription, destination, departureDate, returnDate,
      departureCity, adults = 2, children = 0, budget = '$10,000',
      tier = 'explorer', vibes = [], accommodationStyle = [],
      specialRequests = '', tripId = null
    } = req.body;

    if (!destination) {
      return res.status(400).json({ error: 'Destination is required.' });
    }

    // Set up streaming headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');

    const userTier = req.user.tier || tier;

    // Stream from Claude
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: buildSystemPrompt(userTier),
      messages: [{
        role: 'user',
        content: buildUserPrompt({
          dreamDescription, destination, departureDate, returnDate,
          departureCity, adults, children, budget,
          tier: userTier, vibes, accommodationStyle, specialRequests
        })
      }]
    });

    let fullText = '';

    // Stream each chunk to client
    stream.on('text', (text) => {
      fullText += text;
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    // When done
    stream.on('finalMessage', async (message) => {
      // Send done signal
      res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`);
      res.end();

      // Save to database if tripId provided
      if (tripId) {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_KEY
        );
        await supabase
          .from('trips')
          .update({ ai_itinerary: fullText, status: 'itinerary_ready' })
          .eq('id', tripId)
          .eq('user_id', req.user.id);
      }
    });

    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    console.error('AI generate error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate itinerary.' });
    }
  }
});

// ─── REFINE ITINERARY ───
// POST /api/ai/refine
router.post('/refine', async (req, res) => {
  try {
    const { originalItinerary, refinementRequest, tripId } = req.body;

    if (!originalItinerary || !refinementRequest) {
      return res.status(400).json({ error: 'Original itinerary and refinement request required.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: buildSystemPrompt(req.user.tier),
      messages: [
        {
          role: 'user',
          content: `Here is an existing travel itinerary:\n\n${originalItinerary}\n\nPlease refine it based on this request: "${refinementRequest}"\n\nKeep the overall structure but incorporate the requested changes.`
        }
      ]
    });

    let fullText = '';
    stream.on('text', (text) => {
      fullText += text;
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    stream.on('finalMessage', async () => {
      res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to refine itinerary.' });
  }
});

// ─── ASK A QUESTION ───
// POST /api/ai/question
router.post('/question', async (req, res) => {
  try {
    const { question, tripContext } = req.body;

    if (!question) return res.status(400).json({ error: 'Question is required.' });

    const systemPrompt = `You are Vela, a luxury travel concierge AI. Answer travel questions 
concisely and helpfully. If context about a specific trip is provided, use it to give 
personalized answers. Keep answers under 200 words unless detail is specifically needed.`;

    const userMessage = tripContext
      ? `Trip context: ${tripContext}\n\nQuestion: ${question}`
      : question;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    res.json({
      answer: message.content[0].text
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to answer question.' });
  }
});

export default router;
