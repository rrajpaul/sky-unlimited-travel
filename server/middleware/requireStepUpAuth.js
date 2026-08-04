// server/middleware/requireStepUpAuth.js
//
// Use on any route that returns decrypted sensitive fields (passport, DOB,
// medical/dietary, emergency contacts). The user must already have a valid
// session (authMiddleware sets req.user = { username } from the JWT) — this
// adds a second check: re-entering their password in THIS request before
// sensitive data is decrypted.
//
// Queries the `admins` table directly via the raw pg pool, matching the same
// username/password_hash pattern used in routes/admin.js's /login route.
//
// Frontend usage: when an admin clicks "Show sensitive info", prompt for
// their password, then send it as `reauthPassword` in the request body
// (or `x-reauth-password` header for a GET request).

const bcrypt = require('bcrypt');
const { pool } = require('../db');

async function requireStepUpAuth(req, res, next) {
  try {
    if (!req.user || !req.user.username) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const reauthPassword = req.body?.reauthPassword || req.headers['x-reauth-password'];
    if (!reauthPassword) {
      return res.status(401).json({
        error: 'Password re-entry required to view sensitive information',
        code: 'STEP_UP_REQUIRED',
      });
    }

    const result = await pool.query(
      'SELECT * FROM admins WHERE username = $1',
      [req.user.username]
    );
    const admin = result.rows[0];
    if (!admin) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const passwordMatches = await bcrypt.compare(reauthPassword, admin.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Mark this request as cleared for sensitive data. Route handlers should
    // check req.sensitiveAccessGranted before decrypting/returning anything.
    req.sensitiveAccessGranted = true;
    next();
  } catch (err) {
    console.error('requireStepUpAuth error:', err);
    res.status(500).json({ error: 'Authentication check failed' });
  }
}

module.exports = requireStepUpAuth;