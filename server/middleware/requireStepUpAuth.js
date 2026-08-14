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

// Verifies req.user's password against admins.password_hash, using
// reauthPassword from the body or x-reauth-password header. Returns a
// plain boolean — does NOT touch res, so callers decide how to respond.
// Extracted so routes that need a step-up check on only PART of a
// request (e.g. a PUT that's mostly non-sensitive fields, only requiring
// this when a sensitive field is actually changing) can call it directly
// instead of gating the entire route behind the requireStepUpAuth
// middleware.
async function verifyReauthPassword(req) {
  if (!req.user || !req.user.username) return false;

  const reauthPassword = req.body?.reauthPassword || req.headers['x-reauth-password'];
  if (!reauthPassword) return false;

  const result = await pool.query(
    'SELECT * FROM admins WHERE username = $1',
    [req.user.username]
  );
  const admin = result.rows[0];
  if (!admin) return false;

  return bcrypt.compare(reauthPassword, admin.password_hash);
}

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

    const passwordMatches = await verifyReauthPassword(req);
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
module.exports.verifyReauthPassword = verifyReauthPassword;