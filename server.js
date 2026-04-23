// ─────────────────────────────────────────
// VELA BACKEND — Main Server
// ─────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

// Route imports
import authRoutes from './routes/auth.js';
import tripRoutes from './routes/trips.js';
import aiRoutes from './routes/ai.js';
import stripeRoutes from './routes/stripe.js';
import userRoutes from './routes/users.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── MIDDLEWARE ───
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Stripe webhooks need raw body — must come BEFORE express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());

// ─── HEALTH CHECK ───
app.get('/', (req, res) => {
  res.json({
    status: 'Vela API is running ✦',
    version: '1.0.0',
    environment: process.env.NODE_ENV
  });
});

// ─── ROUTES ───
app.use('/api/auth',   authRoutes);
app.use('/api/trips',  tripRoutes);
app.use('/api/ai',     aiRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/users',  userRoutes);

// ─── 404 HANDLER ───
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── ERROR HANDLER ───
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ─── START ───
app.listen(PORT, () => {
  console.log(`
  ✦ Vela API running
  ─────────────────
  Local:   http://localhost:${PORT}
  Mode:    ${process.env.NODE_ENV}
  `);
});

export default app;
