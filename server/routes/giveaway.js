const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { pool } = require('../db');
const requireAdmin = require('../auth/authMiddleware');
const { sendMail } = require('../utils/mailer');
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The full set of destinations this feature supports choosing from.
// Add new ones here if you expand beyond Bahamas/Jamaica later.
const ALLOWED_DESTINATIONS = ['Bahamas', 'Jamaica'];

const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;

// Helper: verify a Turnstile token with Cloudflare's siteverify endpoint.
// Fails closed — if the secret isn't configured or the request errors out,
// verification is treated as failed rather than silently allowed through.
async function verifyTurnstile(token, remoteip) {
  if (!TURNSTILE_SECRET_KEY) {
    throw new Error('TURNSTILE_SECRET_KEY is not configured');
  }
  if (!token) {
    return { success: false, 'error-codes': ['missing-input-response'] };
  }

  const params = new URLSearchParams();
  params.append('secret', TURNSTILE_SECRET_KEY);
  params.append('response', token);
  if (remoteip) params.append('remoteip', remoteip);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: params,
      signal: controller.signal,
    });
    return await res.json(); // { success: boolean, 'error-codes': [...], ... }
  } catch (err) {
    console.error('Turnstile verify request failed:', err);
    return { success: false, 'error-codes': ['internal-error'] };
  } finally {
    clearTimeout(timeout);
  }
}

// Helper: load the current giveaway settings from the DB.
//
// start_date/end_date are TIMESTAMP WITHOUT TIME ZONE, and the PATCH route
// below writes them via `.toISOString()` — so what's stored is a UTC wall
// clock with the offset dropped. node-pg parses a bare timestamp using the
// NODE PROCESS's local zone, so a plain `new Date(row.start_date)` silently
// reinterprets that UTC clock as local time: an end of 23:59:59 UTC becomes
// 23:59:59 EDT (= 03:59:59 UTC next day), shifting the whole window by the
// server's offset. That made the public entry form open and close four
// hours late in America/Toronto, and skewed the countdown on the site.
//
// `AT TIME ZONE 'UTC'` promotes each column to a timestamptz that says "this
// wall clock is UTC", which node-pg then parses into the correct absolute
// instant regardless of where the server runs.
async function getGiveawaySettings() {
  const result = await pool.query(
    `SELECT start_date AT TIME ZONE 'UTC' AS start_date,
            end_date   AT TIME ZONE 'UTC' AS end_date,
            prize_value_usd, prize_value_cad, destinations
     FROM giveaway_settings WHERE id = 1`
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    start: new Date(row.start_date),
    end: new Date(row.end_date),
    prizeValueUsd: parseFloat(row.prize_value_usd),
    prizeValueCad: parseFloat(row.prize_value_cad),
    destinations: row.destinations, // JSONB column, comes back already parsed as an array
  };
}

// GET current giveaway settings (public — the site's GiveawaySection reads
// this on load to decide whether to show "coming soon", the form, or
// "ended", what prize amount to display, and which destination(s) to offer)
router.get('/settings', async (req, res) => {
  try {
    const settings = await getGiveawaySettings();
    if (!settings) {
      return res.status(404).json({ error: 'No giveaway settings configured yet.' });
    }
    res.json({
      startDate: settings.start.toISOString(),
      endDate: settings.end.toISOString(),
      prizeValueUsd: settings.prizeValueUsd,
      prizeValueCad: settings.prizeValueCad,
      destinations: settings.destinations,
    });
  } catch (err) {
    console.error('Fetch giveaway settings error:', err);
    res.status(500).json({ error: 'Failed to fetch giveaway settings' });
  }
});

// PATCH update the giveaway settings (admin only)
router.patch('/settings', requireAdmin, async (req, res) => {
  const { startDate, endDate, prizeValueUsd, prizeValueCad, destinations } = req.body;

  const start = new Date(startDate);
  const end = new Date(endDate);
  const usd = parseFloat(prizeValueUsd);
  const cad = parseFloat(prizeValueCad);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: 'Invalid start or end date.' });
  }
  if (start >= end) {
    return res.status(400).json({ error: 'Start date must be before end date.' });
  }
  if (isNaN(usd) || usd <= 0 || isNaN(cad) || cad <= 0) {
    return res.status(400).json({ error: 'Prize values must be positive numbers.' });
  }
  if (!Array.isArray(destinations) || destinations.length === 0) {
    return res.status(400).json({ error: 'Select at least one destination.' });
  }
  const invalid = destinations.filter((d) => !ALLOWED_DESTINATIONS.includes(d));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Invalid destination(s): ${invalid.join(', ')}` });
  }

  try {
    await pool.query(
      `INSERT INTO giveaway_settings (id, start_date, end_date, prize_value_usd, prize_value_cad, destinations, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE
       SET start_date = $1, end_date = $2, prize_value_usd = $3, prize_value_cad = $4, destinations = $5, updated_at = NOW()`,
      [start.toISOString(), end.toISOString(), usd, cad, JSON.stringify(destinations)]
    );
    res.json({
      ok: true,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      prizeValueUsd: usd,
      prizeValueCad: cad,
      destinations,
    });
  } catch (err) {
    console.error('Update giveaway settings error:', err);
    res.status(500).json({ error: 'Failed to update giveaway settings' });
  }
});

// GET all giveaway entries (admin only)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM giveaway_entries ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch giveaway entries error:', err);
    res.status(500).json({ error: 'Failed to fetch giveaway entries' });
  }
});

const giveawayLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // Default is the previous hardcoded 5, so production behaviour is
  // unchanged. Configurable because every test that exercises this route
  // shares one IP (127.0.0.1), so a fixed limit of 5 makes the 6th request
  // in a suite return 429 regardless of what it was actually testing.
  // .env.test raises it; nothing else sets it.
  max: parseInt(process.env.GIVEAWAY_RATE_LIMIT_MAX || '5', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many entries. Please try again later.'
  }
});

// POST new giveaway entry (public — used by the site's entry form)
router.post('/', giveawayLimiter, async (req, res) => {
  let settings;
  try {
    settings = await getGiveawaySettings();
    const now = new Date();
    if (settings && (now < settings.start || now > settings.end)) {
      return res.status(403).json({ error: 'This giveaway is not currently accepting entries.' });
    }
  } catch (err) {
    console.error('Giveaway window check error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  const { name, email, destination, turnstileToken, website } = req.body;

  // Honeypot: this hidden field should always be empty for real users.
  // If it's filled in, it's a bot — pretend success so it doesn't learn
  // its submission was flagged, but don't actually write anything.
  if (website && website.trim() !== '') {
    console.warn('Giveaway honeypot triggered', { ip: req.ip });
    return res.json({ ok: true });
  }

  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  if (!turnstileToken) {
    return res.status(400).json({ error: 'Missing security verification. Please try again.' });
  }

  try {
    const verification = await verifyTurnstile(turnstileToken, req.ip);
    if (!verification.success) {
      console.warn('Turnstile verification failed:', verification['error-codes']);
      return res.status(403).json({ error: 'Security verification failed. Please try again.' });
    }
  } catch (err) {
    console.error('Turnstile verification error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  // Build the allowed set from live settings: the active destinations, plus
  // "Either" only if more than one destination is currently offered.
  const activeDestinations = settings?.destinations?.length ? settings.destinations : ALLOWED_DESTINATIONS;
  const allowedForEntry = activeDestinations.length > 1
    ? [...activeDestinations, 'Either']
    : activeDestinations;

  // If there's only one active destination, force it regardless of what was
  // submitted — there's no real choice to make in that case.
  const safeDestination = activeDestinations.length === 1
    ? activeDestinations[0]
    : (allowedForEntry.includes(destination) ? destination : activeDestinations[0]);

  try {
    // Prevent the same email entering more than once
    const existing = await pool.query(
      'SELECT id FROM giveaway_entries WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'This email has already entered.' });
    }

    await pool.query(
      `INSERT INTO giveaway_entries (name, email, destination)
       VALUES ($1, $2, $3)`,
      [name.trim(), email.trim().toLowerCase(), safeDestination]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Giveaway entry insert error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// PATCH set winner status explicitly (admin only) — body: { is_winner: true|false }
router.patch('/:id/winner', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_winner } = req.body;

  if (typeof is_winner !== 'boolean') {
    return res.status(400).json({ error: 'is_winner must be true or false.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM giveaway_entries WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    if (is_winner) {
      await pool.query('UPDATE giveaway_entries SET is_winner = false');
      await pool.query('UPDATE giveaway_entries SET is_winner = true WHERE id = $1', [id]);
    } else {
      await pool.query('UPDATE giveaway_entries SET is_winner = false WHERE id = $1', [id]);
    }

    res.json({ ok: true, is_winner });
  } catch (err) {
    console.error('Update winner status error:', err);
    res.status(500).json({ error: 'Failed to update winner status' });
  }
});

// POST send the "you won" email to a specific entry (admin only)
// Requires the entry to already be marked as the winner. Uses the same
// sendMail util as your inquiries route, and live giveaway settings
// (prize amount, destination, dates) so the email always matches what's
// configured, without hardcoding amounts here.
router.post('/:id/send-winner-email', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const entryResult = await pool.query('SELECT * FROM giveaway_entries WHERE id = $1', [id]);
    const entry = entryResult.rows[0];

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    if (!entry.is_winner) {
      return res.status(400).json({ error: 'This entry is not marked as the winner. Mark them as winner first.' });
    }

    const settings = await getGiveawaySettings();
    const destinationLabel = settings?.destinations?.length
      ? (settings.destinations.length === 1
          ? settings.destinations[0]
          : settings.destinations.join(' or '))
      : entry.destination;
    const prizeLabel = settings
      ? `$${settings.prizeValueUsd} USD ($${settings.prizeValueCad} CAD)`
      : 'your prize';

    await sendMail({
      to: entry.email,
      subject: `Congratulations, ${entry.name} — You Won the Sky Unlimited Travel Giveaway! 🎉`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #1a2947; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">You're Our Winner! 🎉</h1>
          </div>
          <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #1a2947; margin-top: 0;">Hi ${entry.name},</h2>
            <p style="color: #6b7280;">
              Congratulations — you've been randomly selected as the winner of the
              Sky Unlimited Travel giveaway!
            </p>
            <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 4px 0; color: #374151;"><strong>Prize:</strong> ${prizeLabel} credit toward your ${destinationLabel} trip</p>
            </div>
            <p style="color: #6b7280;">
              To claim your prize, please reply to this email or contact us at
              <a href="mailto:info@skyunlimitedtravel.com">info@skyunlimitedtravel.com</a>
              within <strong>7 business days</strong>. Your credit must be used
              toward a booking within <strong>3 months</strong> of this notification.
            </p>
            <p style="color: #9ca3af; font-size: 13px;">If you have any questions, just reply to this email — we're happy to help.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
              © ${new Date().getFullYear()} Sky Unlimited Travel Inc. All rights reserved.
            </p>
          </div>
        </div>
      `,
    });

    await pool.query(
      `UPDATE giveaway_entries
       SET winner_email_sent = true, winner_email_sent_at = NOW()
       WHERE id = $1`,
      [id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Send winner email error:', err);
    res.status(500).json({ error: 'Failed to send winner email' });
  }
});

// POST pick a random winner (admin only).
// Only entries whose created_at falls inside the configured giveaway window
// are eligible. Entries submitted outside that window (e.g. rows created
// before the current start/end dates were set, or seeded/test rows) are
// never selected.
//
// IMPORTANT: the window comparison happens entirely in SQL, against the
// giveaway_settings columns directly. Do NOT route these timestamps through
// JS Dates (e.g. getGiveawaySettings() + .toISOString()) — start_date,
// end_date and created_at are all TIMESTAMP WITHOUT TIME ZONE, so node-pg
// hands them back as Dates interpreted in the server's LOCAL zone, and
// .toISOString() then re-labels that local time as UTC. On a machine running
// anything other than UTC that silently shifts the window by the local
// offset (e.g. an end of 23:59:59 becomes 03:59:59 the next day in
// America/Toronto), letting late entries win and excluding entries that sat
// exactly on the start boundary. Comparing TIMESTAMP to TIMESTAMP inside
// Postgres sidesteps the conversion entirely.
router.post('/pick-winner', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const settingsCheck = await client.query('SELECT 1 FROM giveaway_settings WHERE id = 1');
    if (settingsCheck.rows.length === 0) {
      return res.status(400).json({
        error: 'No giveaway settings configured yet. Set the start and end dates before picking a winner.',
      });
    }

    // Check eligibility BEFORE clearing the existing winner — otherwise a
    // window with no entries would wipe the current winner and set no new
    // one, silently leaving the giveaway with nobody selected.
    const eligible = await client.query(
      `SELECT COUNT(*) AS c FROM giveaway_entries e
       WHERE e.created_at >= (SELECT start_date FROM giveaway_settings WHERE id = 1)
         AND e.created_at <= (SELECT end_date FROM giveaway_settings WHERE id = 1)`
    );
    const eligibleCount = parseInt(eligible.rows[0].c, 10);

    if (eligibleCount === 0) {
      return res.status(400).json({
        error: 'No entries were submitted within the giveaway window, so there is nobody to pick from.',
      });
    }

    // Clearing the old winner and setting the new one must be atomic — a
    // failure between the two would leave the giveaway with no winner at all.
    await client.query('BEGIN');
    await client.query('UPDATE giveaway_entries SET is_winner = false');
    const result = await client.query(
      `UPDATE giveaway_entries SET is_winner = true
       WHERE id = (
         SELECT e.id FROM giveaway_entries e
         WHERE e.created_at >= (SELECT start_date FROM giveaway_settings WHERE id = 1)
           AND e.created_at <= (SELECT end_date FROM giveaway_settings WHERE id = 1)
         ORDER BY RANDOM() LIMIT 1
       )
       RETURNING *`
    );
    await client.query('COMMIT');

    res.json({ ok: true, winner: result.rows[0], eligibleCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Pick winner error:', err);
    res.status(500).json({ error: 'Failed to pick a winner' });
  } finally {
    client.release();
  }
});

module.exports = router;