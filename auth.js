// ─────────────────────────────────────────
// VELA — Auth Middleware
// Verifies JWT token on protected routes
// ─────────────────────────────────────────
import jwt from 'jsonwebtoken';
import supabase from '../lib/supabase.js';

export async function requireAuth(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided. Please log in.' });
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, tier, created_at')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'User not found. Please log in again.' });
    }

    // Attach user to request
    req.user = user;
    next();

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid token. Please log in again.' });
  }
}

// Middleware to require a specific tier or higher
export function requireTier(...tiers) {
  return (req, res, next) => {
    const tierOrder = { explorer: 1, premier: 2, elite: 3 };
    const userTierLevel = tierOrder[req.user?.tier] || 0;
    const requiredLevel = Math.min(...tiers.map(t => tierOrder[t] || 99));

    if (userTierLevel < requiredLevel) {
      return res.status(403).json({
        error: `This feature requires ${tiers[0]} tier or higher.`,
        currentTier: req.user?.tier,
        requiredTier: tiers[0]
      });
    }
    next();
  };
}
