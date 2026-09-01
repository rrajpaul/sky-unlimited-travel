const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { pool } = require('../db');
const requireAdmin = require('../auth/authMiddleware');
const { sendMail } = require('../utils/mailer');
const { escapeHtml } = require('../utils/escapeHtml');
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

// Helper: load the currently active giveaway (archived_at IS NULL) from the
// giveaways table. There is at most one — enforced by a partial unique
// index in the migration, not just by convention here.
//
// start_date/end_date are TIMESTAMPTZ on this table (declared explicitly in
// migration_giveaways_unified.sql), so node-pg hands them back as correct
// absolute instants and a plain SELECT is right — no AT TIME ZONE needed.
async function getCurrentGiveaway() {
  const result = await pool.query(
    'SELECT id, start_date, end_date, prize_value_usd, prize_value_cad, destinations FROM giveaways WHERE archived_at IS NULL'
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
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
    const g = await getCurrentGiveaway();
    if (!g) {
      return res.status(404).json({ error: 'No giveaway settings configured yet.' });
    }
    res.json({
      id: g.id,
      startDate: g.start.toISOString(),
      endDate: g.end.toISOString(),
      prizeValueUsd: g.prizeValueUsd,
      prizeValueCad: g.prizeValueCad,
      destinations: g.destinations,
    });
  } catch (err) {
    console.error('Fetch giveaway settings error:', err);
    res.status(500).json({ error: 'Failed to fetch giveaway settings' });
  }
});

// PATCH update the giveaway settings (admin only). Updates the current
// active row in place if one exists (same id — entries already linked to
// it stay linked, unaffected by the edit); otherwise inserts a fresh row.
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
    const existing = await pool.query('SELECT id FROM giveaways WHERE archived_at IS NULL');

    let row;
    if (existing.rows.length > 0) {
      const updated = await pool.query(
        `UPDATE giveaways
         SET start_date = $1, end_date = $2, prize_value_usd = $3, prize_value_cad = $4, destinations = $5
         WHERE id = $6
         RETURNING *`,
        [start.toISOString(), end.toISOString(), usd, cad, JSON.stringify(destinations), existing.rows[0].id]
      );
      row = updated.rows[0];
    } else {
      const inserted = await pool.query(
        `INSERT INTO giveaways (start_date, end_date, prize_value_usd, prize_value_cad, destinations)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [start.toISOString(), end.toISOString(), usd, cad, JSON.stringify(destinations)]
      );
      row = inserted.rows[0];
    }

    res.json({
      ok: true,
      id: row.id,
      startDate: new Date(row.start_date).toISOString(),
      endDate: new Date(row.end_date).toISOString(),
      prizeValueUsd: parseFloat(row.prize_value_usd),
      prizeValueCad: parseFloat(row.prize_value_cad),
      destinations: row.destinations,
    });
  } catch (err) {
    console.error('Update giveaway settings error:', err);
    res.status(500).json({ error: 'Failed to update giveaway settings' });
  }
});

// POST archive the giveaway that just ended (admin only). One atomic
// UPDATE: flips archived_at on the active row, but only if it has actually
// ended — this is a server-side check, not just a UI affordance, since a
// giveaway can only ever be archived once (archived_at IS NULL is what the
// unique index and every other query in this file key off of).
router.post('/archive', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE giveaways
       SET archived_at = NOW()
       WHERE archived_at IS NULL AND end_date <= NOW()
       RETURNING *`
    );

    if (result.rows.length === 0) {
      const active = await pool.query('SELECT id FROM giveaways WHERE archived_at IS NULL');
      if (active.rows.length === 0) {
        return res.status(400).json({ error: 'No giveaway settings configured yet.' });
      }
      return res.status(400).json({ error: 'This giveaway has not ended yet.' });
    }

    const row = result.rows[0];
    res.json({
      ok: true,
      archived: {
        id: row.id,
        startDate: row.start_date,
        endDate: row.end_date,
        prizeValueUsd: parseFloat(row.prize_value_usd),
        prizeValueCad: parseFloat(row.prize_value_cad),
        destinations: row.destinations,
        archivedAt: row.archived_at,
      },
    });
  } catch (err) {
    console.error('Archive giveaway error:', err);
    res.status(500).json({ error: 'Failed to archive giveaway' });
  }
});

// GET past giveaways (admin only), most recently archived first
router.get('/history', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, start_date, end_date, prize_value_usd, prize_value_cad, destinations, archived_at
       FROM giveaways
       WHERE archived_at IS NOT NULL
       ORDER BY archived_at DESC`
    );
    res.json(
      result.rows.map((row) => ({
        id: row.id,
        startDate: row.start_date,
        endDate: row.end_date,
        prizeValueUsd: parseFloat(row.prize_value_usd),
        prizeValueCad: parseFloat(row.prize_value_cad),
        destinations: row.destinations,
        archivedAt: row.archived_at,
      }))
    );
  } catch (err) {
    console.error('Fetch giveaway history error:', err);
    res.status(500).json({ error: 'Failed to fetch past giveaways' });
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

// POST new giveaway entry (public — used by the site's entry form).
// Stores giveaway_id — the permanent link to whichever giveaway is active
// right now — alongside the existing destination and created_at (date
// entered) columns. If no giveaway is configured at all, giveaway_id stays
// NULL — same "always open" behaviour as before.
router.post('/', giveawayLimiter, async (req, res) => {
  let giveaway;
  try {
    giveaway = await getCurrentGiveaway();
    const now = new Date();
    if (giveaway && (now < giveaway.start || now > giveaway.end)) {
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

  // Build the allowed set from the active giveaway: its destinations, plus
  // "Either" only if more than one destination is currently offered.
  const activeDestinations = giveaway?.destinations?.length ? giveaway.destinations : ALLOWED_DESTINATIONS;
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
      `INSERT INTO giveaway_entries (name, email, destination, giveaway_id)
       VALUES ($1, $2, $3, $4)`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        safeDestination,
        giveaway?.id ?? null,
      ]
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
    const existing = await pool.query('SELECT id, giveaway_id FROM giveaway_entries WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    if (is_winner) {
      // Scoped to this entry's own giveaway — clearing winner flags across
      // every giveaway ever run would silently un-mark past winners too.
      const { giveaway_id } = existing.rows[0];
      await pool.query('UPDATE giveaway_entries SET is_winner = false WHERE giveaway_id IS NOT DISTINCT FROM $1', [giveaway_id]);
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
// sendMail util as your inquiries route, and the current giveaway settings
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

    const giveaway = await getCurrentGiveaway();
    const destinationLabel = giveaway?.destinations?.length
      ? (giveaway.destinations.length === 1
          ? giveaway.destinations[0]
          : giveaway.destinations.join(' or '))
      : entry.destination;
    const prizeLabel = giveaway
      ? `$${giveaway.prizeValueUsd} USD ($${giveaway.prizeValueCad} CAD)`
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
            <h2 style="color: #1a2947; margin-top: 0;">Hi ${escapeHtml(entry.name)},</h2>
            <p style="color: #6b7280;">
              Congratulations — you've been randomly selected as the winner of the
              Sky Unlimited Travel giveaway!
            </p>
            <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 4px 0; color: #374151;"><strong>Prize:</strong> ${escapeHtml(prizeLabel)} credit toward your ${escapeHtml(destinationLabel)} trip</p>
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

// POST pick a random winner (admin only). Eligible entries are now those
// whose giveaway_id matches the currently active giveaway — a direct link
// set at entry time — rather than re-deriving eligibility by comparing
// created_at to the live start/end dates. That date-range comparison used
// to run against ALL entries ever submitted, so two giveaways with
// overlapping or coincidentally similar windows could cross-contaminate
// each other's eligible pool; scoping by giveaway_id closes that off.
router.post('/pick-winner', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const current = await client.query('SELECT id FROM giveaways WHERE archived_at IS NULL');
    if (current.rows.length === 0) {
      return res.status(400).json({
        error: 'No giveaway settings configured yet. Set the start and end dates before picking a winner.',
      });
    }
    const giveawayId = current.rows[0].id;

    // Check eligibility BEFORE clearing the existing winner — otherwise a
    // giveaway with no entries would wipe the current winner and set no new
    // one, silently leaving the giveaway with nobody selected.
    const eligible = await client.query(
      'SELECT COUNT(*) AS c FROM giveaway_entries WHERE giveaway_id = $1',
      [giveawayId]
    );
    const eligibleCount = parseInt(eligible.rows[0].c, 10);

    if (eligibleCount === 0) {
      return res.status(400).json({
        error: 'No entries were submitted for this giveaway, so there is nobody to pick from.',
      });
    }

    // Clearing the old winner and setting the new one must be atomic — a
    // failure between the two would leave the giveaway with no winner at
    // all. Scoped to this giveaway_id so past giveaways' winners aren't
    // touched.
    await client.query('BEGIN');
    await client.query('UPDATE giveaway_entries SET is_winner = false WHERE giveaway_id = $1', [giveawayId]);
    const result = await client.query(
      `UPDATE giveaway_entries SET is_winner = true
       WHERE id = (
         SELECT id FROM giveaway_entries WHERE giveaway_id = $1 ORDER BY RANDOM() LIMIT 1
       )
       RETURNING *`,
      [giveawayId]
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